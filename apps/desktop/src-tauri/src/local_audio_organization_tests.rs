//! Audio organization: consent marker, intent lifecycle, wire shape, dispatch against
//! a fake transport (no network), revalidation, promotion and suppression. All audio and
//! transcripts here are clearly synthetic.
use super::*;
use crate::audio_wav::fixtures::synthetic_wav;
use crate::local_organization::{OrganizationBinding, OrganizationProposal, OrganizationResult};
use crate::local_vault::{classify_machine_output, AudioMachineTranscript, VaultMemory};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

const POLICY: &str = "organize-audio-v1|synthetic-policy|synthetic-model";
const FINGERPRINT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn root(v: &Vault) -> PathBuf {
    v.root_for_test().join("Recall")
}
fn history_file(v: &Vault, id: &str, rev: u64) -> PathBuf {
    root(v).join(format!("History/{id}/{rev:020}.json"))
}
fn note_file(v: &Vault, id: &str) -> PathBuf {
    root(v).join(format!("Memories/{id}.md"))
}
fn source_file(v: &Vault, id: &str) -> PathBuf {
    root(v).join(format!("Sources/{id}.wav"))
}
fn op() -> String {
    Uuid::new_v4().to_string()
}
pub(crate) struct Env {
    dir: PathBuf,
    state: LocalVaultState,
    token: String,
}
impl Env {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("recall-synthetic-audioorg-{}", op()));
        let root = dir.join("vault");
        fs::create_dir_all(&root).unwrap();
        let state = LocalVaultState::new(dir.join("selected.json"));
        let token = state.select_path(&root).unwrap().vault_id.unwrap();
        Self { dir, state, token }
    }
    fn guard(&self) -> SelectionGuard {
        self.state.session(&self.token).unwrap()
    }
}
impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}
fn marker(vault: &Vault, epoch: u64) -> OrganizationMarker {
    OrganizationMarker {
        schema_version: "1.0".into(),
        vault_id: vault.id.clone(),
        policy_version: POLICY.into(),
        consent_epoch: epoch,
        local_epoch: op(),
        connection_fingerprint: FINGERPRINT.into(),
    }
}
fn capture(vault: &Vault) -> VaultMemory {
    vault
        .audio_commit_capture(&op(), &synthetic_wav(16_000, 1, 16_000), "recorded", None)
        .unwrap()
}
fn machine(memory: &VaultMemory, text: &str, rms: f64) -> AudioMachineTranscript {
    let (eligible, flags) = classify_machine_output(text, rms);
    AudioMachineTranscript {
        operation_id: op(),
        source_sha256: memory.source_sha256.clone(),
        source_revision: 1,
        runtime_source_commit: "d".repeat(40),
        runtime_binary_sha256: "a".repeat(64),
        model_sha256: "b".repeat(64),
        derivative_sha256: "c".repeat(64),
        transform_version: crate::audio_wav::TRANSFORM_VERSION.into(),
        output_sha256: "e".repeat(64),
        text: text.into(),
        segments: None,
        input_rms_pcm16: rms,
        quality_flags: flags,
        eligibility: if eligible { "eligible" } else { "ineligible" }.into(),
        quality_state: "machine_unreviewed".into(),
    }
}
fn transcribe(vault: &Vault, memory: &VaultMemory, text: &str) -> VaultMemory {
    vault
        .audio_apply_machine_transcript(&memory.id, machine(memory, text, 2800.0))
        .unwrap()
}
fn operation(vault: &Vault, memory_id: &str) -> OrganizationOperation {
    vault
        .audio_organization_operations(memory_id)
        .unwrap()
        .remove(0)
}
fn intent_of(vault: &Vault, memory_id: &str) -> AudioOrganizationIntent {
    vault
        .audio_organization_intents()
        .unwrap()
        .into_iter()
        .find(|i| i.memory_id == memory_id)
        .unwrap()
}

const SPOKEN: &str = "Call the dentist tomorrow at three. Bring the insurance card.";

pub(crate) fn complete_receipt(request: &OrganizationRequest, body: &[u8]) -> OrganizationReceipt {
    let text = std::str::from_utf8(body).unwrap();
    let digest = request.payload_sha256().unwrap();
    let memory_id = &request.binding.memory_id;
    let evidence = |quote: &str| json!([{"page_id": memory_id, "quote": quote}]);
    let legibility =
        if request.binding.transcript_evidence_kind.as_deref() == Some("machine_unreviewed") {
            "mixed"
        } else {
            "clear"
        };
    let extraction = json!({
        "schema_version":"1.1","capture_id":memory_id,"input_manifest_sha256":digest,
        "summary":"A dental appointment reminder.","summary_evidence":evidence("Call the dentist"),
        "pages":[{"page_id":memory_id,"ordinal":1,"transcription":text,"legibility":legibility}],
        "mentions":[{"local_id":"m1","kind":"organization","raw_text":"the dentist","evidence":evidence("the dentist")}],
        "statements":[{"local_id":"s1","kind":"claim","subject_mention_id":"m1","predicate":"call_tomorrow",
            "text":"A call is due tomorrow at three.","value_text":null,"epistemic_state":"reported",
            "attribution_text":null,"temporal_text":"tomorrow at three","object_mention_id":null,
            "evidence":evidence("tomorrow at three")}],
        "action_suggestions":[{"local_id":"a1","kind":"action","text":"Bring the insurance card.",
            "assignee_mention_id":null,"due_text":null,"evidence":evidence("Bring the insurance card.")}],
        "uncertainties":[]
    });
    OrganizationReceipt {
        schema_version: "1.0".into(),
        binding: request.binding.clone(),
        payload_sha256: digest.clone(),
        state: "complete".into(),
        result: Some(OrganizationResult {
            provider: "anthropic".into(),
            model_id: "synthetic-model".into(),
            input_manifest_sha256: digest,
            derivative: None,
            extraction,
            related_context: None,
            validation_notes: Vec::new(),
            review_state: "unreviewed".into(),
        }),
        error_code: None,
    }
}

type PostHook = Box<dyn Fn() + Send + Sync>;
pub(crate) struct Fake {
    vault_id: String,
    epoch: Mutex<u64>,
    enabled: Mutex<bool>,
    lookups: Mutex<VecDeque<Result<OrganizationLookup>>>,
    post_error: Mutex<bool>,
    posts: AtomicUsize,
    gets: AtomicUsize,
    sent_headers: Mutex<Vec<String>>,
    on_post: Mutex<Option<PostHook>>,
    on_get: Mutex<Option<PostHook>>,
    capability_calls: AtomicUsize,
    epoch_after_calls: Mutex<Option<(usize, u64)>>,
    complete_with: Mutex<Option<OrganizationReceipt>>,
}
impl Fake {
    fn new(vault: &Vault, epoch: u64) -> Self {
        Self {
            vault_id: vault.id.clone(),
            epoch: Mutex::new(epoch),
            enabled: Mutex::new(true),
            lookups: Mutex::new(VecDeque::new()),
            post_error: Mutex::new(false),
            posts: AtomicUsize::new(0),
            gets: AtomicUsize::new(0),
            sent_headers: Mutex::new(Vec::new()),
            on_post: Mutex::new(None),
            on_get: Mutex::new(None),
            capability_calls: AtomicUsize::new(0),
            epoch_after_calls: Mutex::new(None),
            complete_with: Mutex::new(None),
        }
    }
}
impl AudioOrganizationTransport for Fake {
    fn capability(&self) -> Result<OrganizationCapability> {
        let calls = self.capability_calls.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some((after, epoch)) = *self.epoch_after_calls.lock().unwrap() {
            if calls > after {
                *self.epoch.lock().unwrap() = epoch;
            }
        }
        Ok(OrganizationCapability {
            schema_version: "1.0".into(),
            scope: "vault_intelligence".into(),
            purpose: "organize_audio".into(),
            vault_id: self.vault_id.clone(),
            policy_version: POLICY.into(),
            provider: Some("anthropic".into()),
            consent: "active".into(),
            enabled: *self.enabled.lock().unwrap(),
            consent_epoch: *self.epoch.lock().unwrap(),
            decided_at: Some("2026-10-22T12:00:00Z".into()),
        })
    }
    fn get(&self, _request: &OrganizationRequest) -> Result<OrganizationLookup> {
        self.gets.fetch_add(1, Ordering::SeqCst);
        if let Some(hook) = self.on_get.lock().unwrap().as_ref() {
            hook();
        }
        self.lookups
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(OrganizationLookup::NotFound))
    }
    fn post(&self, request: &OrganizationRequest, body: Vec<u8>) -> Result<OrganizationReceipt> {
        self.posts.fetch_add(1, Ordering::SeqCst);
        self.sent_headers
            .lock()
            .unwrap()
            .push(request.header_value()?);
        if let Some(hook) = self.on_post.lock().unwrap().as_ref() {
            hook();
        }
        if *self.post_error.lock().unwrap() {
            return Err("Organization outcome is unknown; recover this operation".into());
        }
        request.validate(&body)?;
        Ok(self
            .complete_with
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| complete_receipt(request, &body)))
    }
}
pub(crate) fn run(guard: &SelectionGuard, fake: &Fake) -> Result<bool> {
    run_audio_scoped(
        guard,
        None,
        &mut HashSet::new(),
        &|| Ok(FINGERPRINT.to_owned()),
        fake,
    )
}

/// An audio-enabled vault with one eligible, queued recording.
pub(crate) fn queued() -> (Env, SelectionGuard, VaultMemory, Fake) {
    let env = Env::new();
    let guard = env.guard();
    guard
        .vault
        .set_audio_organization_marker(Some(marker(&guard.vault, 1)))
        .unwrap();
    let captured = capture(&guard.vault);
    assert_eq!(
        operation(&guard.vault, &captured.id).state,
        "awaiting_transcript"
    );
    let transcribed = transcribe(&guard.vault, &captured, SPOKEN);
    assert_eq!(operation(&guard.vault, &captured.id).state, "queued");
    let fake = Fake::new(&guard.vault, 1);
    (env, guard, transcribed, fake)
}

