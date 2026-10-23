//! ORGSTATE-01: compare-and-set transitions, the durable "sent" marker and typed dispatch
//! outcomes for the text/photo organization path. Real vaults, a fake transport (no
//! network), and TEXT, PHOTO and a v2 context-bearing intent in every scenario.
use super::*;
use crate::local_vault::LocalVaultState;
use serde_json::json;
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

const FP: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn op() -> String {
    Uuid::new_v4().to_string()
}
#[derive(Clone, Copy, Debug)]
enum Kind {
    Text,
    Photo,
    TextV2,
}
const KINDS: [Kind; 3] = [Kind::Text, Kind::Photo, Kind::TextV2];

struct Env {
    dir: PathBuf,
    state: LocalVaultState,
    token: String,
}
impl Env {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("recall-synthetic-orgstate-{}", op()));
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
fn marker(vault: &Vault, kind: Kind, local_epoch: &str) -> OrganizationMarker {
    OrganizationMarker {
        schema_version: "1.0".into(),
        vault_id: vault.id.clone(),
        policy_version: match kind {
            Kind::TextV2 => "organize-v2|anthropic-v1|synthetic-model",
            _ => "organize-v1|anthropic-v1|synthetic-model",
        }
        .into(),
        consent_epoch: 3,
        local_epoch: local_epoch.into(),
        connection_fingerprint: FP.into(),
    }
}

type Hook = Box<dyn Fn() + Send + Sync>;
struct Fake {
    vault_id: String,
    policy: String,
    epoch: Mutex<u64>,
    enabled: Mutex<bool>,
    lookups: Mutex<VecDeque<Result<OrganizationLookup>>>,
    post_error: Mutex<bool>,
    posts: AtomicUsize,
    gets: AtomicUsize,
    on_get: Mutex<Option<Hook>>,
    on_post: Mutex<Option<Hook>>,
    complete_with: Mutex<Option<OrganizationReceipt>>,
    /// When set, `post` asserts the on-disk intent already carries `"sent":true`.
    vault: Mutex<Option<Vault>>,
    capability_calls: AtomicUsize,
    capability_fails_from: Mutex<Option<usize>>,
}
impl OrganizationDispatchTransport for Fake {
    fn capability(&self) -> Result<OrganizationCapability> {
        let calls = self.capability_calls.fetch_add(1, Ordering::SeqCst) + 1;
        if self
            .capability_fails_from
            .lock()
            .unwrap()
            .is_some_and(|n| calls >= n)
        {
            return Err("Organization capability unavailable".into());
        }
        Ok(OrganizationCapability {
            schema_version: "1.0".into(),
            scope: "vault_intelligence".into(),
            purpose: "organize".into(),
            vault_id: self.vault_id.clone(),
            policy_version: self.policy.clone(),
            provider: Some("anthropic".into()),
            consent: "active".into(),
            enabled: *self.enabled.lock().unwrap(),
            consent_epoch: *self.epoch.lock().unwrap(),
            decided_at: Some("2026-10-23T12:00:00Z".into()),
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
        if let Some(vault) = self.vault.lock().unwrap().as_ref() {
            let path = vault.root_for_test().join(format!(
                "Recall/_meta/organize/{}.json",
                request.binding.operation_id
            ));
            assert!(
                fs::read_to_string(path).unwrap().contains("\"sent\":true"),
                "the durable sent marker must precede the POST"
            );
        }
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
            .unwrap_or_else(|| in_flight(request)))
    }
}
fn in_flight(request: &OrganizationRequest) -> OrganizationReceipt {
    OrganizationReceipt {
        schema_version: "1.0".into(),
        binding: request.binding.clone(),
        payload_sha256: request.payload_sha256().unwrap(),
        state: "in_flight".into(),
        result: None,
        error_code: None,
    }
}
fn text_receipt(request: &OrganizationRequest, body: &[u8]) -> OrganizationReceipt {
    let text = std::str::from_utf8(body).unwrap();
    let digest = request.payload_sha256().unwrap();
    let id = &request.binding.memory_id;
    let quote: String = text.chars().take(10).collect();
    let extraction = json!({
        "schema_version":"1.1","capture_id":id,"input_manifest_sha256":digest,
        "summary":"A synthetic memory.","summary_evidence":[{"page_id":id,"quote":quote}],
        "pages":[{"page_id":id,"ordinal":1,"transcription":text,"legibility":"clear"}],
        "mentions":[],"statements":[],"action_suggestions":[],"uncertainties":[]
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
            related_context: request.binding.context.as_ref().map(|_| Vec::new()),
            validation_notes: Vec::new(),
            review_state: "unreviewed".into(),
        }),
        error_code: None,
    }
}

