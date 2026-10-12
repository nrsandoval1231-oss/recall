//! Durable, consented parser operations. No model-controlled paths or publication.

use crate::{
    jev, librarian,
    local_vault::{self, Vault},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};
use uuid::Uuid;
const FORMAT: &str = "recall-parser-operation-v1";
const MAX_JSON: u64 = 512 * 1024;
const MAX_OPERATIONS: usize = 10_000;
const RESERVED_INPUT: u64 = 100_000;
type Result<T, E = String> = std::result::Result<T, E>;

#[derive(Default)]
pub struct Config {
    api_key: Option<String>,
    model: Option<String>,
    price_micros: Option<i64>,
    daily_micros: Option<i64>,
    monthly_micros: Option<i64>,
}
impl Config {
    #[cfg(test)]
    pub(crate) fn synthetic_test_config()->Self {
        Self {api_key:Some("synthetic-key".into()),model:Some("jev-1.13.0".into()),price_micros:Some(42_000),daily_micros:Some(1_000_000),monthly_micros:Some(10_000_000)}
    }
    pub fn from_env() -> Self {
        let value = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let amount = |name: &str| {
            value(name)
                .and_then(|v| librarian::usd_to_micros(&v).ok())
                .filter(|v| *v > 0)
        };
        Self {
            api_key: value("TYPESAFE_API_KEY"),
            model: value("RECALL_JEV_MODEL"),
            price_micros: amount("RECALL_JEV_INPUT_USD_PER_MTOK"),
            daily_micros: amount("RECALL_JEV_DAILY_BUDGET_USD"),
            monthly_micros: amount("RECALL_JEV_MONTHLY_BUDGET_USD"),
        }
    }
    fn ready(&self) -> bool {
        self.api_key
            .as_ref()
            .is_some_and(|v| !v.is_empty() && v.len() <= 4096 && !v.chars().any(char::is_control))
            && self.model.is_some()
            && self.price_micros.is_some_and(|v| v > 0)
            && self.daily_micros.is_some_and(|v| v > 0)
            && self.monthly_micros.is_some_and(|v| v > 0)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    format: String,
    vault_id: String,
    operation_id: String,
    memory_id: String,
    revision: u64,
    source_sha256: String,
    mime_type: String,
    human_corrected: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Attempt {
    format: String,
    input_sha256: String,
    model: String,
    price_micros: i64,
    reserved_micros: i64,
    day: String,
    month: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Completed {
    format: String,
    input_sha256: String,
    attempt_sha256: String,
    parsed: jev::ParsedSource,
}
#[derive(Clone, Debug, Serialize)]
pub struct Job {
    pub operation_id: String,
    pub memory_id: String,
    pub expected_revision: u64,
    pub source_sha256: String,
    pub state: String,
    pub message: String,
    pub model: Option<String>,
    pub reserved_micros: i64,
    pub parsed: Option<jev::ParsedSource>,
}
pub trait ParserTransport {
    fn parse(
        &self,
        config: &jev::JevConfig,
        source_id: &str,
        text: &str,
        sha: &str,
    ) -> Result<jev::ParsedSource>;
}
pub struct NativeJev;
impl ParserTransport for NativeJev {
    fn parse(
        &self,
        c: &jev::JevConfig,
        id: &str,
        text: &str,
        sha: &str,
    ) -> Result<jev::ParsedSource> {
        jev::parse(c, id, text, sha)
    }
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn stable_id(value: &str) -> Result<()> {
    if Uuid::parse_str(value)
        .map_err(|_| "Invalid parser operation identity")?
        .to_string()
        != value
    {
        return Err("Invalid parser operation identity".into());
    }
    Ok(())
}
fn json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| "Invalid parser record".into())
}
fn root(vault: &Vault) -> Result<PathBuf> {
    vault.validate_for_processing()?;
    let path = vault.root().join("Recall/_meta/processing");
    local_vault::safe(&path)?;
    if !path.exists() {
        fs::create_dir(&path).map_err(|_| "Could not create parser state directory")?;
    }
    for name in ["inputs", "attempts", "results"] {
        let dir = path.join(name);
        local_vault::safe(&dir)?;
        if !dir.exists() {
            fs::create_dir(&dir).map_err(|_| "Could not create parser record directory")?;
        }
    }
    Ok(path)
}
fn path(root: &Path, kind: &str, id: &str) -> Result<PathBuf> {
    stable_id(id)?;
    Ok(root.join(kind).join(format!("{id}.json")))
}
fn read_optional<T: for<'d> Deserialize<'d>>(path: &Path) -> Result<Option<T>> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Parser record could not be inspected".into()),
        Ok(_) => serde_json::from_slice(&local_vault::read(path, MAX_JSON)?)
            .map(Some)
            .map_err(|_| "Invalid parser record JSON".into()),
    }
}
fn immutable<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = json(value)?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("Parser record exceeds storage bound".into());
    }
    match fs::symlink_metadata(path) {
        Ok(_) => {
            if local_vault::read(path, MAX_JSON)? != bytes {
                return Err("Parser operation reused with different payload".into());
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => local_vault::create(path, &bytes),
        Err(_) => Err("Parser record could not be inspected".into()),
    }
}
fn lock(root: &Path) -> Result<File> {
    let path = root.join("processing.lock");
    local_vault::safe(&path)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(0x20000);
    }
    let file = options.open(path).map_err(|_| "Parser lock unavailable")?;
    file.try_lock()
        .map_err(|_| "Parser is busy; original evidence remains saved")?;
    Ok(file)
}
fn reservation(price: i64) -> Result<i64> {
    if price <= 0 {
        return Err("Invalid parser price".into());
    }
    let product = price
        .checked_mul(RESERVED_INPUT as i64)
        .ok_or("Parser reservation overflow")?;
    Ok(product / 1_000_000 + i64::from(product % 1_000_000 != 0))
}
fn valid_input(vault: &Vault, input: &Input, operation: &str) -> Result<()> {
    stable_id(&input.memory_id)?;
    stable_id(&input.operation_id)?;
    if input.format != FORMAT
        || input.vault_id != vault.id
        || input.operation_id != operation
        || input.revision == 0
        || input.revision > 10_000
        || input.source_sha256.len() != 64
        || !input.source_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !["text/plain", "image/png", "image/jpeg", "image/webp"]
            .contains(&input.mime_type.as_str())
    {
        return Err("Parser record scope or source identity mismatch".into());
    }
    Ok(())
}
fn valid_date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && value[5..7]
            .parse::<u8>()
            .is_ok_and(|n| (1..=12).contains(&n))
        && value[8..10]
            .parse::<u8>()
            .is_ok_and(|n| (1..=31).contains(&n))
}
fn valid_completed(input: &Input, attempt: &Attempt, result: &Completed) -> Result<()> {
    if result.format != FORMAT
        || result.input_sha256 != digest(&json(input)?)
        || result.attempt_sha256 != digest(&json(attempt)?)
    {
        return Err("Parser result identity mismatch".into());
    }
    jev::validate_parsed(
        &result.parsed,
        &input.memory_id,
        &result.parsed.transcription,
        &input.source_sha256,
        &attempt.model,
    )
}
fn valid_attempt(input: &Input, attempt: &Attempt) -> Result<()> {
    if attempt.format != FORMAT
        || attempt.input_sha256 != digest(&json(input)?)
        || attempt.model.len() > 80
        || attempt.reserved_micros != reservation(attempt.price_micros)?
        || attempt.day.len() != 10
        || attempt.month.len() != 7
        || !valid_date(&attempt.day)
        || !attempt.day.starts_with(&attempt.month)
    {
        return Err("Invalid parser reservation record".into());
    }
    // The model must be pinned to the supported version syntax before any send.
    jev::prepare(
        &input.memory_id,
        "validation",
        &digest(b"validation"),
        &attempt.model,
    )?;
    Ok(())
}
fn budget(vault: &Vault, dir: &Path, input: &Input, config: &Config, required: i64) -> Result<()> {
    let (day, month) = librarian::utc_day_month();
    let mut daily = 0_i64;
    let mut monthly = 0_i64;
    let entries = fs::read_dir(dir.join("attempts")).map_err(|_| "Parser budget unavailable")?;
    for (count, entry) in entries.enumerate() {
        if count >= MAX_OPERATIONS {
            return Err("Parser retention capacity reached".into());
        }
        let p = entry.map_err(|_| "Parser budget unavailable")?.path();
        let id = p
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid parser budget filename")?;
        stable_id(id)?;
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            return Err("Unexpected parser budget file".into());
        }
        let original: Input =
            read_optional(&path(dir, "inputs", id)?)?.ok_or("Missing parser budget input")?;
        valid_input(vault, &original, id)?;
        let attempt: Attempt = read_optional(&p)?.ok_or("Missing parser reservation")?;
        valid_attempt(&original, &attempt)?;
        // Conservative accounting keeps the full reservation, even on success.
        if attempt.day == day {
            daily = daily
                .checked_add(attempt.reserved_micros)
                .ok_or("Parser spend overflow")?;
        }
        if attempt.month == month {
            monthly = monthly
                .checked_add(attempt.reserved_micros)
                .ok_or("Parser spend overflow")?;
        }
        let completed = read_optional::<Completed>(&path(dir, "results", id)?)?;
        if let Some(result) = &completed {
            valid_completed(&original, &attempt, result)?;
        }
        if original.source_sha256 == input.source_sha256 && completed.is_none() {
            return Err(
                "Previous parser request for this source has an uncertain outcome; review required"
                    .into(),
            );
        }
    }
    if daily
        .checked_add(required)
        .is_none_or(|n| n > config.daily_micros.unwrap_or(0))
        || monthly
            .checked_add(required)
            .is_none_or(|n| n > config.monthly_micros.unwrap_or(0))
    {
        return Err("Parser budget exhausted; original evidence remains saved".into());
    }
    Ok(())
}
fn job(
    input: &Input,
    state: &str,
    message: &str,
    attempt: Option<&Attempt>,
    parsed: Option<jev::ParsedSource>,
) -> Job {
    Job {
        operation_id: input.operation_id.clone(),
        memory_id: input.memory_id.clone(),
        expected_revision: input.revision,
        source_sha256: input.source_sha256.clone(),
        state: state.into(),
        message: message.into(),
        model: attempt.map(|a| a.model.clone()),
        reserved_micros: attempt.map_or(0, |a| a.reserved_micros),
        parsed,
    }
}
fn read_job(vault: &Vault, dir: &Path, input: &Input) -> Result<Job> {
    valid_input(vault, input, &input.operation_id)?;
    let snap = vault.processing_snapshot(&input.memory_id, input.revision)?;
    if snap.source.sha256 != input.source_sha256
        || snap.source.mime_type != input.mime_type
        || snap.human_corrected != input.human_corrected
    {
        return Err("Parser source changed".into());
    }
    let attempt: Option<Attempt> = read_optional(&path(dir, "attempts", &input.operation_id)?)?;
    let result: Option<Completed> = read_optional(&path(dir, "results", &input.operation_id)?)?;
    if let Some(a) = &attempt {
        valid_attempt(input, a)?;
        if let Some(result) = result {
            valid_completed(input, a, &result)?;
            let text = std::str::from_utf8(&snap.source.bytes)
                .map_err(|_| "Parser result is not a text source")?;
            jev::validate_parsed(
                &result.parsed,
                &input.memory_id,
                text,
                &input.source_sha256,
                &a.model,
            )?;
            return Ok(job(
                input,
                "parsed",
                "Source parsed; Claude organization is pending",
                Some(a),
                Some(result.parsed),
            ));
        }
        return Ok(job(
            input,
            "uncertain",
            "Parser outcome is uncertain; this request will not be resent",
            Some(a),
            None,
        ));
    }
    if result.is_some() {
        return Err("Parser result has no reserved attempt".into());
    }
    if input.human_corrected {
        return Ok(job(
            input,
            "needs_review",
            "Human correction preserved; automatic reprocessing requires review",
            None,
            None,
        ));
    }
    if input.mime_type != "text/plain" {
        return Ok(job(
            input,
            "needs_transcription",
            "Photo saved; visual transcription is required before Jev",
            None,
            None,
        ));
    }
    Ok(job(
        input,
        "pending",
        "Original saved; configured and consented parsing is pending",
        None,
        None,
    ))
}
pub fn status(vault: &Vault, operation: &str) -> Result<Job> {
    let dir = root(vault)?;
    let _lock = lock(&dir)?;
    let input: Input = read_optional(&path(&dir, "inputs", operation)?)?
        .ok_or("Parser operation not found in this vault")?;
    read_job(vault, &dir, &input)
}
pub fn parse_note(
    vault: &Vault,
    config: &Config,
    operation: &str,
    memory: &str,
    revision: u64,
    consent: bool,
    transport: &impl ParserTransport,
) -> Result<Job> {
    stable_id(operation)?;
    stable_id(memory)?;
    let dir = root(vault)?;
    let _lock = lock(&dir)?;
    let snap = vault.processing_snapshot(memory, revision)?;
    let input = Input {
        format: FORMAT.into(),
        vault_id: vault.id.clone(),
        operation_id: operation.into(),
        memory_id: memory.into(),
        revision,
        source_sha256: snap.source.sha256.clone(),
        mime_type: snap.source.mime_type.clone(),
        human_corrected: snap.human_corrected,
    };
    if fs::read_dir(dir.join("inputs"))
        .map_err(|_| "Parser inputs unavailable")?
        .count()
        >= MAX_OPERATIONS
        && !path(&dir, "inputs", operation)?.exists()
    {
        return Err("Parser retention capacity reached".into());
    }
    immutable(&path(&dir, "inputs", operation)?, &input)?;
    let prior = read_job(vault, &dir, &input)?;
    if prior.state != "pending" || !consent || !config.ready() {
        return Ok(prior);
    }
    let text = std::str::from_utf8(&snap.source.bytes).map_err(|_| "Original text is not UTF-8")?;
    let model = config.model.as_deref().ok_or("Parser model unavailable")?;
    jev::prepare(memory, text, &input.source_sha256, model)?;
    let required = reservation(config.price_micros.ok_or("Parser price unavailable")?)?;
    budget(vault, &dir, &input, config, required)?;
    let (day, month) = librarian::utc_day_month();
    let attempt = Attempt {
        format: FORMAT.into(),
        input_sha256: digest(&json(&input)?),
        model: model.into(),
        price_micros: config.price_micros.unwrap_or(0),
        reserved_micros: required,
        day,
        month,
    };
    immutable(&path(&dir, "attempts", operation)?, &attempt)?;
    let c = jev::JevConfig {
        api_key: config.api_key.clone().ok_or("Parser key unavailable")?,
        model: model.into(),
        consent: true,
        max_request_bytes: 128 * 1024,
    };
    let output = transport.parse(&c, memory, text, &input.source_sha256);
    if let Ok(parsed) = output {
        if jev::validate_parsed(&parsed, memory, text, &input.source_sha256, model).is_ok() {
            // Revalidate revision/source after the provider call before accepting derived state.
            let latest = vault.processing_snapshot(memory, revision)?;
            if latest.source.sha256 != input.source_sha256 || latest.human_corrected {
                return Err("Source changed during parser request; result withheld".into());
            }
            let completed = Completed {
                format: FORMAT.into(),
                input_sha256: digest(&json(&input)?),
                attempt_sha256: digest(&json(&attempt)?),
                parsed,
            };
            immutable(&path(&dir, "results", operation)?, &completed)?;
        }
    }
    read_job(vault, &dir, &input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };
    const NOTE: &str="Brad says maybe 5–10 MW? Utility late. Call Sarah. Need generators by Dec? Prism doing electrical? Site access north? Ask operator about gas. Crossed out: 8 MW confirmed.";
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("recall-synthetic-job-{}", Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
        fn vault(&self) -> Vault {
            Vault::open(&self.0).unwrap()
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn id() -> String {
        Uuid::new_v4().to_string()
    }
    fn configured() -> Config {
        Config {
            api_key: Some("synthetic-only-key".into()),
            model: Some("jev-1.13.0".into()),
            price_micros: Some(42_000),
            daily_micros: Some(1_000_000),
            monthly_micros: Some(10_000_000),
        }
    }
    // Synthetic output tests orchestration/validation only; never live proof.
    struct FixtureParser {
        calls: AtomicUsize,
        fail: bool,
        wrong_source: bool,
    }
    impl ParserTransport for FixtureParser {
        fn parse(
            &self,
            _: &jev::JevConfig,
            source: &str,
            text: &str,
            sha: &str,
        ) -> Result<jev::ParsedSource, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                return Err("synthetic uncertain delivery".into());
            }
            let spans = jev::candidates(text)?;
            let kinds = [
                "observation",
                "quantity",
                "date",
                "decision",
                "possible_commitment",
                "follow_up",
                "question",
                "conflict",
                "other",
            ];
            Ok(jev::ParsedSource {
                schema_version: 1,
                source_id: if self.wrong_source {
                    "wrong".into()
                } else {
                    source.into()
                },
                source_sha256: sha.into(),
                transcription: text.into(),
                legibility: "text_supplied_not_visually_verified".into(),
                model: "jev-1.13.0".into(),
                input_tokens: 100,
                output_tokens: 50,
                mentions: vec![],
                candidates: spans
                    .into_iter()
                    .map(|span| jev::ParsedCandidate {
                        source_id: source.into(),
                        kind: if span.retracted {
                            "conflict"
                        } else if span.uncertain {
                            "question"
                        } else {
                            "observation"
                        }
                        .into(),
                        confidence: 0.9,
                        probabilities: kinds
                            .iter()
                            .map(|k| {
                                (
                                    (*k).into(),
                                    if *k
                                        == (if span.retracted {
                                            "conflict"
                                        } else if span.uncertain {
                                            "question"
                                        } else {
                                            "observation"
                                        })
                                    {
                                        1.0
                                    } else {
                                        0.0
                                    },
                                )
                            })
                            .collect(),
                        status: if span.retracted {
                            "retracted"
                        } else if span.uncertain {
                            "needs_review"
                        } else {
                            "candidate"
                        }
                        .into(),
                        span,
                    })
                    .collect(),
            })
        }
    }
    fn parser() -> FixtureParser {
        FixtureParser {
            calls: AtomicUsize::new(0),
            fail: false,
            wrong_source: false,
        }
    }
    #[test]
    fn pending_without_config_preserves_original_and_restart_state() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let op = id();
        let p = parser();
        let j = parse_note(&v, &Config::default(), &op, &m.id, 1, true, &p).unwrap();
        assert_eq!(j.state, "pending");
        assert_eq!(p.calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            fs::read(t.0.join(format!("Recall/Sources/{}.txt", m.id))).unwrap(),
            NOTE.as_bytes()
        );
        assert_eq!(status(&t.vault(), &op).unwrap().state, "pending");
    }
    #[test]
    fn consent_and_budget_stop_before_provider() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let p = parser();
        assert_eq!(
            parse_note(&v, &configured(), &id(), &m.id, 1, false, &p)
                .unwrap()
                .state,
            "pending"
        );
        let mut c = configured();
        c.daily_micros = Some(1);
        assert!(parse_note(&v, &c, &id(), &m.id, 1, true, &p)
            .unwrap_err()
            .contains("budget"));
        assert_eq!(p.calls.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn validated_parser_result_is_durable_and_identical_replay_is_free() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let op = id();
        let p = parser();
        assert_eq!(
            parse_note(&v, &configured(), &op, &m.id, 1, true, &p)
                .unwrap()
                .state,
            "parsed"
        );
        let j = parse_note(&t.vault(), &Config::default(), &op, &m.id, 1, true, &p).unwrap();
        assert_eq!(j.parsed.unwrap().transcription, NOTE);
        assert_eq!(p.calls.load(Ordering::SeqCst), 1);
        assert_eq!(status(&t.vault(), &op).unwrap().state, "parsed");
        let other = v.capture_note(&id(), "Other source").unwrap();
        assert!(parse_note(&v, &configured(), &op, &other.id, 1, true, &p).is_err());
    }
    #[test]
    fn uncertain_outcome_blocks_same_and_new_operation_after_restart() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let op = id();
        let p = FixtureParser {
            calls: AtomicUsize::new(0),
            fail: true,
            wrong_source: false,
        };
        assert_eq!(
            parse_note(&v, &configured(), &op, &m.id, 1, true, &p)
                .unwrap()
                .state,
            "uncertain"
        );
        let next = parser();
        assert_eq!(
            parse_note(&t.vault(), &configured(), &op, &m.id, 1, true, &next)
                .unwrap()
                .state,
            "uncertain"
        );
        assert!(parse_note(&v, &configured(), &id(), &m.id, 1, true, &next).is_err());
        assert_eq!(next.calls.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn invalid_provider_source_is_not_persisted_as_processed() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let op = id();
        let p = FixtureParser {
            calls: AtomicUsize::new(0),
            fail: false,
            wrong_source: true,
        };
        assert_eq!(
            parse_note(&v, &configured(), &op, &m.id, 1, true, &p)
                .unwrap()
                .state,
            "uncertain"
        );
        assert!(status(&v, &op).unwrap().parsed.is_none());
    }
    #[test]
    fn human_correction_and_stale_revision_cannot_trigger_model() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let p = parser();
        v.correct(&m.id, 1, &id(), "Utility on time").unwrap();
        assert!(parse_note(&v, &configured(), &id(), &m.id, 1, true, &p).is_err());
        assert_eq!(
            parse_note(&v, &configured(), &id(), &m.id, 2, true, &p)
                .unwrap()
                .state,
            "needs_review"
        );
        assert_eq!(p.calls.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn tampered_classification_cannot_be_replayed_as_a_decision() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), "Utility late.").unwrap();
        let op = id();
        parse_note(&v, &configured(), &op, &m.id, 1, true, &parser()).unwrap();
        let result_path = path(&root(&v).unwrap(), "results", &op).unwrap();
        let mut completed: Completed = read_optional(&result_path).unwrap().unwrap();
        completed.parsed.candidates[0].kind = "decision".into();
        fs::write(&result_path, json(&completed).unwrap()).unwrap();
        assert!(status(&t.vault(), &op)
            .unwrap_err()
            .contains("distribution"));
    }
    #[test]
    fn forged_result_cannot_unlock_an_uncertain_source() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let op = id();
        let failing = FixtureParser {
            calls: AtomicUsize::new(0),
            fail: true,
            wrong_source: false,
        };
        parse_note(&v, &configured(), &op, &m.id, 1, true, &failing).unwrap();
        let parsed = parser()
            .parse(
                &jev::JevConfig {
                    api_key: "fixture".into(),
                    model: "jev-1.13.0".into(),
                    consent: true,
                    max_request_bytes: 128 * 1024,
                },
                &m.id,
                NOTE,
                &digest(NOTE.as_bytes()),
            )
            .unwrap();
        let result = Completed {
            format: FORMAT.into(),
            input_sha256: "forged".into(),
            attempt_sha256: "forged".into(),
            parsed,
        };
        immutable(&path(&root(&v).unwrap(), "results", &op).unwrap(), &result).unwrap();
        let p = parser();
        assert!(parse_note(&v, &configured(), &id(), &m.id, 1, true, &p)
            .unwrap_err()
            .contains("identity"));
        assert_eq!(p.calls.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn successful_attempts_keep_budget_reserved_after_restart() {
        let t = Temp::new();
        let v = t.vault();
        let m = v.capture_note(&id(), NOTE).unwrap();
        let p = parser();
        let mut c = configured();
        c.daily_micros = Some(reservation(c.price_micros.unwrap()).unwrap());
        parse_note(&v, &c, &id(), &m.id, 1, true, &p).unwrap();
        let other = v.capture_note(&id(), "Another source").unwrap();
        assert!(parse_note(&t.vault(), &c, &id(), &other.id, 1, true, &p)
            .unwrap_err()
            .contains("budget"));
        assert_eq!(p.calls.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn malformed_date_is_rejected_without_unicode_panics() {
        for value in ["2026-13-01", "2026-01-00", "ééééé", "2026-01-01"] {
            assert_eq!(valid_date(value), value == "2026-01-01");
        }
    }
    #[test]
    fn photo_waits_for_transcription_without_pretending_jev_sees_images() {
        let t = Temp::new();
        let v = t.vault();
        let m = v
            .capture(&id(), "synthetic.png", b"\x89PNG\r\n\x1a\nSYNTHETIC", "")
            .unwrap();
        let p = parser();
        assert_eq!(
            parse_note(&v, &configured(), &id(), &m.id, 1, true, &p)
                .unwrap()
                .state,
            "needs_transcription"
        );
        assert_eq!(p.calls.load(Ordering::SeqCst), 0);
    }
}
