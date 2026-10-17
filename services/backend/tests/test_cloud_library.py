"""Synthetic native records against real PostgreSQL, RLS and private object storage."""

import base64
import hashlib
import uuid

from conftest import Env, synthetic_image


def capture(user, **extra):
    user.req("GET", "/v1/me")
    body = {
        "operation_id": str(uuid.uuid4()),
        "memory_id": str(uuid.uuid4()),
        "action": "capture",
        "expected_revision": 0,
        "note": "SYNTHETIC: pump pressure was 42 psi.",
        **extra,
    }
    result = user.req("POST", "/v1/library/mutations", json=body)
    assert result.status_code == 200, result.text
    return body, result.json()


def test_capture_retry_edit_conflict_delete_and_original(env: Env):
    user = env.user()
    body, row = capture(user)
    assert user.req("POST", "/v1/library/mutations", json=body).json() == row
    changed = {**body, "note": "Different source"}
    assert user.req("POST", "/v1/library/mutations", json=changed).status_code == 409
    edit = {
        "operation_id": str(uuid.uuid4()),
        "memory_id": row["id"],
        "expected_revision": 1,
        "action": "correct",
        "note": "SYNTHETIC correction: pressure is 43 psi.",
    }
    corrected = user.req("POST", "/v1/library/mutations", json=edit)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["revision"] == 2
    assert user.req("POST", "/v1/library/mutations", json=edit).json() == corrected.json()
    conflict = user.req(
        "POST", "/v1/library/mutations", json={**edit, "operation_id": str(uuid.uuid4()), "note": "Concurrent edit"}
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["details"]["current"]["revision"] == 2
    original = user.req("GET", f"/v1/library/memories/{row['id']}/source")
    assert original.content == body["note"].encode()
    assert original.headers["X-Recall-Source-SHA256"] == hashlib.sha256(original.content).hexdigest()
    assert original.headers["Cache-Control"] == "no-store"
    removed = user.req(
        "POST",
        "/v1/library/mutations",
        json={**edit, "expected_revision": 2, "action": "remove", "operation_id": str(uuid.uuid4())},
    )
    assert removed.json()["state"] == "deleted"
    assert user.req("GET", "/v1/library/memories").json() == []
    assert len(user.req("GET", "/v1/library/memories?include_deleted=true").json()) == 1
    assert len(user.req("GET", f"/v1/library/memories/{row['id']}/history").json()) == 3
    assert user.req("GET", f"/v1/library/memories/{row['id']}/source").content == original.content


def test_private_memory_isolation_and_validation(env: Env):
    user, other = env.user(), env.user()
    _, row = capture(user)
    other.req("GET", "/v1/me")
    assert other.req("GET", "/v1/library/memories").json() == []
    assert other.req("GET", f"/v1/library/memories/{row['id']}/source").status_code == 404
    assert env.client.get("/v1/library/memories").status_code == 401
    data = synthetic_image()
    body, image = capture(
        user, source_base64=base64.b64encode(data).decode(), mime_type="image/jpeg", source_name="synthetic.jpg"
    )
    assert user.req("GET", f"/v1/library/memories/{image['id']}/source").content == data
    bad = {**body, "operation_id": str(uuid.uuid4()), "memory_id": str(uuid.uuid4()), "source_sha256": "a" * 64}
    assert user.req("POST", "/v1/library/mutations", json=bad).status_code == 422
    bad["source_sha256"] = hashlib.sha256(data).hexdigest()
    bad["source_name"] = "../private"
    assert user.req("POST", "/v1/library/mutations", json=bad).status_code == 422
    answer = user.req("POST", "/v1/library/ask", json={"question": "pump pressure"}).json()
    assert row["id"] in [hit["memory_id"] for hit in answer["hits"]]
    assert "Keyword-only" in answer["message"]


def test_browser_cookie_is_http_only_revocable_and_csrf_protected(pg_cluster, jwt_key, tmp_path):
    site = "http://testserver"
    env = Env(pg_cluster, jwt_key, tmp_path, overrides={"site_origins": [site], "operator_token": "s" * 40})
    try:
        issued = env.client.post("/v1/operator/enrollments", json={}, headers={"Authorization": "Bearer " + "s" * 40})
        assert issued.status_code == 201, issued.text
        body = {"enrollment_token": issued.json()["enrollment_token"]}
        assert env.client.post("/v1/session", json=body).status_code == 403
        session = env.client.post("/v1/session", json=body, headers={"Origin": site})
        assert session.status_code == 200, session.text
        assert "session_token" not in session.json()
        assert "HttpOnly" in session.headers["set-cookie"]
        assert "SameSite=strict" in session.headers["set-cookie"]
        assert env.client.get("/v1/library/status").status_code == 200
        mutation = {
            "operation_id": str(uuid.uuid4()),
            "memory_id": str(uuid.uuid4()),
            "expected_revision": 0,
            "action": "capture",
            "note": "SYNTHETIC cookie session",
        }
        assert env.client.post("/v1/library/mutations", json=mutation).status_code == 403
        assert (
            env.client.post(
                "/v1/library/mutations", json=mutation, headers={"Origin": "https://evil.invalid"}
            ).status_code
            == 403
        )
        assert env.client.post("/v1/library/mutations", json=mutation, headers={"Origin": site}).status_code == 200
        assert env.client.delete("/v1/session", headers={"Origin": site}).status_code == 200
        assert env.client.get("/v1/library/status").status_code == 401
        assert env.client.post("/v1/session", json=body, headers={"Origin": site}).status_code == 401
    finally:
        env.close()


def test_native_import_preserves_ids_history_and_links(env: Env):
    user = env.user()
    user.req("GET", "/v1/me")
    identifier = str(uuid.uuid4())
    original = "SYNTHETIC original pump note"
    corrected = "SYNTHETIC corrected pump note [[Recall/Memories/linked-note.md]]"
    body = {
        "operation_id": identifier,
        "memory_id": identifier,
        "expected_revision": 0,
        "action": "import",
        "source_name": "note.txt",
        "mime_type": "text/plain",
        "note_path": "existing-note.md",
        "note": corrected,
        "source_base64": base64.b64encode(original.encode()).decode(),
        "captured_at": "2026-01-01T00:00:00Z",
        "history": [
            {
                "revision": 1,
                "note": original,
                "origin": "human:recall",
                "kind": "capture",
                "recorded_at": "2026-01-01T00:00:00Z",
            },
            {
                "revision": 2,
                "note": corrected,
                "origin": "human:obsidian",
                "kind": "external",
                "recorded_at": "2026-01-02T00:00:00Z",
            },
        ],
    }
    saved = user.req("POST", "/v1/library/mutations", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["id"] == identifier
    assert saved.json()["revision"] == 2
    assert saved.json()["note_path"] == "existing-note.md"
    assert user.req("POST", "/v1/library/mutations", json=body).json() == saved.json()
    history = user.req("GET", f"/v1/library/memories/{identifier}/history").json()
    assert history[0]["origin"] == "human:obsidian"
    assert history[-1]["note"] == original
    assert user.req("GET", f"/v1/library/memories/{identifier}/source").content == original.encode()
    bad = {**body, "operation_id": str(uuid.uuid4()), "memory_id": str(uuid.uuid4()), "history": [body["history"][1]]}
    assert user.req("POST", "/v1/library/mutations", json=bad).status_code == 422


def test_cloud_library_backup_restores_originals_and_pending_receipts(env: Env, pg_cluster, tmp_path):
    import psycopg

    from conftest import make_database
    from recall.db.backup import backup, restore
    from recall.storage.local import LocalObjectStore

    user = env.user()
    body, row = capture(user)
    archive = tmp_path / "synthetic-backup.zip"
    manifest = backup(env.admin_dsn, env.store, archive)
    assert any(item["source_id"].endswith(row["id"]) for item in manifest["originals"])
    owner, _ = make_database(pg_cluster, apply_migrations=False)
    restored_store = LocalObjectStore(tmp_path / "restored")
    restore(owner.replace("recall_owner@", "postgres@"), restored_store, archive)
    # Read as the isolated cluster operator for inventory comparison (RLS remains enabled).
    restored_admin = owner.replace("recall_owner@", "postgres@")
    with psycopg.connect(restored_admin) as conn:
        record = conn.execute(
            "select note,source_key,source_sha256 from library_documents where id=%s", (row["id"],)
        ).fetchone()
        assert record[0] == body["note"]
        assert b"".join(restored_store.iter_bytes(record[1])) == body["note"].encode()
        assert (
            conn.execute(
                "select count(*) from library_operations where operation_id=%s", (body["operation_id"],)
            ).fetchone()[0]
            == 1
        )


def test_remote_answer_requires_consent_and_valid_citations(pg_cluster, jwt_key, tmp_path):
    import json

    from fake_provider import FakeProvider
    from test_recall import AI

    provider = FakeProvider()
    env = Env(pg_cluster, jwt_key, tmp_path, overrides=AI, provider=provider)
    try:
        user = env.user()
        _, row = capture(user)
        question = {"question": "pump pressure"}
        assert "Keyword-only" in user.req("POST", "/v1/library/ask", json=question).json()["message"]
        assert not provider.answer_calls
        assert user.req("PUT", "/v1/settings/ai", json={"enabled": True}).status_code == 200
        provider.answer_script.append(
            json.dumps(
                {
                    "status": "answered",
                    "sentences": [{"text": "The recorded pump pressure was 42 psi.", "citation_ids": ["c1"]}],
                    "limitations": [],
                }
            )
        )
        answer = user.req("POST", "/v1/library/ask", json=question)
        assert answer.status_code == 200, answer.text
        assert answer.json()["citations"][0]["memory_id"] == row["id"]
        assert answer.json()["message"].startswith("AI-assisted answer:")
        provider.answer_script.append(
            json.dumps(
                {
                    "status": "answered",
                    "sentences": [{"text": "Unsupported claim", "citation_ids": ["c99"]}],
                    "limitations": [],
                }
            )
        )
        rejected = user.req("POST", "/v1/library/ask", json=question).json()
        assert "Unsupported claim" not in rejected["message"]
        assert "citations" not in rejected
        assert user.req("PUT", "/v1/settings/ai", json={"enabled": False}).status_code == 200
        calls = len(provider.answer_calls)
        user.req("POST", "/v1/library/ask", json=question)
        assert len(provider.answer_calls) == calls
    finally:
        env.close()