struct Case {
    env: std::sync::Arc<Env>,
    guard: SelectionGuard,
    marker: OrganizationMarker,
    memory_id: String,
    operation: String,
    fake: std::sync::Arc<Fake>,
}
impl Case {
    fn vault(&self) -> &Vault {
        &self.guard.vault
    }
    fn intent(&self) -> OrganizationIntent {
        self.vault()
            .organization_intents()
            .unwrap()
            .into_iter()
            .find(|i| i.binding.memory_id == self.memory_id)
            .unwrap()
    }
    fn state(&self) -> (String, Option<String>) {
        let o = self
            .vault()
            .organization_operation(&self.operation)
            .unwrap();
        (o.state, o.error_code)
    }
    fn run(&self) {
        process_intent(
            &self.guard,
            self.vault(),
            &self.intent(),
            &self.marker,
            FP,
            &|| Ok(FP.to_owned()),
            &*self.fake,
        )
        .unwrap();
    }
    fn posts(&self) -> usize {
        self.fake.posts.load(Ordering::SeqCst)
    }
}
fn case(kind: Kind) -> Case {
    let env = Env::new();
    let guard = env.guard();
    let vault = &guard.vault;
    if matches!(kind, Kind::TextV2) {
        // Eligible prior memory so the v2 binding carries real bound context.
        vault
            .capture_text(&op(), "Project Lantern scope includes backup power.")
            .unwrap();
    }
    let marker = marker(vault, kind, &op());
    vault.set_organization_marker(Some(marker.clone())).unwrap();
    let memory = match kind {
        Kind::Photo => vault
            .capture(
                &op(),
                "synthetic.png",
                b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY",
                "photo note",
            )
            .unwrap(),
        _ => vault
            .capture_text(&op(), "Project Lantern meeting will evaluate backup power.")
            .unwrap(),
    };
    let mut operation = vault.organization_operations(&memory.id).unwrap().remove(0);
    if operation.state == "prepared" {
        // Capture swallows a transient publish error and leaves `prepared`; the first
        // dispatch check promotes it. (Seen occasionally on Windows under parallel tests.)
        vault
            .organization_dispatch_material(&operation.operation_id)
            .unwrap();
        operation = vault.organization_operations(&memory.id).unwrap().remove(0);
    }
    assert_eq!(operation.state, "queued");
    let fake = Fake {
        vault_id: vault.id.clone(),
        policy: marker.policy_version.clone(),
        epoch: Mutex::new(marker.consent_epoch),
        enabled: Mutex::new(true),
        lookups: Mutex::new(VecDeque::new()),
        post_error: Mutex::new(false),
        posts: AtomicUsize::new(0),
        gets: AtomicUsize::new(0),
        on_get: Mutex::new(None),
        on_post: Mutex::new(None),
        complete_with: Mutex::new(None),
        vault: Mutex::new(Some(vault.clone())),
        capability_calls: AtomicUsize::new(0),
        capability_fails_from: Mutex::new(None),
    };
    Case {
        env: std::sync::Arc::new(env),
        guard,
        marker,
        memory_id: memory.id,
        operation: operation.operation_id,
        fake: std::sync::Arc::new(fake),
    }
}

// --------------------------------------------------------------------------------
// Scenario A: the pre-send re-check fails after the operation moved to `processing`
// --------------------------------------------------------------------------------

#[test]
fn a_epoch_change_at_the_recheck_is_stale_and_never_unknown() {
    for kind in KINDS {
        let c = case(kind);
        *c.fake.epoch.lock().unwrap() = 99;
        c.run();
        assert_eq!(c.posts(), 0, "{kind:?}");
        assert_eq!(
            c.state(),
            ("stale".into(), Some("CONSENT_CHANGED".into())),
            "{kind:?}"
        );
        assert!(!c.intent().sent);
    }
}

#[test]
fn a_source_change_during_the_receipt_lookup_keeps_its_precise_stale_code() {
    for kind in KINDS {
        let c = case(kind);
        let (vault, memory) = (c.vault().clone(), c.memory_id.clone());
        *c.fake.on_get.lock().unwrap() = Some(Box::new(move || {
            let current = vault
                .list("")
                .unwrap()
                .into_iter()
                .find(|m| m.id == memory)
                .unwrap();
            vault
                .correct(
                    &memory,
                    current.revision,
                    &Uuid::new_v4().to_string(),
                    "changed mid lookup",
                )
                .unwrap();
        }));
        c.run();
        assert_eq!(c.posts(), 0, "{kind:?}");
        // The vault's own precise code survives; it is not rewritten to unknown/NOT_DISPATCHED.
        assert_eq!(
            c.state(),
            ("stale".into(), Some("SOURCE_OR_REVISION_CHANGED".into())),
            "{kind:?}"
        );
    }
}

