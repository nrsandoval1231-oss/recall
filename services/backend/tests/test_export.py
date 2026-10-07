"""Authenticated deterministic export, history and byte preservation using real PG."""

import hashlib
import io
import json
import uuid
import zipfile

from conftest import Env
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_export_is_deterministic_private_and_retains_corrected_history(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, other = ai.user(), ai.user()
    cap = capture_with(ai, user, fake, ["Initial pressure was 42 psi."])
    other_cap = capture_with(ai, other, fake, ["Foreign private number 999."])
    consent(user)
    drain(worker)
    memory = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
    correction = user.req(
        "POST",
        f"/v1/memories/{memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "summary", "text": "Corrected interpretation: recorded 42 psi."},
    )
    assert correction.status_code == 200, correction.text
    first = user.req("POST", "/v1/exports")
    assert first.status_code == 200, first.text
    assert user.req("POST", "/v1/exports").content == first.content
    with zipfile.ZipFile(io.BytesIO(first.content)) as archive:
        document = json.loads(archive.read("recall.json"))
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["canonical_sha256"] == hashlib.sha256(archive.read("recall.json")).hexdigest()
        assert manifest["snapshot"] == document["snapshot"]
        assert document["snapshot"]["sync_clock"] > 0
        assert document["snapshot"]["schema_version"] == "0006_portability"
        assert [row["id"] for row in document["captures"]] == [cap["capture_id"]]
        assert other_cap["capture_id"] not in archive.read("recall.json").decode()
        assert len(document["memory_revisions"]) == 2 and document["memory_overrides"]
        assert all("storage_key" not in row for row in document["source_objects"])
        assert f"memories/{memory}.md" in archive.namelist()
        assert b"Corrected interpretation" in archive.read(f"memories/{memory}.md")
        for original in manifest["originals"]:
            assert hashlib.sha256(archive.read(original["path"])).hexdigest() == original["sha256"]
    assert ai.client.post("/v1/exports").status_code == 401