// --------------------------------------------------------------------------------
// Consent marker
// --------------------------------------------------------------------------------

fn server(vault: &Vault, consent: &str, epoch: u64) -> OrganizationCapability {
    OrganizationCapability {
        schema_version: "1.0".into(),
        scope: "vault_intelligence".into(),
        purpose: "organize_audio".into(),
        vault_id: vault.id.clone(),
        policy_version: POLICY.into(),
        provider: Some("anthropic".into()),
        consent: consent.into(),
        enabled: consent == "active",
        consent_epoch: epoch,
        decided_at: Some("2026-10-22T12:00:00Z".into()),
    }
}

#[test]
fn confirmed_enable_commits_a_separate_future_only_marker() {
    let env = Env::new();
    let vault = env.guard().vault;
    let before = capture(&vault);
    let connection = pairing::IntelligenceConnection::from_parts(
        vault.id.clone(),
        "https://synthetic.invalid".into(),
        "synthetic-secret".into(),
    );
    let ready = commit_confirmed_audio_consent(
        &vault,
        &connection,
        Some(&connection),
        server(&vault, "active", 1),
        true,
    )
    .unwrap();
    assert!(ready.automatic_enabled);
    assert_eq!(ready.local_readiness, "ready");
    assert_eq!(ready.server.purpose, "organize_audio");
    // Separate marker: text/photo consent is untouched; the earlier recording is never enrolled.
    assert!(vault.organization_marker().unwrap().is_none());
    assert!(vault.audio_organization_marker().unwrap().is_some());
    assert!(vault
        .audio_organization_operations(&before.id)
        .unwrap()
        .is_empty());
    assert!(vault.audio_organization_intents().unwrap().is_empty());
    // A re-paired connection during the request keeps the fence off.
    let replacement = pairing::IntelligenceConnection::from_parts(
        vault.id.clone(),
        "https://replacement.invalid".into(),
        "replacement-secret".into(),
    );
    let changed = commit_confirmed_audio_consent(
        &vault,
        &connection,
        Some(&replacement),
        server(&vault, "active", 1),
        true,
    )
    .unwrap();
    assert_eq!(
        (changed.local_readiness.as_str(), changed.automatic_enabled),
        ("unknown", false)
    );
    assert_eq!(
        vault
            .audio_organization_marker()
            .unwrap()
            .unwrap()
            .connection_fingerprint,
        connection.fingerprint
    );
    // A recording captured after opt-in is enrolled, and a typed note is not touched.
    let after = capture(&vault);
    assert_eq!(operation(&vault, &after.id).state, "awaiting_transcript");
    let typed = vault
        .capture_text(&op(), "typed after audio opt-in")
        .unwrap();
    assert!(vault.organization_operations(&typed.id).unwrap().is_empty());
    // Revoking clears the marker and retires undispatched work.
    let off = commit_confirmed_audio_consent(
        &vault,
        &connection,
        None,
        server(&vault, "missing", 2),
        false,
    )
    .unwrap();
    assert_eq!(off.local_readiness, "off");
    assert_eq!(operation(&vault, &after.id).state, "stale");
    assert_eq!(
        operation(&vault, &after.id).error_code.as_deref(),
        Some("CONSENT_REVOKED")
    );
}

#[test]
fn local_readiness_mirrors_the_text_photo_semantics() {
    let env = Env::new();
    let vault = env.guard().vault;
    let connection = pairing::IntelligenceConnection::from_parts(
        vault.id.clone(),
        "https://synthetic.invalid".into(),
        "synthetic-secret".into(),
    );
    let readiness = |consent: &str, epoch: u64| {
        native_audio_capability(&vault, &connection, server(&vault, consent, epoch)).local_readiness
    };
    assert_eq!(readiness("missing", 1), "off");
    assert_eq!(readiness("active", 1), "needs_setup");
    let mut m = marker(&vault, 1);
    m.connection_fingerprint = connection.fingerprint.clone();
    vault
        .set_audio_organization_marker(Some(m.clone()))
        .unwrap();
    assert_eq!(readiness("active", 1), "ready");
    assert_eq!(readiness("active", 2), "needs_setup");
    assert_eq!(readiness("missing", 1), "unknown");
    assert_eq!(readiness("outdated", 1), "unknown");
    // The text/photo marker never makes audio ready, and audio never makes text ready.
    assert!(vault.organization_marker().unwrap().is_none());
}

#[test]
fn a_text_photo_marker_alone_never_enrolls_audio() {
    let env = Env::new();
    let vault = env.guard().vault;
    vault
        .set_organization_marker(Some(OrganizationMarker {
            schema_version: "1.0".into(),
            vault_id: vault.id.clone(),
            policy_version: "organize-v2|anthropic-v1|synthetic-model".into(),
            consent_epoch: 2,
            local_epoch: op(),
            connection_fingerprint: FINGERPRINT.into(),
        }))
        .unwrap();
    let recording = capture(&vault);
    assert!(vault
        .audio_organization_operations(&recording.id)
        .unwrap()
        .is_empty());
    transcribe(&vault, &recording, SPOKEN);
    assert!(vault.audio_organization_intents().unwrap().is_empty());
    assert!(vault.organization_intents().unwrap().is_empty());
    // And an audio marker alone never enrolls a typed note.
    let env2 = Env::new();
    let v2 = env2.guard().vault;
    v2.set_audio_organization_marker(Some(marker(&v2, 1)))
        .unwrap();
    let note = v2.capture_text(&op(), "typed").unwrap();
    assert!(v2.organization_operations(&note.id).unwrap().is_empty());
}

// --------------------------------------------------------------------------------
// Intent lifecycle
// --------------------------------------------------------------------------------

#[test]
fn only_eligible_transcripts_queue_and_they_bind_the_exact_transcript_bytes() {
    let env = Env::new();
    let vault = env.guard().vault;
    vault
        .set_audio_organization_marker(Some(marker(&vault, 3)))
        .unwrap();
    let ok = capture(&vault);
    let saved = transcribe(&vault, &ok, SPOKEN);
    let intent = intent_of(&vault, &ok.id);
    assert_eq!(intent.state, "queued");
    assert_eq!(intent.consent_epoch, 3);
    let binding = &intent.request.as_ref().unwrap().binding;
    assert_eq!(binding.schema_version, "3.0");
    assert_eq!(binding.source_kind, "audio_transcript");
    assert_eq!(binding.source_sha256, ok.source_sha256);
    assert_eq!(
        binding.input_sha256,
        crate::audio_wav::sha256_hex(SPOKEN.as_bytes())
    );
    assert_eq!(
        binding.derivative_sha256.as_deref(),
        Some("c".repeat(64).as_str())
    );
    assert_eq!(
        binding.transcript_evidence_kind.as_deref(),
        Some("machine_unreviewed")
    );
    assert_eq!(
        (binding.expected_revision, binding.transcript_revision),
        (saved.revision, Some(saved.revision))
    );
    assert_eq!(binding.operation_id, intent.operation_id);
    assert_eq!(binding.captured_at, ok.captured_at);
    assert!(binding.context.is_none() && binding.context_coverage.is_none());
    for (text, rms, code) in [
        ("[Music]", 900.0, "TRANSCRIPT_INELIGIBLE"),
        ("(crickets chirping)", 900.0, "TRANSCRIPT_INELIGIBLE"),
        ("you", 0.0, "TRANSCRIPT_INELIGIBLE"),
        ("", 900.0, "TRANSCRIPT_INELIGIBLE"),
    ] {
        let m = capture(&vault);
        vault
            .audio_apply_machine_transcript(&m.id, machine(&m, text, rms))
            .unwrap();
        let op_state = operation(&vault, &m.id);
        assert_eq!(
            (op_state.state.as_str(), op_state.error_code.as_deref()),
            ("saved_local", Some(code)),
            "{text:?}"
        );
        assert!(intent_of(&vault, &m.id).request.is_none());
    }
    let long = capture(&vault);
    vault
        .audio_apply_machine_transcript(&long.id, machine(&long, &"word ".repeat(6_001), 900.0))
        .unwrap();
    assert_eq!(
        operation(&vault, &long.id).error_code.as_deref(),
        Some("INPUT_LIMIT_EXCEEDED")
    );
    // A failed recognizer run is an honest saved_local, not a silent wait.
    let failed = capture(&vault);
    let begin = vault
        .audio_asr_begin(
            &failed.id,
            &crate::local_vault::AsrIdentity {
                runtime_source_commit: "d".repeat(40),
                runtime_binary_sha256: "a".repeat(64),
                model_sha256: "b".repeat(64),
            },
        )
        .unwrap();
    vault.audio_asr_mark_dispatched(&begin.request).unwrap();
    vault
        .audio_asr_record_result(
            &begin.request,
            &crate::local_vault::AsrResult {
                schema_version: "1.0".into(),
                asr_operation_id: begin.request.asr_operation_id.clone(),
                memory_id: failed.id.clone(),
                source_sha256: begin.request.source_sha256.clone(),
                derivative_sha256: begin.request.derivative_sha256.clone(),
                state: "failed".into(),
                error_code: Some("asr_timeout".into()),
                output_sha256: None,
                text: None,
                segments: None,
                gated_before_launch: false,
                exit_code: None,
                elapsed_ms: 1,
                completed_at: crate::local_vault::utc_now(),
            },
        )
        .unwrap();
    assert_eq!(
        operation(&vault, &failed.id).error_code.as_deref(),
        Some("TRANSCRIPTION_FAILED")
    );
}