#[test]
fn a_service_switched_off_at_the_recheck_returns_unsent_work_to_queued() {
    for kind in KINDS {
        let c = case(kind);
        let fake = c.fake.clone();
        let hook = fake.clone();
        *fake.on_get.lock().unwrap() = Some(Box::new(move || {
            *hook.enabled.lock().unwrap() = false;
        }));
        // Drive with the shared fake directly.
        process_intent(
            &c.guard,
            c.vault(),
            &c.intent(),
            &c.marker,
            FP,
            &|| Ok(FP.to_owned()),
            &*fake,
        )
        .unwrap();
        assert_eq!(fake.posts.load(Ordering::SeqCst), 0, "{kind:?}");
        assert_eq!(c.state(), ("queued".into(), None), "{kind:?}");
        assert!(!c.intent().sent);
        // The service comes back: the very same operation is sent.
        *fake.enabled.lock().unwrap() = true;
        *fake.on_get.lock().unwrap() = None;
        process_intent(
            &c.guard,
            c.vault(),
            &c.intent(),
            &c.marker,
            FP,
            &|| Ok(FP.to_owned()),
            &*fake,
        )
        .unwrap();
        assert_eq!(fake.posts.load(Ordering::SeqCst), 1, "{kind:?}");
    }
}

// --------------------------------------------------------------------------------
// Scenario B: revoke or epoch change while `processing`
// --------------------------------------------------------------------------------

#[test]
fn b_revoking_during_unsent_processing_retires_it_and_nothing_is_posted() {
    for kind in KINDS {
        let c = case(kind);
        let vault = c.vault().clone();
        *c.fake.on_get.lock().unwrap() = Some(Box::new(move || {
            vault.set_organization_marker(None).unwrap();
        }));
        c.run();
        assert_eq!(c.posts(), 0, "{kind:?}");
        assert_eq!(
            c.state(),
            ("stale".into(), Some("CONSENT_REVOKED".into())),
            "{kind:?}"
        );
    }
}

#[test]
fn b_a_revoke_retires_unsent_processing_but_leaves_sent_and_unknown_work_alone() {
    for kind in KINDS {
        let c = case(kind);
        let v = c.vault();
        v.set_organization_operation_state(&c.operation, "processing", None)
            .unwrap();
        assert!(!c.intent().sent);
        // A new local epoch retires the unsent request...
        let mut next = c.marker.clone();
        next.local_epoch = op();
        v.set_organization_marker(Some(next)).unwrap();
        assert_eq!(
            c.state(),
            ("stale".into(), Some("CONSENT_EPOCH_CHANGED".into())),
            "{kind:?}"
        );

        // ...but one that may have been sent is resolved only by its receipt.
        let c = case(kind);
        let v = c.vault();
        v.set_organization_operation_state(&c.operation, "processing", None)
            .unwrap();
        assert!(v.mark_organization_sent(&c.operation).unwrap());
        let mut next = c.marker.clone();
        next.local_epoch = op();
        v.set_organization_marker(Some(next)).unwrap();
        // Sent work is never retired as stale, and never hangs on "organizing": it becomes
        // ambiguous with the reason, and nothing is sent.
        assert_eq!(
            c.state(),
            ("unknown".into(), Some("CONSENT_EPOCH_CHANGED".into())),
            "{kind:?}"
        );
        assert!(c.intent().sent);
        assert_eq!(c.posts(), 0);
        let c = case(kind);
        let v = c.vault();
        v.set_organization_operation_state(&c.operation, "processing", None)
            .unwrap();
        assert!(v.mark_organization_sent(&c.operation).unwrap());
        v.set_organization_marker(None).unwrap();
        assert_eq!(
            c.state(),
            ("unknown".into(), Some("CONSENT_REVOKED".into())),
            "{kind:?}: nor stays processing after a revoke"
        );
        assert_eq!(c.posts(), 0);
        v.set_organization_operation_state(
            &c.operation,
            "unknown",
            Some("RECEIPT_UNAVAILABLE".into()),
        )
        .unwrap();
        v.set_organization_marker(Some(c.marker.clone())).unwrap();
        v.set_organization_marker(None).unwrap();
        assert_eq!(
            c.state().0,
            "unknown",
            "{kind:?}: ambiguous work stays ambiguous"
        );
    }
}

// --------------------------------------------------------------------------------
// Scenario C: revoke between the material fetch and the `processing` write
// --------------------------------------------------------------------------------

