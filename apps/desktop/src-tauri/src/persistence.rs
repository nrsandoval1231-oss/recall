use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

const RECORD_KINDS: &[&str] = &[
    "capture",
    "memory",
    "entity",
    "source",
    "claim",
    "relationship",
    "action",
];
const COMMAND_KINDS: &[&str] = &["memory.correction", "action.update"];
const MAX_LOCAL_SOURCE_BYTES: usize = 100 * 1024 * 1024;
const MAX_PAGE_EVENTS: usize = 1_000;
const MAX_SNAPSHOT_RECORDS: usize = 5_000;
const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const MAX_CURSOR_BYTES: usize = 4 * 1024;
const MAX_QUERY_BYTES: usize = 8 * 1024;

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
  id TEXT NOT NULL, version INTEGER NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id,user_id,kind,id)
);
CREATE TABLE IF NOT EXISTS sources (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, source_id TEXT NOT NULL,
  sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, path TEXT NOT NULL,
  verified INTEGER NOT NULL, PRIMARY KEY(workspace_id,user_id,source_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  kind TEXT NOT NULL, target_id TEXT NOT NULL, expected_version INTEGER NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT, PRIMARY KEY(workspace_id,user_id,operation_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS local_search USING fts5(
  workspace_id UNINDEXED, user_id UNINDEXED, record_kind UNINDEXED,
  record_id UNINDEXED, text
);
CREATE INDEX IF NOT EXISTS records_scope_kind ON records(workspace_id,user_id,kind);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(workspace_id,user_id,state,created_at);
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scope {
    pub user_id: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub sequence: i64,
    pub workspace_id: String,
    pub kind: String,
    pub record_id: String,
    pub version: i64,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedRecord {
    pub kind: String,
    pub record_id: String,
    pub version: i64,
    pub payload: serde_json::Value,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub cursor: String,
    pub records: Vec<SyncEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCommand {
    pub operation_id: String,
    pub kind: String,
    pub target_id: String,
    pub expected_version: i64,
    pub payload: serde_json::Value,
    pub created_at: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInventory {
    pub source_id: String,
    pub sha256: String,
    pub byte_size: u64,
    pub path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid scope or identifier")]
    InvalidIdentifier,
    #[error("workspace scope mismatch")]
    ScopeMismatch,
    #[error("idempotency key reused with a different command")]
    IdempotencyMismatch,
    #[error("source hash verification failed")]
    HashMismatch,
    #[error("source exceeds local limit")]
    SourceTooLarge,
    #[error("sync payload exceeds local limit")]
    PayloadTooLarge,
    #[error("unsafe local source path")]
    UnsafePath,
    #[error("filesystem: {0}")]
    Io(#[from] std::io::Error),
}

pub struct NativeStore {
    conn: Mutex<Connection>,
    files: Mutex<()>,
    root: PathBuf,
}

impl NativeStore {
    pub fn open(path: impl AsRef<Path>, source_root: impl AsRef<Path>) -> Result<Self, StoreError> {
        let requested_root = if source_root.as_ref().is_absolute() {
            source_root.as_ref().to_path_buf()
        } else {
            std::env::current_dir()?.join(source_root)
        };
        fs::create_dir_all(&requested_root)?;
        // Reject a pre-existing symlink/junction before canonicalization. Otherwise the
        // canonical path would hide that the configured storage root had been redirected.
        Self::validate_directory(&requested_root)?;
        let root = fs::canonicalize(requested_root)?;
        Self::validate_directory(&root)?;
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        // Keep upgrades explicit: an early scaffold database may have had no command kind.
        let has_kind: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('outbox') WHERE name='kind')",
            [],
            |r| r.get(0),
        )?;
        if !has_kind {
            conn.execute(
                "ALTER TABLE outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'",
                [],
            )?;
            conn.execute(
                "UPDATE outbox SET state='rejected',last_error='legacy command lacks kind; requeue explicitly' WHERE kind='unknown' AND state IN ('pending','retryable_failure')",
                [],
            )?;
        }
        let has_sequence: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('records') WHERE name='sequence')",
            [],
            |r| r.get(0),
        )?;
        if !has_sequence {
            conn.execute(
                "ALTER TABLE records ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        conn.execute("INSERT INTO meta(key,value) VALUES('schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value", [])?;
        Ok(Self {
            conn: Mutex::new(conn),
            files: Mutex::new(()),
            root,
        })
    }

    pub fn memory() -> Result<Self, StoreError> {
        Self::open(
            ":memory:",
            std::env::temp_dir().join("recall-native-memory-cache"),
        )
    }

    fn uuid_ok(value: &str) -> Result<(), StoreError> {
        let parsed = Uuid::parse_str(value).map_err(|_| StoreError::InvalidIdentifier)?;
        if parsed.hyphenated().to_string() != value {
            return Err(StoreError::InvalidIdentifier);
        }
        Ok(())
    }

    fn scope_ok(scope: &Scope) -> Result<(), StoreError> {
        Self::uuid_ok(&scope.user_id)?;
        Self::uuid_ok(&scope.workspace_id)
    }

    fn record_kind_ok(kind: &str) -> Result<(), StoreError> {
        if RECORD_KINDS.contains(&kind) {
            Ok(())
        } else {
            Err(StoreError::InvalidIdentifier)
        }
    }

    fn command_kind_ok(kind: &str) -> Result<(), StoreError> {
        if COMMAND_KINDS.contains(&kind) {
            Ok(())
        } else {
            Err(StoreError::InvalidIdentifier)
        }
    }

    fn cursor_key(scope: &Scope) -> String {
        format!("cursor:{}:{}", scope.workspace_id, scope.user_id)
    }
    fn last_workspace_key(user_id: &str) -> String {
        format!("last_workspace:{user_id}")
    }

    fn remember_scope(tx: &Transaction<'_>, scope: &Scope) -> Result<(), StoreError> {
        tx.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![Self::last_workspace_key(&scope.user_id), scope.workspace_id],
        )?;
        Ok(())
    }

    fn payload(value: &serde_json::Value) -> Result<String, StoreError> {
        let payload = serde_json::to_string(value)?;
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(StoreError::PayloadTooLarge);
        }
        Ok(payload)
    }

    fn cursor_ok(cursor: &str) -> Result<(), StoreError> {
        if cursor.len() > MAX_CURSOR_BYTES {
            return Err(StoreError::PayloadTooLarge);
        }
        Ok(())
    }

    pub fn apply_page(
        &self,
        scope: &Scope,
        events: &[SyncEvent],
        cursor: String,
    ) -> Result<(), StoreError> {
        Self::scope_ok(scope)?;
        Self::cursor_ok(&cursor)?;
        if events.len() > MAX_PAGE_EVENTS {
            return Err(StoreError::PayloadTooLarge);
        }
        let mut previous_sequence = 0;
        let mut possible_source_tombstones = HashSet::new();
        let mut page_source_state = HashMap::new();
        for event in events {
            if event.workspace_id != scope.workspace_id {
                return Err(StoreError::ScopeMismatch);
            }
            Self::uuid_ok(&event.workspace_id)?;
            Self::uuid_ok(&event.record_id)?;
            Self::record_kind_ok(&event.kind)?;
            if event.sequence <= 0 || event.sequence <= previous_sequence || event.version < 1 {
                return Err(StoreError::InvalidIdentifier);
            }
            Self::payload(&event.payload)?;
            previous_sequence = event.sequence;
            if event.kind == "source" {
                page_source_state.insert(event.record_id.clone(), event.deleted);
                if event.deleted {
                    possible_source_tombstones.insert(event.record_id.clone());
                }
            }
        }
        let _files = self.files.lock().unwrap();
        let scope_root = self.scope_root(scope, false)?;
        let source_paths = Self::validated_source_paths_for_ids(
            scope_root.as_deref(),
            &possible_source_tombstones,
        )?;
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut source_tombstones = HashSet::new();
        for event in events {
            let payload = Self::payload(&event.payload)?;
            let old: Option<i64> = tx.query_row("SELECT sequence FROM records WHERE workspace_id=? AND user_id=? AND kind=? AND id=?", params![scope.workspace_id,scope.user_id,event.kind,event.record_id], |r| r.get(0)).optional()?;
            if old
                .map(|sequence| sequence >= event.sequence)
                .unwrap_or(false)
            {
                continue;
            }
            tx.execute("INSERT INTO records(workspace_id,user_id,kind,id,version,sequence,payload,deleted) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,kind,id) DO UPDATE SET version=excluded.version,sequence=excluded.sequence,payload=excluded.payload,deleted=excluded.deleted", params![scope.workspace_id,scope.user_id,event.kind,event.record_id,event.version,event.sequence,payload,event.deleted as i64])?;
            tx.execute("DELETE FROM local_search WHERE workspace_id=? AND user_id=? AND record_kind=? AND record_id=?", params![scope.workspace_id,scope.user_id,event.kind,event.record_id])?;
            if !event.deleted {
                let text = event.payload.to_string();
                tx.execute("INSERT INTO local_search(workspace_id,user_id,record_kind,record_id,text) VALUES(?,?,?,?,?)", params![scope.workspace_id,scope.user_id,event.kind,event.record_id,text])?;
            }
            if event.kind == "source" {
                if event.deleted {
                    source_tombstones.insert(event.record_id.clone());
                } else {
                    source_tombstones.remove(&event.record_id);
                }
            }
        }
        for (source_id, deleted) in page_source_state {
            if !deleted {
                source_tombstones.remove(&source_id);
                continue;
            }
            let cached_deleted: Option<i64> = tx
                .query_row(
                    "SELECT deleted FROM records WHERE workspace_id=? AND user_id=? AND kind='source' AND id=?",
                    params![scope.workspace_id, scope.user_id, source_id],
                    |row| row.get(0),
                )
                .optional()?;
            if cached_deleted == Some(1) {
                source_tombstones.insert(source_id);
            }
        }
        for source_id in &source_tombstones {
            tx.execute(
                "DELETE FROM sources WHERE workspace_id=? AND user_id=? AND source_id=?",
                params![scope.workspace_id, scope.user_id, source_id],
            )?;
        }
        tx.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![Self::cursor_key(scope),cursor])?;
        Self::remember_scope(&tx, scope)?;
        // Purge controlled bytes before committing the cursor. If removal is
        // temporarily blocked, rolling the SQLite transaction back guarantees
        // that the same tombstone remains pending instead of stranding bytes
        // behind an already-advanced cursor.
        for source_id in &source_tombstones {
            if let Some(paths) = source_paths.get(source_id) {
                for path in paths {
                    fs::remove_file(path)?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn replace_snapshot(&self, scope: &Scope, snapshot: &Snapshot) -> Result<(), StoreError> {
        Self::scope_ok(scope)?;
        Self::cursor_ok(&snapshot.cursor)?;
        if snapshot.records.len() > MAX_SNAPSHOT_RECORDS {
            return Err(StoreError::PayloadTooLarge);
        }
        let mut live_sources = HashSet::new();
        for event in &snapshot.records {
            if event.workspace_id != scope.workspace_id {
                return Err(StoreError::ScopeMismatch);
            }
            Self::uuid_ok(&event.workspace_id)?;
            Self::uuid_ok(&event.record_id)?;
            Self::record_kind_ok(&event.kind)?;
            if event.version < 1 {
                return Err(StoreError::InvalidIdentifier);
            }
            Self::payload(&event.payload)?;
            if event.kind == "source" && !event.deleted {
                live_sources.insert(event.record_id.clone());
            }
        }
        let _files = self.files.lock().unwrap();
        let scope_root = self.scope_root(scope, false)?;
        let source_entries = Self::validated_source_entries(scope_root.as_deref())?;
        let stale_paths: Vec<PathBuf> = source_entries
            .iter()
            .filter(|(source_id, _)| !live_sources.contains(source_id))
            .map(|(_, path)| path.clone())
            .collect();
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let cached_sources = {
            let mut statement =
                tx.prepare("SELECT source_id FROM sources WHERE workspace_id=? AND user_id=?")?;
            let mapped = statement
                .query_map(params![scope.workspace_id, scope.user_id], |row| {
                    row.get::<_, String>(0)
                })?;
            mapped.collect::<Result<Vec<_>, _>>()?
        };
        for source_id in cached_sources {
            Self::uuid_ok(&source_id)?;
            if !live_sources.contains(&source_id) {
                tx.execute(
                    "DELETE FROM sources WHERE workspace_id=? AND user_id=? AND source_id=?",
                    params![scope.workspace_id, scope.user_id, source_id],
                )?;
            }
        }
        tx.execute(
            "DELETE FROM records WHERE workspace_id=? AND user_id=?",
            params![scope.workspace_id, scope.user_id],
        )?;
        tx.execute(
            "DELETE FROM local_search WHERE workspace_id=? AND user_id=?",
            params![scope.workspace_id, scope.user_id],
        )?;
        for event in &snapshot.records {
            let payload = Self::payload(&event.payload)?;
            tx.execute("INSERT INTO records(workspace_id,user_id,kind,id,version,sequence,payload,deleted) VALUES(?,?,?,?,?,0,?,?)", params![scope.workspace_id,scope.user_id,event.kind,event.record_id,event.version,payload,event.deleted as i64])?;
            if !event.deleted {
                tx.execute("INSERT INTO local_search(workspace_id,user_id,record_kind,record_id,text) VALUES(?,?,?,?,?)", params![scope.workspace_id,scope.user_id,event.kind,event.record_id,event.payload.to_string()])?;
            }
        }
        tx.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![Self::cursor_key(scope),snapshot.cursor])?;
        Self::remember_scope(&tx, scope)?;
        // A failed purge must not publish a snapshot cursor that makes the
        // stale source invisible to later reconciliation.
        for path in &stale_paths {
            fs::remove_file(path)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn cursor(&self, scope: &Scope) -> Result<String, StoreError> {
        Self::scope_ok(scope)?;
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row(
                "SELECT value FROM meta WHERE key=?",
                params![Self::cursor_key(scope)],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_default())
    }

    pub fn last_workspace(&self, user_id: &str) -> Result<Option<String>, StoreError> {
        Self::uuid_ok(user_id)?;
        let conn = self.conn.lock().unwrap();
        let value = conn
            .query_row(
                "SELECT value FROM meta WHERE key=?",
                params![Self::last_workspace_key(user_id)],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        if let Some(workspace_id) = value.as_deref() {
            Self::uuid_ok(workspace_id)?;
        }
        Ok(value)
    }

    fn cached(
        kind: String,
        record_id: String,
        version: i64,
        payload: String,
        deleted: i64,
    ) -> Result<CachedRecord, StoreError> {
        Self::record_kind_ok(&kind)?;
        Self::uuid_ok(&record_id)?;
        if version < 1 {
            return Err(StoreError::InvalidIdentifier);
        }
        Ok(CachedRecord {
            kind,
            record_id,
            version,
            payload: serde_json::from_str(&payload)?,
            deleted: deleted != 0,
        })
    }

    pub fn records(
        &self,
        scope: &Scope,
        kind: Option<&str>,
        limit: u32,
    ) -> Result<Vec<CachedRecord>, StoreError> {
        Self::scope_ok(scope)?;
        if let Some(value) = kind {
            Self::record_kind_ok(value)?;
        }
        let conn = self.conn.lock().unwrap();
        let sql = if kind.is_some() {
            "SELECT kind,id,version,payload,deleted FROM records WHERE workspace_id=? AND user_id=? AND kind=? AND deleted=0 ORDER BY kind,id LIMIT ?"
        } else {
            "SELECT kind,id,version,payload,deleted FROM records WHERE workspace_id=? AND user_id=? AND deleted=0 ORDER BY kind,id LIMIT ?"
        };
        let mut stmt = conn.prepare(sql)?;
        let cap = limit.clamp(1, 500);
        let mut out = Vec::new();
        if let Some(value) = kind {
            let rows = stmt.query_map(
                params![scope.workspace_id, scope.user_id, value, cap],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?;
            for row in rows {
                let (k, id, v, p, d) = row?;
                out.push(Self::cached(k, id, v, p, d)?);
            }
        } else {
            let rows = stmt.query_map(params![scope.workspace_id, scope.user_id, cap], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?;
            for row in rows {
                let (k, id, v, p, d) = row?;
                out.push(Self::cached(k, id, v, p, d)?);
            }
        }
        Ok(out)
    }

    pub fn get_record(
        &self,
        scope: &Scope,
        kind: &str,
        record_id: &str,
    ) -> Result<Option<CachedRecord>, StoreError> {
        Self::scope_ok(scope)?;
        Self::record_kind_ok(kind)?;
        Self::uuid_ok(record_id)?;
        let conn = self.conn.lock().unwrap();
        let row: Option<(String,String,i64,String,i64)> = conn.query_row(
            "SELECT kind,id,version,payload,deleted FROM records WHERE workspace_id=? AND user_id=? AND kind=? AND id=?",
            params![scope.workspace_id,scope.user_id,kind,record_id],
            |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
        ).optional()?;
        row.map(|(k, id, v, p, d)| Self::cached(k, id, v, p, d))
            .transpose()
    }

    fn fts_query(query: &str) -> String {
        let mut seen = HashSet::new();
        query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .filter(|term| seen.insert(term.to_lowercase()))
            .take(64)
            .map(|term| format!("\"{term}\""))
            .collect::<Vec<_>>()
            .join(" OR ")
    }

    pub fn search(
        &self,
        scope: &Scope,
        query: &str,
        limit: u32,
    ) -> Result<Vec<CachedRecord>, StoreError> {
        Self::scope_ok(scope)?;
        if query.len() > MAX_QUERY_BYTES {
            return Err(StoreError::PayloadTooLarge);
        }
        let query = Self::fts_query(query);
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt=conn.prepare("SELECT r.kind,r.id,r.version,r.payload,r.deleted FROM local_search s JOIN records r ON r.workspace_id=s.workspace_id AND r.user_id=s.user_id AND r.kind=s.record_kind AND r.id=s.record_id WHERE s.workspace_id=? AND s.user_id=? AND local_search MATCH ? AND r.deleted=0 ORDER BY rank LIMIT ?")?;
        let rows = stmt.query_map(
            params![
                scope.workspace_id,
                scope.user_id,
                query,
                limit.clamp(1, 100)
            ],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
        let mut out = Vec::new();
        for row in rows {
            let (k, id, v, p, d) = row?;
            out.push(Self::cached(k, id, v, p, d)?);
        }
        Ok(out)
    }

    pub fn enqueue(&self, scope: &Scope, command: &PendingCommand) -> Result<(), StoreError> {
        Self::scope_ok(scope)?;
        Self::uuid_ok(&command.operation_id)?;
        Self::uuid_ok(&command.target_id)?;
        Self::command_kind_ok(&command.kind)?;
        if command.expected_version < 1
            || command.created_at.is_empty()
            || command.created_at.len() > 128
            || (!command.state.is_empty() && command.state != "pending")
        {
            return Err(StoreError::InvalidIdentifier);
        }
        let payload = Self::payload(&command.payload)?;
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let existing: Option<(String,String,i64,String)> = tx.query_row("SELECT kind,target_id,expected_version,payload FROM outbox WHERE workspace_id=? AND user_id=? AND operation_id=?", params![scope.workspace_id,scope.user_id,command.operation_id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        if let Some((kind, target, version, old)) = existing {
            if kind != command.kind
                || target != command.target_id
                || version != command.expected_version
                || old != payload
            {
                return Err(StoreError::IdempotencyMismatch);
            }
            return Ok(());
        }
        tx.execute("INSERT INTO outbox(workspace_id,user_id,operation_id,target_id,expected_version,payload,created_at,kind,state) VALUES(?,?,?,?,?,?,?,?, 'pending')", params![scope.workspace_id,scope.user_id,command.operation_id,command.target_id,command.expected_version,payload,command.created_at,command.kind])?;
        Self::remember_scope(&tx, scope)?;
        tx.commit()?;
        Ok(())
    }

    pub fn outbox(&self, scope: &Scope) -> Result<Vec<PendingCommand>, StoreError> {
        Self::scope_ok(scope)?;
        let conn = self.conn.lock().unwrap();
        let mut st=conn.prepare("SELECT operation_id,kind,target_id,expected_version,payload,created_at,state,last_error FROM outbox WHERE workspace_id=? AND user_id=? AND state IN ('pending','retryable_failure') ORDER BY created_at,operation_id")?;
        let rows = st.query_map(params![scope.workspace_id, scope.user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (
                operation_id,
                kind,
                target_id,
                expected_version,
                payload,
                created_at,
                state,
                last_error,
            ) = row?;
            Self::uuid_ok(&operation_id)?;
            Self::command_kind_ok(&kind)?;
            Self::uuid_ok(&target_id)?;
            if expected_version < 1 {
                return Err(StoreError::InvalidIdentifier);
            }
            out.push(PendingCommand {
                operation_id,
                kind,
                target_id,
                expected_version,
                payload: serde_json::from_str(&payload)?,
                created_at,
                state,
                last_error,
            });
        }
        Ok(out)
    }

    pub fn mark_outbox(
        &self,
        scope: &Scope,
        operation_id: &str,
        state: &str,
        error: Option<&str>,
    ) -> Result<(), StoreError> {
        Self::scope_ok(scope)?;
        Self::uuid_ok(operation_id)?;
        if !matches!(
            state,
            "applied" | "already_applied" | "conflict" | "rejected" | "retryable_failure"
        ) {
            return Err(StoreError::InvalidIdentifier);
        }
        if error.map(str::len).unwrap_or(0) > 2_000 {
            return Err(StoreError::PayloadTooLarge);
        }
        let conn = self.conn.lock().unwrap();
        if conn.execute("UPDATE outbox SET state=?,last_error=? WHERE workspace_id=? AND user_id=? AND operation_id=?", params![state,error,scope.workspace_id,scope.user_id,operation_id])? == 0 { return Err(StoreError::InvalidIdentifier); }
        Ok(())
    }

    pub fn clear_cache(&self, scope: &Scope, clear_outbox: bool) -> Result<(), StoreError> {
        Self::scope_ok(scope)?;
        let _files = self.files.lock().unwrap();
        let (scope_root, source_paths) = {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            let rows = {
                let mut statement =
                    tx.prepare("SELECT source_id FROM sources WHERE workspace_id=? AND user_id=?")?;
                let mapped = statement
                    .query_map(params![scope.workspace_id, scope.user_id], |r| {
                        r.get::<_, String>(0)
                    })?;
                mapped.collect::<Result<Vec<_>, _>>()?
            };
            for source_id in &rows {
                Self::uuid_ok(source_id)?;
            }
            let scope_root = self.scope_root(scope, false)?;
            let source_paths: Vec<PathBuf> = Self::validated_source_entries(scope_root.as_deref())?
                .into_iter()
                .map(|(_, path)| path)
                .collect();
            tx.execute(
                "DELETE FROM records WHERE workspace_id=? AND user_id=?",
                params![scope.workspace_id, scope.user_id],
            )?;
            tx.execute(
                "DELETE FROM local_search WHERE workspace_id=? AND user_id=?",
                params![scope.workspace_id, scope.user_id],
            )?;
            tx.execute(
                "DELETE FROM sources WHERE workspace_id=? AND user_id=?",
                params![scope.workspace_id, scope.user_id],
            )?;
            tx.execute(
                "DELETE FROM meta WHERE key IN (?,?)",
                params![
                    Self::cursor_key(scope),
                    Self::last_workspace_key(&scope.user_id)
                ],
            )?;
            if clear_outbox {
                tx.execute(
                    "DELETE FROM outbox WHERE workspace_id=? AND user_id=?",
                    params![scope.workspace_id, scope.user_id],
                )?;
            }
            // Keep cache state/cursor intact if Windows still has a controlled
            // source open. The user can retry and no orphan becomes detached
            // from the inventory by a committed cache clear.
            for path in &source_paths {
                fs::remove_file(path)?;
            }
            tx.commit()?;
            (scope_root, source_paths)
        };
        drop(source_paths);
        if let Some(scope_root) = scope_root {
            if fs::read_dir(&scope_root)?.next().is_none() {
                fs::remove_dir(&scope_root)?;
                let user_root = self.root.join(&scope.user_id);
                if user_root.exists() && fs::read_dir(&user_root)?.next().is_none() {
                    fs::remove_dir(user_root)?;
                }
            }
        }
        Ok(())
    }

    fn is_reparse(metadata: &fs::Metadata) -> bool {
        if metadata.file_type().is_symlink() {
            return true;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            return metadata.file_attributes() & 0x400 != 0;
        }
        #[cfg(not(windows))]
        false
    }

    fn validate_directory(path: &Path) -> Result<(), StoreError> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.is_dir() || Self::is_reparse(&metadata) {
            return Err(StoreError::UnsafePath);
        }
        Ok(())
    }

    fn validate_regular_file(path: &Path) -> Result<(), StoreError> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.is_file() || Self::is_reparse(&metadata) {
            return Err(StoreError::UnsafePath);
        }
        Ok(())
    }

    fn scope_root(&self, scope: &Scope, create: bool) -> Result<Option<PathBuf>, StoreError> {
        Self::scope_ok(scope)?;
        let user_root = self.root.join(&scope.user_id);
        let scope_root = user_root.join(&scope.workspace_id);
        if create {
            if !user_root.exists() {
                fs::create_dir(&user_root)?;
            }
            Self::validate_directory(&user_root)?;
            if fs::canonicalize(&user_root)? != user_root {
                return Err(StoreError::UnsafePath);
            }
            if !scope_root.exists() {
                fs::create_dir(&scope_root)?;
            }
        } else if !scope_root.exists() {
            return Ok(None);
        }
        Self::validate_directory(&user_root)?;
        Self::validate_directory(&scope_root)?;
        if fs::canonicalize(&user_root)? != user_root
            || fs::canonicalize(&scope_root)? != scope_root
        {
            return Err(StoreError::UnsafePath);
        }
        Ok(Some(scope_root))
    }

    fn validated_source_entries(
        scope_root: Option<&Path>,
    ) -> Result<Vec<(String, PathBuf)>, StoreError> {
        let Some(scope_root) = scope_root else {
            return Ok(Vec::new());
        };
        let mut entries = Vec::new();
        for entry in fs::read_dir(scope_root)? {
            let entry = entry?;
            let path = entry.path();
            let extension = path.extension().and_then(|value| value.to_str());
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                return Err(StoreError::UnsafePath);
            };
            if !matches!(extension, Some("bin") | Some("part")) {
                return Err(StoreError::UnsafePath);
            }
            Self::uuid_ok(stem).map_err(|_| StoreError::UnsafePath)?;
            Self::validate_regular_file(&path)?;
            entries.push((stem.to_string(), path));
        }
        Ok(entries)
    }

    fn validated_source_paths_for_ids(
        scope_root: Option<&Path>,
        source_ids: &HashSet<String>,
    ) -> Result<HashMap<String, Vec<PathBuf>>, StoreError> {
        let Some(scope_root) = scope_root else {
            return Ok(HashMap::new());
        };
        let mut paths = HashMap::new();
        for source_id in source_ids {
            Self::uuid_ok(source_id)?;
            for extension in ["bin", "part"] {
                let path = scope_root.join(format!("{source_id}.{extension}"));
                match fs::symlink_metadata(&path) {
                    Ok(_) => {
                        Self::validate_regular_file(&path)?;
                        paths
                            .entry(source_id.clone())
                            .or_insert_with(Vec::new)
                            .push(path);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        Ok(paths)
    }

    pub fn store_source(
        &self,
        scope: &Scope,
        source_id: &str,
        expected_sha256: &str,
        bytes: &[u8],
    ) -> Result<SourceInventory, StoreError> {
        Self::scope_ok(scope)?;
        Self::uuid_ok(source_id)?;
        if expected_sha256.len() != 64 || !expected_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(StoreError::InvalidIdentifier);
        }
        if bytes.len() > MAX_LOCAL_SOURCE_BYTES {
            return Err(StoreError::SourceTooLarge);
        }
        let got = hex::encode(Sha256::digest(bytes));
        if got != expected_sha256.to_ascii_lowercase() {
            return Err(StoreError::HashMismatch);
        }
        let _files = self.files.lock().unwrap();
        let scope_root = self
            .scope_root(scope, true)?
            .ok_or(StoreError::UnsafePath)?;
        let final_path = scope_root.join(format!("{source_id}.bin"));
        let temp = scope_root.join(format!("{source_id}.part"));
        let mut needs_write = true;
        if final_path.exists() {
            Self::validate_regular_file(&final_path)?;
            let existing = fs::read(&final_path)?;
            if existing.len() == bytes.len() && hex::encode(Sha256::digest(&existing)) == got {
                needs_write = false;
            } else {
                // A source ID names immutable original bytes. Refuse a conflicting
                // replacement so a failed download can never destroy verified evidence.
                return Err(StoreError::HashMismatch);
            }
        }
        if needs_write {
            if temp.exists() {
                Self::validate_regular_file(&temp)?;
                fs::remove_file(&temp)?;
            }
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, &final_path)?;
        }
        let path = final_path.to_string_lossy().to_string();
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("INSERT INTO sources(workspace_id,user_id,source_id,sha256,byte_size,path,verified) VALUES(?,?,?,?,?,?,1) ON CONFLICT(workspace_id,user_id,source_id) DO UPDATE SET sha256=excluded.sha256,byte_size=excluded.byte_size,path=excluded.path,verified=1",params![scope.workspace_id,scope.user_id,source_id,got,bytes.len() as i64,path])?;
        Self::remember_scope(&tx, scope)?;
        tx.commit()?;
        Ok(SourceInventory {
            source_id: source_id.to_string(),
            sha256: got,
            byte_size: bytes.len() as u64,
            path,
        })
    }

    pub fn get_source(
        &self,
        scope: &Scope,
        source_id: &str,
    ) -> Result<Option<SourceInventory>, StoreError> {
        Self::scope_ok(scope)?;
        Self::uuid_ok(source_id)?;
        let row: Option<(String, i64)> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT sha256,byte_size FROM sources WHERE workspace_id=? AND user_id=? AND source_id=? AND verified=1", params![scope.workspace_id,scope.user_id,source_id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?
        };
        let Some((sha256, byte_size)) = row else {
            return Ok(None);
        };
        if byte_size < 0 || sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(StoreError::InvalidIdentifier);
        }
        let _files = self.files.lock().unwrap();
        let Some(scope_root) = self.scope_root(scope, false)? else {
            return Ok(None);
        };
        let path = scope_root.join(format!("{source_id}.bin"));
        if !path.exists() {
            return Ok(None);
        }
        Self::validate_regular_file(&path)?;
        let bytes = fs::read(&path)?;
        if bytes.len() != byte_size as usize || hex::encode(Sha256::digest(&bytes)) != sha256 {
            return Err(StoreError::HashMismatch);
        }
        Ok(Some(SourceInventory {
            source_id: source_id.to_string(),
            sha256,
            byte_size: byte_size as u64,
            path: path.to_string_lossy().to_string(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const USER_ID: &str = "11111111-1111-4111-8111-111111111111";
    const WORKSPACE_ID: &str = "22222222-2222-4222-8222-222222222222";
    const MEMORY_ID: &str = "33333333-3333-4333-8333-333333333333";
    const OTHER_MEMORY_ID: &str = "44444444-4444-4444-8444-444444444444";
    const OPERATION_ID: &str = "55555555-5555-4555-8555-555555555555";
    const SOURCE_ID: &str = "66666666-6666-4666-8666-666666666666";

    fn scope() -> Scope {
        Scope {
            user_id: USER_ID.into(),
            workspace_id: WORKSPACE_ID.into(),
        }
    }
    fn event(id: &str, sequence: i64, version: i64, summary: &str) -> SyncEvent {
        SyncEvent {
            sequence,
            workspace_id: WORKSPACE_ID.into(),
            kind: "memory".into(),
            record_id: id.into(),
            version,
            payload: serde_json::json!({"summary":summary}),
            deleted: false,
        }
    }
    fn source_event(sequence: i64, deleted: bool) -> SyncEvent {
        SyncEvent {
            sequence,
            workspace_id: WORKSPACE_ID.into(),
            kind: "source".into(),
            record_id: SOURCE_ID.into(),
            version: 1,
            payload: if deleted {
                serde_json::Value::Null
            } else {
                serde_json::json!({"source_id": SOURCE_ID})
            },
            deleted,
        }
    }
    fn command() -> PendingCommand {
        PendingCommand {
            operation_id: OPERATION_ID.into(),
            kind: "action.update".into(),
            target_id: MEMORY_ID.into(),
            expected_version: 1,
            payload: serde_json::json!({"status":"open"}),
            created_at: "2026-10-06T12:00:00Z".into(),
            state: "pending".into(),
            last_error: None,
        }
    }
    fn temp_store(label: &str) -> (NativeStore, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "recall-native-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).unwrap();
        (
            NativeStore::open(base.join("cache.sqlite3"), base.join("sources")).unwrap(),
            base,
        )
    }

    #[test]
    fn page_and_cursor_are_atomic_and_idempotent() {
        let s = NativeStore::memory().unwrap();
        let e = event(MEMORY_ID, 1, 1, "alpha");
        s.apply_page(&scope(), &[e.clone()], "opaque-1".into())
            .unwrap();
        s.apply_page(&scope(), &[e], "opaque-1".into()).unwrap();
        assert_eq!(s.cursor(&scope()).unwrap(), "opaque-1");
        assert_eq!(s.search(&scope(), "alpha", 10).unwrap().len(), 1);
    }
    #[test]
    fn snapshot_replaces_records_but_preserves_outbox() {
        let s = NativeStore::memory().unwrap();
        s.enqueue(&scope(), &command()).unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "alpha")],
            "opaque-1".into(),
        )
        .unwrap();
        s.replace_snapshot(
            &scope(),
            &Snapshot {
                cursor: "opaque-8".into(),
                records: vec![event(OTHER_MEMORY_ID, 0, 2, "alpha")],
            },
        )
        .unwrap();
        assert_eq!(s.outbox(&scope()).unwrap().len(), 1);
        assert_eq!(
            s.search(&scope(), "alpha", 10).unwrap()[0].record_id,
            OTHER_MEMORY_ID
        );
    }
    #[test]
    fn idempotency_rejects_different_payload() {
        let s = NativeStore::memory().unwrap();
        let c = command();
        s.enqueue(&scope(), &c).unwrap();
        assert!(matches!(
            s.enqueue(
                &scope(),
                &PendingCommand {
                    payload: serde_json::json!({"status":"done"}),
                    ..c
                }
            ),
            Err(StoreError::IdempotencyMismatch)
        ));
    }
    #[test]
    fn source_is_unavailable_until_hash_verified() {
        let (s, base) = temp_store("bad-hash");
        assert!(matches!(
            s.store_source(&scope(), SOURCE_ID, &"0".repeat(64), b"bytes"),
            Err(StoreError::HashMismatch)
        ));
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_parent_scope_before_removing_any_directory() {
        let (s, base) = temp_store("scope-traversal");
        let victim = base.join(WORKSPACE_ID);
        fs::create_dir_all(&victim).unwrap();
        fs::write(victim.join("keep.txt"), b"keep").unwrap();
        let malicious = Scope {
            user_id: "..".into(),
            workspace_id: WORKSPACE_ID.into(),
        };
        assert!(matches!(
            s.clear_cache(&malicious, false),
            Err(StoreError::InvalidIdentifier)
        ));
        assert!(victim.join("keep.txt").exists());
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn higher_sequence_replaces_same_version_projection() {
        let s = NativeStore::memory().unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "before")],
            "opaque-1".into(),
        )
        .unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 2, 1, "after")],
            "opaque-2".into(),
        )
        .unwrap();
        let record = s
            .get_record(&scope(), "memory", MEMORY_ID)
            .unwrap()
            .unwrap();
        assert_eq!(record.payload["summary"], "after");
    }

    #[test]
    fn records_can_be_listed_without_an_fts_wildcard() {
        let s = NativeStore::memory().unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "alpha")],
            "opaque-1".into(),
        )
        .unwrap();
        assert_eq!(s.records(&scope(), Some("memory"), 10).unwrap().len(), 1);
    }

    #[test]
    fn human_search_text_is_escaped_for_fts() {
        let s = NativeStore::memory().unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "Sam knew 800 psi")],
            "opaque-1".into(),
        )
        .unwrap();
        assert_eq!(
            s.search(&scope(), "who was Sam? 800 psi?", 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn cache_clear_resets_cursor_and_keeps_pending_outbox() {
        let s = NativeStore::memory().unwrap();
        s.enqueue(&scope(), &command()).unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "alpha")],
            "opaque-1".into(),
        )
        .unwrap();
        s.clear_cache(&scope(), false).unwrap();
        assert_eq!(s.cursor(&scope()).unwrap(), "");
        assert_eq!(s.outbox(&scope()).unwrap().len(), 1);
        assert!(s.records(&scope(), None, 10).unwrap().is_empty());
    }

    #[test]
    fn cache_clear_refuses_unknown_files_before_clearing_database_rows() {
        let (s, base) = temp_store("clear-unknown-file");
        let digest = hex::encode(Sha256::digest(b"bytes"));
        let inventory = s
            .store_source(&scope(), SOURCE_ID, &digest, b"bytes")
            .unwrap();
        s.apply_page(
            &scope(),
            &[event(MEMORY_ID, 1, 1, "alpha")],
            "opaque-1".into(),
        )
        .unwrap();
        let unknown = Path::new(&inventory.path)
            .parent()
            .unwrap()
            .join("keep.txt");
        fs::write(&unknown, b"keep").unwrap();

        assert!(matches!(
            s.clear_cache(&scope(), false),
            Err(StoreError::UnsafePath)
        ));
        assert!(unknown.exists());
        assert!(Path::new(&inventory.path).exists());
        assert_eq!(s.cursor(&scope()).unwrap(), "opaque-1");
        assert_eq!(s.records(&scope(), None, 10).unwrap().len(), 1);
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn terminal_outbox_rows_are_not_returned_for_dispatch() {
        let s = NativeStore::memory().unwrap();
        s.enqueue(&scope(), &command()).unwrap();
        s.mark_outbox(&scope(), OPERATION_ID, "applied", None)
            .unwrap();
        assert!(s.outbox(&scope()).unwrap().is_empty());
    }

    #[test]
    fn remembers_last_workspace_for_offline_bootstrap() {
        let s = NativeStore::memory().unwrap();
        s.apply_page(&scope(), &[], "opaque-1".into()).unwrap();
        assert_eq!(
            s.last_workspace(USER_ID).unwrap().as_deref(),
            Some(WORKSPACE_ID)
        );
    }

    #[test]
    fn stored_source_can_be_fetched_only_in_its_scope() {
        let (s, base) = temp_store("source-get");
        let digest = hex::encode(Sha256::digest(b"bytes"));
        s.store_source(&scope(), SOURCE_ID, &digest, b"bytes")
            .unwrap();
        assert_eq!(
            s.get_source(&scope(), SOURCE_ID).unwrap().unwrap().sha256,
            digest
        );
        let other_scope = Scope {
            user_id: USER_ID.into(),
            workspace_id: "77777777-7777-4777-8777-777777777777".into(),
        };
        assert!(s.get_source(&other_scope, SOURCE_ID).unwrap().is_none());
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn conflicting_or_tampered_source_never_replaces_verified_bytes() {
        let (s, base) = temp_store("source-integrity");
        let digest = hex::encode(Sha256::digest(b"bytes"));
        let inventory = s
            .store_source(&scope(), SOURCE_ID, &digest, b"bytes")
            .unwrap();
        let replacement_digest = hex::encode(Sha256::digest(b"other"));
        assert!(matches!(
            s.store_source(&scope(), SOURCE_ID, &replacement_digest, b"other"),
            Err(StoreError::HashMismatch)
        ));
        assert_eq!(fs::read(&inventory.path).unwrap(), b"bytes");

        fs::write(&inventory.path, b"bytfs").unwrap();
        assert!(matches!(
            s.get_source(&scope(), SOURCE_ID),
            Err(StoreError::HashMismatch)
        ));
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn source_tombstone_removes_inventory_and_controlled_bytes() {
        let (s, base) = temp_store("source-tombstone");
        let digest = hex::encode(Sha256::digest(b"bytes"));
        let inventory = s
            .store_source(&scope(), SOURCE_ID, &digest, b"bytes")
            .unwrap();
        s.apply_page(
            &scope(),
            &[source_event(1, false), source_event(2, true)],
            "opaque-2".into(),
        )
        .unwrap();
        assert!(s.get_source(&scope(), SOURCE_ID).unwrap().is_none());
        assert!(!Path::new(&inventory.path).exists());
        // A crash after the SQLite commit could leave an orphan. Replaying the
        // same page must retry controlled-byte deletion even though its sequence
        // is already cached.
        fs::write(&inventory.path, b"orphan").unwrap();
        s.apply_page(&scope(), &[source_event(2, true)], "opaque-2".into())
            .unwrap();
        assert!(!Path::new(&inventory.path).exists());
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn authoritative_snapshot_removes_downloads_that_are_no_longer_present() {
        let (s, base) = temp_store("snapshot-source-removal");
        let digest = hex::encode(Sha256::digest(b"bytes"));
        let inventory = s
            .store_source(&scope(), SOURCE_ID, &digest, b"bytes")
            .unwrap();
        s.replace_snapshot(
            &scope(),
            &Snapshot {
                cursor: "opaque-3".into(),
                records: Vec::new(),
            },
        )
        .unwrap();
        assert!(s.get_source(&scope(), SOURCE_ID).unwrap().is_none());
        assert!(!Path::new(&inventory.path).exists());
        drop(s);
        fs::remove_dir_all(base).unwrap();
    }
}
