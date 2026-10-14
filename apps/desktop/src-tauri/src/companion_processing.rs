//! Source-specific phone consent and durable desktop-engine work; no renderer secrets.
use crate::{
    librarian,
    local_vault::{self, Vault, VaultMemory},
    processing,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::PathBuf, sync::Mutex};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intent {
    format: String,
    vault_id: String,
    memory_id: String,
    revision: u64,
    source_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outcome {
    pub state: String,
    pub message: String,
    pub memory_id: String,
    pub revision: u64,
}
fn stage(memory: &str, label: &str) -> String {
    let hash = Sha256::digest(format!("recall-phone-meeting-v1:{memory}:{label}").as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 15) | 0x50;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}
fn path(vault: &Vault, memory: &str, kind: &str) -> Result<PathBuf, String> {
    if Uuid::parse_str(memory)
        .map_err(|_| "Invalid companion memory")?
        .to_string()
        != memory
    {
        return Err("Invalid companion memory".into());
    }
    let dir = vault.root().join("Recall/_meta/phone-processing");
    local_vault::safe(&dir)?;
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|_| "Phone processing directory unavailable")?;
    }
    Ok(dir.join(format!("{memory}-{kind}.json")))
}
fn persist<T: Serialize>(path: &std::path::Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "Invalid companion record")?;
    match fs::symlink_metadata(path) {
        Ok(_) => {
            if local_vault::read(path, 16 * 1024)? == bytes {
                Ok(())
            } else {
                Err("Companion operation reused".into())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => local_vault::create(path, &bytes),
        Err(_) => Err("Companion record inspection failed".into()),
    }
}
pub fn consent(
    vault: &Vault,
    memory: &VaultMemory,
    authorized: bool,
) -> Result<Option<Intent>, String> {
    if !authorized {
        return Ok(None);
    }
    let _lock = vault.lock()?;
    // Capture retries of completed/corrected memories do not create new work.
    if memory.revision != 1 {
        return Ok(None);
    }
    let snapshot = vault.processing_snapshot_while_locked(&memory.id, 1)?;
    if snapshot.human_corrected {
        return Err("Corrected memory requires review".into());
    }
    let intent = Intent {
        format: "recall-phone-consent-v1".into(),
        vault_id: vault.id.clone(),
        memory_id: memory.id.clone(),
        revision: 1,
        source_sha256: snapshot.source.sha256,
    };
    persist(&path(vault, &memory.id, "consent")?, &intent)?;
    Ok(Some(intent))
}
pub fn run(vault: &Vault, intent: &Intent) -> Result<Outcome, String> {
    run_with(
        vault,
        intent,
        &processing::Config::from_env(),
        &librarian::config_from_env(),
        &processing::NativeJev,
        &librarian::ClaudeTransport,
        &librarian::ClaudeTransport,
    )
}

/// Reload existing source-specific consent; this cannot grant new authorization.
pub fn recoverable(vault: &Vault, memory: &str) -> Result<Intent, String> {
    let _lock = vault.lock()?;
    let bytes = local_vault::read(&path(vault, memory, "consent")?, 16 * 1024)
        .map_err(|_| "No readable prior processing consent; review on desktop")?;
    let intent: Intent =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid prior processing consent")?;
    if intent.format != "recall-phone-consent-v1"
        || intent.vault_id != vault.id
        || intent.memory_id != memory
        || intent.revision != 1
    {
        return Err("Prior processing consent scope mismatch".into());
    }
    let snapshot = vault.processing_snapshot_while_locked(memory, intent.revision)?;
    if snapshot.human_corrected || snapshot.source.sha256 != intent.source_sha256 {
        return Err("Source changed; review processing on desktop".into());
    }
    Ok(intent)
}

static ACTIVE: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
struct ActiveJob(String);
impl Drop for ActiveJob {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            active.remove(&self.0);
        }
    }
}
fn reserve(key: String) -> Result<Option<ActiveJob>, String> {
    let mut active = ACTIVE
        .lock()
        .map_err(|_| "Processing worker state unavailable")?;
    if active.contains(&key) {
        return Ok(None);
    }
    if active.len() >= 4 {
        return Err(
            "Processing busy. Your original is saved; resume from its saved page later.".into(),
        );
    }
    active.insert(key.clone());
    Ok(Some(ActiveJob(key)))
}
/// Bounded workers reuse deterministic parser/librarian/publication IDs. Those
/// durable operations, not this in-process set, prevent duplicate provider calls.
pub fn enqueue(vault: &Vault, intent: Intent) -> Result<(), String> {
    let Some(guard) = reserve(format!("{}:{}", intent.vault_id, intent.memory_id))? else {
        return Ok(());
    };
    let requested = Outcome {
        state: "pending".into(),
        message: "Processing requested using existing authorization. Refresh for native status."
            .into(),
        memory_id: intent.memory_id.clone(),
        revision: intent.revision,
    };
    record(vault, &requested)?;
    let worker = vault.clone();
    std::thread::Builder::new()
        .name("recall-phone-processing".into())
        .spawn(move || {
            let _guard = guard;
            let outcome = run(&worker, &intent).unwrap_or_else(|error| Outcome {
                state: "error".into(),
                message: error,
                memory_id: requested.memory_id,
                revision: requested.revision,
            });
            let _ = record(&worker, &outcome);
        })
        .map_err(|_| {
            "Processing worker unavailable. Original and authorization retained; resume later"
                .to_string()
        })?;
    Ok(())
}
fn run_with(
    vault: &Vault,
    intent: &Intent,
    parser_config: &processing::Config,
    claude_config: &librarian::LibrarianConfig,
    parser: &impl processing::ParserTransport,
    reader: &impl librarian::ReadingTransport,
    organizer: &impl librarian::OrganizationTransport,
) -> Result<Outcome, String> {
    if intent.format != "recall-phone-consent-v1"
        || intent.vault_id != vault.id
        || intent.revision != 1
    {
        return Err("Companion consent scope mismatch".into());
    }
    let consent_path = path(vault, &intent.memory_id, "consent")?;
    let stored: Intent = serde_json::from_slice(&local_vault::read(&consent_path, 16 * 1024)?)
        .map_err(|_| "Invalid companion consent")?;
    if serde_json::to_vec(&stored).ok() != serde_json::to_vec(intent).ok() {
        return Err("Companion consent identity mismatch".into());
    }
    let parse = stage(&intent.memory_id, "parse");
    let organize = stage(&intent.memory_id, "organize");
    let publish = stage(&intent.memory_id, "publish");
    if let Ok(memory) = vault.publish_meeting(&parse, &organize, &publish) {
        return Ok(Outcome {
            state: if memory.state == "active" && memory.conflict.is_none() {
                "published"
            } else {
                "needs_review"
            }
            .into(),
            message: "Previous native publication recovered; human edits preserved".into(),
            memory_id: memory.id,
            revision: memory.revision,
        });
    }
    let snapshot = vault.processing_snapshot(&intent.memory_id, intent.revision)?;
    if snapshot.human_corrected || snapshot.source.sha256 != intent.source_sha256 {
        return Err("Companion source changed; processing stopped".into());
    }
    let job = processing::parse_with_visual(
        vault,
        parser_config,
        &parse,
        &intent.memory_id,
        intent.revision,
        true,
        parser,
        Some((claude_config, reader)),
    )?;
    if job.state != "parsed" {
        return Ok(Outcome {
            state: job.state,
            message: job.message,
            memory_id: intent.memory_id.clone(),
            revision: intent.revision,
        });
    }
    librarian::organize_selected(vault, claude_config, &parse, &organize, true, organizer)?;
    let memory = vault.publish_meeting(&parse, &organize, &publish)?;
    Ok(Outcome {
        state: "published".into(),
        message: "Organized in Recall; uncertainty and original evidence preserved".into(),
        memory_id: memory.id,
        revision: memory.revision,
    })
}
pub fn record(vault: &Vault, outcome: &Outcome) -> Result<(), String> {
    let _lock = vault.lock()?;
    let target = path(vault, &outcome.memory_id, "result")?;
    let bytes = serde_json::to_vec(outcome).map_err(|_| "Invalid companion outcome")?;
    librarian::atomic_write(&target, &bytes)
}
pub fn status(vault: &Vault, memory: &str) -> Result<Option<Outcome>, String> {
    if let Ok(current) = vault.publish_meeting(
        &stage(memory, "parse"),
        &stage(memory, "organize"),
        &stage(memory, "publish"),
    ) {
        return Ok(Some(Outcome {
            state: if current.state == "active" && current.conflict.is_none() {
                "published"
            } else {
                "needs_review"
            }
            .into(),
            message: "Native organization receipt verified; current human edits preserved".into(),
            memory_id: current.id,
            revision: current.revision,
        }));
    }
    let _lock = vault.lock()?;
    let target = path(vault, memory, "result")?;
    match fs::symlink_metadata(&target) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Companion outcome unavailable".into()),
        Ok(_) => {
            let mut outcome: Outcome =
                serde_json::from_slice(&local_vault::read(&target, 16 * 1024)?)
                    .map_err(|_| "Invalid companion outcome")?;
            if outcome.memory_id != memory
                || outcome.message.len() > 4096
                || !(1..=10000).contains(&outcome.revision)
                || ![
                    "pending",
                    "needs_transcription",
                    "needs_review",
                    "uncertain",
                    "published",
                    "error",
                ]
                .contains(&outcome.state.as_str())
            {
                return Err("Companion outcome scope mismatch".into());
            }
            if outcome.state == "published" {
                outcome.state = "needs_review".into();
                outcome.message = "Native publication could not be verified; inspect the original and proposal on desktop".into();
            }
            Ok(Some(outcome))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Parser(AtomicUsize);
    impl processing::ParserTransport for Parser {
        fn parse(
            &self,
            _: &jev::JevConfig,
            id: &str,
            text: &str,
            sha: &str,
        ) -> Result<jev::ParsedSource, String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            let mut p = crate::meeting::tests::source();
            assert_eq!(p.transcription, text);
            p.source_id = id.into();
            p.source_sha256 = sha.into();
            for candidate in &mut p.candidates {
                candidate.source_id = id.into();
            }
            Ok(p)
        }
    }
    use crate::jev;
    #[test]
    fn no_consent_or_missing_configuration_never_calls_provider() {
        let (t, v, _, memory) = crate::librarian::organization_tests::setup();
        let m = v
            .list_with_deleted("", false)
            .unwrap()
            .into_iter()
            .find(|m| m.id == memory)
            .unwrap();
        assert!(consent(&v, &m, false).unwrap().is_none());
        assert!(!t.0.join("Recall/_meta/phone-processing").exists());
        let intent = consent(&v, &m, true).unwrap().unwrap();
        let parser = Parser(AtomicUsize::new(0));
        let c = crate::librarian::organization_tests::config();
        let outcome = run_with(
            &v,
            &intent,
            &processing::Config::default(),
            &c,
            &parser,
            &librarian::ClaudeTransport,
            &crate::librarian::organization_tests::claude(),
        )
        .unwrap();
        assert_eq!(outcome.state, "pending");
        assert_eq!(parser.0.load(Ordering::SeqCst), 0);
        record(&v, &outcome).unwrap();
        assert_eq!(
            status(&Vault::open(&t.0).unwrap(), &memory)
                .unwrap()
                .unwrap()
                .state,
            "pending"
        );
    }
    #[test]
    fn deterministic_stage_ids_publish_once_and_recover_without_provider_calls() {
        let (t, v, _, memory) = crate::librarian::organization_tests::setup();
        let m = v
            .list_with_deleted("", false)
            .unwrap()
            .into_iter()
            .find(|m| m.id == memory)
            .unwrap();
        let intent = consent(&v, &m, true).unwrap().unwrap();
        let parser = Parser(AtomicUsize::new(0));
        let c = crate::librarian::organization_tests::config();
        let organizer = crate::librarian::organization_tests::claude();
        let outcome = run_with(
            &v,
            &intent,
            &processing::Config::synthetic_test_config(),
            &c,
            &parser,
            &librarian::ClaudeTransport,
            &organizer,
        )
        .unwrap();
        assert_eq!(outcome.state, "published");
        assert_eq!(outcome.revision, 2);
        let again = run_with(
            &Vault::open(&t.0).unwrap(),
            &intent,
            &processing::Config::default(),
            &c,
            &parser,
            &librarian::ClaudeTransport,
            &organizer,
        )
        .unwrap();
        assert_eq!(again.revision, 2);
        assert_eq!(parser.0.load(Ordering::SeqCst), 1);
        assert_eq!(status(&v, &memory).unwrap().unwrap().state, "published");
        assert_eq!(v.history(&memory).unwrap().len(), 2);
    }
    #[test]
    fn cached_publication_cannot_authorize_publication() {
        let (_t, v, _, memory) = crate::librarian::organization_tests::setup();
        record(
            &v,
            &Outcome {
                state: "published".into(),
                message: "forged".into(),
                memory_id: memory.clone(),
                revision: 2,
            },
        )
        .unwrap();
        assert_eq!(status(&v, &memory).unwrap().unwrap().state, "needs_review");
    }
    #[test]
    fn cached_publication_is_rejected_after_original_tampering() {
        let (t, v, _, memory) = crate::librarian::organization_tests::setup();
        let m = v
            .list_with_deleted("", false)
            .unwrap()
            .into_iter()
            .find(|m| m.id == memory)
            .unwrap();
        let intent = consent(&v, &m, true).unwrap().unwrap();
        let outcome = run_with(
            &v,
            &intent,
            &processing::Config::synthetic_test_config(),
            &crate::librarian::organization_tests::config(),
            &Parser(AtomicUsize::new(0)),
            &librarian::ClaudeTransport,
            &crate::librarian::organization_tests::claude(),
        )
        .unwrap();
        record(&v, &outcome).unwrap();
        fs::write(t.0.join(format!("Recall/Sources/{memory}.txt")), "tampered").unwrap();
        assert_eq!(
            status(&Vault::open(&t.0).unwrap(), &memory)
                .unwrap()
                .unwrap()
                .state,
            "needs_review"
        );
    }
    #[test]
    fn consent_scope_and_source_changes_stop_processing() {
        let (_t, v, _, memory) = crate::librarian::organization_tests::setup();
        let m = v
            .list_with_deleted("", false)
            .unwrap()
            .into_iter()
            .find(|m| m.id == memory)
            .unwrap();
        let mut intent = consent(&v, &m, true).unwrap().unwrap();
        intent.source_sha256 = "a".repeat(64);
        assert!(run(&v, &intent).unwrap_err().contains("identity"));
        let intent = consent(&v, &m, true).unwrap().unwrap();
        v.correct(&memory, 1, &Uuid::new_v4().to_string(), "Human correction")
            .unwrap();
        assert!(run(&v, &intent).is_err());
    }
    #[test]
    fn recovery_uses_original_consent_and_does_not_repeat_uncertain_provider_delivery() {
        struct LostResponse(AtomicUsize);
        impl processing::ParserTransport for LostResponse {
            fn parse(
                &self,
                _: &jev::JevConfig,
                _: &str,
                _: &str,
                _: &str,
            ) -> Result<jev::ParsedSource, String> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Err("Synthetic lost provider response".into())
            }
        }
        let (temp, vault, _, memory_id) = crate::librarian::organization_tests::setup();
        let memory = vault
            .list_with_deleted("", false)
            .unwrap()
            .into_iter()
            .find(|m| m.id == memory_id)
            .unwrap();
        let intent = consent(&vault, &memory, true).unwrap().unwrap();
        let parser = LostResponse(AtomicUsize::new(0));
        let config = crate::librarian::organization_tests::config();
        let organizer = crate::librarian::organization_tests::claude();
        let first = run_with(
            &vault,
            &intent,
            &processing::Config::synthetic_test_config(),
            &config,
            &parser,
            &librarian::ClaudeTransport,
            &organizer,
        )
        .unwrap();
        assert_eq!(first.state, "uncertain");
        let reopened = Vault::open(&temp.0).unwrap();
        let recovered = recoverable(&reopened, &memory_id).unwrap();
        assert_eq!(
            serde_json::to_vec(&recovered).unwrap(),
            serde_json::to_vec(&intent).unwrap()
        );
        let second = run_with(
            &reopened,
            &recovered,
            &processing::Config::synthetic_test_config(),
            &config,
            &parser,
            &librarian::ClaudeTransport,
            &organizer,
        )
        .unwrap();
        assert_eq!(second.state, "uncertain");
        assert_eq!(parser.0.load(Ordering::SeqCst), 1);
        assert_eq!(reopened.history(&memory_id).unwrap().len(), 1);
        reopened
            .correct(
                &memory_id,
                1,
                &Uuid::new_v4().to_string(),
                "User correction",
            )
            .unwrap();
        assert!(recoverable(&reopened, &memory_id).is_err());
    }

    #[test]
    fn workers_are_bounded_deduplicated_and_release_capacity() {
        let first_id = Uuid::new_v4().to_string();
        let first = reserve(first_id.clone()).unwrap().unwrap();
        assert!(reserve(first_id).unwrap().is_none());
        let others: Vec<_> = (0..3)
            .map(|_| reserve(Uuid::new_v4().to_string()).unwrap().unwrap())
            .collect();
        assert!(reserve(Uuid::new_v4().to_string()).is_err());
        drop(first);
        let replacement = reserve(Uuid::new_v4().to_string()).unwrap().unwrap();
        drop(replacement);
        drop(others);
    }
}