#[test]
fn no_backlog_and_a_changed_or_revoked_epoch_never_revives_old_intents() {
    let env = Env::new();
    let vault = env.guard().vault;
    let early = capture(&vault);
    transcribe(&vault, &early, SPOKEN);
    vault
        .set_audio_organization_marker(Some(marker(&vault, 1)))
        .unwrap();
    // Opt-in does not sweep the backlog.
    assert!(vault.audio_organization_intents().unwrap().is_empty());
    let a = capture(&vault);
    let b = capture(&vault);
    transcribe(&vault, &b, SPOKEN);
    assert_eq!(operation(&vault, &a.id).state, "awaiting_transcript");
    assert_eq!(operation(&vault, &b.id).state, "queued");
    // New epoch: both undispatched intents retire; a later transcript cannot revive them.
    vault
        .set_audio_organization_marker(Some(marker(&vault, 2)))
        .unwrap();
    for id in [&a.id, &b.id] {
        let o = operation(&vault, id);
        assert_eq!(
            (o.state.as_str(), o.error_code.as_deref()),
            ("stale", Some("CONSENT_EPOCH_CHANGED"))
        );
    }
    transcribe(&vault, &a, SPOKEN);
    assert_eq!(operation(&vault, &a.id).state, "stale");
    // Only recordings captured under the new epoch are enrolled.
    let c = capture(&vault);
    assert_eq!(intent_of(&vault, &c.id).consent_epoch, 2);
    vault.set_audio_organization_marker(None).unwrap();
    assert_eq!(
        operation(&vault, &c.id).error_code.as_deref(),
        Some("CONSENT_REVOKED")
    );
    transcribe(&vault, &c, SPOKEN);
    assert_eq!(operation(&vault, &c.id).state, "stale");
    assert!(vault.audio_organization_marker().unwrap().is_none());
}

#[test]
fn a_correction_before_dispatch_rebinds_to_the_corrected_wording_with_the_same_operation() {
    let (_env, guard, memory, _fake) = queued();
    let vault = &guard.vault;
    let before = intent_of(vault, &memory.id);
    let corrected = vault
        .audio_correct(
            &memory.id,
            memory.revision,
            &op(),
            "Call the dentist on Friday.",
        )
        .unwrap();
    let after = intent_of(vault, &memory.id);
    assert_eq!(after.state, "queued");
    assert_eq!(
        after.operation_id, before.operation_id,
        "never sent, so the ID is reused"
    );
    let binding = after.request.as_ref().unwrap().binding.clone();
    assert_eq!(
        binding.transcript_evidence_kind.as_deref(),
        Some("human_corrected")
    );
    assert_eq!(
        binding.input_sha256,
        crate::audio_wav::sha256_hex(b"Call the dentist on Friday.")
    );
    assert_eq!(binding.expected_revision, corrected.revision);
    // An empty correction deliberately suppresses everything: nothing queues.
    let blank = vault
        .audio_correct(&memory.id, corrected.revision, &op(), "")
        .unwrap();
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("saved_local", Some("EMPTY_CORRECTION"))
    );
    assert!(intent_of(vault, &memory.id).request.is_none());
    // A later non-empty correction can still queue (same consent, never sent).
    vault
        .audio_correct(&memory.id, blank.revision, &op(), "Dentist on Monday.")
        .unwrap();
    assert_eq!(operation(vault, &memory.id).state, "queued");
}

#[test]
fn a_correction_after_dispatch_started_retires_the_machine_request() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    let op_id = operation(vault, &memory.id).operation_id;
    vault
        .set_audio_organization_operation_state(&op_id, "processing", None)
        .unwrap();
    vault
        .audio_correct(&memory.id, memory.revision, &op(), "Different words.")
        .unwrap();
    // The in-flight request is stale and is never re-bound to the new wording.
    assert!(vault
        .audio_organization_dispatch_material(&op_id)
        .unwrap()
        .is_none());
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("stale", Some("HUMAN_CORRECTION"))
    );
    assert!(run(&guard, &fake).is_ok());
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
}

// --------------------------------------------------------------------------------
// Wire shape
// --------------------------------------------------------------------------------

fn wire_request() -> (OrganizationRequest, Vec<u8>) {
    let body = SPOKEN.as_bytes().to_vec();
    let binding = OrganizationBinding {
        schema_version: "3.0".into(),
        operation_id: "00000000-0000-4000-8000-000000000021".into(),
        vault_id: "00000000-0000-4000-8000-000000000002".into(),
        memory_id: "00000000-0000-4000-8000-000000000003".into(),
        source_kind: "audio_transcript".into(),
        source_sha256: "f".repeat(64),
        expected_revision: 2,
        input_sha256: crate::audio_wav::sha256_hex(&body),
        derivative_sha256: Some("c".repeat(64)),
        transcript_revision: Some(2),
        transcript_evidence_kind: Some("machine_unreviewed".into()),
        consent_epoch: 1,
        captured_at: "2026-10-22T12:00:00Z".into(),
        context_coverage: None,
        context: None,
    };
    (
        OrganizationRequest {
            binding,
            media_type: "text/plain; charset=utf-8".into(),
        },
        body,
    )
}

#[test]
fn binding_3_0_has_the_frozen_key_set_header_and_validation() {
    let (request, body) = wire_request();
    request.validate(&body).unwrap();
    let canonical = String::from_utf8(serde_json::to_vec(&request.binding).unwrap()).unwrap();
    assert_eq!(
        canonical,
        r#"{"schema_version":"3.0","operation_id":"00000000-0000-4000-8000-000000000021","vault_id":"00000000-0000-4000-8000-000000000002","memory_id":"00000000-0000-4000-8000-000000000003","source_kind":"audio_transcript","source_sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","expected_revision":2,"input_sha256":"c8cd7c48bd1b52b8a60b2c3a2b0e6d7ebd1fa5f5fcb4d5e0a1b4b4bf7bf7e1f1","derivative_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","transcript_revision":2,"transcript_evidence_kind":"machine_unreviewed","consent_epoch":1,"captured_at":"2026-10-22T12:00:00Z"}"#
            .replace(
                "c8cd7c48bd1b52b8a60b2c3a2b0e6d7ebd1fa5f5fcb4d5e0a1b4b4bf7bf7e1f1",
                &request.binding.input_sha256
            )
    );
    let header = request.header_value().unwrap();
    assert!(header.starts_with("v3.") && header.is_ascii() && header.len() <= 3_072);
    assert!(!header.contains('=') && !header[3..].contains(['+', '/']));
    // Decoding returns the canonical JSON (base64url without padding).
    let decoded = {
        let table = |c: u8| match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' => 62,
            _ => 63,
        };
        let mut out = Vec::new();
        for chunk in header.as_bytes()[3..].chunks(4) {
            let v: Vec<u32> = chunk.iter().map(|c| table(*c) as u32).collect();
            let n = v.iter().fold(0u32, |acc, x| (acc << 6) | x) << (6 * (4 - v.len()));
            out.extend_from_slice(&n.to_be_bytes()[1..=(chunk.len() * 6 / 8)]);
        }
        out
    };
    assert_eq!(decoded, canonical.as_bytes());
    println!("AUDIO-3.0 header: {header}");
    println!(
        "AUDIO-3.0 payload_sha256: {}",
        request.payload_sha256().unwrap()
    );
    // v1/v2 are unchanged: no audio keys can appear in their bytes.
    let text = OrganizationBinding {
        schema_version: "1.0".into(),
        source_kind: "text".into(),
        derivative_sha256: None,
        transcript_revision: None,
        transcript_evidence_kind: None,
        ..request.binding.clone()
    };
    let text_json = serde_json::to_string(&text).unwrap();
    assert!(!text_json.contains("derivative") && !text_json.contains("transcript"));
}

#[test]
fn binding_3_0_rejects_malformed_fields_and_bodies() {
    let (request, body) = wire_request();
    let mut cases: Vec<(&str, OrganizationRequest)> = Vec::new();
    let mut r = request.clone();
    r.binding.source_kind = "text".into();
    cases.push(("kind", r));
    let mut r = request.clone();
    r.binding.derivative_sha256 = None;
    cases.push(("derivative missing", r));
    let mut r = request.clone();
    r.binding.derivative_sha256 = Some("C".repeat(64));
    cases.push(("derivative uppercase", r));
    let mut r = request.clone();
    r.binding.transcript_revision = Some(0);
    cases.push(("revision zero", r));
    let mut r = request.clone();
    r.binding.transcript_evidence_kind = Some("verified".into());
    cases.push(("evidence kind", r));
    let mut r = request.clone();
    r.binding.context_coverage = Some(crate::local_organization::OrganizationContextCoverage {
        eligible_count: 0,
        selected_count: 0,
        limited: false,
        truncated_count: 0,
    });
    r.binding.context = Some(Vec::new());
    cases.push(("context is out of scope (would be 3.1)", r));
    let mut r = request.clone();
    r.binding.consent_epoch = 0;
    cases.push(("epoch", r));
    let mut r = request.clone();
    r.media_type = "text/plain".into();
    cases.push(("media type", r));
    for (label, case) in cases {
        assert!(case.validate(&body).is_err(), "{label}");
    }
    // 1.0/2.0 bindings may not carry audio fields.
    let mut v1 = request.clone();
    v1.binding.schema_version = "1.0".into();
    v1.binding.source_kind = "text".into();
    assert!(v1.validate(&body).is_err());
    // Body rules: hash, NUL, UTF-8, emptiness and bounds.
    let mut nul = request.clone();
    let nul_body = b"hello\0world".to_vec();
    nul.binding.input_sha256 = crate::audio_wav::sha256_hex(&nul_body);
    assert!(nul.validate(&nul_body).is_err());
    let mut bad = request.clone();
    let bad_body = vec![0xff, 0xfe, 0x41];
    bad.binding.input_sha256 = crate::audio_wav::sha256_hex(&bad_body);
    assert!(bad.validate(&bad_body).is_err());
    assert!(request.validate(b"tampered body").is_err());
    let mut empty = request.clone();
    empty.binding.input_sha256 = crate::audio_wav::sha256_hex(b"");
    assert!(empty.validate(b"").is_err());
    let mut big = request.clone();
    let big_body = "a".repeat(30_001).into_bytes();
    big.binding.input_sha256 = crate::audio_wav::sha256_hex(&big_body);
    assert!(big.validate(&big_body).is_err());
    let at_limit = "a".repeat(30_000).into_bytes();
    let mut ok = request.clone();
    ok.binding.input_sha256 = crate::audio_wav::sha256_hex(&at_limit);
    ok.validate(&at_limit).unwrap();
}

