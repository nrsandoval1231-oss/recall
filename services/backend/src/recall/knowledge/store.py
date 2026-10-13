from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from .models import Snapshot, Source, Status


class StaleGeneration(ValueError):
    pass


class SnapshotStore:
    """Durable generation ledger and serialized rebuild queue."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS scopes (
                    scope TEXT PRIMARY KEY, generation INTEGER NOT NULL,
                    processing_allowed INTEGER NOT NULL, state TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0,
                    indexed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
                    message TEXT
                );
                CREATE TABLE IF NOT EXISTS queue (
                    scope TEXT PRIMARY KEY, generation INTEGER NOT NULL,
                    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                    kind TEXT NOT NULL DEFAULT 'rebuild', work_ids_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS indexed_sources (
                    scope TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
                    source_sha256 TEXT NOT NULL, note_sha256 TEXT NOT NULL,
                    source_json TEXT NOT NULL, PRIMARY KEY(scope, source_id)
                );
                """
            )
            columns = {row[1] for row in db.execute("PRAGMA table_info(queue)")}
            if "kind" not in columns:
                db.execute("ALTER TABLE queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'rebuild'")
            if "work_ids_json" not in columns:
                db.execute("ALTER TABLE queue ADD COLUMN work_ids_json TEXT NOT NULL DEFAULT '[]'")
            # Rebuild from an empty scope after interrupted graph writes of unknown progress.
            db.execute("UPDATE queue SET state='queued',kind='rebuild' WHERE state='processing'")
            for interrupted in db.execute(
                "SELECT scope,generation,snapshot_json FROM scopes WHERE state='processing'"
            ).fetchall():
                data = json.loads(interrupted["snapshot_json"])
                work_ids = data.get("eligible_ids", [])
                db.execute(
                    "INSERT INTO queue(scope,generation,state,attempts,kind,work_ids_json) "
                    "VALUES(?,?,'queued',1,'rebuild',?) "
                    "ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,state='queued', "
                    "attempts=queue.attempts+1,kind='rebuild',work_ids_json=excluded.work_ids_json",
                    (interrupted["scope"], interrupted["generation"], json.dumps(work_ids)),
                )
            db.execute(
                "UPDATE scopes SET state='queued',message='Recovering interrupted index operation.' "
                "WHERE state='processing'"
            )

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=15, isolation_level="IMMEDIATE")
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=15000")
        db.execute("PRAGMA secure_delete=ON")
        return db

    def submit(self, snapshot: Snapshot) -> Status:
        status = self._submit(snapshot)
        # Queue snapshots contain authorized source text while processing. Once a
        # newer snapshot replaces it (especially revocation/deletion), remove old
        # WAL frames so stale note bytes are not left in the durable queue files.
        with sqlite3.connect(self.path, timeout=15, isolation_level=None) as db:
            db.execute("PRAGMA busy_timeout=15000")
            busy, _log_frames, _checkpointed = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            raise RuntimeError("Secure local queue compaction could not complete.")
        return status

    def _submit(self, snapshot: Snapshot) -> Status:
        stored_snapshot = (
            snapshot.model_copy(update={"sources": [], "rebuild": False})
            if not snapshot.processing_allowed
            else snapshot.model_copy(update={"rebuild": False})
        )
        serialized = stored_snapshot.model_dump_json()
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT generation,state,snapshot_json FROM scopes WHERE scope=?", (snapshot.scope,)
            ).fetchone()
            if row is not None and snapshot.generation < row["generation"]:
                raise StaleGeneration("snapshot generation is older than the persisted generation")
            if row is not None and snapshot.generation == row["generation"]:
                if row["snapshot_json"] != serialized:
                    raise StaleGeneration("same generation cannot describe different snapshot content")
                if snapshot.rebuild:
                    work_ids = list(snapshot.eligible_ids) if snapshot.processing_allowed else []
                    db.execute(
                        "UPDATE scopes SET state=?,pending=?,failed=0,message='' WHERE scope=?",
                        ("queued" if snapshot.processing_allowed else "purging", len(work_ids), snapshot.scope),
                    )
                    db.execute(
                        "INSERT INTO queue(scope,generation,state,attempts,kind,work_ids_json) "
                        "VALUES(?,?,?,0,'rebuild',?) "
                        "ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,state='queued', "
                        "attempts=0,kind='rebuild',work_ids_json=excluded.work_ids_json",
                        (snapshot.scope, snapshot.generation, "queued", json.dumps(work_ids)),
                    )
                return self._status(db, snapshot.scope)

            prior = json.loads(row["snapshot_json"] or "{}") if row is not None else {}
            prior_status = row["state"] if row is not None else "empty"
            needs_rebuild = (
                row is None or snapshot.rebuild or prior.get("processing_allowed") != snapshot.processing_allowed
            )
            old_sources = {s["id"]: s for s in prior.get("sources", []) if s["id"] in prior.get("eligible_ids", [])}
            new_sources = {s.id: s for s in snapshot.sources if s.id in snapshot.eligible_ids}
            removed = set(old_sources) - set(new_sources)
            added = set(new_sources) - set(old_sources)
            changed = False
            for source_id in set(old_sources) & set(new_sources):
                old = old_sources[source_id]
                new = new_sources[source_id]
                if any(old[key] != getattr(new, key) for key in ("revision", "source_sha256", "note_sha256")):
                    changed = True
            if removed or changed:
                needs_rebuild = True
            queued = db.execute("SELECT 1 FROM queue WHERE scope=?", (snapshot.scope,)).fetchone() is not None
            if prior_status in {"queued", "processing", "failed", "purging"} or queued:
                needs_rebuild = True

            if not snapshot.processing_allowed:
                needs_rebuild = needs_rebuild or prior.get("processing_allowed") is True
                if needs_rebuild:
                    state, message = "pending", "Processing consent is disabled; derived results are fenced."
                else:
                    state, message = "disabled", ""
                eligible = []
                kind, work_ids = "rebuild", []
            else:
                eligible = [s for s in snapshot.sources if s.id in snapshot.eligible_ids]
                if needs_rebuild:
                    kind, work_ids = "rebuild", [s.id for s in eligible]
                elif added:
                    kind, work_ids = "append", sorted(added)
                else:
                    kind, work_ids = "none", []
                state, message = ("queued", "") if kind != "none" else ("ready", "")
                if kind == "none":
                    db.execute("DELETE FROM indexed_sources WHERE scope=?", (snapshot.scope,))
                    db.executemany(
                        "INSERT INTO indexed_sources(scope,source_id,revision,source_sha256,note_sha256,source_json) "
                        "VALUES(?,?,?,?,?,?)",
                        [
                            (
                                snapshot.scope,
                                s.id,
                                s.revision,
                                s.source_sha256,
                                s.note_sha256,
                                s.model_copy(update={"text": ""}).model_dump_json(),
                            )
                            for s in eligible
                        ],
                    )
            if not snapshot.processing_allowed and needs_rebuild:
                db.execute("DELETE FROM indexed_sources WHERE scope=?", (snapshot.scope,))
            db.execute(
                "INSERT INTO scopes(scope,generation,processing_allowed,state,snapshot_json,pending,indexed,failed,"
                "message) "
                "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation, "
                "processing_allowed=excluded.processing_allowed,state=excluded.state, "
                "snapshot_json=excluded.snapshot_json, "
                "pending=excluded.pending,indexed=excluded.indexed,failed=0,message=excluded.message",
                (
                    snapshot.scope,
                    snapshot.generation,
                    int(snapshot.processing_allowed),
                    state,
                    serialized,
                    len(work_ids) if kind != "none" else 0,
                    len(eligible) if kind == "none" else 0,
                    0,
                    message,
                ),
            )
            if kind != "none":
                db.execute(
                    "INSERT INTO queue(scope,generation,state,attempts,kind,work_ids_json) "
                    "VALUES(?,?,?,0,?,?) "
                    "ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,state='queued', "
                    "attempts=0,kind=excluded.kind,work_ids_json=excluded.work_ids_json",
                    (snapshot.scope, snapshot.generation, "queued", kind, json.dumps(work_ids)),
                )
            else:
                db.execute("DELETE FROM queue WHERE scope=?", (snapshot.scope,))
            return self._status(db, snapshot.scope)

    def next_job(self) -> tuple[Snapshot, int, str, set[str]] | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT scope,generation,kind,work_ids_json FROM queue WHERE state='queued' ORDER BY scope LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            current = db.execute(
                "SELECT generation,snapshot_json FROM scopes WHERE scope=?", (row["scope"],)
            ).fetchone()
            db.execute("DELETE FROM queue WHERE scope=?", (row["scope"],))
            if current is None or current["generation"] != row["generation"]:
                return None
            snap = Snapshot.model_validate_json(current["snapshot_json"])
            db.execute("UPDATE scopes SET state='processing',message=NULL WHERE scope=?", (row["scope"],))
            return snap, row["generation"], str(row["kind"]), set(json.loads(row["work_ids_json"]))

    def commit(self, scope: str, generation: int, sources: list[Source]) -> bool:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT generation,processing_allowed FROM scopes WHERE scope=?", (scope,)).fetchone()
            if row is None or row["generation"] != generation:
                return False
            if row["processing_allowed"]:
                db.execute("DELETE FROM indexed_sources WHERE scope=?", (scope,))
                db.executemany(
                    "INSERT INTO indexed_sources(scope,source_id,revision,source_sha256,note_sha256,source_json) "
                    "VALUES(?,?,?,?,?,?)",
                    [
                        (
                            scope,
                            s.id,
                            s.revision,
                            s.source_sha256,
                            s.note_sha256,
                            s.model_copy(update={"text": ""}).model_dump_json(),
                        )
                        for s in sources
                    ],
                )
                db.execute(
                    "UPDATE scopes SET state='ready',pending=0,indexed=?,failed=0,message=NULL WHERE scope=?",
                    (len(sources), scope),
                )
            else:
                db.execute("DELETE FROM indexed_sources WHERE scope=?", (scope,))
                db.execute(
                    "UPDATE scopes SET state='disabled',pending=0,indexed=0,message=NULL WHERE scope=?", (scope,)
                )
            return True

    def failed(self, scope: str, generation: int, message: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE scopes SET state='failed',pending=0,failed=1,message=? WHERE scope=? AND generation=?",
                (message[:200], scope, generation),
            )

    def status(self, scope: str) -> Status:
        with self._lock, self._connect() as db:
            return self._status(db, scope)

    @staticmethod
    def _status(db: sqlite3.Connection, scope: str) -> Status:
        row = db.execute("SELECT state,pending,indexed,failed,message FROM scopes WHERE scope=?", (scope,)).fetchone()
        if row is None:
            from .providers import provider_disclosures

            return Status(state="empty", providers=provider_disclosures())
        from .providers import provider_disclosures

        values = dict(row)
        values["message"] = values.get("message") or ""
        return Status(**values, providers=provider_disclosures())

    def generation(self, scope: str) -> tuple[int, bool, Snapshot] | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT generation,processing_allowed,snapshot_json FROM scopes WHERE scope=?", (scope,)
            ).fetchone()
            if row is None:
                return None
            return (
                row["generation"],
                bool(row["processing_allowed"]),
                Snapshot.model_validate_json(row["snapshot_json"]),
            )

    def current_sources(self, scope: str) -> dict[str, Source]:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT snapshot_json FROM scopes WHERE scope=?", (scope,)).fetchone()
            if row is None:
                return {}
            snapshot = Snapshot.model_validate_json(row["snapshot_json"])
            return {s.id: s for s in snapshot.sources if s.id in snapshot.eligible_ids}

    def requeue_rebuild(self, scope: str, generation: int) -> Status:
        """Queue a same-generation rebuild when persistent graph data is missing."""
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT generation,processing_allowed,snapshot_json,state FROM scopes WHERE scope=?", (scope,)
            ).fetchone()
            if row is None or row["generation"] != generation or not row["processing_allowed"]:
                return self._status(db, scope)
            if row["state"] not in {"ready", "failed"}:
                return self._status(db, scope)
            snapshot = Snapshot.model_validate_json(row["snapshot_json"])
            work_ids = sorted(snapshot.eligible_ids)
            db.execute(
                "UPDATE scopes SET state='queued',pending=?,indexed=0,failed=0,message='' WHERE scope=?",
                (len(work_ids), scope),
            )
            db.execute(
                "INSERT INTO queue(scope,generation,state,attempts,kind,work_ids_json) "
                "VALUES(?,?,'queued',0,'rebuild',?) "
                "ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,state='queued',attempts=0,"
                "kind='rebuild',work_ids_json=excluded.work_ids_json",
                (scope, generation, json.dumps(work_ids)),
            )
            return self._status(db, scope)

    def all_scopes(self) -> list[str]:
        with self._lock, self._connect() as db:
            return [row[0] for row in db.execute("SELECT scope FROM scopes ORDER BY scope")]


def row_snapshot(db: sqlite3.Connection, scope: str) -> str | None:
    row = db.execute("SELECT snapshot_json FROM scopes WHERE scope=?", (scope,)).fetchone()
    return None if row is None else str(row[0])
