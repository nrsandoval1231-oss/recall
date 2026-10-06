"""Test infrastructure: a throwaway real PostgreSQL cluster, a locally generated JWKS key,
and a private temp object store. Mocks do not establish RLS/storage correctness, so the
database is real; only the identity provider's signing key is local."""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from PIL import Image

from recall.api.app import create_app
from recall.api.auth import StaticKeyResolver, TokenVerifier
from recall.config import Settings
from recall.db.database import Database
from recall.db.migrate import migrate
from recall.storage.local import LocalObjectStore

ISSUER = "https://test-project.supabase.example/auth/v1"
AUDIENCE = "authenticated"
SIGNING_SECRET = "test-signing-secret-0123456789abcdef-not-real"
REPO_ROOT = Path(__file__).resolve().parents[3]


def _pg_bin() -> Path:
    for candidate in sorted(Path("/usr/lib/postgresql").glob("*/bin"), reverse=True):
        if (candidate / "initdb").exists():
            return candidate
    found = shutil.which("initdb")
    if found:
        return Path(found).parent
    pytest.skip("PostgreSQL server binaries (initdb) not available")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class PgCluster:
    """initdb/pg_ctl run as an unprivileged user when the suite runs as root."""

    def __init__(self) -> None:
        self.bin = _pg_bin()
        self.dir = Path(tempfile.mkdtemp(prefix="recall-pg-"))
        self.port = _free_port()
        self.as_user: str | None = None
        if os.geteuid() == 0:
            self.as_user = "postgres"
            shutil.chown(self.dir, user="postgres")
        self.dir.chmod(0o700)
        self._run(["initdb", "-D", str(self.dir / "data"), "-A", "trust", "-U", "postgres", "--no-sync"])
        self._run(
            [
                "pg_ctl",
                "-D",
                str(self.dir / "data"),
                "-w",
                "-l",
                str(self.dir / "pg.log"),
                "-o",
                f"-p {self.port} -k {self.dir} -c listen_addresses=127.0.0.1 -c fsync=off",
                "start",
            ]
        )

    def _run(self, args: list[str]) -> None:
        cmd = [str(self.bin / args[0]), *args[1:]]
        if self.as_user:
            cmd = ["runuser", "-u", self.as_user, "--", *cmd]
        subprocess.run(cmd, check=True, capture_output=True)

    def dsn(self, db: str = "postgres", user: str = "postgres") -> str:
        return f"postgresql://{user}@127.0.0.1:{self.port}/{db}"

    def stop(self) -> None:
        self._run(["pg_ctl", "-D", str(self.dir / "data"), "-m", "immediate", "stop"])
        shutil.rmtree(self.dir, ignore_errors=True)


@pytest.fixture(scope="session")
def pg_cluster() -> Iterator[PgCluster]:
    cluster = PgCluster()
    yield cluster
    cluster.stop()


def make_database(cluster: PgCluster, *, apply_migrations: bool = True) -> tuple[str, str]:
    """Fresh database. Returns (owner_dsn, app_dsn). The app role is NOT the owner."""
    name = f"recall_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(cluster.dsn(), autocommit=True) as conn:
        conn.execute(f'create database "{name}"')
        if conn.execute("select 1 from pg_roles where rolname='recall_owner'").fetchone() is None:
            conn.execute("create role recall_owner login createdb createrole")
        if conn.execute("select 1 from pg_roles where rolname='recall_api'").fetchone() is None:
            conn.execute("create role recall_api login nosuperuser nobypassrls")
    with psycopg.connect(cluster.dsn(name), autocommit=True) as conn:
        conn.execute(f'alter database "{name}" owner to recall_owner')
        conn.execute("grant all on schema public to recall_owner")
    owner_dsn = cluster.dsn(name, "recall_owner")
    if apply_migrations:
        migrate(owner_dsn)
        with psycopg.connect(cluster.dsn(name), autocommit=True) as conn:
            conn.execute("grant recall_app to recall_api")
    return owner_dsn, cluster.dsn(name, "recall_api")


@pytest.fixture(scope="session")
def jwt_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def make_token(key: ec.EllipticCurvePrivateKey, user_id: uuid.UUID, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "sub": str(user_id),
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + 3600,
        "email": f"{user_id.hex[:8]}@synthetic.invalid",
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="ES256")