#[test]
fn receipts_for_audio_must_quote_exactly_and_never_call_machine_wording_clear() {
    let (request, body) = wire_request();
    let text = std::str::from_utf8(&body).unwrap();
    let mut receipt = complete_receipt(&request, &body);
    receipt.validate(&request, Some(&body)).unwrap();
    // Misquote.
    let mut misquote = receipt.clone();
    misquote.result.as_mut().unwrap().extraction["summary_evidence"][0]["quote"] =
        "never said this".into();
    assert!(misquote.validate(&request, Some(&body)).is_err());
    // Changed transcription.
    let mut changed = receipt.clone();
    changed.result.as_mut().unwrap().extraction["pages"][0]["transcription"] =
        format!("{text} extra").into();
    assert!(changed.validate(&request, Some(&body)).is_err());
    // "clear" is never claimed for unreviewed machine wording...
    let mut clear = receipt.clone();
    clear.result.as_mut().unwrap().extraction["pages"][0]["legibility"] = "clear".into();
    assert!(clear.validate(&request, Some(&body)).is_err());
    // ...but is allowed when the person corrected the wording.
    let mut human = request.clone();
    human.binding.transcript_evidence_kind = Some("human_corrected".into());
    let human_receipt = complete_receipt(&human, &body);
    assert_eq!(
        human_receipt.result.as_ref().unwrap().extraction["pages"][0]["legibility"],
        "clear"
    );
    human_receipt.validate(&human, Some(&body)).unwrap();
    // No related context in 3.0, no derivative, wrong purpose binding.
    receipt.result.as_mut().unwrap().related_context = Some(Vec::new());
    assert!(receipt.validate(&request, Some(&body)).is_err());
    let mut other = complete_receipt(&request, &body);
    other.binding.operation_id = op();
    assert!(other.validate(&request, Some(&body)).is_err());
}

/// The backend-published synthetic vectors. A missing or unparseable file FAILS: there is
/// no silent skip, so the native and service sides cannot drift apart unnoticed.
pub(crate) fn shared_fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/contracts/fixtures/local-audio-organization-synthetic.json");
    let text = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("shared audio organization fixture is required ({path:?}): {e}")
    });
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("shared audio organization fixture is invalid JSON: {e}"))
}

#[test]
fn shared_backend_vectors_match_byte_for_byte() {
    let fixture = shared_fixture();
    let variants = fixture["variants"].as_array().unwrap();
    assert!(variants.len() >= 2);
    // The capability and consent bodies parse into (and match the keys of) the native types.
    let capability: OrganizationCapability =
        serde_json::from_value(fixture["capability_example"].clone()).unwrap();
    assert_eq!(capability.purpose, "organize_audio");
    assert!(capability.policy_version.starts_with("organize-audio-v1|"));
    let consent = fixture["consent_request_example"].as_object().unwrap();
    let mut keys: Vec<_> = consent.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "enabled",
            "expected_consent_epoch",
            "policy_version",
            "schema_version"
        ]
    );
    let sent = serde_json::json!({"schema_version":"1.0","policy_version":capability.policy_version,"enabled":true,"expected_consent_epoch":0});
    assert_eq!(&sent, &fixture["consent_request_example"]);

    for variant in variants {
        let name = variant["name"].as_str().unwrap();
        let binding: OrganizationBinding =
            serde_json::from_value(variant["binding"].clone()).unwrap();
        let request = OrganizationRequest {
            binding,
            media_type: variant["media_type"].as_str().unwrap().into(),
        };
        let body = variant["body_text"].as_str().unwrap().as_bytes();
        request
            .validate(body)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            String::from_utf8(serde_json::to_vec(&request.binding).unwrap()).unwrap(),
            variant["canonical_binding_utf8"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(
            request.header_value().unwrap(),
            variant["organization_header"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(
            request.header_value().unwrap().len() as u64,
            variant["header_ascii_length"].as_u64().unwrap()
        );
        assert_eq!(
            String::from_utf8(request.canonical_bytes().unwrap()).unwrap(),
            variant["canonical_payload_json"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(
            request.payload_sha256().unwrap(),
            variant["payload_sha256"].as_str().unwrap(),
            "{name}"
        );
        let kind = request.binding.transcript_evidence_kind.as_deref().unwrap();
        assert_eq!(
            variant["expected_wrapper_legibility"] == "mixed",
            kind == "machine_unreviewed",
            "{name}: wrapper legibility rule"
        );
    }
}

// --------------------------------------------------------------------------------
// Dispatch, promotion, suppression
// --------------------------------------------------------------------------------

#[test]
fn eligible_transcripts_are_sent_once_and_promoted_as_inert_unreviewed_proposals() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    let history_before: Vec<Vec<u8>> = (1..=memory.revision)
        .map(|rev| fs::read(history_file(vault, &memory.id, rev)).unwrap())
        .collect();
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert_eq!(
        fake.gets.load(Ordering::SeqCst),
        1,
        "receipt lookup precedes any send"
    );
    assert!(fake.sent_headers.lock().unwrap()[0].starts_with("v3."));
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("organized", None)
    );
    let promoted = guard.with(|v| v.list("")).unwrap().remove(0);
    let proposal = promoted.audio_organization.as_ref().unwrap();
    assert!(!proposal.suppressed && proposal.review_state == "unreviewed");
    assert_eq!(proposal.binding.schema_version, "3.0");
    assert_eq!(proposal.result.provider, "anthropic");
    assert_eq!(promoted.revision, memory.revision + 1);
    // The promotion is a v9 journaled event; nothing earlier was rewritten.
    let events = vault.history(&memory.id).unwrap();
    assert_eq!(events.last().unwrap().kind, "audio_organization");
    for (rev, bytes) in history_before.iter().enumerate() {
        assert_eq!(
            &fs::read(history_file(vault, &memory.id, rev as u64 + 1)).unwrap(),
            bytes
        );
    }
    assert!(
        fs::read_to_string(history_file(vault, &memory.id, promoted.revision))
            .unwrap()
            .contains("\"format\":\"recall-local-vault-v9\"")
    );
    // Markdown: clearly labelled, inert, annotation region intact.
    let markdown = fs::read_to_string(note_file(vault, &memory.id)).unwrap();
    assert!(markdown.contains("## Machine proposals (unreviewed)"));
    assert!(markdown.contains("derived from an unreviewed machine transcript"));
    assert!(markdown.contains("not verified facts"));
    assert_eq!(markdown.matches("## Human annotation\n\n").count(), 1);
    // Search finds current proposals; a direct edit in the annotation region still reconciles.
    assert_eq!(guard.with(|v| v.list("dental")).unwrap().len(), 1);
    fs::write(
        note_file(vault, &memory.id),
        format!("{markdown}my own note"),
    )
    .unwrap();
    let edited = guard.with(|v| v.list("")).unwrap().remove(0);
    assert_eq!(edited.note, "my own note");
    assert!(edited
        .audio_organization
        .as_ref()
        .is_some_and(|p| !p.suppressed));
    // A second sweep sends nothing.
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    // Replay from a fresh open is clean.
    assert!(Vault::open(&guard.vault.root_for_test())
        .unwrap()
        .list("")
        .unwrap()
        .iter()
        .all(|m| m.conflict.is_none()));
}

#[test]
fn a_human_correction_after_promotion_suppresses_proposals_and_history_keeps_them() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    run(&guard, &fake).unwrap();
    let promoted = guard.with(|v| v.list("")).unwrap().remove(0);
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .audio_correct(
            &memory.id,
            promoted.revision,
            &op(),
            "Dentist on Friday, nothing to bring.",
        )
        .unwrap();
    assert!(corrected.audio_organization.as_ref().unwrap().suppressed);
    let o = operation(vault, &memory.id);
    assert_eq!(o.state, "organized", "the finished operation is not re-run");
    run(&guard, &fake).unwrap();
    assert_eq!(
        fake.posts.load(Ordering::SeqCst),
        1,
        "a correction never re-organizes"
    );
    // Current search and Ask follow the correction only.
    assert!(guard.with(|v| v.list("dental")).unwrap().is_empty());
    assert!(guard.with(|v| v.list("insurance")).unwrap().is_empty());
    let candidates = guard.with(|v| v.ask_candidates()).unwrap();
    assert_eq!(candidates[0].evidence_kind, "human_audio_correction");
    assert!(!candidates[0].ranking_text.contains("insurance"));
    let markdown = fs::read_to_string(note_file(vault, &memory.id)).unwrap();
    assert!(markdown.contains("## Machine proposals (suppressed)"));
    assert!(!markdown.contains("Machine proposals (unreviewed)"));
    // History retains the unsuppressed proposal and the machine transcript it came from.
    let history = vault.history(&memory.id).unwrap();
    let at_promotion = history
        .iter()
        .find(|r| r.kind == "audio_organization")
        .unwrap();
    assert!(at_promotion
        .audio_organization
        .as_ref()
        .is_some_and(|p| !p.suppressed));
    assert_eq!(
        at_promotion.audio_transcript.as_ref().unwrap().machine.text,
        SPOKEN
    );
    assert!(
        history
            .last()
            .unwrap()
            .audio_organization
            .as_ref()
            .unwrap()
            .suppressed
    );
}

#[test]
fn revalidation_stales_changed_sources_and_never_sends() {
    // Source bytes mutated after queueing.
    let (_env, guard, memory, fake) = queued();
    let path = source_file(&guard.vault, &memory.id);
    let mut bytes = fs::read(&path).unwrap();
    bytes[60] ^= 0xff;
    fs::write(&path, bytes).unwrap();
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(&guard.vault, &memory.id).state, "stale");
    // A later revision (annotation edit) stales the request too.
    let (_e2, g2, m2, f2) = queued();
    g2.vault
        .correct(&m2.id, m2.revision, &op(), "note")
        .unwrap();
    run(&g2, &f2).unwrap();
    assert_eq!(f2.posts.load(Ordering::SeqCst), 0);
    assert_eq!(
        operation(&g2.vault, &m2.id).error_code.as_deref(),
        Some("SOURCE_OR_REVISION_CHANGED")
    );
}