#[test]
fn c_revoke_between_material_and_the_processing_write_never_resurrects_the_intent() {
    for kind in KINDS {
        let c = case(kind);
        let v = c.vault();
        assert!(v
            .organization_dispatch_material(&c.operation)
            .unwrap()
            .is_some());
        v.set_organization_marker(None).unwrap();
        assert!(v
            .transition_organization_state(&c.operation, &["queued"], "processing", None)
            .unwrap()
            .is_none());
        assert_eq!(
            c.state(),
            ("stale".into(), Some("CONSENT_REVOKED".into())),
            "{kind:?}"
        );
        for to in ["processing", "queued", "unknown"] {
            assert!(v
                .transition_organization_state(
                    &c.operation,
                    &["queued", "processing", "unknown"],
                    to,
                    None
                )
                .unwrap()
                .is_none());
        }
        assert!(!v.mark_organization_sent(&c.operation).unwrap());
        assert_eq!(c.posts(), 0);
    }
}

// --------------------------------------------------------------------------------
// Sent, then failure: unknown, and never re-sent blindly
// --------------------------------------------------------------------------------

#[test]
fn a_post_failure_after_the_sent_marker_is_unknown_and_recovery_reads_the_receipt_first() {
    for kind in KINDS {
        let c = case(kind);
        *c.fake.post_error.lock().unwrap() = true;
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}");
        assert_eq!(
            c.state(),
            ("unknown".into(), Some("RECEIPT_UNAVAILABLE".into())),
            "{kind:?}"
        );
        // Receipt lookup unavailable: nothing is sent.
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Err("receipt unavailable".into()));
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}: no blind re-send");
        assert_eq!(c.state().0, "unknown");
        // The service has a record: recovery adopts it and never POSTs again.
        let request = OrganizationRequest {
            binding: c.intent().binding,
            media_type: c.intent().media_type,
        };
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Ok(OrganizationLookup::Receipt(in_flight(&request))));
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}: a found receipt is not re-sent");
        // Only an authenticated 404 may re-send, with the same operation.
        *c.fake.post_error.lock().unwrap() = false;
        c.run();
        assert_eq!(c.posts(), 2, "{kind:?}");
        assert_eq!(c.intent().binding.operation_id, c.operation);
    }
}

#[test]
fn a_lookup_failure_on_first_send_keeps_the_existing_unknown_code_without_sending() {
    for kind in KINDS {
        let c = case(kind);
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Err("receipt unavailable".into()));
        c.run();
        assert_eq!(c.posts(), 0);
        assert_eq!(
            c.state(),
            ("unknown".into(), Some("NOT_DISPATCHED".into())),
            "{kind:?}"
        );
        assert!(!c.intent().sent);
    }
}

// --------------------------------------------------------------------------------
// Terminal states and promotion
// --------------------------------------------------------------------------------

#[test]
fn terminal_states_are_never_overwritten() {
    for terminal in ["stale", "failed", "saved_local", "organized"] {
        let c = case(Kind::Text);
        let v = c.vault();
        v.set_organization_operation_state(&c.operation, terminal, Some("X".into()))
            .unwrap();
        for to in ["processing", "queued", "unknown", "stale", "failed"] {
            assert!(
                v.transition_organization_state(
                    &c.operation,
                    &["queued", "processing", "unknown"],
                    to,
                    Some("Y")
                )
                .unwrap()
                .is_none(),
                "{terminal} -> {to}"
            );
        }
        assert!(!v.mark_organization_sent(&c.operation).unwrap());
        v.revert_organization_unsent(&c.operation).unwrap();
        assert_eq!(c.state(), (terminal.into(), Some("X".into())));
        // A late dispatch attempt on a retired operation does nothing at all.
        c.run();
        assert_eq!(c.posts(), 0);
        assert_eq!(c.state(), (terminal.into(), Some("X".into())));
    }
}

#[test]
fn promotion_refuses_a_retired_operation_and_leaves_the_vault_untouched() {
    for retired in ["stale", "failed", "saved_local", "organized"] {
        let c = case(Kind::Text);
        let v = c.vault();
        let (_, request, body) = v
            .organization_dispatch_material(&c.operation)
            .unwrap()
            .unwrap();
        let receipt = text_receipt(&request, &body);
        v.set_organization_operation_state(&c.operation, retired, Some("RETIRED".into()))
            .unwrap();
        let before = v.history(&c.memory_id).unwrap().len();
        // The marker is still valid; only the operation's own state forbids promotion.
        let outcome = v.promote_organization(&request, &body, &receipt).unwrap();
        assert_eq!(outcome.state, retired);
        assert_eq!(v.history(&c.memory_id).unwrap().len(), before, "{retired}");
        assert!(c.guard.with(|g| g.list("")).unwrap()[0]
            .organization
            .is_none());
    }
    // A live operation still promotes.
    let c = case(Kind::Text);
    let v = c.vault();
    let (_, request, body) = v
        .organization_dispatch_material(&c.operation)
        .unwrap()
        .unwrap();
    let outcome = v
        .promote_organization(&request, &body, &text_receipt(&request, &body))
        .unwrap();
    assert_eq!(outcome.state, "organized");
}