class Env:
    """One migrated database + app + private storage, shared by a test module."""

    def __init__(self, cluster: PgCluster, key: ec.EllipticCurvePrivateKey, tmp: Path, store_dir: Path | None = None):
        self.owner_dsn, self.app_dsn = make_database(cluster)
        self.admin_dsn = self.owner_dsn.replace("recall_owner@", "postgres@")  # superuser: bypasses RLS, for assertions
        self.key = key
        self.store_dir = store_dir or tmp / "objects"
        self.settings = Settings(
            database_url=self.app_dsn,
            auth_issuer=ISSUER,
            auth_audience=AUDIENCE,
            auth_jwt_secret=None,
            auth_jwks_url="https://unused.invalid/jwks",
            signing_secret=SIGNING_SECRET,
            local_storage_dir=self.store_dir,
            capture_schema_path=REPO_ROOT / "packages/contracts/capture.schema.json",
        )
        self.store = LocalObjectStore(self.store_dir)
        self.db = Database(self.app_dsn)
        self.db.open()
        verifier = TokenVerifier(StaticKeyResolver(key.public_key(), ["ES256"]), ISSUER, AUDIENCE)
        self.app = create_app(self.settings, verifier=verifier, store=self.store, database=self.db)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def close(self) -> None:
        self.client.__exit__(None, None, None)
        self.db.close()

    def user(self) -> User:
        return User(self, uuid.uuid4())


class User:
    def __init__(self, env: Env, user_id: uuid.UUID):
        self.env = env
        self.id = user_id
        self.device_id = uuid.uuid4()

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(self.env.key, self.id)}"}

    def req(self, method: str, path: str, **kw: object):  # type: ignore[no-untyped-def]
        headers = {**self.headers, **kw.pop("headers", {})}  # type: ignore[arg-type]
        return self.env.client.request(method, path, headers=headers, **kw)  # type: ignore[arg-type]

    def register_device(self):  # type: ignore[no-untyped-def]
        return self.req("POST", "/v1/devices", json={"device_id": str(self.device_id), "platform": "ios"})


@pytest.fixture(scope="module")
def env(
    pg_cluster: PgCluster, jwt_key: ec.EllipticCurvePrivateKey, tmp_path_factory: pytest.TempPathFactory
) -> Iterator[Env]:
    e = Env(pg_cluster, jwt_key, tmp_path_factory.mktemp("env"))
    yield e
    e.close()


# ------------------------------------------------------------------ synthetic image fixtures
def synthetic_image(fmt: str = "JPEG", seed: int = 0, size: tuple[int, int] = (64, 48)) -> bytes:
    """A tiny, clearly synthetic test pattern. Not a real photo."""
    image = Image.new("RGB", size, (seed * 37 % 255, 80, 160))
    for x in range(size[0]):
        image.putpixel((x, x % size[1]), (255, seed * 11 % 255, 0))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_for(
    user: User,
    pages: list[bytes],
    *,
    media_type: str = "image/jpeg",
    client_capture_id: uuid.UUID | None = None,
    hint: str | None = "synthetic test capture",
) -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "client_capture_id": str(client_capture_id or uuid.uuid4()),
        "device_id": str(user.device_id),
        "captured_at": "2026-10-06T14:00:00-05:00",
        "timezone": "America/Chicago",
        "source_kind": "handwritten_note",
        "context_hint": hint,
        "pages": [
            {
                "client_page_id": str(uuid.uuid4()),
                "ordinal": i + 1,
                "media_type": media_type,
                "byte_size": len(data),
                "sha256": sha(data),
                "original_filename": f"synthetic-{i + 1}.jpg",
            }
            for i, data in enumerate(pages)
        ],
    }


def create_capture(user: User, manifest: dict[str, object], key: str | None = None):  # type: ignore[no-untyped-def]
    return user.req(
        "POST", "/v1/captures", json=manifest, headers={"Idempotency-Key": key or str(manifest["client_capture_id"])}
    )


def upload_all(user: User, capture: dict[str, object], pages: list[bytes]) -> None:
    auths = user.req("POST", f"/v1/captures/{capture['capture_id']}/upload-authorizations").json()["authorizations"]
    by_source = {a["source_id"]: a for a in auths}
    for page, data in zip(capture["pages"], pages, strict=True):  # type: ignore[arg-type]
        auth = by_source[page["source_id"]]
        resp = user.req("PUT", auth["url"], content=data, headers=auth["required_headers"])
        assert resp.status_code == 200, resp.text


def finalize(user: User, capture: dict[str, object], key: str | None = None, pages: list[bytes] | None = None):  # type: ignore[no-untyped-def]
    body = {"expected_pages": [{"source_id": p["source_id"], "sha256": p["declared_sha256"]} for p in capture["pages"]]}  # type: ignore[attr-defined]
    return user.req(
        "POST",
        f"/v1/captures/{capture['capture_id']}/finalize",
        json=body,
        headers={"Idempotency-Key": key or f"fin-{capture['capture_id']}"},
    )


def stored_capture(user: User, pages: list[bytes]) -> dict[str, object]:
    user.register_device()
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    result = finalize(user, created)
    assert result.status_code == 200, result.text
    return result.json()  # type: ignore[no-any-return]