#[test]
fn consent_connection_or_service_changes_block_sending_and_late_promotion() {
    // Revoked locally: nothing is processed.
    let (_e, guard, memory, fake) = queued();
    guard.vault.set_audio_organization_marker(None).unwrap();
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(&guard.vault, &memory.id).state, "stale");
    // Service says disabled or a different epoch: not sent, intent stays queued for later.
    let (_e, guard, memory, fake) = queued();
    *fake.enabled.lock().unwrap() = false;
    run(&guard, &fake).unwrap();
    *fake.enabled.lock().unwrap() = true;
    *fake.epoch.lock().unwrap() = 9;
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(&guard.vault, &memory.id).state, "queued");
    // Paired connection replaced: the sweep does not run at all.
    let (_e, guard, memory, fake) = queued();
    let ran = run_audio_scoped(
        &guard,
        None,
        &mut HashSet::new(),
        &|| Ok("b".repeat(64)),
        &fake,
    )
    .unwrap();
    assert!(!ran);
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(&guard.vault, &memory.id).state, "queued");
    // Consent revoked while the request is in flight: the result is not promoted.
    let (_e, guard, memory, fake) = queued();
    let vault = guard.vault.clone();
    *fake.on_post.lock().unwrap() = Some(Box::new(move || {
        vault.set_audio_organization_marker(None).unwrap();
    }));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert!(guard
        .with(|v| v.list(""))
        .unwrap()
        .remove(0)
        .audio_organization
        .is_none());
    assert_eq!(operation(&guard.vault, &memory.id).state, "stale");
    // A human correction while the request is in flight: stale, never promoted.
    let (_e, guard, memory, fake) = queued();
    let (vault, id, rev) = (guard.vault.clone(), memory.id.clone(), memory.revision);
    *fake.on_post.lock().unwrap() = Some(Box::new(move || {
        vault
            .audio_correct(
                &id,
                rev,
                &Uuid::new_v4().to_string(),
                "Corrected during flight.",
            )
            .unwrap();
    }));
    run(&guard, &fake).unwrap();
    assert!(guard
        .with(|v| v.list(""))
        .unwrap()
        .remove(0)
        .audio_organization
        .is_none());
    assert_eq!(operation(&guard.vault, &memory.id).state, "stale");
}

#[test]
fn lost_replies_become_unknown_and_recovery_never_double_sends() {
    // GET unavailable: nothing may be sent.
    let (_e, guard, memory, fake) = queued();
    fake.lookups
        .lock()
        .unwrap()
        .push_back(Err("receipt unavailable".into()));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    let o = operation(&guard.vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("unknown", Some("NOT_DISPATCHED"))
    );
    // Authenticated 404 on recovery: the same operation is sent once.
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert_eq!(operation(&guard.vault, &memory.id).state, "organized");
    // Ambiguous POST, then the server's receipt shows completion: recovered without re-sending.
    let (_e, guard, memory, fake) = queued();
    *fake.post_error.lock().unwrap() = true;
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert_eq!(operation(&guard.vault, &memory.id).state, "unknown");
    let intent = intent_of(&guard.vault, &memory.id);
    let request = intent.request.clone().unwrap();
    let body = SPOKEN.as_bytes();
    fake.lookups
        .lock()
        .unwrap()
        .push_back(Ok(OrganizationLookup::Receipt(complete_receipt(
            &request, body,
        ))));
    *fake.post_error.lock().unwrap() = false;
    let mut attempted = HashSet::new();
    run_audio_scoped(
        &guard,
        Some(&intent.operation_id),
        &mut attempted,
        &|| Ok(FINGERPRINT.to_owned()),
        &fake,
    )
    .unwrap();
    assert_eq!(
        fake.posts.load(Ordering::SeqCst),
        1,
        "recovery used the receipt, not another POST"
    );
    assert_eq!(operation(&guard.vault, &memory.id).state, "organized");
    // Service-side failure and in-flight/unknown receipts keep honest states.
    let (_e, guard, memory, fake) = queued();
    let mut failed = complete_receipt(
        &intent_of(&guard.vault, &memory.id).request.unwrap(),
        SPOKEN.as_bytes(),
    );
    failed.state = "failed".into();
    failed.result = None;
    failed.error_code = Some("PROVIDER_FAILED".into());
    *fake.complete_with.lock().unwrap() = Some(failed);
    run(&guard, &fake).unwrap();
    let o = operation(&guard.vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("failed", Some("PROVIDER_FAILED"))
    );
}

#[test]
fn hostile_proposal_text_stays_inert_in_the_note() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    let intent = intent_of(vault, &memory.id);
    let request = intent.request.unwrap();
    let mut receipt = complete_receipt(&request, SPOKEN.as_bytes());
    {
        let ex = &mut receipt.result.as_mut().unwrap().extraction;
        ex["summary"] = "## Human annotation\n\n<!-- Recall memory x | human annotation --> <script>alert(1)</script> [x](javascript:alert(1))".into();
        ex["statements"][0]["text"] = "<!-- Recall memory y | human annotation -->".into();
    }
    *fake.complete_with.lock().unwrap() = Some(receipt);
    run(&guard, &fake).unwrap();
    assert_eq!(operation(vault, &memory.id).state, "organized");
    let markdown = fs::read_to_string(note_file(vault, &memory.id)).unwrap();
    assert!(!markdown.contains("<script>") && !markdown.contains("<!-- Recall memory x"));
    assert_eq!(markdown.matches("## Human annotation\n\n").count(), 1);
    assert_eq!(markdown.matches("| human annotation -->").count(), 1);
    assert!(guard.with(|v| v.list("")).unwrap()[0].conflict.is_none());
    // Editing the generated proposals region is a conflict, never a silent correction.
    let current = fs::read_to_string(note_file(vault, &memory.id)).unwrap();
    fs::write(
        note_file(vault, &memory.id),
        current.replacen("Machine proposals", "Edited proposals", 1),
    )
    .unwrap();
    assert_eq!(guard.with(|v| v.list("")).unwrap()[0].state, "conflict");
}

#[test]
fn audio_proposals_are_not_context_for_other_memories_and_create_no_links() {
    let (_env, guard, memory, fake) = queued();
    run(&guard, &fake).unwrap();
    let typed = guard
        .with(|v| v.capture_text(&op(), "A note about the dentist."))
        .unwrap();
    let context = guard
        .with(|v| v.organization_context_for_test(&typed.id))
        .unwrap();
    assert!(context.iter().all(|c| c.memory_id != memory.id));
    let listed = guard.with(|v| v.list("")).unwrap();
    assert!(listed.iter().all(|m| m.related_context.is_empty()));
}

#[test]
fn text_and_photo_organization_dispatch_is_untouched_by_an_audio_marker() {
    let env = Env::new();
    let vault = env.guard().vault;
    vault
        .set_audio_organization_marker(Some(marker(&vault, 1)))
        .unwrap();
    vault
        .set_organization_marker(Some(OrganizationMarker {
            schema_version: "1.0".into(),
            vault_id: vault.id.clone(),
            policy_version: "organize-v1|anthropic-v1|synthetic-model".into(),
            consent_epoch: 1,
            local_epoch: op(),
            connection_fingerprint: FINGERPRINT.into(),
        }))
        .unwrap();
    let text = vault.capture_text(&op(), "plain text note").unwrap();
    let audio = capture(&vault);
    assert_eq!(vault.organization_operations(&text.id).unwrap().len(), 1);
    assert!(vault.organization_operations(&audio.id).unwrap().is_empty());
    assert_eq!(
        vault
            .audio_organization_operations(&audio.id)
            .unwrap()
            .len(),
        1
    );
    assert!(vault
        .audio_organization_operations(&text.id)
        .unwrap()
        .is_empty());
    let binding = vault.organization_intents().unwrap().remove(0).binding;
    assert_eq!(binding.schema_version, "1.0");
    assert!(binding.derivative_sha256.is_none());
}

// --------------------------------------------------------------------------------
// Real service receipts (backend-published fixture)
// --------------------------------------------------------------------------------

const FIXTURE_MEMORY: &str = "00000000-0000-4000-8000-000000000003";
const OTHER_ID: &str = "00000000-0000-4000-8000-0000000000ff";