#[test]
fn a_full_text_dispatch_still_promotes_end_to_end() {
    let c = case(Kind::Text);
    let intent = c.intent();
    let request = OrganizationRequest {
        binding: intent.binding,
        media_type: intent.media_type,
    };
    let body = b"Project Lantern meeting will evaluate backup power.".to_vec();
    *c.fake.complete_with.lock().unwrap() = Some(text_receipt(&request, &body));
    c.run();
    assert_eq!(c.posts(), 1);
    assert_eq!(c.state(), ("organized".into(), None));
    // Terminal intents drop the in-flight `sent` key again (`post` asserted it was set first).
    assert!(!c.intent().sent);
    assert!(c.guard.with(|g| g.list("")).unwrap()[0]
        .organization
        .is_some());
}

// --------------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------------

#[test]
fn unsent_intents_serialize_byte_identically_and_old_files_load() {
    let intent = OrganizationIntent {
        schema_version: "1.0".into(),
        binding: OrganizationBinding {
            schema_version: "1.0".into(),
            operation_id: "00000000-0000-4000-8000-000000000001".into(),
            vault_id: "00000000-0000-4000-8000-000000000002".into(),
            memory_id: "00000000-0000-4000-8000-000000000003".into(),
            source_kind: "text".into(),
            source_sha256: "a".repeat(64),
            expected_revision: 1,
            input_sha256: "a".repeat(64),
            derivative_sha256: None,
            transcript_revision: None,
            transcript_evidence_kind: None,
            consent_epoch: 2,
            captured_at: "2026-10-23T12:00:00Z".into(),
            context_coverage: None,
            context: None,
        },
        media_type: "text/plain; charset=utf-8".into(),
        human_text_sha256: "b".repeat(64),
        connection_fingerprint: "c".repeat(64),
        local_epoch: "00000000-0000-4000-8000-000000000004".into(),
        state: "queued".into(),
        error_code: None,
        sent: false,
    };
    // Golden bytes: exactly the pre-change serialization (field order, no `sent` key).
    let golden = r#"{"schema_version":"1.0","binding":{"schema_version":"1.0","operation_id":"00000000-0000-4000-8000-000000000001","vault_id":"00000000-0000-4000-8000-000000000002","memory_id":"00000000-0000-4000-8000-000000000003","source_kind":"text","source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_revision":1,"input_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","consent_epoch":2,"captured_at":"2026-10-23T12:00:00Z"},"media_type":"text/plain; charset=utf-8","human_text_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","connection_fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","local_epoch":"00000000-0000-4000-8000-000000000004","state":"queued","error_code":null}"#;
    assert_eq!(serde_json::to_string(&intent).unwrap(), golden);
    let old: OrganizationIntent = serde_json::from_str(golden).unwrap();
    assert_eq!(old, intent);
    assert!(!old.sent);
    // Once sent, the marker is persisted and round-trips.
    let mut sent = intent.clone();
    sent.sent = true;
    let text = serde_json::to_string(&sent).unwrap();
    assert!(text.ends_with(r#""error_code":null,"sent":true}"#));
    assert!(
        serde_json::from_str::<OrganizationIntent>(&text)
            .unwrap()
            .sent
    );
    // On disk: a real unsent intent file has no `sent` key until the POST marker is written.
    let c = case(Kind::Text);
    let path = c
        .vault()
        .root_for_test()
        .join(format!("Recall/_meta/organize/{}.json", c.operation));
    assert!(!fs::read_to_string(&path).unwrap().contains("\"sent\""));
    c.vault()
        .set_organization_operation_state(&c.operation, "processing", None)
        .unwrap();
    assert!(!fs::read_to_string(&path).unwrap().contains("\"sent\""));
    assert!(c.vault().mark_organization_sent(&c.operation).unwrap());
    assert!(fs::read_to_string(&path).unwrap().contains("\"sent\":true"));
}

#[test]
fn the_v2_scenarios_really_carry_bound_context() {
    let c = case(Kind::TextV2);
    let (intent, request, _) = c
        .vault()
        .organization_dispatch_material(&c.operation)
        .unwrap()
        .unwrap();
    assert_eq!(intent.binding.schema_version, "2.0");
    assert_eq!(request.binding.context.as_ref().map(Vec::len), Some(1));
    assert_eq!(case(Kind::Photo).intent().binding.source_kind, "photo");
}

// --------------------------------------------------------------------------------
// Fix round 1: production-path coverage, SF1 outcomes, hardening
// --------------------------------------------------------------------------------

fn intent_file(c: &Case) -> PathBuf {
    c.vault()
        .root_for_test()
        .join(format!("Recall/_meta/organize/{}.json", c.operation))
}
fn real_request(c: &Case) -> (OrganizationRequest, Vec<u8>) {
    let (_, request, body) = c
        .vault()
        .organization_dispatch_material(&c.operation)
        .unwrap()
        .unwrap();
    (request, body)
}

#[test]
fn a_vault_switch_during_the_receipt_lookup_sends_nothing() {
    for kind in KINDS {
        let c = case(kind);
        let env = c.env.clone();
        let other = env.dir.join("another-vault");
        fs::create_dir_all(&other).unwrap();
        *c.fake.on_get.lock().unwrap() = Some(Box::new(move || {
            env.state.select_path(&other).unwrap();
        }));
        c.run();
        assert_eq!(c.posts(), 0, "{kind:?}");
        assert_eq!(c.state(), ("queued".into(), None), "{kind:?}");
        assert!(!c.intent().sent);
    }
}

#[test]
fn a_failing_sent_marker_write_sends_nothing_and_unsent_work_stays_recoverable() {
    for kind in KINDS {
        let c = case(kind);
        let path = intent_file(&c);
        let hook_path = path.clone();
        // After the lookup, the intent file becomes unwritable: the re-check (read-only) passes
        // but the durable marker cannot be written, so the POST must not happen.
        *c.fake.on_get.lock().unwrap() = Some(Box::new(move || {
            let mut permissions = fs::metadata(&hook_path).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(&hook_path, permissions).unwrap();
        }));
        c.run();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).unwrap();
        assert_eq!(c.posts(), 0, "{kind:?}: no marker, no POST");
        assert!(!c.intent().sent);
        // Whatever state the failed revert left, the unsent request is still recoverable.
        assert!(
            ["processing", "queued"].contains(&c.state().0.as_str()),
            "{kind:?}"
        );
        c.vault().revert_organization_unsent(&c.operation).unwrap();
        assert_eq!(c.state().0, "queued");
        *c.fake.on_get.lock().unwrap() = None;
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}");
    }
}

