//! Durable reading intent and receipts share the vault writer lock, never the network lifetime.
use super::*;
use crate::reading::{MachineReading, ReadingBinding, ReadingReceipt, ReadingRequest};
#[derive(Clone, Debug, Serialize)]
pub struct ReadingOperation {
    pub operation_id: String,
    pub memory_id: String,
    pub expected_revision: u64,
    pub state: String,
    pub may_have_been_sent: bool,
    pub error_code: Option<String>,
}
impl Vault {
    pub(super) fn fence_v3(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if manifest.format == FORMAT_V3 {
            return Ok(());
        }
        let backup = if manifest.format == FORMAT {
            "_meta/manifest-v1.json"
        } else {
            "_meta/manifest-v2.json"
        };
        immutable(&self.path(backup), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V3.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn reading_dir(&self, operation: &str) -> Result<PathBuf> {
        id(operation)?;
        Ok(self.path(&format!("_meta/readings/{operation}")))
    }
    fn reading_file(&self, operation: &str, name: &str) -> Result<PathBuf> {
        Ok(self.reading_dir(operation)?.join(name))
    }
    fn request(&self, operation: &str) -> Result<ReadingRequest> {
        let req: ReadingRequest = decode(&self.reading_file(operation, "request.json")?)?;
        req.validate()?;
        if req.binding.operation_id != operation || req.binding.vault_id != self.id {
            return Err("Reading request identity mismatch".into());
        }
        Ok(req)
    }
    fn cancelled(&self, operation: &str) -> Result<bool> {
        let path = self.reading_file(operation, "cancelled")?;
        safe(&path)?;
        if path.exists() {
            if read(&path, 128)? != b"cancelled" {
                return Err("Invalid reading cancellation".into());
            }
            return Ok(true);
        }
        Ok(false)
    }
    pub fn prepare_reading(
        &self,
        memory_id: &str,
        revision: u64,
        operation: &str,
    ) -> Result<ReadingRequest> {
        let _lock = self.lock()?;
        id(memory_id)?;
        id(operation)?;
        if self.cancelled(operation)? {
            return Err("Reading cancelled; original remains available".into());
        }
        let pending = self.recover()?;
        let request_path = self.reading_file(operation, "request.json")?;
        if request_path.exists() {
            let req = self.request(operation)?;
            if req.binding.memory_id != memory_id || req.binding.expected_revision != revision {
                return Err("Operation ID reused with different payload".into());
            }
            if self.cancelled(operation)? {
                return Err("Reading cancelled; original remains available".into());
            }
            return Ok(req);
        }
        // Operation families cannot alias one another.
        if self.journal_path(operation).exists() {
            return Err("Operation ID already used".into());
        }
        let m = self.current(memory_id, &pending)?;
        if m.state != "active" || m.conflict.is_some() || m.revision != revision {
            return Err("Memory changed; refresh before reading".into());
        }
        let source = self.verify_source(&m)?;
        let req = ReadingRequest {
            binding: ReadingBinding {
                schema_version: "1.0".into(),
                operation_id: operation.into(),
                vault_id: self.id.clone(),
                memory_id: memory_id.into(),
                source_id: memory_id.into(),
                source_sha256: m.source_sha256,
                expected_revision: revision,
                captured_at: m.captured_at,
            },
            media_type: source.mime_type,
        };
        req.validate()?;
        self.ensure_reading_dir(operation)?;
        let note_path = m.note_path.as_deref().ok_or("Missing selected note path")?;
        immutable(
            &self.reading_file(operation, "note-path")?,
            note_path.as_bytes(),
        )?;
        immutable(&request_path, &json(&req)?)?;
        Ok(req)
    }
    fn ensure_reading_dir(&self, operation: &str) -> Result<()> {
        self.fence_v3()?;
        let root = self.path("_meta/readings");
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(root.parent().ok_or("Missing parent")?)?;
        }
        if entries(&root)?.len() + 2 > MAX_RECORDS {
            return Err("Reading retention capacity reached".into());
        }
        let dir = self.reading_dir(operation)?;
        safe(&dir)?;
        if !dir.exists() {
            fs::create_dir(&dir).map_err(fail)?;
            sync_dir(&root)?;
        }
        if entries(&dir)?.len() + 4 > 32 {
            return Err("Reading preparation retention capacity reached".into());
        }
        Ok(())
    }
    pub fn reading_request(&self, operation: &str) -> Result<ReadingRequest> {
        let _lock = self.lock()?;
        self.request(operation)
    }
    fn check_reading_current(&self, request: &ReadingRequest) -> Result<VaultMemory> {
        if self.request(&request.binding.operation_id)? != *request
            || self.cancelled(&request.binding.operation_id)?
        {
            return Err("Reading cancelled or request changed".into());
        }
        let pending = self.recover()?;
        let m = self.current(&request.binding.memory_id, &pending)?;
        let b = &request.binding;
        if m.state != "active"
            || m.conflict.is_some()
            || m.revision != b.expected_revision
            || m.source_sha256 != b.source_sha256
            || m.captured_at != b.captured_at
            || Some(read(
                &self.reading_file(&b.operation_id, "note-path")?,
                260,
            )?) != m.note_path.as_ref().map(|p| p.as_bytes().to_vec())
        {
            return Err("Reading is stale; source or memory changed".into());
        }
        self.verify_source(&m)?;
        Ok(m)
    }
    /// Called immediately before I/O. A durable dispatch marker forces GET after any uncertain outcome.
    pub fn reading_recovery_check(&self, request: &ReadingRequest) -> Result<()> {
        let _lock = self.lock()?;
        self.check_reading_current(request).map(|_| ())
    }
    pub fn reading_dispatch(&self, request: &ReadingRequest) -> Result<Option<Vec<u8>>> {
        let _lock = self.lock()?;
        let m = self.check_reading_current(request)?;
        let marker = self.reading_file(&request.binding.operation_id, "dispatched")?;
        if marker.exists() {
            if read(&marker, 128)? != b"may-have-been-sent" {
                return Err("Invalid reading dispatch receipt".into());
            }
            return Ok(None);
        }
        immutable(&marker, b"may-have-been-sent")?;
        Ok(Some(self.verify_source(&m)?.bytes))
    }
    pub fn bind_reading_connection(
        &self,
        request: &ReadingRequest,
        fingerprint: &str,
    ) -> Result<()> {
        let _lock = self.lock()?;
        if self.request(&request.binding.operation_id)? != *request
            || self.cancelled(&request.binding.operation_id)?
        {
            return Err("Reading cancelled or request changed".into());
        }
        self.connection_matches(request, fingerprint, true)
    }
    fn connection_matches(
        &self,
        request: &ReadingRequest,
        fingerprint: &str,
        initialize: bool,
    ) -> Result<()> {
        if fingerprint.len() != 64
            || !fingerprint
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid connection fingerprint".into());
        }
        let operation = &request.binding.operation_id;
        let path = self.reading_file(operation, "connection-sha256")?;
        if path.exists() {
            if read(&path, 64)? != fingerprint.as_bytes() {
                return Err(
                    "Reading connection changed; previous operation cannot be resent".into(),
                );
            }
        } else {
            if !initialize
                || self.reading_file(operation, "dispatched")?.exists()
                || self.reading_file(operation, "status.json")?.exists()
            {
                return Err(
                    "Previous reading connection identity is unavailable; operation was not resent"
                        .into(),
                );
            }
            immutable(&path, fingerprint.as_bytes())?;
        }
        Ok(())
    }
    pub fn retry_reading_not_found(
        &self,
        request: &ReadingRequest,
        fingerprint: &str,
    ) -> Result<Vec<u8>> {
        let _lock = self.lock()?;
        self.connection_matches(request, fingerprint, false)?;
        let operation = &request.binding.operation_id;
        // Once admission was observed, a later 404 must never turn into redispatch.
        if self.reading_file(operation, "status.json")?.exists()
            || self.reading_file(operation, "complete.json")?.exists()
        {
            return Err("Previously admitted reading cannot be resent".into());
        }
        let m = self.check_reading_current(request)?;
        let bytes = self.verify_source(&m)?.bytes;
        immutable(
            &self.reading_file(operation, "dispatched")?,
            b"may-have-been-sent",
        )?;
        Ok(bytes)
    }
    pub fn reading_saved_result(&self, operation: &str) -> Result<Option<ReadingReceipt>> {
        let _lock = self.lock()?;
        let path = self.reading_file(operation, "complete.json")?;
        if !path.exists() {
            return Ok(None);
        }
        let r: ReadingReceipt = decode(&path)?;
        r.validate(&self.request(operation)?)?;
        Ok(Some(r))
    }
    pub fn retain_reading_response(
        &self,
        request: &ReadingRequest,
        response: &ReadingReceipt,
    ) -> Result<()> {
        let _lock = self.lock()?;
        response.validate(request)?;
        if self.request(&request.binding.operation_id)? != *request {
            return Err("Reading request changed".into());
        }
        let name = if response.state == "complete" {
            "complete.json"
        } else {
            "status.json"
        };
        let path = self.reading_file(&request.binding.operation_id, name)?;
        if name == "complete.json" {
            immutable(&path, &json(response)?)?;
        } else {
            let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
            if entries(&self.reading_dir(&request.binding.operation_id)?)?.len() + 2 > 32 {
                return Err("Reading status retention capacity reached".into());
            }
            create(&stage, &json(response)?)?;
            replace(&stage, &path)?;
        }
        Ok(())
    }
    pub fn accept_reading(
        &self,
        request: &ReadingRequest,
        response: &ReadingReceipt,
    ) -> Result<VaultMemory> {
        response.validate(request)?;
        let result = response
            .result
            .as_ref()
            .filter(|_| response.state == "complete")
            .ok_or("Reading is not complete")?;
        self.retain_reading_response(request, response)?;
        let _lock = self.lock()?;
        let operation = &request.binding.operation_id;
        // Receipt replay returns current authority without making a cancelled operation eligible anew.
        if self.cancelled(operation)? {
            return Err("Reading cancelled; provider cost may still apply".into());
        }
        if self.journal_path(operation).exists() {
            let e: Event = decode(&self.journal_path(operation))?;
            self.event_valid(&e)?;
            if e.kind != "machine_reading"
                || e.memory.reading.as_ref().map(|r| &r.machine)
                    != Some(&MachineReading {
                        request: request.clone(),
                        result: result.clone(),
                    })
            {
                return Err("Reading operation payload changed".into());
            }
            self.finish(&e)?;
        }
        let pending = self.recover()?;
        if let Some(e) = self.receipt(operation)? {
            if e.kind != "machine_reading"
                || e.memory.reading.as_ref().map(|r| &r.machine)
                    != Some(&MachineReading {
                        request: request.clone(),
                        result: result.clone(),
                    })
            {
                return Err("Reading operation payload changed".into());
            }
            return self.current(&request.binding.memory_id, &pending);
        }
        let mut m = self.check_reading_current(request)?;
        let human = m.reading.as_ref().and_then(|r| r.human_correction.clone());
        m.reading = Some(Reading {
            machine: MachineReading {
                request: request.clone(),
                result: result.clone(),
            },
            human_correction: human,
        });
        self.commit_reading(m, operation, "machine_reading")
    }
    pub fn correct_reading(
        &self,
        memory_id: &str,
        revision: u64,
        operation: &str,
        text: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        id(memory_id)?;
        id(operation)?;
        note_valid(text)?;
        let pending = self.recover()?;
        if let Some(e) = self.receipt(operation)? {
            if e.kind != "reading_correction"
                || e.memory.id != memory_id
                || e.expected_revision != revision
                || e.memory
                    .reading
                    .as_ref()
                    .and_then(|r| r.human_correction.as_deref())
                    != Some(text)
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(memory_id, &pending);
        }
        if self.reading_file(operation, "request.json")?.exists() {
            return Err("Operation ID already used".into());
        }
        let mut m = self.current(memory_id, &pending)?;
        if m.state != "active" || m.conflict.is_some() || m.revision != revision {
            return Err("Memory changed; refresh before correcting reading".into());
        }
        m.reading
            .as_mut()
            .ok_or("No machine reading to correct")?
            .human_correction = Some(text.into());
        self.commit_reading(m, operation, "reading_correction")
    }
    fn commit_reading(
        &self,
        mut m: VaultMemory,
        operation: &str,
        kind: &str,
    ) -> Result<VaultMemory> {
        let last = self.records(&m.id)?.pop().ok_or("Missing history")?;
        let expected_revision = m.revision;
        m.revision += 1;
        m.updated_at = timestamp();
        let base = payload(
            kind,
            &m.id,
            expected_revision,
            &m.note,
            &m.source_sha256,
            &m.source_name,
        )?;
        let e = Event {
            format: FORMAT_V3.into(),
            vault_id: self.id.clone(),
            operation_id: operation.into(),
            kind: kind.into(),
            expected_revision,
            payload_sha256: hash(&json(&(base, &m.reading))?),
            parent_sha256: Some(self.parent_hash(&m.id, expected_revision)?),
            origin: if kind == "machine_reading" {
                "machine:anthropic"
            } else {
                "human:recall"
            }
            .into(),
            note_path: m.note_path.clone(),
            expected_state: None,
            previous_markdown: Some(last.markdown),
            markdown: markdown(&m),
            memory: m,
        };
        self.commit(&e)
    }
    pub fn cancel_reading(&self, operation: &str) -> Result<ReadingOperation> {
        let _lock = self.lock()?;
        if !self.reading_file(operation, "request.json")?.exists() {
            if self.journal_path(operation).exists() {
                return Err("Operation ID already used".into());
            }
            self.ensure_reading_dir(operation)?;
            immutable(&self.reading_file(operation, "cancelled")?, b"cancelled")?;
            return Ok(ReadingOperation {
                operation_id: operation.into(),
                memory_id: String::new(),
                expected_revision: 0,
                state: "cancelled".into(),
                may_have_been_sent: false,
                error_code: None,
            });
        }
        self.request(operation)?;
        // A completed local commit cannot be undone by cancellation; UI receives committed status.
        if !self.history_has_reading(operation)? {
            immutable(&self.reading_file(operation, "cancelled")?, b"cancelled")?;
            if self.journal_path(operation).exists() {
                let event: Event = decode(&self.journal_path(operation))?;
                self.rollback_cancelled_reading(&event)?;
            }
        }
        self.reading_status_inner(operation)
    }
    /// Resolve only an uncommitted cancelled generated publication. All original
    /// journals/backups and any displaced draft remain immutable retained evidence.
    pub(super) fn rollback_cancelled_reading(&self, e: &Event) -> Result<()> {
        self.event_valid(e)?;
        if e.kind != "machine_reading"
            || !self.cancelled(&e.operation_id)?
            || self.history_has_reading(&e.operation_id)?
        {
            return Ok(());
        }
        let last = self
            .records(&e.memory.id)?
            .pop()
            .ok_or("Missing rollback authority")?;
        if last.memory.revision != e.expected_revision {
            return Ok(());
        }
        if e.parent_sha256 != Some(self.parent_hash(&e.memory.id, e.expected_revision)?)
            || e.previous_markdown.as_ref() != Some(&last.markdown)
        {
            return Err("Cancelled reading parent changed".into());
        }
        let note = self.event_note_path(e)?;
        if self
            .inventory(&e.memory.id, e.note_path.as_deref())?
            .is_some_and(|p| p != note)
        {
            return Err("Cancelled reading note moved; retained files need review".into());
        }
        let base = last.markdown.as_bytes();
        let backup = self.backup_path(&e.operation_id);
        if backup.exists() && read(&backup, MAX_JSON)? != base {
            return Err(
                "Concurrent human draft retained; cancellation did not overwrite it".into(),
            );
        }
        let displaced = self.reading_file(&e.operation_id, "cancelled-publication.md")?;
        if displaced.exists() && read(&displaced, MAX_JSON)? != e.markdown.as_bytes() {
            return Err("Concurrent editor draft retained during cancellation".into());
        }
        let current = if note.exists() {
            Some(read(&note, MAX_JSON)?)
        } else {
            None
        };
        if current.as_deref() == Some(base) {
            return Ok(());
        }
        if !backup.exists()
            || (current.is_some() && current.as_deref() != Some(e.markdown.as_bytes()))
        {
            return Err("Concurrent note edit; cancellation retained all files".into());
        }
        boundary!("rollback_before_move", &note);
        if current.is_some() {
            // Create-only rename preserves an intervening editor's bytes, then verify
            // them before publishing the old authoritative note at the vacant path.
            rename(&note, &displaced)?;
            if read(&displaced, MAX_JSON)? != e.markdown.as_bytes() {
                return Err("Concurrent note edit retained during cancellation".into());
            }
        }
        boundary!("rollback_before_restore", &note);
        atomic_new(&note, base)?;
        boundary!("rollback_after_restore", &note);
        if read(&note, MAX_JSON)? != base
            || read(&backup, MAX_JSON)? != base
            || (displaced.exists() && read(&displaced, MAX_JSON)? != e.markdown.as_bytes())
        {
            return Err("Concurrent editor draft retained during cancellation".into());
        }
        Ok(())
    }
    fn history_has_reading(&self, operation: &str) -> Result<bool> {
        let path = self.journal_path(operation);
        if !path.exists() {
            return Ok(false);
        }
        let e: Event = decode(&path)?;
        self.event_valid(&e)?;
        let bytes = read(&path, MAX_JSON)?;
        if read(
            &self.history_path(&e.memory.id, e.memory.revision),
            MAX_JSON,
        )
        .ok()
            != Some(bytes.clone())
        {
            return Ok(false);
        }
        // History publication is the commit point. Repair only that exact immutable
        // chain, never finish/publish an uncommitted machine draft here.
        self.repair_receipt(&e, &bytes)?;
        Ok(true)
    }
    pub fn reading_operations(&self, memory_id: &str) -> Result<Vec<ReadingOperation>> {
        let _lock = self.lock()?;
        id(memory_id)?;
        let root = self.path("_meta/readings");
        safe(&root)?;
        if !root.exists() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        for dir in entries(&root)? {
            let operation = dir
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid reading directory")?;
            // An incomplete/damaged intent cannot be attributed by directory alone.
            // Keep every artifact, but never let it hide another memory's operations.
            let Ok(req) = self.request(operation) else {
                continue;
            };
            if req.binding.memory_id == memory_id {
                match self.reading_status_inner(operation) {
                    Ok(status) => out.push(status),
                    Err(_) => out.push(ReadingOperation {
                        operation_id: operation.into(),
                        memory_id: memory_id.into(),
                        expected_revision: req.binding.expected_revision,
                        state: "failed".into(),
                        may_have_been_sent: self.reading_file(operation, "dispatched")?.exists(),
                        error_code: Some("LOCAL_READING_STATE_INVALID".into()),
                    }),
                }
            }
        }
        Ok(out)
    }
    fn reading_status_inner(&self, operation: &str) -> Result<ReadingOperation> {
        let req = self.request(operation)?;
        let dispatched = self.reading_file(operation, "dispatched")?.exists();
        let (state, error_code) = if self.cancelled(operation)? {
            ("cancelled".into(), None)
        } else if self.history_has_reading(operation)? {
            ("committed".into(), None)
        } else if self.reading_file(operation, "complete.json")?.exists() {
            ("ready".into(), None)
        } else if self.reading_file(operation, "status.json")?.exists() {
            let r: ReadingReceipt = decode(&self.reading_file(operation, "status.json")?)?;
            r.validate(&req)?;
            (r.state, r.error_code)
        } else {
            (if dispatched { "unknown" } else { "prepared" }.into(), None)
        };
        Ok(ReadingOperation {
            operation_id: operation.into(),
            memory_id: req.binding.memory_id,
            expected_revision: req.binding.expected_revision,
            state,
            may_have_been_sent: dispatched,
            error_code,
        })
    }
    pub(super) fn reading_event_valid(&self, e: &Event) -> Result<()> {
        if let Some(r) = &e.memory.reading {
            r.machine.validate()?;
            if let Some(h) = &r.human_correction {
                note_valid(h)?;
            }
            let b = &r.machine.request.binding;
            if b.vault_id != self.id
                || b.memory_id != e.memory.id
                || b.source_sha256 != e.memory.source_sha256
                || b.captured_at != e.memory.captured_at
                || b.expected_revision >= e.memory.revision
            {
                return Err("Reading source binding mismatch".into());
            }
            if e.kind == "machine_reading"
                && (b.operation_id != e.operation_id || b.expected_revision != e.expected_revision)
            {
                return Err("Reading revision binding mismatch".into());
            }
        } else if ["machine_reading", "reading_correction"].contains(&e.kind.as_str()) {
            return Err("Missing reading".into());
        }
        if e.kind == "capture" && e.memory.reading.is_some() {
            return Err("Capture cannot invent a reading".into());
        }
        Ok(())
    }
    pub(super) fn reading_transition(&self, prev: &Event, next: &Event) -> Result<()> {
        if prev.format == FORMAT_V3 && next.format != FORMAT_V3 {
            return Err("Reading history format downgrade".into());
        }
        let a = &prev.memory.reading;
        let b = &next.memory.reading;
        match next.kind.as_str() {
            "machine_reading" => {
                if prev.memory.note != next.memory.note
                    || a.as_ref().and_then(|r| r.human_correction.as_ref())
                        != b.as_ref().and_then(|r| r.human_correction.as_ref())
                {
                    return Err("Machine reading changed human prose".into());
                }
            }
            "reading_correction" => {
                if prev.memory.note != next.memory.note
                    || a.as_ref().map(|r| &r.machine) != b.as_ref().map(|r| &r.machine)
                    || b.as_ref()
                        .and_then(|r| r.human_correction.as_ref())
                        .is_none()
                {
                    return Err("Correction changed machine reading".into());
                }
            }
            _ => {
                if a != b {
                    return Err("Unrelated event changed reading".into());
                }
            }
        }
        Ok(())
    }
    pub(super) fn reading_publish_allowed(&self, e: &Event) -> Result<()> {
        if e.kind == "machine_reading" {
            let req = self.request(&e.operation_id)?;
            if self.cancelled(&e.operation_id)?
                || e.memory.reading.as_ref().map(|r| &r.machine.request) != Some(&req)
            {
                return Err(
                    "Reading cancelled or request changed; retained without promotion".into(),
                );
            }
            let receipt: ReadingReceipt =
                decode(&self.reading_file(&e.operation_id, "complete.json")?)?;
            receipt.validate(&req)?;
            if receipt.result.as_ref() != e.memory.reading.as_ref().map(|r| &r.machine.result) {
                return Err("Reading receipt changed".into());
            }
        }
        Ok(())
    }
}
impl LocalVaultState {
    pub fn begin_reading(
        &self,
        session: &str,
        memory: &str,
        revision: u64,
        operation: &str,
    ) -> Result<(Vault, ReadingRequest)> {
        self.with(session,|v| {
            let mut sessions=self.reading_sessions.lock().map_err(fail)?;
            if sessions.len()>=128 && !sessions.contains_key(&(session.into(),operation.into())) {return Err("Too many reading operations this session; restart after pending work completes".into());}
            let request=v.prepare_reading(memory,revision,operation)?;
            sessions.insert((session.into(),operation.into()),v.clone());Ok((v.clone(),request))
        })
    }
    pub fn resume_reading(
        &self,
        session: &str,
        operation: &str,
    ) -> Result<(Vault, ReadingRequest)> {
        self.with(session, |v| {
            let request = v.reading_request(operation)?;
            let mut sessions = self.reading_sessions.lock().map_err(fail)?;
            if sessions.len() >= 128 && !sessions.contains_key(&(session.into(), operation.into()))
            {
                return Err("Too many reading operations this session".into());
            }
            sessions.insert((session.into(), operation.into()), v.clone());
            Ok((v.clone(), request))
        })
    }
    pub fn cancel_session_reading(
        &self,
        session: &str,
        operation: &str,
    ) -> Result<ReadingOperation> {
        // Lock order matches begin/select; an old token can only cancel its registered operation.
        let selected = self.selected.lock().map_err(fail)?;
        if let Some(s) = selected.as_ref().filter(|s| s.token == session) {
            return s.vault.cancel_reading(operation);
        }
        let sessions = self.reading_sessions.lock().map_err(fail)?;
        sessions
            .get(&(session.into(), operation.into()))
            .ok_or("Vault selection changed; reading remains unpromoted")?
            .cancel_reading(operation)
    }
    pub fn forget_reading_session(&self, session: &str, operation: &str) -> Result<()> {
        self.reading_sessions
            .lock()
            .map_err(fail)?
            .remove(&(session.into(), operation.into()));
        Ok(())
    }
}