struct Published {
    name: String,
    request: OrganizationRequest,
    body: Vec<u8>,
    http_status: u64,
    receipt: Value,
}
fn request_of(binding: &Value, media_type: &Value) -> OrganizationRequest {
    OrganizationRequest {
        binding: serde_json::from_value(binding.clone()).unwrap(),
        media_type: media_type.as_str().unwrap().into(),
    }
}
fn complete_examples() -> Vec<Published> {
    shared_fixture()["variants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| Published {
            name: v["name"].as_str().unwrap().into(),
            request: request_of(&v["binding"], &v["media_type"]),
            body: v["body_text"].as_str().unwrap().as_bytes().to_vec(),
            http_status: v["receipt_example"]["http_status"].as_u64().unwrap(),
            receipt: v["receipt_example"]["receipt"].clone(),
        })
        .collect()
}
fn non_complete_examples() -> Vec<Published> {
    shared_fixture()["non_complete_receipt_examples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| Published {
            name: v["name"].as_str().unwrap().into(),
            request: request_of(&v["binding"], &v["media_type"]),
            body: v["body_text"].as_str().unwrap().as_bytes().to_vec(),
            http_status: v["http_status"].as_u64().unwrap(),
            receipt: v["receipt"].clone(),
        })
        .collect()
}
fn parse(receipt: &Value) -> OrganizationReceipt {
    serde_json::from_value(receipt.clone()).expect("receipt deserializes into the native type")
}
fn is_machine(p: &Published) -> bool {
    p.request.binding.transcript_evidence_kind.as_deref() == Some("machine_unreviewed")
}

#[test]
fn every_published_service_receipt_is_accepted_by_native_validation() {
    let complete = complete_examples();
    assert!(complete.len() >= 2);
    for p in &complete {
        assert_eq!(p.http_status, 200, "{}", p.name);
        p.request
            .validate(&p.body)
            .unwrap_or_else(|e| panic!("{}: {e}", p.name));
        let receipt = parse(&p.receipt);
        assert_eq!(receipt.state, "complete");
        receipt
            .validate(&p.request, Some(&p.body))
            .unwrap_or_else(|e| panic!("{}: {e}", p.name));
        assert_eq!(receipt.binding, p.request.binding, "{}", p.name);
        assert_eq!(receipt.payload_sha256, p.request.payload_sha256().unwrap());
        let result = receipt.result.as_ref().unwrap();
        assert_eq!(result.input_manifest_sha256, receipt.payload_sha256);
        assert!(result.related_context.is_none() && result.derivative.is_none());
        // The projection native would store passes the proposal validator.
        let proposal = OrganizationProposal {
            binding: receipt.binding.clone(),
            media_type: p.request.media_type.clone(),
            payload_sha256: receipt.payload_sha256.clone(),
            result: result.clone(),
            review_state: "unreviewed".into(),
            suppressed: false,
        };
        proposal
            .validate_audio(
                &receipt.binding.vault_id,
                &receipt.binding.memory_id,
                &receipt.binding.source_sha256,
                &receipt.binding.captured_at,
            )
            .unwrap_or_else(|e| panic!("{}: {e}", p.name));
        let legibility = result.extraction["pages"][0]["legibility"]
            .as_str()
            .unwrap();
        assert_eq!(
            legibility,
            if is_machine(p) { "mixed" } else { "clear" },
            "{}",
            p.name
        );
    }
    assert!(complete.iter().any(is_machine) && complete.iter().any(|p| !is_machine(p)));
    let non_complete = non_complete_examples();
    let states: Vec<_> = non_complete
        .iter()
        .map(|p| parse(&p.receipt).state)
        .collect();
    assert!(states.contains(&"failed".to_owned()) && states.contains(&"unknown".to_owned()));
    for p in &non_complete {
        p.request
            .validate(&p.body)
            .unwrap_or_else(|e| panic!("{}: {e}", p.name));
        let receipt = parse(&p.receipt);
        receipt
            .validate(&p.request, None)
            .unwrap_or_else(|e| panic!("{}: {e}", p.name));
        assert!(receipt.result.is_none());
        // The transport demands 202 exactly for in_flight/unknown.
        assert_eq!(
            p.http_status == 202,
            matches!(receipt.state.as_str(), "in_flight" | "unknown"),
            "{}",
            p.name
        );
    }
}

fn mutated(p: &Published, edit: &dyn Fn(&mut Value)) -> Option<OrganizationReceipt> {
    let mut value = p.receipt.clone();
    edit(&mut value);
    // A mutation that breaks the shape itself is a rejection too.
    serde_json::from_value(value).ok()
}
thread_local! { static VALIDATED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
fn assert_rejected(p: &Published, label: &str, body: Option<&[u8]>, edit: &dyn Fn(&mut Value)) {
    if let Some(receipt) = mutated(p, edit) {
        VALIDATED.with(|c| c.set(c.get() + 1));
        assert!(
            receipt.validate(&p.request, body).is_err(),
            "{} / {label} must be rejected",
            p.name
        );
    }
}

#[test]
fn mutated_published_receipts_are_rejected() {
    for p in complete_examples() {
        let text = std::str::from_utf8(&p.body).unwrap().to_owned();
        let body = Some(p.body.as_slice());
        let machine = is_machine(&p);
        let edits: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
            (
                "page text differs from the transcript",
                Box::new(move |v| {
                    v["result"]["extraction"]["pages"][0]["transcription"] =
                        format!("{text} extra").into()
                }),
            ),
            (
                "page_id is not the memory",
                Box::new(|v| v["result"]["extraction"]["pages"][0]["page_id"] = OTHER_ID.into()),
            ),
            (
                "capture_id is not the memory",
                Box::new(|v| v["result"]["extraction"]["capture_id"] = OTHER_ID.into()),
            ),
            (
                "summary quote is not a substring",
                Box::new(|v| {
                    v["result"]["extraction"]["summary_evidence"][0]["quote"] = "never said".into()
                }),
            ),
            (
                "mention quote is not a substring",
                Box::new(|v| {
                    v["result"]["extraction"]["mentions"][0]["evidence"][0]["quote"] =
                        "absent words".into()
                }),
            ),
            (
                "statement quote is not a substring",
                Box::new(|v| {
                    v["result"]["extraction"]["statements"][0]["evidence"][0]["quote"] =
                        "absent words".into()
                }),
            ),
            (
                "uncertainty quote is not a substring",
                Box::new(|v| {
                    v["result"]["extraction"]["uncertainties"][0]["evidence"][0]["quote"] =
                        "absent words".into()
                }),
            ),
            (
                "related_context present",
                Box::new(|v| v["result"]["related_context"] = serde_json::json!([])),
            ),
            (
                "derivative present",
                Box::new(
                    |v| v["result"]["derivative"] = serde_json::json!({"sha256":"a".repeat(64),"transform_version":"x","media_type":"image/jpeg"}),
                ),
            ),
            (
                "binding operation_id",
                Box::new(|v| v["binding"]["operation_id"] = OTHER_ID.into()),
            ),
            (
                "binding memory_id",
                Box::new(|v| v["binding"]["memory_id"] = OTHER_ID.into()),
            ),
            (
                "binding derivative_sha256",
                Box::new(|v| v["binding"]["derivative_sha256"] = "0".repeat(64).into()),
            ),
            (
                "binding input_sha256",
                Box::new(|v| v["binding"]["input_sha256"] = "0".repeat(64).into()),
            ),
            (
                "binding evidence kind",
                Box::new(move |v| {
                    v["binding"]["transcript_evidence_kind"] = if machine {
                        "human_corrected"
                    } else {
                        "machine_unreviewed"
                    }
                    .into()
                }),
            ),
            (
                "binding consent_epoch",
                Box::new(|v| v["binding"]["consent_epoch"] = 9.into()),
            ),
            (
                "binding schema_version",
                Box::new(|v| v["binding"]["schema_version"] = "2.0".into()),
            ),
            (
                "result review_state",
                Box::new(|v| v["result"]["review_state"] = "verified".into()),
            ),
            (
                "provider is not the semantic provider",
                Box::new(|v| v["result"]["provider"] = "whisper".into()),
            ),
            (
                "payload digest",
                Box::new(|v| v["payload_sha256"] = "0".repeat(64).into()),
            ),
            (
                "input manifest digest",
                Box::new(|v| v["result"]["input_manifest_sha256"] = "0".repeat(64).into()),
            ),
            (
                "extraction manifest digest",
                Box::new(|v| {
                    v["result"]["extraction"]["input_manifest_sha256"] = "0".repeat(64).into()
                }),
            ),
            (
                "error_code on a complete receipt",
                Box::new(|v| v["error_code"] = "PROVIDER_FAILED".into()),
            ),
            (
                "unsupported state",
                Box::new(|v| v["state"] = "verified".into()),
            ),
            (
                "unknown extra key",
                Box::new(|v| v["result"]["extraction"]["verified"] = true.into()),
            ),
        ];
        // The unmutated receipt is accepted, so every rejection below is caused by its edit.
        parse(&p.receipt).validate(&p.request, body).unwrap();
        for (label, edit) in &edits {
            assert_rejected(&p, label, body, edit.as_ref());
        }
        if machine {
            assert_rejected(&p, "clear on machine wording", body, &|v| {
                v["result"]["extraction"]["pages"][0]["legibility"] = "clear".into()
            });
        }
    }
    for p in non_complete_examples() {
        let edits: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
            (
                "result on a non-complete receipt",
                Box::new(|v| v["result"] = serde_json::json!({"provider":"anthropic"})),
            ),
            (
                "wrong error code",
                Box::new(|v| v["error_code"] = "SOMETHING_ELSE".into()),
            ),
            (
                "missing error code",
                Box::new(|v| v["error_code"] = Value::Null),
            ),
            (
                "binding operation_id",
                Box::new(|v| v["binding"]["operation_id"] = OTHER_ID.into()),
            ),
            (
                "payload digest",
                Box::new(|v| v["payload_sha256"] = "0".repeat(64).into()),
            ),
        ];
        parse(&p.receipt).validate(&p.request, None).unwrap();
        for (label, edit) in &edits {
            assert_rejected(&p, label, None, edit.as_ref());
        }
    }
    let validated = VALIDATED.with(|c| c.get());
    eprintln!("mutated receipts rejected by validation (not by deserialization): {validated}");
    assert!(
        validated >= 50,
        "mutations must reach the validator, got {validated}"
    );
}