#[test]
fn a_crash_resumed_unsent_processing_intent_recovers_by_receipt_and_resends_only_on_404() {
    for kind in KINDS {
        // Lookup unavailable: ambiguous, nothing sent.
        let c = case(kind);
        c.vault()
            .set_organization_operation_state(&c.operation, "processing", None)
            .unwrap();
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Err("receipt unavailable".into()));
        c.run();
        assert_eq!(c.posts(), 0);
        assert_eq!(
            c.state(),
            ("unknown".into(), Some("RECEIPT_UNAVAILABLE".into())),
            "{kind:?}"
        );
        // Authenticated 404: the same operation is sent exactly once (POST asserts `sent`).
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}");
        assert_eq!(c.intent().binding.operation_id, c.operation);
        // A found receipt is adopted without any further send.
        let (request, _) = real_request(&c);
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Ok(OrganizationLookup::Receipt(in_flight(&request))));
        c.run();
        assert_eq!(c.posts(), 1, "{kind:?}");
    }
}

#[test]
fn an_invalid_receipt_does_not_stop_the_sweep_and_is_never_resent() {
    let c = case(Kind::Text);
    let second = c
        .vault()
        .capture_text(&op(), "Another synthetic memory about the pump.")
        .unwrap();
    let (other_request, other_body) = super::tests::fixture_request();
    let invalid = text_receipt(&other_request, &other_body);
    *c.fake.complete_with.lock().unwrap() = Some(invalid.clone());
    let sweep = |c: &Case| {
        run_scoped_with(
            &c.guard,
            None,
            &mut HashSet::new(),
            &c.marker,
            FP,
            &|| Ok(FP.to_owned()),
            &*c.fake,
        )
        .expect("a bad receipt must not abort the sweep")
    };
    sweep(&c);
    assert_eq!(
        c.posts(),
        2,
        "both intents were attempted despite the first bad receipt"
    );
    for memory in [&c.memory_id, &second.id] {
        let o = c.vault().organization_operations(memory).unwrap().remove(0);
        assert_eq!(
            (o.state.as_str(), o.error_code.as_deref()),
            ("unknown", Some("RECEIPT_INVALID"))
        );
    }
    // The service holds a record; recovery finds it (still invalid) and never sends again.
    for _ in 0..2 {
        c.fake
            .lookups
            .lock()
            .unwrap()
            .push_back(Ok(OrganizationLookup::Receipt(invalid.clone())));
    }
    sweep(&c);
    assert_eq!(c.posts(), 2);
}

