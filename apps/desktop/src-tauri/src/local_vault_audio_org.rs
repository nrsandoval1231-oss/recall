//! Audio-transcript organization state: a marker separate from the text/photo one,
//! a durable per-recording intent, revalidation, and the v9 promotion event.
//!
//! The recording is never sent anywhere; only the bounded transcript text is, and
//! only for recordings captured after the remembered audio decision. Everything the
//! provider returns is an unreviewed proposal derived from an unreviewed machine
//! transcript (or a human-corrected one).
use super::*;

const MAX_TRANSCRIPT_CHARS: usize = 30_000;
const MAX_TRANSCRIPT_BYTES: usize = 120_000;

/// One intent per recording, created at capture only when an audio marker exists.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioOrganizationIntent {
    pub schema_version: String,
    pub operation_id: String,
    pub memory_id: String,
    pub vault_id: String,
    pub source_sha256: String,
    pub captured_at: String,
    pub consent_epoch: u64,
    pub local_epoch: String,
    pub connection_fingerprint: String,
    /// awaiting_transcript | queued | processing | unknown | organized | failed | stale | saved_local
    pub state: String,
    pub error_code: Option<String>,
    pub request: Option<OrganizationRequest>,
    /// Set durably immediately before the POST. A `processing` intent that was never
    /// sent can safely be retired or retried; a sent one stays ambiguous (`unknown`).
    #[serde(default)]
    pub sent: bool,
}

struct AudioOrgInput {
    text: String,
    evidence_kind: &'static str,
    derivative_sha256: String,
}

/// The exact current transcript bytes eligible for organization, or an honest code.
fn audio_org_input(m: &VaultMemory) -> std::result::Result<AudioOrgInput, &'static str> {
    let transcript = m.audio_transcript.as_ref().ok_or("TRANSCRIPT_MISSING")?;
    let (text, evidence_kind) = match &transcript.human_correction {
        Some(human) if human.text.trim().is_empty() => return Err("EMPTY_CORRECTION"),
        Some(human) => (human.text.clone(), "human_corrected"),
        None if transcript.machine.eligibility == "eligible"
            && !transcript.machine.text.trim().is_empty() =>
        {
            (transcript.machine.text.clone(), "machine_unreviewed")
        }
        None => return Err("TRANSCRIPT_INELIGIBLE"),
    };
    if text.contains('\0')
        || text.chars().count() > MAX_TRANSCRIPT_CHARS
        || text.len() > MAX_TRANSCRIPT_BYTES
    {
        return Err("INPUT_LIMIT_EXCEEDED");
    }
    Ok(AudioOrgInput {
        text,
        evidence_kind,
        derivative_sha256: transcript.machine.derivative_sha256.clone(),
    })
}