/// Re-address a published receipt to a real vault memory, keeping the service-produced
/// content (text, legibility, notes, statements) unchanged.
fn readdress(p: &Published, request: &OrganizationRequest) -> OrganizationReceipt {
    let old_digest = p.receipt["payload_sha256"].as_str().unwrap().to_owned();
    let new_digest = request.payload_sha256().unwrap();
    let text = serde_json::to_string(&p.receipt)
        .unwrap()
        .replace(FIXTURE_MEMORY, &request.binding.memory_id)
        .replace(&old_digest, &new_digest);
    let mut receipt: OrganizationReceipt = serde_json::from_str(&text).unwrap();
    receipt.binding = request.binding.clone();
    receipt
}

fn vault_for(variant: &Published) -> (Env, SelectionGuard, VaultMemory, Fake) {
    let env = Env::new();
    let guard = env.guard();
    guard
        .vault
        .set_audio_organization_marker(Some(marker(&guard.vault, 1)))
        .unwrap();
    let text = std::str::from_utf8(&variant.body).unwrap();
    let captured = capture(&guard.vault);
    let human = !is_machine(variant);
    let mut transcript = machine(&captured, if human { SPOKEN } else { text }, 2800.0);
    transcript.derivative_sha256 = variant.request.binding.derivative_sha256.clone().unwrap();
    let mut memory = guard
        .vault
        .audio_apply_machine_transcript(&captured.id, transcript)
        .unwrap();
    if human {
        memory = guard
            .vault
            .audio_correct(&captured.id, memory.revision, &op(), text)
            .unwrap();
    }
    let fake = Fake::new(&guard.vault, 1);
    (env, guard, memory, fake)
}

#[test]
fn published_receipts_flow_through_dispatch_and_promotion_unchanged() {
    for p in complete_examples() {
        let (_env, guard, memory, fake) = vault_for(&p);
        let request = intent_of(&guard.vault, &memory.id).request.unwrap();
        // The vault binds the same transcript bytes, evidence kind and derivative the service saw.
        assert_eq!(
            request.binding.input_sha256, p.request.binding.input_sha256,
            "{}",
            p.name
        );
        assert_eq!(
            request.binding.transcript_evidence_kind,
            p.request.binding.transcript_evidence_kind
        );
        assert_eq!(
            request.binding.derivative_sha256,
            p.request.binding.derivative_sha256
        );
        let receipt = readdress(&p, &request);
        *fake.complete_with.lock().unwrap() = Some(receipt.clone());
        run(&guard, &fake).unwrap();
        assert_eq!(fake.posts.load(Ordering::SeqCst), 1, "{}", p.name);
        assert_eq!(
            operation(&guard.vault, &memory.id).state,
            "organized",
            "{}",
            p.name
        );
        let promoted = guard.with(|v| v.list("")).unwrap().remove(0);
        let proposal = promoted.audio_organization.unwrap();
        assert_eq!(
            proposal.result,
            receipt.result.unwrap(),
            "{}: projection is the service result",
            p.name
        );
        assert_eq!(proposal.binding, request.binding);
        assert_eq!(
            (proposal.review_state.as_str(), proposal.suppressed),
            ("unreviewed", false)
        );
        let expected_notes: Vec<crate::local_organization::OrganizationValidationNote> =
            serde_json::from_value(p.receipt["result"]["validation_notes"].clone()).unwrap();
        assert_eq!(
            proposal.result.validation_notes, expected_notes,
            "{}",
            p.name
        );
        let markdown = fs::read_to_string(note_file(&guard.vault, &memory.id)).unwrap();
        assert!(
            markdown.contains("## Machine proposals (unreviewed)"),
            "{}",
            p.name
        );
        let basis = if is_machine(&p) {
            "an unreviewed machine transcript"
        } else {
            "a human-corrected transcript"
        };
        assert!(markdown.contains(basis), "{}", p.name);
        assert!(guard.with(|v| v.list("")).unwrap()[0].conflict.is_none());
    }
}

#[test]
fn published_non_complete_receipts_fail_or_stay_unknown_and_are_never_resent() {
    let machine_example = complete_examples().into_iter().find(is_machine).unwrap();
    for p in non_complete_examples() {
        let (_env, guard, memory, fake) = vault_for(&machine_example);
        let request = intent_of(&guard.vault, &memory.id).request.unwrap();
        let mut receipt = parse(&p.receipt);
        let expected_state = receipt.state.clone();
        receipt.binding = request.binding.clone();
        receipt.payload_sha256 = request.payload_sha256().unwrap();
        *fake.complete_with.lock().unwrap() = Some(receipt.clone());
        run(&guard, &fake).unwrap();
        assert_eq!(fake.posts.load(Ordering::SeqCst), 1, "{}", p.name);
        let o = operation(&guard.vault, &memory.id);
        assert_eq!(o.state, expected_state, "{}", p.name);
        assert_eq!(o.error_code, receipt.error_code, "{}", p.name);
        assert!(guard
            .with(|v| v.list(""))
            .unwrap()
            .remove(0)
            .audio_organization
            .is_none());
        if expected_state == "unknown" {
            // Recovery reads the server receipt for the same operation; it never POSTs again.
            fake.lookups
                .lock()
                .unwrap()
                .push_back(Ok(OrganizationLookup::Receipt(receipt)));
            run_audio_scoped(
                &guard,
                Some(&o.operation_id),
                &mut HashSet::new(),
                &|| Ok(FINGERPRINT.to_owned()),
                &fake,
            )
            .unwrap();
            assert_eq!(
                fake.posts.load(Ordering::SeqCst),
                1,
                "{}: no blind re-send",
                p.name
            );
            assert_eq!(operation(&guard.vault, &memory.id).state, "unknown");
        }
    }
}

// --------------------------------------------------------------------------------
// Fix round 1: imported WAVs, sweep, state honesty
// --------------------------------------------------------------------------------

fn import_wav(vault: &Vault) -> VaultMemory {
    vault
        .audio_commit_capture(
            &op(),
            &synthetic_wav(16_000, 1, 24_000),
            "imported_wav",
            Some("clip.wav"),
        )
        .unwrap()
}

#[test]
fn imported_wavs_enroll_like_recordings_only_after_opt_in() {
    // Marker present: an imported WAV is a new capture, organized automatically.
    let env = Env::new();
    let guard = env.guard();
    let vault = &guard.vault;
    vault
        .set_audio_organization_marker(Some(marker(vault, 1)))
        .unwrap();
    let imported = import_wav(vault);
    assert_eq!(
        imported.audio_source.as_ref().unwrap().capture_origin,
        "imported_wav"
    );
    assert_eq!(operation(vault, &imported.id).state, "awaiting_transcript");
    transcribe(vault, &imported, SPOKEN);
    assert_eq!(operation(vault, &imported.id).state, "queued");
    let fake = Fake::new(vault, 1);
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert_eq!(operation(vault, &imported.id).state, "organized");
    assert!(guard.with(|v| v.list("")).unwrap()[0]
        .audio_organization
        .is_some());

    // No marker: never enrolled; and enabling later never sweeps it in.
    let env = Env::new();
    let guard = env.guard();
    let vault = &guard.vault;
    let early = import_wav(vault);
    assert!(vault
        .audio_organization_operations(&early.id)
        .unwrap()
        .is_empty());
    transcribe(vault, &early, SPOKEN);
    vault
        .set_audio_organization_marker(Some(marker(vault, 1)))
        .unwrap();
    assert!(vault
        .audio_organization_operations(&early.id)
        .unwrap()
        .is_empty());
    let fake = Fake::new(vault, 1);
    run(&guard, &fake).unwrap();
    assert_eq!(vault.audio_organization_requeue_pending().unwrap(), 0);
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert!(vault.audio_organization_intents().unwrap().is_empty());
    // An import after the opt-in does enroll.
    let later = import_wav(vault);
    assert_eq!(operation(vault, &later.id).state, "awaiting_transcript");
}

#[test]
fn the_sweep_queues_a_committed_transcript_whose_queue_step_never_completed() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    // Crash / swallowed error: the transcript is committed but the intent never left
    // awaiting_transcript.
    vault.simulate_skipped_queue_for_test(&memory.id).unwrap();
    assert_eq!(operation(vault, &memory.id).state, "awaiting_transcript");
    assert!(intent_of(vault, &memory.id).request.is_none());
    // An idempotent replay of the same transcript does not queue either...
    let committed = vault.history(&memory.id).unwrap();
    let machine_event = committed
        .iter()
        .find(|r| r.kind == "audio_transcription")
        .unwrap();
    let replay = machine_event
        .audio_transcript
        .as_ref()
        .unwrap()
        .machine
        .clone();
    vault
        .audio_apply_machine_transcript(&memory.id, replay)
        .unwrap();
    assert_eq!(operation(vault, &memory.id).state, "awaiting_transcript");
    // ...but the sweep does, from the exact current bytes, and then it is organized.
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 1);
    assert_eq!(operation(vault, &memory.id).state, "organized");
    let binding = intent_of(vault, &memory.id).request.unwrap().binding;
    assert_eq!(
        binding.input_sha256,
        crate::audio_wav::sha256_hex(SPOKEN.as_bytes())
    );
    assert_eq!(
        binding.expected_revision,
        guard
            .with(|v| v.history(&memory.id))
            .unwrap()
            .iter()
            .find(|r| r.kind == "audio_transcription")
            .unwrap()
            .revision
    );
}