#[test]
fn a_failed_promotion_becomes_unknown_and_recovery_promotes_without_resending() {
    let c = case(Kind::Text);
    let (request, body) = real_request(&c);
    let receipt = text_receipt(&request, &body);
    *c.fake.complete_with.lock().unwrap() = Some(receipt.clone());
    // The journal slot of the promotion event is occupied, so the commit itself fails.
    let blocker = c
        .vault()
        .root_for_test()
        .join(format!("Recall/_meta/journal/{}.json", c.operation));
    let hook_blocker = blocker.clone();
    *c.fake.on_post.lock().unwrap() = Some(Box::new(move || {
        fs::create_dir(&hook_blocker).unwrap();
    }));
    c.run();
    assert_eq!(c.posts(), 1);
    assert_eq!(
        c.state(),
        ("unknown".into(), Some("PROMOTION_FAILED".into()))
    );
    assert!(c.guard.with(|g| g.list("")).unwrap()[0]
        .organization
        .is_none());
    // Fault cleared: recovery reads the receipt and promotes. Nothing is POSTed again.
    fs::remove_dir(&blocker).unwrap();
    *c.fake.on_post.lock().unwrap() = None;
    c.fake
        .lookups
        .lock()
        .unwrap()
        .push_back(Ok(OrganizationLookup::Receipt(receipt)));
    c.run();
    assert_eq!(c.posts(), 1, "no blind re-send");
    assert_eq!(c.state(), ("organized".into(), None));
}

#[test]
fn complete_path_check_failures_do_not_abort_and_map_to_precise_states() {
    // A capability read error after the POST: ambiguous, recoverable by receipt.
    let c = case(Kind::Text);
    let (request, body) = real_request(&c);
    *c.fake.complete_with.lock().unwrap() = Some(text_receipt(&request, &body));
    *c.fake.capability_fails_from.lock().unwrap() = Some(2);
    c.run();
    assert_eq!(c.posts(), 1);
    assert_eq!(
        c.state(),
        ("unknown".into(), Some("RECEIPT_UNAVAILABLE".into()))
    );
    // Consent revoked while the request is in flight: the result is dropped as stale.
    let c = case(Kind::Text);
    let (request, body) = real_request(&c);
    *c.fake.complete_with.lock().unwrap() = Some(text_receipt(&request, &body));
    let vault = c.vault().clone();
    *c.fake.on_post.lock().unwrap() = Some(Box::new(move || {
        vault.set_organization_marker(None).unwrap();
    }));
    c.run();
    assert_eq!(c.posts(), 1);
    assert_eq!(c.state(), ("stale".into(), Some("CONSENT_CHANGED".into())));
    assert!(c.guard.with(|g| g.list("")).unwrap()[0]
        .organization
        .is_none());
}

#[test]
fn a_busy_vault_after_the_post_does_not_abort_and_the_state_stays_correct() {
    for kind in KINDS {
        let c = case(kind);
        let held: std::sync::Arc<Mutex<Option<fs::File>>> = std::sync::Arc::new(Mutex::new(None));
        let (vault, slot) = (c.vault().clone(), held.clone());
        *c.fake.on_post.lock().unwrap() = Some(Box::new(move || {
            *slot.lock().unwrap() = Some(vault.hold_lock_for_test().unwrap());
        }));
        // The outcome write hits a busy vault: skipped quietly, no error, no re-send.
        c.run();
        held.lock().unwrap().take();
        assert_eq!(c.posts(), 1, "{kind:?}");
        let state = c.state();
        assert_eq!(state.0, "processing", "{kind:?}: left for the next trigger");
        assert!(c.intent().sent);
    }
}

