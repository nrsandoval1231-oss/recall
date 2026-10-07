"""Automatic semantic indexing integration tests. Synthetic vectors only; no live provider."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from conftest import Env, PgCluster
from fake_provider import FakeProvider
from recall.ingestion.embeddings import EmbeddingConfig, EmbeddingProviderError, EmbeddingResult
from recall.ingestion.worker import Worker
from test_recall import AI, admin, capture_with, consent, drain


class FakeEmbeddings:
    def __init__(self, config: EmbeddingConfig) -> None:
        self.config = config
        self.calls: list[list[str]] = []
        self.before_result: Callable[[], None] | None = None
        self.fail = False

    def embed(self, texts: list[str], *, input_type: str) -> EmbeddingResult:
        assert input_type == "document"
        self.calls.append(texts)
        if self.before_result:
            self.before_result()
        if self.fail:
            raise EmbeddingProviderError("SYNTHETIC_OUTAGE")
        return EmbeddingResult(
            [[1.0, 0.0, 0.0] for _ in texts], self.config.model_id, 3, self.config.version, len(texts)
        )


@pytest.fixture
def embedding_env(
    pg_cluster: PgCluster, jwt_key: ec.EllipticCurvePrivateKey, tmp_path_factory: pytest.TempPathFactory
) -> Iterator[tuple[Env, FakeProvider, FakeEmbeddings]]:
    config = EmbeddingConfig("synthetic-not-real", "synthetic-vectors", 3, "test-v1", 1.0)
    fake = FakeProvider()
    overrides = {
        **AI,
        "embedding_provider": "voyage",
        "embedding_model_id": config.model_id,
        "embedding_api_key": config.api_key,
        "embedding_dimensions": config.dimensions,
        "embedding_version": config.version,
        "embedding_input_usd_per_mtok": config.input_usd_per_mtok,
    }
    env = Env(pg_cluster, jwt_key, tmp_path_factory.mktemp("embedding"), overrides=overrides, provider=fake)
    try:
        with psycopg.connect(env.admin_dsn) as conn:
            row = conn.execute("select to_regclass('public.search_chunk_embeddings')").fetchone()
            if row is None or row[0] is None:
                pytest.skip("pgvector is not installed in this local PostgreSQL")
        yield env, fake, FakeEmbeddings(config)
    finally:
        env.close()


def _worker(env: Env, fake: FakeProvider, embeddings: FakeEmbeddings) -> Worker:
    worker = Worker(env.worker_dsn, env.store, env.settings, fake, embedding_provider=embeddings)  # type: ignore[arg-type]
    worker.open()
    return worker


def _enable_index(env: Env, user_id: uuid.UUID) -> None:
    workspace = admin(env, "select workspace_id from workspace_members where user_id=%s", (user_id,))[0][0]
    admin(
        env,
        "insert into retrieval_index_config(workspace_id,provider,model_id,dimensions,embedding_version,enabled) "
        "values(%s,'voyage','synthetic-vectors',3,'test-v1',true) on conflict(workspace_id) do update "
        "set provider=excluded.provider,model_id=excluded.model_id,dimensions=excluded.dimensions,"
        "embedding_version=excluded.embedding_version,enabled=true",
        (workspace,),
    )


def _set_index_enabled(env: Env, user_id: uuid.UUID, *, enabled: bool) -> None:
    workspace = admin(env, "select workspace_id from workspace_members where user_id=%s", (user_id,))[0][0]
    admin(env, "update retrieval_index_config set enabled=%s where workspace_id=%s", (enabled, workspace))


def test_worker_can_discover_enabled_workspaces_without_content_scope(
    pg_cluster: PgCluster, jwt_key: ec.EllipticCurvePrivateKey, tmp_path_factory: pytest.TempPathFactory
) -> None:
    config = EmbeddingConfig("synthetic-not-real", "synthetic-vectors", 3, "test-v1", 1.0)
    overrides = {
        **AI,
        "embedding_provider": "voyage",
        "embedding_model_id": config.model_id,
        "embedding_api_key": config.api_key,
        "embedding_dimensions": config.dimensions,
        "embedding_version": config.version,
        "embedding_input_usd_per_mtok": config.input_usd_per_mtok,
    }
    env = Env(
        pg_cluster,
        jwt_key,
        tmp_path_factory.mktemp("embedding-discovery"),
        overrides=overrides,
        provider=FakeProvider(),
    )
    try:
        user = env.user()
        consent(user)
        _enable_index(env, user.id)
        workspace = admin(env, "select workspace_id from workspace_members where user_id=%s", (user.id,))[0][0]
        with psycopg.connect(env.worker_dsn) as conn:
            discovered = conn.execute("select workspace_id from recall_embedding_enabled_workspaces()").fetchall()
        assert discovered == [(workspace,)]
    finally:
        env.close()


def test_idle_sweep_indexes_new_chunk(embedding_env: tuple[Env, FakeProvider, FakeEmbeddings]) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)
    _set_index_enabled(env, user.id, enabled=False)
    worker = _worker(env, fake, embeddings)
    try:
        capture_with(env, user, fake, ["synthetic semantic backlog"])
        drain(worker)
        assert embeddings.calls == []
        _set_index_enabled(env, user.id, enabled=True)
        worker.run_once()  # idle sweep
        assert embeddings.calls
        assert admin(env, "select count(*) from search_chunk_embeddings")[0][0] > 0
    finally:
        worker.close()


def test_revoked_consent_during_call_records_usage_without_vector(
    embedding_env: tuple[Env, FakeProvider, FakeEmbeddings],
) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)

    def revoke() -> None:
        consent(user, enabled=False)

    embeddings.before_result = revoke
    worker = _worker(env, fake, embeddings)
    try:
        capture_with(env, user, fake, ["revocation race"])
        drain(worker)
        worker.run_once()
        assert admin(env, "select count(*) from search_chunk_embeddings")[0][0] == 0
        assert admin(env, "select count(*) from ai_usage where purpose='embedding'")[0][0] == 1
    finally:
        worker.close()


def test_provider_failure_sets_idle_backoff(embedding_env: tuple[Env, FakeProvider, FakeEmbeddings]) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)
    _set_index_enabled(env, user.id, enabled=False)
    worker = _worker(env, fake, embeddings)
    try:
        capture_with(env, user, fake, ["retry only after backoff"])
        drain(worker)
        assert embeddings.calls == []
        _set_index_enabled(env, user.id, enabled=True)
        embeddings.fail = True
        worker.run_once()
        assert embeddings.calls
        assert worker._embedding_retry_not_before
        calls = len(embeddings.calls)
        worker.run_once()
        assert len(embeddings.calls) == calls
    finally:
        worker.close()


def test_oversize_chunk_is_terminal_until_configured_limit_increases(
    embedding_env: tuple[Env, FakeProvider, FakeEmbeddings],
) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)
    worker = _worker(env, fake, embeddings)
    try:
        # Each line remains a valid grounded statement, while the complete
        # transcription exceeds the default 4096-byte embedding batch bound.
        text = "\n".join(["x" * 1000 for _ in range(5)])
        capture_with(env, user, fake, [text])
        drain(worker)
        for _ in range(10):
            worker.run_once()

        failed = admin(
            env,
            "select chunk_id,status,embedding is null from search_chunk_embeddings "
            "where status='failed' order by chunk_id",
        )
        assert failed and all(status == "failed" and missing for _, status, missing in failed)
        calls = len(embeddings.calls)
        worker.run_once()
        assert len(embeddings.calls) == calls

        env.settings.embedding_max_batch_tokens = 100_000
        worker.run_once()
        recovered = admin(
            env,
            "select status,embedding is not null from search_chunk_embeddings where chunk_id=%s",
            (failed[0][0],),
        )
        assert recovered == [("current", True)]
        assert len(embeddings.calls) == calls + 1
    finally:
        worker.close()


def test_workspace_erasure_during_embedding_call_discards_result_and_usage(
    embedding_env: tuple[Env, FakeProvider, FakeEmbeddings],
) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)

    def erase_workspace() -> None:
        preview = user.req("GET", "/v1/workspace/deletion-preview")
        assert preview.status_code == 200, preview.text
        erased = user.req(
            "DELETE",
            "/v1/workspace/data",
            headers={
                "Idempotency-Key": str(uuid.uuid4()),
                "If-Match": str(preview.json()["version"]),
            },
        )
        assert erased.status_code == 200, erased.text

    embeddings.before_result = erase_workspace
    worker = _worker(env, fake, embeddings)
    try:
        capture_with(env, user, fake, ["erase while the synthetic embedding call is in flight"])
        drain(worker)
        assert embeddings.calls
        assert admin(env, "select count(*) from embedding_reservations")[0][0] == 0
        assert admin(env, "select count(*) from search_chunk_embeddings")[0][0] == 0
        assert admin(env, "select count(*) from ai_usage where purpose='embedding'")[0][0] == 0
    finally:
        worker.close()


def test_corrected_chunk_is_reindexed(embedding_env: tuple[Env, FakeProvider, FakeEmbeddings]) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)
    worker = _worker(env, fake, embeddings)
    try:
        cap = capture_with(env, user, fake, ["pump 42 psi"])
        drain(worker)
        worker.run_once()
        memory = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
        claim = user.req("GET", f"/v1/memories/{memory}").json()["claims"][0]
        response = user.req(
            "POST",
            f"/v1/memories/{memory}/corrections",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
            json={
                "target": "claim",
                "claim_id": claim["claim_id"],
                "text": "pump 43 psi",
                "epistemic_state": "confirmed_by_user",
            },
        )
        assert response.status_code == 200, response.text
        worker.run_once()
        assert any("43" in text for batch in embeddings.calls for text in batch)
    finally:
        worker.close()


def test_configured_model_mismatch_never_calls_provider(
    embedding_env: tuple[Env, FakeProvider, FakeEmbeddings],
) -> None:
    env, fake, embeddings = embedding_env
    user = env.user()
    consent(user)
    _enable_index(env, user.id)
    admin(env, "update retrieval_index_config set model_id='wrong-space'")
    worker = _worker(env, fake, embeddings)
    try:
        capture_with(env, user, fake, ["must not leave Recall"])
        drain(worker)
        worker.run_once()
        assert embeddings.calls == []
    finally:
        worker.close()