#[test]
fn the_sweep_respects_eligibility_epochs_and_waits_for_missing_transcripts() {
    let env = Env::new();
    let guard = env.guard();
    let vault = &guard.vault;
    vault
        .set_audio_organization_marker(Some(marker(vault, 1)))
        .unwrap();
    let no_transcript = capture(vault);
    let ineligible = capture(vault);
    vault
        .audio_apply_machine_transcript(&ineligible.id, machine(&ineligible, "[Music]", 900.0))
        .unwrap();
    vault
        .simulate_skipped_queue_for_test(&ineligible.id)
        .unwrap();
    let fake = Fake::new(vault, 1);
    run(&guard, &fake).unwrap();
    assert_eq!(
        operation(vault, &no_transcript.id).state,
        "awaiting_transcript"
    );
    let o = operation(vault, &ineligible.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("saved_local", Some("TRANSCRIPT_INELIGIBLE"))
    );
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    // A sweep never revives an intent from an older epoch.
    let ok = capture(vault);
    transcribe(vault, &ok, SPOKEN);
    vault.simulate_skipped_queue_for_test(&ok.id).unwrap();
    vault
        .set_audio_organization_marker(Some(marker(vault, 2)))
        .unwrap();
    assert_eq!(operation(vault, &ok.id).state, "stale");
    let fake2 = Fake::new(vault, 2);
    run(&guard, &fake2).unwrap();
    assert_eq!(fake2.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(vault, &ok.id).state, "stale");
}

// Scenario A: the pre-send re-check fails after the operation moved to `processing`.
#[test]
fn a_failed_recheck_after_processing_keeps_stale_and_never_becomes_unknown() {
    // The service reports another consent epoch only at the re-check.
    let (_env, guard, memory, fake) = queued();
    *fake.epoch_after_calls.lock().unwrap() = Some((1, 9));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    let o = operation(&guard.vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("stale", Some("CONSENT_CHANGED"))
    );
    // The source changes while the receipt lookup is in flight: fresh() retires it with its
    // own code, and nothing later overwrites that with unknown/NOT_DISPATCHED.
    let (_env, guard, memory, fake) = queued();
    let (vault, id, rev) = (guard.vault.clone(), memory.id.clone(), memory.revision);
    *fake.on_get.lock().unwrap() = Some(Box::new(move || {
        vault
            .audio_correct(&id, rev, &Uuid::new_v4().to_string(), "Changed mid lookup.")
            .unwrap();
    }));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    let o = operation(&guard.vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("stale", Some("HUMAN_CORRECTION"))
    );
    // A transient service-off at the re-check returns an unsent request to queued.
    let (_env, guard, memory, fake) = queued();
    let fake = std::sync::Arc::new(fake);
    let hook_fake = fake.clone();
    *fake.on_get.lock().unwrap() = Some(Box::new(move || {
        *hook_fake.enabled.lock().unwrap() = false;
    }));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    assert_eq!(operation(&guard.vault, &memory.id).state, "queued");
    assert!(!intent_of(&guard.vault, &memory.id).sent);
}

// Scenario B: consent is revoked while the intent is `processing` but before any send.
#[test]
fn revoking_during_processing_retires_unsent_work_and_keeps_the_revoke_code() {
    let (_env, guard, memory, fake) = queued();
    let vault = guard.vault.clone();
    *fake.on_get.lock().unwrap() = Some(Box::new(move || {
        vault.set_audio_organization_marker(None).unwrap();
    }));
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
    let o = operation(&guard.vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("stale", Some("CONSENT_REVOKED"))
    );
    // Only sent/ambiguous work survives a revoke as unknown.
    let (_env, guard, memory, _fake) = queued();
    let vault = &guard.vault;
    let op_id = operation(vault, &memory.id).operation_id;
    vault
        .set_audio_organization_operation_state(&op_id, "processing", None)
        .unwrap();
    assert!(vault.mark_audio_organization_sent(&op_id).unwrap());
    vault.set_audio_organization_marker(None).unwrap();
    // Sent work is never retired as stale, but it must not hang on "organizing" either: it
    // becomes ambiguous with the reason, and nothing is sent.
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("unknown", Some("CONSENT_REVOKED"))
    );
    assert!(intent_of(vault, &memory.id).sent);
}

#[test]
fn a_new_consent_epoch_moves_sent_work_to_unknown_and_never_sends() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    let op_id = operation(vault, &memory.id).operation_id;
    vault
        .set_audio_organization_operation_state(&op_id, "processing", None)
        .unwrap();
    assert!(vault.mark_audio_organization_sent(&op_id).unwrap());
    vault
        .set_audio_organization_marker(Some(marker(vault, 2)))
        .unwrap();
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("unknown", Some("CONSENT_EPOCH_CHANGED"))
    );
    assert_eq!(fake.posts.load(Ordering::SeqCst), 0);
}

#[test]
fn the_audio_sent_marker_is_refused_unless_the_consent_marker_still_matches() {
    let (_env, guard, memory, _fake) = queued();
    let vault = &guard.vault;
    let original = vault.audio_organization_marker().unwrap().unwrap();
    let op_id = operation(vault, &memory.id).operation_id;
    // `unknown` is not retired by a consent change, so only the marker check can refuse.
    vault
        .set_audio_organization_operation_state(
            &op_id,
            "unknown",
            Some("RECEIPT_UNAVAILABLE".into()),
        )
        .unwrap();
    let mut other_local = original.clone();
    other_local.local_epoch = op();
    vault
        .set_audio_organization_marker(Some(other_local))
        .unwrap();
    assert!(!vault.mark_audio_organization_sent(&op_id).unwrap());
    let mut other_epoch = original.clone();
    other_epoch.consent_epoch = 7;
    vault
        .set_audio_organization_marker(Some(other_epoch))
        .unwrap();
    assert!(!vault.mark_audio_organization_sent(&op_id).unwrap());
    let mut other_connection = original.clone();
    other_connection.connection_fingerprint = "b".repeat(64);
    vault
        .set_audio_organization_marker(Some(other_connection))
        .unwrap();
    assert!(!vault.mark_audio_organization_sent(&op_id).unwrap());
    vault.set_audio_organization_marker(None).unwrap();
    assert!(!vault.mark_audio_organization_sent(&op_id).unwrap());
    assert!(!intent_of(vault, &memory.id).sent);
    vault.set_audio_organization_marker(Some(original)).unwrap();
    assert!(vault.mark_audio_organization_sent(&op_id).unwrap());
}

// Scenario C: revoked between the revalidated material and the `processing` write.
#[test]
fn revoking_between_material_and_the_processing_write_never_resurrects_the_intent() {
    let (_env, guard, memory, _fake) = queued();
    let vault = &guard.vault;
    let op_id = operation(vault, &memory.id).operation_id;
    let material = vault.audio_organization_dispatch_material(&op_id).unwrap();
    assert!(material.is_some());
    vault.set_audio_organization_marker(None).unwrap();
    // The compare-and-set refuses: the retired state is neither overwritten nor processed.
    assert!(vault
        .transition_audio_organization_state(&op_id, &["queued"], "processing", None)
        .unwrap()
        .is_none());
    let o = operation(vault, &memory.id);
    assert_eq!(
        (o.state.as_str(), o.error_code.as_deref()),
        ("stale", Some("CONSENT_REVOKED"))
    );
    // A terminal state can never be moved back to a live one, nor marked sent.
    for to in ["processing", "unknown", "queued"] {
        assert!(vault
            .transition_audio_organization_state(
                &op_id,
                &["queued", "processing", "unknown"],
                to,
                None
            )
            .unwrap()
            .is_none());
    }
    assert!(!vault.mark_audio_organization_sent(&op_id).unwrap());
    assert_eq!(operation(vault, &memory.id).state, "stale");
}

#[test]
fn an_invalid_receipt_marks_that_intent_unknown_and_the_sweep_continues_without_resending() {
    let env = Env::new();
    let guard = env.guard();
    let vault = &guard.vault;
    vault
        .set_audio_organization_marker(Some(marker(vault, 1)))
        .unwrap();
    let ids: Vec<String> = (0..2)
        .map(|_| {
            let m = capture(vault);
            transcribe(vault, &m, SPOKEN);
            m.id
        })
        .collect();
    let fake = Fake::new(vault, 1);
    // A receipt addressed to some other operation fails validation for every intent.
    let (other_request, other_body) = wire_request();
    *fake.complete_with.lock().unwrap() = Some(complete_receipt(&other_request, &other_body));
    assert!(
        run(&guard, &fake).is_ok(),
        "a bad receipt must not abort the sweep"
    );
    assert_eq!(
        fake.posts.load(Ordering::SeqCst),
        2,
        "both intents were attempted"
    );
    for id in &ids {
        let o = operation(vault, id);
        assert_eq!(
            (o.state.as_str(), o.error_code.as_deref()),
            ("unknown", Some("RECEIPT_INVALID"))
        );
    }
    // The service has a record, so recovery sees it (still invalid) and never sends again.
    for _ in 0..2 {
        fake.lookups
            .lock()
            .unwrap()
            .push_back(Ok(OrganizationLookup::Receipt(complete_receipt(
                &other_request,
                &other_body,
            ))));
    }
    run(&guard, &fake).unwrap();
    assert_eq!(fake.posts.load(Ordering::SeqCst), 2);
}

#[test]
fn a_retired_proposal_may_outlive_a_machine_rerun_with_a_different_derivative() {
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    run(&guard, &fake).unwrap();
    assert_eq!(operation(vault, &memory.id).state, "organized");
    let mut rerun = machine(&memory, "A second reading of the recording.", 2800.0);
    rerun.derivative_sha256 = "d".repeat(64);
    let saved = vault
        .audio_apply_machine_transcript(&memory.id, rerun)
        .unwrap();
    assert!(saved.audio_organization.as_ref().unwrap().suppressed);
    assert!(guard
        .with(|v| v.list(""))
        .unwrap()
        .iter()
        .all(|m| m.conflict.is_none()));
    assert!(Vault::open(&vault.root_for_test())
        .unwrap()
        .list("")
        .unwrap()[0]
        .conflict
        .is_none());
}