#[test]
fn typed_recovery_unknown_never_dispatches_and_404_dispatches_the_same_operation() {
    // Supersedes the former `recover_then_dispatch` test of the same name.
    let (request, body) = super::tests::fixture_request();
    let unavailable = typed_recover_then_dispatch(
        Err("receipt unavailable".into()),
        &request,
        || unreachable!(),
        |_, _| unreachable!(),
    );
    assert!(matches!(unavailable, Attempt::LookupFailed));
    let expected_id = request.binding.operation_id.clone();
    let sent = std::cell::Cell::new(false);
    let attempt = typed_recover_then_dispatch(
        Ok(OrganizationLookup::NotFound),
        &request,
        || Ok((request.clone(), body.clone())),
        |retry, bytes| {
            sent.set(true);
            assert_eq!(retry.binding.operation_id, expected_id);
            assert_eq!(retry, &request);
            retry.validate(&bytes).unwrap();
            Ok(in_flight(retry))
        },
    );
    assert!(sent.get());
    assert!(matches!(attempt, Attempt::Receipt(r) if r.binding.operation_id == expected_id));
    // A found receipt never dispatches.
    let found = typed_recover_then_dispatch(
        Ok(OrganizationLookup::Receipt(in_flight(&request))),
        &request,
        || unreachable!(),
        |_, _| unreachable!(),
    );
    assert!(matches!(found, Attempt::Receipt(_)));
}

#[test]
fn typed_recovery_refuses_a_changed_binding_before_any_post() {
    // Supersedes the former `recover_then_dispatch` changed-binding test.
    let (request, body) = super::tests::fixture_request();
    let mut changed = request.clone();
    changed.binding.operation_id = op();
    let attempt = typed_recover_then_dispatch(
        Ok(OrganizationLookup::NotFound),
        &request,
        || Ok((changed, body)),
        |_, _| panic!("a changed operation must never be posted"),
    );
    assert!(matches!(attempt, Attempt::Stale(_)));
    // And a re-check that reports staleness or a transient problem never dispatches.
    for outcome in [Recheck::Stale("CONSENT_REVOKED".into()), Recheck::Transient] {
        let attempt = typed_recover_then_dispatch(
            Ok(OrganizationLookup::NotFound),
            &request,
            || Err(outcome),
            |_, _| panic!("must not post"),
        );
        assert!(matches!(attempt, Attempt::Stale(_) | Attempt::Transient));
    }
}

// --- Hardening ----------------------------------------------------------------

#[test]
fn the_sent_marker_is_refused_unless_the_consent_marker_still_matches() {
    for kind in KINDS {
        let c = case(kind);
        let v = c.vault();
        // `unknown` is not retired by a consent change, so only the marker check can refuse.
        v.set_organization_operation_state(
            &c.operation,
            "unknown",
            Some("RECEIPT_UNAVAILABLE".into()),
        )
        .unwrap();
        let mut next = c.marker.clone();
        next.local_epoch = op();
        v.set_organization_marker(Some(next.clone())).unwrap();
        assert!(
            !v.mark_organization_sent(&c.operation).unwrap(),
            "{kind:?}: other local epoch"
        );
        let mut other_epoch = next.clone();
        other_epoch.local_epoch = c.marker.local_epoch.clone();
        other_epoch.consent_epoch += 1;
        v.set_organization_marker(Some(other_epoch)).unwrap();
        assert!(
            !v.mark_organization_sent(&c.operation).unwrap(),
            "{kind:?}: other consent epoch"
        );
        let mut other_connection = c.marker.clone();
        other_connection.connection_fingerprint = "b".repeat(64);
        v.set_organization_marker(Some(other_connection)).unwrap();
        assert!(
            !v.mark_organization_sent(&c.operation).unwrap(),
            "{kind:?}: other connection"
        );
        v.set_organization_marker(None).unwrap();
        assert!(
            !v.mark_organization_sent(&c.operation).unwrap(),
            "{kind:?}: revoked"
        );
        assert!(!c.intent().sent);
        v.set_organization_marker(Some(c.marker.clone())).unwrap();
        assert!(
            v.mark_organization_sent(&c.operation).unwrap(),
            "{kind:?}: matching marker"
        );
    }
}

#[test]
fn only_in_flight_intents_carry_the_sent_key() {
    for terminal in ["organized", "failed", "stale", "saved_local"] {
        let c = case(Kind::Text);
        let v = c.vault();
        v.set_organization_operation_state(&c.operation, "processing", None)
            .unwrap();
        assert!(v.mark_organization_sent(&c.operation).unwrap());
        assert!(fs::read_to_string(intent_file(&c))
            .unwrap()
            .contains("\"sent\":true"));
        v.transition_organization_state(&c.operation, &["processing"], terminal, Some("X"))
            .unwrap()
            .unwrap();
        let bytes = fs::read_to_string(intent_file(&c)).unwrap();
        assert!(!bytes.contains("\"sent\""), "{terminal}: {bytes}");
        assert!(!c.intent().sent);
    }
}

#[test]
fn transition_rejects_unknown_target_states() {
    let c = case(Kind::Text);
    assert!(c
        .vault()
        .transition_organization_state(&c.operation, &["queued"], "verified", None)
        .is_err());
    assert_eq!(c.state().0, "queued");
}