impl Vault {
    fn audio_org_marker_path(&self) -> PathBuf {
        self.path("_meta/audio-organization-marker.json")
    }
    fn audio_org_dir(&self) -> PathBuf {
        self.path("_meta/audio-organize")
    }
    fn ensure_audio_org_dir(&self) -> Result<PathBuf> {
        let root = self.audio_org_dir();
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(root.parent().ok_or("Missing audio organization parent")?)?;
        }
        if !root.is_dir() {
            return Err("Audio organization storage is unavailable".into());
        }
        Ok(root)
    }
    fn audio_org_intent_path(&self, memory_id: &str) -> Result<PathBuf> {
        id(memory_id)?;
        Ok(self.audio_org_dir().join(format!("{memory_id}.json")))
    }
    fn load_audio_marker(&self) -> Result<Option<OrganizationMarker>> {
        let path = self.audio_org_marker_path();
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let marker: OrganizationMarker = decode(&path)?;
        if marker.schema_version != "1.0"
            || marker.vault_id != self.id
            || marker.consent_epoch == 0
            || Uuid::parse_str(&marker.local_epoch).is_err()
            || !marker.policy_version.starts_with("organize-audio-v1|")
            || marker.policy_version.len() > 160
            || marker.connection_fingerprint.len() != 64
            || !marker
                .connection_fingerprint
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid remembered audio organization consent marker".into());
        }
        Ok(Some(marker))
    }
    pub fn audio_organization_marker(&self) -> Result<Option<OrganizationMarker>> {
        let _lock = self.lock()?;
        self.load_audio_marker()
    }
    fn audio_org_intent(&self, memory_id: &str) -> Result<Option<AudioOrganizationIntent>> {
        let path = self.audio_org_intent_path(memory_id)?;
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let intent: AudioOrganizationIntent = decode(&path)?;
        if intent.schema_version != "1.0"
            || intent.memory_id != memory_id
            || intent.vault_id != self.id
            || id(&intent.operation_id).is_err()
            || Uuid::parse_str(&intent.local_epoch).is_err()
            || intent.connection_fingerprint.len() != 64
            || ![
                "awaiting_transcript",
                "queued",
                "processing",
                "unknown",
                "organized",
                "failed",
                "stale",
                "saved_local",
            ]
            .contains(&intent.state.as_str())
        {
            return Err("Invalid audio organization intent".into());
        }
        Ok(Some(intent))
    }
    fn save_audio_org_intent(
        &self,
        intent: &AudioOrganizationIntent,
        replace_existing: bool,
    ) -> Result<()> {
        let root = self.ensure_audio_org_dir()?;
        let path = self.audio_org_intent_path(&intent.memory_id)?;
        let bytes = json(intent)?;
        if bytes.len() > MAX_JSON as usize {
            return Err("Audio organization intent exceeds its limit".into());
        }
        if path.exists() {
            let old: AudioOrganizationIntent = decode(&path)?;
            if !replace_existing {
                return if old == *intent {
                    Ok(())
                } else {
                    Err("Audio organization intent already exists".into())
                };
            }
            if old.operation_id != intent.operation_id
                || old.memory_id != intent.memory_id
                || old.source_sha256 != intent.source_sha256
                || old.consent_epoch != intent.consent_epoch
                || old.local_epoch != intent.local_epoch
                || old.connection_fingerprint != intent.connection_fingerprint
            {
                return Err("Audio organization retry binding changed".into());
            }
            let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
            create(&stage, &bytes)?;
            replace(&stage, &path)
        } else {
            if entries(&root)?.len() >= MAX_RECORDS {
                return Err("Audio organization retention capacity reached".into());
            }
            immutable(&path, &bytes)
        }
    }
    fn update_audio_org_intent(
        &self,
        intent: &mut AudioOrganizationIntent,
        state: &str,
        error: Option<&str>,
        request: Option<Option<OrganizationRequest>>,
    ) -> Result<()> {
        intent.state = state.into();
        intent.error_code = error.map(str::to_owned);
        if let Some(request) = request {
            intent.request = request;
        }
        self.save_audio_org_intent(intent, true)
    }

    /// Persist or clear the separate audio marker. A new epoch or a revoke retires
    /// every not-yet-dispatched intent; nothing is ever revived or backfilled.
    pub fn set_audio_organization_marker(&self, marker: Option<OrganizationMarker>) -> Result<()> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let root = self.ensure_audio_org_dir()?;
        let path = self.audio_org_marker_path();
        if let Some(marker) = &marker {
            if marker.vault_id != self.id
                || marker.schema_version != "1.0"
                || marker.consent_epoch == 0
                || Uuid::parse_str(&marker.local_epoch).is_err()
                || !marker.policy_version.starts_with("organize-audio-v1|")
            {
                return Err("Invalid audio organization consent marker".into());
            }
            let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
            create(&stage, &json(marker)?)?;
            if path.exists() {
                replace(&stage, &path)?;
            } else {
                rename(&stage, &path)?;
            }
        } else if path.exists() {
            fs::remove_file(&path).map_err(fail)?;
            sync_dir(path.parent().ok_or("Missing marker parent")?)?;
        }
        for p in entries(&root)? {
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(memory_id) = p.file_stem().and_then(|x| x.to_str()) else {
                continue;
            };
            let Some(mut intent) = self.audio_org_intent(memory_id)? else {
                continue;
            };
            // Undispatched work is retired; a request that may already have been sent
            // (`sent`) stays ambiguous and is resolved only by its receipt.
            let unsent = ["awaiting_transcript", "queued"].contains(&intent.state.as_str())
                || (intent.state == "processing" && !intent.sent);
            if !unsent {
                // Sent work must not sit on "processing" forever once consent is gone: it becomes
                // ambiguous (`unknown`) with the reason. This only writes state; it never sends.
                if intent.state == "processing" && intent.sent {
                    let code = match &marker {
                        Some(m) if m.local_epoch == intent.local_epoch => continue,
                        Some(_) => "CONSENT_EPOCH_CHANGED",
                        None => "CONSENT_REVOKED",
                    };
                    self.update_audio_org_intent(&mut intent, "unknown", Some(code), None)?;
                }
                continue;
            }
            match &marker {
                Some(m) if m.local_epoch == intent.local_epoch => {}
                Some(_) => self.update_audio_org_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_EPOCH_CHANGED"),
                    None,
                )?,
                None => self.update_audio_org_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_REVOKED"),
                    None,
                )?,
            }
        }
        Ok(())
    }

    fn audio_org_operation_of(intent: &AudioOrganizationIntent) -> OrganizationOperation {
        OrganizationOperation {
            operation_id: intent.operation_id.clone(),
            memory_id: intent.memory_id.clone(),
            state: intent.state.clone(),
            error_code: intent.error_code.clone(),
        }
    }
    pub fn audio_organization_operations(
        &self,
        memory_id: &str,
    ) -> Result<Vec<OrganizationOperation>> {
        let _lock = self.lock()?;
        Ok(self
            .audio_org_intent(memory_id)?
            .iter()
            .map(Self::audio_org_operation_of)
            .collect())
    }
    pub fn audio_organization_intents(&self) -> Result<Vec<AudioOrganizationIntent>> {
        let _lock = self.lock()?;
        let root = self.audio_org_dir();
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for p in entries(&root)? {
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Some(memory_id) = p.file_stem().and_then(|x| x.to_str()) {
                if let Some(intent) = self.audio_org_intent(memory_id)? {
                    out.push(intent);
                }
            }
        }
        out.sort_by(|a, b| {
            a.captured_at
                .cmp(&b.captured_at)
                .then(a.operation_id.cmp(&b.operation_id))
        });
        Ok(out)
    }
    fn audio_org_intent_by_operation(&self, op: &str) -> Result<AudioOrganizationIntent> {
        id(op)?;
        let root = self.audio_org_dir();
        if root.exists() {
            for p in entries(&root)? {
                let Some(memory_id) = p.file_stem().and_then(|x| x.to_str()) else {
                    continue;
                };
                if p.extension().and_then(|x| x.to_str()) != Some("json") {
                    continue;
                }
                if let Some(intent) = self.audio_org_intent(memory_id)? {
                    if intent.operation_id == op {
                        return Ok(intent);
                    }
                }
            }
        }
        Err("Audio organization operation not found".into())
    }
    pub fn audio_organization_operation(&self, op: &str) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        Ok(Self::audio_org_operation_of(
            &self.audio_org_intent_by_operation(op)?,
        ))
    }
    /// Unconditional setter, for tests and maintenance only. Production transitions use
    /// [`Self::transition_audio_organization_state`] so a terminal state is never overwritten.
    #[cfg(test)]
    pub fn set_audio_organization_operation_state(
        &self,
        op: &str,
        state: &str,
        error: Option<String>,
    ) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(op)?;
        self.update_audio_org_intent(&mut intent, state, error.as_deref(), None)?;
        Ok(Self::audio_org_operation_of(&intent))
    }

    /// Compare-and-set: move the operation to `to` only if it is currently in one of the
    /// `from` states. Returns `None` (and writes nothing) otherwise, so a retired
    /// (`stale`/`failed`/`organized`/`saved_local`) operation can never be overwritten.
    pub fn transition_audio_organization_state(
        &self,
        op: &str,
        from: &[&str],
        to: &str,
        error: Option<&str>,
    ) -> Result<Option<OrganizationOperation>> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(op)?;
        if !from.contains(&intent.state.as_str()) {
            return Ok(None);
        }
        self.update_audio_org_intent(&mut intent, to, error, None)?;
        Ok(Some(Self::audio_org_operation_of(&intent)))
    }
    /// Durable "may have been sent" marker, written right before the POST. Refused (false)
    /// unless the operation is still live, so a retired intent is never sent.
    pub fn mark_audio_organization_sent(&self, op: &str) -> Result<bool> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(op)?;
        if !["processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(false);
        }
        // The marker must still be the one this intent was enrolled under.
        if self.audio_org_marker_matches(&intent)?.is_err() {
            return Ok(false);
        }
        if !intent.sent {
            intent.sent = true;
            self.save_audio_org_intent(&intent, true)?;
        }
        Ok(true)
    }
    /// A `processing` operation that was never sent returns to `queued` (nothing left the
    /// device), e.g. after a transient check failure.
    pub fn revert_audio_organization_unsent(&self, op: &str) -> Result<()> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(op)?;
        if intent.state == "processing" && !intent.sent {
            self.update_audio_org_intent(&mut intent, "queued", None, None)?;
        }
        Ok(())
    }
    /// Sweep: queue every intent still `awaiting_transcript` whose recording already has a
    /// committed transcript or correction (a crash, a swallowed error or an idempotent
    /// replay may have skipped the queue step). Permanent problems become a safe
    /// `saved_local` code inside the queue step; transient I/O errors leave the intent
    /// untouched for the next sweep. Returns how many intents were examined.
    pub fn audio_organization_requeue_pending(&self) -> Result<usize> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let root = self.audio_org_dir();
        if !root.exists() {
            return Ok(0);
        }
        let mut examined = 0;
        for p in entries(&root)? {
            let Some(memory_id) = p.file_stem().and_then(|x| x.to_str()) else {
                continue;
            };
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Ok(Some(intent)) = self.audio_org_intent(memory_id) else {
                continue;
            };
            if intent.state != "awaiting_transcript" {
                continue;
            }
            let Ok(memory) = self.current(memory_id, &pending) else {
                continue;
            };
            if memory.state != "active"
                || memory.conflict.is_some()
                || memory.audio_transcript.is_none()
            {
                continue;
            }
            examined += 1;
            let _ = self.audio_org_queue_locked(&memory);
        }
        Ok(examined)
    }

    #[cfg(test)]
    pub fn simulate_skipped_queue_for_test(&self, memory_id: &str) -> Result<()> {
        let _lock = self.lock()?;
        let mut intent = self
            .audio_org_intent(memory_id)?
            .ok_or("No audio organization intent")?;
        self.update_audio_org_intent(&mut intent, "awaiting_transcript", None, Some(None))
    }

    /// Called under the writer lock right after the capture commits, with the marker read
    /// under the same lock immediately before publishing the original. The fence is the
    /// marker present at capture commit: a recording whose commit lands after the opt-in
    /// (even if the person pressed Record earlier) is enrolled; anything committed before
    /// the decision, or imported before it, is never enrolled later (no backlog, no revival).
    pub(super) fn prepare_audio_org_intent(
        &self,
        memory: &VaultMemory,
        marker: Option<&OrganizationMarker>,
    ) -> Result<()> {
        let Some(marker) = marker else {
            return Ok(());
        };
        if memory.audio_source.is_none() || memory.revision != 1 {
            return Ok(());
        }
        let intent = AudioOrganizationIntent {
            schema_version: "1.0".into(),
            operation_id: Uuid::new_v4().to_string(),
            memory_id: memory.id.clone(),
            vault_id: self.id.clone(),
            source_sha256: memory.source_sha256.clone(),
            captured_at: memory.captured_at.clone(),
            consent_epoch: marker.consent_epoch,
            local_epoch: marker.local_epoch.clone(),
            connection_fingerprint: marker.connection_fingerprint.clone(),
            state: "awaiting_transcript".into(),
            error_code: None,
            request: None,
            sent: false,
        };
        if self.audio_org_intent_path(&memory.id)?.exists() {
            return Ok(());
        }
        self.save_audio_org_intent(&intent, false)
    }
    pub(super) fn audio_org_current_marker(&self) -> Option<OrganizationMarker> {
        self.load_audio_marker().ok().flatten()
    }

    /// Called under the writer lock after a transcript or correction commits. Only an
    /// eligible machine transcript or a non-empty human correction can queue, and the
    /// request is built from those exact current bytes.
    pub(super) fn audio_org_queue_locked(&self, memory: &VaultMemory) -> Result<()> {
        let Some(mut intent) = self.audio_org_intent(&memory.id)? else {
            return Ok(());
        };
        let retryable_hold = intent.state == "saved_local"
            && matches!(
                intent.error_code.as_deref(),
                Some(
                    "TRANSCRIPT_INELIGIBLE"
                        | "TRANSCRIPTION_FAILED"
                        | "INPUT_LIMIT_EXCEEDED"
                        | "EMPTY_CORRECTION"
                )
            );
        if !["awaiting_transcript", "queued"].contains(&intent.state.as_str()) && !retryable_hold {
            return Ok(());
        }
        let marker = self.load_audio_marker()?;
        match marker.as_ref() {
            None => {
                return self.update_audio_org_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_REVOKED"),
                    None,
                );
            }
            Some(m)
                if m.local_epoch != intent.local_epoch
                    || m.consent_epoch != intent.consent_epoch
                    || m.connection_fingerprint != intent.connection_fingerprint =>
            {
                return self.update_audio_org_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_EPOCH_CHANGED"),
                    None,
                );
            }
            Some(_) => {}
        }
        let input = match audio_org_input(memory) {
            Ok(input) => input,
            Err(code) => {
                return self.update_audio_org_intent(
                    &mut intent,
                    "saved_local",
                    Some(code),
                    Some(None),
                );
            }
        };
        let binding = OrganizationBinding {
            schema_version: "3.0".into(),
            operation_id: intent.operation_id.clone(),
            vault_id: self.id.clone(),
            memory_id: memory.id.clone(),
            source_kind: "audio_transcript".into(),
            source_sha256: memory.source_sha256.clone(),
            expected_revision: memory.revision,
            input_sha256: hash(input.text.as_bytes()),
            derivative_sha256: Some(input.derivative_sha256),
            transcript_revision: Some(memory.revision),
            transcript_evidence_kind: Some(input.evidence_kind.into()),
            consent_epoch: intent.consent_epoch,
            captured_at: memory.captured_at.clone(),
            context_coverage: None,
            context: None,
        };
        let request = OrganizationRequest {
            binding,
            media_type: "text/plain; charset=utf-8".into(),
        };
        if request.validate(input.text.as_bytes()).is_err() {
            return self.update_audio_org_intent(
                &mut intent,
                "saved_local",
                Some("REQUEST_INVALID"),
                Some(None),
            );
        }
        self.update_audio_org_intent(&mut intent, "queued", None, Some(Some(request)))
    }
    /// A failed recognizer run is an honest, non-queued outcome for the intent.
    pub(super) fn audio_org_mark_awaiting_failed(&self, memory_id: &str) {
        if let Ok(Some(mut intent)) = self.audio_org_intent(memory_id) {
            if intent.state == "awaiting_transcript" {
                let _ = self.update_audio_org_intent(
                    &mut intent,
                    "saved_local",
                    Some("TRANSCRIPTION_FAILED"),
                    None,
                );
            }
        }
    }

    /// Revalidate everything a request depends on against the current vault. `Err(code)`
    /// means the request is stale; it must never be sent or promoted.
    fn audio_org_revalidate(
        &self,
        request: &OrganizationRequest,
        pending: &BTreeMap<String, String>,
    ) -> std::result::Result<Vec<u8>, &'static str> {
        let b = &request.binding;
        if b.vault_id != self.id || b.source_kind != "audio_transcript" {
            return Err("SOURCE_OR_REVISION_CHANGED");
        }
        let memory = self
            .current(&b.memory_id, pending)
            .map_err(|_| "SOURCE_OR_REVISION_CHANGED")?;
        let human = memory
            .audio_transcript
            .as_ref()
            .is_some_and(|t| t.human_correction.is_some());
        if human && b.transcript_evidence_kind.as_deref() == Some("machine_unreviewed") {
            return Err("HUMAN_CORRECTION");
        }
        if memory.state != "active"
            || memory.conflict.is_some()
            || memory.revision != b.expected_revision
            || memory.source_sha256 != b.source_sha256
            || memory.captured_at != b.captured_at
            || b.transcript_revision.is_none_or(|r| r > memory.revision)
            || self.verify_source(&memory).is_err()
        {
            return Err("SOURCE_OR_REVISION_CHANGED");
        }
        let input = audio_org_input(&memory).map_err(|_| "TRANSCRIPT_CHANGED")?;
        if Some(input.derivative_sha256.as_str()) != b.derivative_sha256.as_deref()
            || Some(input.evidence_kind) != b.transcript_evidence_kind.as_deref()
            || hash(input.text.as_bytes()) != b.input_sha256
        {
            return Err("TRANSCRIPT_CHANGED");
        }
        let body = input.text.into_bytes();
        request.validate(&body).map_err(|_| "INPUT_CHANGED")?;
        Ok(body)
    }
    fn audio_org_already_promoted(&self, intent: &mut AudioOrganizationIntent) -> Result<bool> {
        match self.receipt(&intent.operation_id)? {
            Some(e) if e.kind == "audio_organization" => {
                if intent.state != "organized" {
                    self.update_audio_org_intent(intent, "organized", None, None)?;
                }
                Ok(true)
            }
            _ => Ok(false),
        }
    }
    fn audio_org_marker_matches(
        &self,
        intent: &AudioOrganizationIntent,
    ) -> Result<std::result::Result<OrganizationMarker, &'static str>> {
        Ok(match self.load_audio_marker()? {
            None => Err("CONSENT_REVOKED"),
            Some(m)
                if m.local_epoch != intent.local_epoch
                    || m.consent_epoch != intent.consent_epoch
                    || m.connection_fingerprint != intent.connection_fingerprint =>
            {
                Err("CONSENT_EPOCH_CHANGED")
            }
            Some(m) => Ok(m),
        })
    }

    /// Revalidated send material, or `None` after the intent was retired as stale.
    pub fn audio_organization_dispatch_material(
        &self,
        op: &str,
    ) -> Result<Option<(AudioOrganizationIntent, OrganizationRequest, Vec<u8>)>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(op)?;
        if !["queued", "processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(None);
        }
        if self.audio_org_already_promoted(&mut intent)? {
            return Ok(None);
        }
        let stale = |this: &Self, intent: &mut AudioOrganizationIntent, code: &str| {
            this.update_audio_org_intent(intent, "stale", Some(code), None)?;
            Ok::<_, String>(None)
        };
        if let Err(code) = self.audio_org_marker_matches(&intent)? {
            return stale(self, &mut intent, code);
        }
        let Some(request) = intent.request.clone() else {
            return stale(self, &mut intent, "NOT_QUEUED");
        };
        match self.audio_org_revalidate(&request, &pending) {
            Ok(body) => Ok(Some((intent, request, body))),
            Err(code) => stale(self, &mut intent, code),
        }
    }

    /// Journal the validated proposals onto the recording as a v9 event, after a final
    /// revalidation under the same lock.
    pub fn promote_audio_organization(
        &self,
        request: &OrganizationRequest,
        body: &[u8],
        receipt: &OrganizationReceipt,
    ) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let mut intent = self.audio_org_intent_by_operation(&request.binding.operation_id)?;
        if intent.memory_id != request.binding.memory_id {
            return Err("Audio organization operation mismatch".into());
        }
        if self.audio_org_already_promoted(&mut intent)? {
            return Ok(Self::audio_org_operation_of(&intent));
        }
        // A retired operation (stale after a revoke or correction) never promotes late.
        if !["queued", "processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(Self::audio_org_operation_of(&intent));
        }
        if self.audio_org_marker_matches(&intent)?.is_err()
            || request.binding.consent_epoch != intent.consent_epoch
            || request.binding.vault_id != self.id
        {
            return Err("Audio organization authorization changed".into());
        }
        request.validate(body)?;
        receipt.validate(request, Some(body))?;
        if receipt.state != "complete" {
            let state = if receipt.state == "failed" {
                "failed"
            } else {
                "unknown"
            };
            self.update_audio_org_intent(&mut intent, state, receipt.error_code.as_deref(), None)?;
            return Ok(Self::audio_org_operation_of(&intent));
        }
        if intent.request.as_ref() != Some(request) {
            self.update_audio_org_intent(&mut intent, "stale", Some("REQUEST_CHANGED"), None)?;
            return Ok(Self::audio_org_operation_of(&intent));
        }
        if let Err(code) = self.audio_org_revalidate(request, &pending) {
            self.update_audio_org_intent(&mut intent, "stale", Some(code), None)?;
            return Ok(Self::audio_org_operation_of(&intent));
        }
        let result = receipt
            .result
            .clone()
            .ok_or("Missing audio organization result")?;
        let mut memory = self.current(&request.binding.memory_id, &pending)?;
        let last = self.records(&memory.id)?.pop().ok_or("Missing history")?;
        let expected_revision = memory.revision;
        memory.revision += 1;
        memory.updated_at = timestamp();
        memory.audio_organization = Some(OrganizationProposal {
            binding: request.binding.clone(),
            media_type: request.media_type.clone(),
            payload_sha256: receipt.payload_sha256.clone(),
            review_state: "unreviewed".into(),
            result,
            suppressed: false,
        });
        let e = Event {
            format: FORMAT_V9.into(),
            vault_id: self.id.clone(),
            operation_id: request.binding.operation_id.clone(),
            kind: "audio_organization".into(),
            expected_revision,
            payload_sha256: String::new(),
            parent_sha256: Some(self.parent_hash(&memory.id, last.memory.revision)?),
            origin: "machine:anthropic".into(),
            note_path: memory.note_path.clone(),
            expected_state: None,
            previous_markdown: Some(last.markdown),
            markdown: String::new(),
            memory,
            context_link_projection: None,
        };
        self.commit(&e)?;
        self.update_audio_org_intent(&mut intent, "organized", None, None)?;
        Ok(Self::audio_org_operation_of(&intent))
    }
}

#[cfg(test)]
impl Vault {
    pub fn root_for_test(&self) -> PathBuf {
        self.root.clone()
    }
    pub fn dir_for_test(&self) -> &'static str {
        self.dir
    }
    /// Create (or open) a pre-rename vault whose memory subtree is `Recall/`.
    pub fn open_legacy_for_test(root: &Path) -> Result<Self> {
        Self::open_in(root, LEGACY_DIR)
    }
}

#[cfg(test)]
impl Vault {
    /// Test-only: hold the writer lock so another operation sees "vault is busy".
    pub fn hold_lock_for_test(&self) -> Result<File> {
        self.lock()
    }
}
