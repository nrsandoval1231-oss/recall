//! Vault-authoritative annotations, separate readings, and immutable evidence.
//! Transport is outside this locked filesystem boundary.
//! Journals and revision records are retained; Markdown publication backups are
//! retained too, so an editor holding the old inode cannot lose its draft.
use crate::local_organization::{
    OrganizationBinding, OrganizationContextCoverage, OrganizationContextExcerpt,
    OrganizationIntent, OrganizationMarker, OrganizationOperation, OrganizationProposal,
    OrganizationReceipt, OrganizationRequest,
};
use crate::reading::Reading;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const FORMAT: &str = "recall-local-vault-v1";
const FORMAT_V2: &str = "recall-local-vault-v2";
const FORMAT_V3: &str = "recall-local-vault-v3";
const FORMAT_V4: &str = "recall-local-vault-v4";
const FORMAT_V5: &str = "recall-local-vault-v5";
const FORMAT_V6: &str = "recall-local-vault-v6";
const FORMAT_V7: &str = "recall-local-vault-v7";
const FORMAT_V8: &str = "recall-local-vault-v8";
const FORMAT_V9: &str = "recall-local-vault-v9";
const MAX_PHOTO: u64 = 25 * 1024 * 1024;
const MAX_NOTE: usize = 256 * 1024;
const MAX_JSON: u64 = 2 * 1024 * 1024;
const MAX_RECORDS: usize = 10_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultStatus {
    pub root: Option<String>,
    pub vault_id: Option<String>,
    #[serde(default)]
    pub vault_identity: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultMemory {
    pub id: String,
    pub revision: u64,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<Reading>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<OrganizationProposal>,
    pub source_sha256: String,
    pub source_name: String,
    pub captured_at: String,
    pub updated_at: String,
    pub conflict: Option<String>,
    pub state: String,
    pub note_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_context: Vec<RelatedMemoryLink>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub context_repair_pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_text: Option<ImportedText>,
    /// Command DTO shape: absent v9 audio fields serialize as null. The on-disk
    /// event projection (`event_memory`) omits them so v1-v8 bytes are unchanged.
    #[serde(default)]
    pub audio_source: Option<AudioSource>,
    #[serde(default)]
    pub audio_transcript: Option<AudioTranscript>,
    /// Validated, unreviewed machine proposals derived from an unreviewed machine
    /// transcript (or a human-corrected one). Null in the command DTO; omitted from
    /// every event that never carried one so earlier bytes are unchanged.
    #[serde(default)]
    pub audio_organization: Option<OrganizationProposal>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ImportedText {
    pub original_name: String,
    pub original_extension: String,
    pub source_media_type: String,
    pub semantic_sha256: String,
    pub semantic_bytes: u64,
    pub semantic_characters: u64,
}
fn is_false(value: &bool) -> bool {
    !value
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RelatedMemoryLink {
    pub target_memory_id: String,
    pub label: String,
    pub source_quote: String,
    pub target_quote: String,
    pub note_basename: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct VaultSource {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct VaultRelatedMemory {
    pub memory_id: String,
    pub revision: u64,
    pub source_sha256: String,
    pub source_name: String,
    pub note_basename: String,
    pub original: VaultSource,
}
/// Current, source-verified text eligible for a local Ask packet. This stays
/// inside the native process; callers must not serialize the ranking text.
#[derive(Clone, Debug)]
pub struct AskCandidate {
    pub memory: VaultMemory,
    pub text: String,
    pub evidence_kind: String,
    pub epistemic_state: String,
    pub alternate_reading: Option<AskEvidenceChoice>,
    pub ranking_text: String,
}
#[derive(Clone, Debug)]
pub struct AskEvidenceChoice {
    pub text: String,
    pub evidence_kind: String,
    pub epistemic_state: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct VaultRevision {
    pub revision: u64,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<Reading>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<OrganizationProposal>,
    pub audio_transcript: Option<AudioTranscript>,
    pub audio_organization: Option<OrganizationProposal>,
    pub recorded_at: String,
    pub origin: String,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct HistoryEvidence {
    pub memory_id: String,
    pub revision: u64,
    pub event_sha256: String,
    pub source_sha256: String,
    pub captured_at: String,
    pub recorded_at: String,
    pub current_revision: u64,
    pub history_status: String,
    pub evidence_kind: String,
    pub epistemic_state: String,
    pub excerpt: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct HistorySelection {
    pub eligible_count: u32,
    pub selected_count: u32,
    pub limited: bool,
    pub truncated_count: u32,
    pub evidence: Vec<HistoryEvidence>,
}
#[derive(Clone, Debug, Serialize)]
pub struct HistoryCitation {
    pub memory_id: String,
    pub revision: u64,
    pub event_sha256: String,
    pub source_sha256: String,
    pub current_revision: u64,
    pub current: bool,
    pub quote: String,
    pub retained_revision: RetainedRevision,
    pub original: VaultSource,
}
#[derive(Clone, Debug, Serialize)]
pub struct RetainedRevision {
    pub revision: u64,
    pub recorded_at: String,
    pub kind: String,
    pub origin: String,
    pub note: String,
    pub reading: Option<Reading>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<OrganizationProposal>,
    pub audio_transcript: Option<AudioTranscript>,
    pub audio_organization: Option<OrganizationProposal>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    vault_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Event {
    format: String,
    vault_id: String,
    operation_id: String,
    kind: String,
    expected_revision: u64,
    payload_sha256: String,
    parent_sha256: Option<String>,
    origin: String,
    #[serde(with = "event_memory")]
    memory: VaultMemory,
    #[serde(
        default,
        deserialize_with = "present_string",
        skip_serializing_if = "Option::is_none"
    )]
    note_path: Option<String>,
    #[serde(
        default,
        deserialize_with = "present_string",
        skip_serializing_if = "Option::is_none"
    )]
    expected_state: Option<String>,
    previous_markdown: Option<String>,
    markdown: String,
    #[serde(
        default,
        deserialize_with = "present_projection",
        skip_serializing_if = "Option::is_none"
    )]
    context_link_projection: Option<Vec<ContextLinkProjection>>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct TextImportIntent {
    format: String,
    vault_id: String,
    operation_id: String,
    original_name: String,
    original_extension: String,
    source_media_type: String,
    source_sha256: String,
    source_bytes: u64,
    semantic_sha256: String,
    semantic_bytes: u64,
    semantic_characters: u64,
    captured_at: String,
    #[serde(default)]
    organization_snapshot: Option<OrganizationMarker>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ContextLinkProjection {
    target_memory_id: String,
    note_basename: String,
    suppressed: bool,
}
fn present_projection<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Vec<ContextLinkProjection>>, D::Error> {
    Vec::<ContextLinkProjection>::deserialize(d).map(Some)
}
// Preserve the exact v1 persisted shape; response-only lifecycle fields never
// enter history. Optional v2 event fields are forbidden on v1 by event_valid.
mod event_memory {
    use super::*;
    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Stored {
        id: String,
        revision: u64,
        note: String,
        #[serde(
            default,
            deserialize_with = "present_reading",
            skip_serializing_if = "Option::is_none"
        )]
        reading: Option<Reading>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization: Option<OrganizationProposal>,
        source_sha256: String,
        source_name: String,
        captured_at: String,
        updated_at: String,
        conflict: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        imported_text: Option<ImportedText>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio_source: Option<AudioSource>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio_transcript: Option<AudioTranscript>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio_organization: Option<OrganizationProposal>,
    }
    fn present_reading<'de, D: serde::Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<Option<Reading>, D::Error> {
        Reading::deserialize(d).map(Some)
    }
    pub fn serialize<S: serde::Serializer>(
        m: &VaultMemory,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        Stored {
            id: m.id.clone(),
            revision: m.revision,
            note: m.note.clone(),
            reading: m.reading.clone(),
            organization: m.organization.clone(),
            source_sha256: m.source_sha256.clone(),
            source_name: m.source_name.clone(),
            captured_at: m.captured_at.clone(),
            updated_at: m.updated_at.clone(),
            conflict: m.conflict.clone(),
            imported_text: m.imported_text.clone(),
            audio_source: m.audio_source.clone(),
            audio_transcript: m.audio_transcript.clone(),
            audio_organization: m.audio_organization.clone(),
        }
        .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<VaultMemory, D::Error> {
        let m = Stored::deserialize(deserializer)?;
        Ok(VaultMemory {
            id: m.id,
            revision: m.revision,
            note: m.note,
            reading: m.reading,
            organization: m.organization,
            source_sha256: m.source_sha256,
            source_name: m.source_name,
            captured_at: m.captured_at,
            updated_at: m.updated_at,
            conflict: m.conflict,
            imported_text: m.imported_text,
            audio_source: m.audio_source,
            audio_transcript: m.audio_transcript,
            audio_organization: m.audio_organization,
            state: "active".into(),
            note_path: None,
            related_context: Vec::new(),
            context_repair_pending: false,
        })
    }
}
fn basename(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 255
        || value.contains(['/', '\\', '\0'])
        || !value.ends_with(".md")
        || Path::new(value).components().count() != 1
    {
        return Err("Unsafe note basename".into());
    }
    Ok(())
}
#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
    pub id: String,
}

// Compiled out entirely outside unit tests; no production fault controls.
macro_rules! boundary {
    ($point:expr, $path:expr) => {{
        #[cfg(test)]
        tests::boundary($point, $path)?;
    }};
}
fn present_string<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
fn fail(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let end = value
        .char_indices()
        .take_while(|(index, character)| index + character.len_utf8() <= max_bytes)
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    value[..end].to_owned()
}
fn id(value: &str) -> Result<()> {
    if Uuid::parse_str(value).map_err(fail)?.to_string() != value {
        return Err("Invalid stable ID".into());
    }
    Ok(())
}
fn note_valid(note: &str) -> Result<()> {
    if note.len() > MAX_NOTE || note.contains('\0') {
        return Err("Note is too large or contains NUL".into());
    }
    Ok(())
}
fn timestamp() -> String {
    // ISO-8601 UTC, using civil-from-days (Gregorian); clocks never choose winners.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let z = (secs / 86400) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    y += i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600 % 24,
        secs / 60 % 60,
        secs % 60
    )
}
fn parse_utc_second(value: &str) -> Option<u64> {
    if value.len() != 20 || !value.ends_with('Z') {
        return None;
    }
    let bytes = value.as_bytes();
    if [4, 7, 10, 13, 16]
        .iter()
        .any(|i| bytes[*i] != b'-' && *i < 10)
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
        || [0..4, 5..7, 8..10, 11..13, 14..16, 17..19]
            .iter()
            .any(|r| !bytes[r.clone()].iter().all(u8::is_ascii_digit))
    {
        return None;
    }
    let year = value[0..4].parse::<i64>().ok()?;
    let month = value[5..7].parse::<i64>().ok()?;
    let day = value[8..10].parse::<i64>().ok()?;
    let hour = value[11..13].parse::<i64>().ok()?;
    let minute = value[14..16].parse::<i64>().ok()?;
    let second = value[17..19].parse::<i64>().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=12).contains(&month)
        || day < 1
        || day > days[(month - 1) as usize]
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    Some(
        days_from_civil(year, month, day) as u64 * 86_400
            + (hour * 3600 + minute * 60 + second) as u64,
    )
}
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
fn utc_second(value: &str) -> Result<u64> {
    parse_utc_second(value).ok_or_else(|| "Invalid UTC timestamp".into())
}
fn validate_history_interval(start: &str, end: &str) -> Result<()> {
    let start = utc_second(start)?;
    let end = utc_second(end)?;
    if end <= start || !(23 * 3600..=25 * 3600).contains(&(end - start)) {
        return Err("History interval must span one local calendar day".into());
    }
    Ok(())
}
fn historical_texts(memory: &VaultMemory) -> Vec<(&str, &'static str, &'static str)> {
    if memory.source_name == "note.txt" || memory.imported_text.is_some() {
        return if memory.note.trim().is_empty() {
            Vec::new()
        } else {
            vec![(&memory.note, "human_note", "reported")]
        };
    }
    if memory.audio_source.is_some() {
        let mut candidates = Vec::new();
        if !memory.note.trim().is_empty() {
            candidates.push((&memory.note[..], "human_note", "reported"));
        }
        if let Some(spoken) = audio_current_text(memory) {
            candidates.push(spoken);
        }
        return candidates;
    }
    let mut candidates = Vec::new();
    if !memory.note.trim().is_empty() {
        candidates.push((&memory.note[..], "human_note", "reported"));
    }
    if let Some(reading) = memory.reading.as_ref() {
        if reading.machine.validate().is_ok() {
            let text = reading.effective_text();
            if !text.trim().is_empty() {
                if reading.human_correction.is_some() {
                    candidates.push((text, "human_reading_correction", "reported"));
                } else {
                    candidates.push((text, "machine_reading", "unreviewed"));
                }
            }
        }
    }
    // Organization is a separate unreviewed Ask alternative. A human
    // correction, including an intentionally empty one, suppresses this
    // machine proposal just as it suppresses the current projection.
    if !memory
        .reading
        .as_ref()
        .is_some_and(|reading| reading.human_correction.is_some())
    {
        if let Some(organization) = memory
            .organization
            .as_ref()
            .filter(|o| !o.suppressed && o.review_state == "unreviewed")
        {
            if let Some(text) = organization.result.extraction["pages"][0]["transcription"]
                .as_str()
                .filter(|text| !text.trim().is_empty())
            {
                candidates.push((text, "organization_proposal", "unreviewed"));
            }
        }
    }
    candidates
}
fn historical_text<'a>(
    memory: &'a VaultMemory,
    terms: &[String],
) -> Option<(&'a str, &'static str, &'static str)> {
    let mut selected = None;
    let mut best_score = 0;
    for candidate in historical_texts(memory) {
        let score = terms
            .iter()
            .filter(|term| candidate.0.to_lowercase().contains(term.as_str()))
            .count();
        if selected.is_none() || score > best_score {
            selected = Some(candidate);
            best_score = score;
        }
    }
    selected
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HistoricalTransition {
    Unchanged,
    HumanCorrected,
    HumanSuppressed,
    MachineReprocessed,
    SuppressedWithoutCounterpart,
}

fn historical_lane<'a>(
    memory: &'a VaultMemory,
    kind: &str,
) -> Option<(&'a str, &'static str, &'static str)> {
    historical_texts(memory)
        .into_iter()
        .find(|(_, candidate_kind, _)| *candidate_kind == kind)
}

// The event kind is the authority for whether a person corrected a lane. Text
// equality alone cannot turn an annotation or a machine reread into a human
// correction of a transcription.
fn historical_transition(
    records: &[(Event, String)],
    revision: u64,
    selected_kind: &str,
    selected_text: &str,
) -> HistoricalTransition {
    let Some((current, _)) = records.last() else {
        return HistoricalTransition::SuppressedWithoutCounterpart;
    };
    let later = records
        .iter()
        .filter(|(event, _)| event.memory.revision > revision);
    match selected_kind {
        "human_note" => {
            let changed_by_human = later.clone().any(|(event, _)| {
                ["correct", "external"].contains(&event.kind.as_str())
                    && event.origin.starts_with("human:")
            });
            let Some((text, _, _)) = historical_lane(&current.memory, selected_kind) else {
                return if changed_by_human {
                    HistoricalTransition::HumanSuppressed
                } else {
                    HistoricalTransition::SuppressedWithoutCounterpart
                };
            };
            if changed_by_human && text != selected_text {
                HistoricalTransition::HumanCorrected
            } else {
                HistoricalTransition::Unchanged
            }
        }
        "human_reading_correction" => {
            let changed_by_human = later.clone().any(|(event, _)| {
                event.kind == "reading_correction" && event.origin.starts_with("human:")
            });
            let Some((text, _, _)) = historical_lane(&current.memory, selected_kind) else {
                return if changed_by_human {
                    HistoricalTransition::HumanSuppressed
                } else {
                    HistoricalTransition::SuppressedWithoutCounterpart
                };
            };
            if changed_by_human && text != selected_text {
                HistoricalTransition::HumanCorrected
            } else {
                HistoricalTransition::Unchanged
            }
        }
        "human_audio_correction" => {
            let changed_by_human = later.clone().any(|(event, _)| {
                event.kind == "audio_transcript_correction" && event.origin.starts_with("human:")
            });
            let Some((text, _, _)) = historical_lane(&current.memory, selected_kind) else {
                return if changed_by_human {
                    HistoricalTransition::HumanSuppressed
                } else {
                    HistoricalTransition::SuppressedWithoutCounterpart
                };
            };
            if changed_by_human && text != selected_text {
                HistoricalTransition::HumanCorrected
            } else {
                HistoricalTransition::Unchanged
            }
        }
        "machine_audio_transcript" => {
            let corrected = later.clone().any(|(event, _)| {
                event.kind == "audio_transcript_correction" && event.origin.starts_with("human:")
            });
            if corrected {
                return match historical_lane(&current.memory, "human_audio_correction") {
                    Some((text, _, _)) if !text.trim().is_empty() => {
                        HistoricalTransition::HumanCorrected
                    }
                    _ => HistoricalTransition::HumanSuppressed,
                };
            }
            match historical_lane(&current.memory, selected_kind) {
                Some((text, _, _)) if text != selected_text => {
                    HistoricalTransition::MachineReprocessed
                }
                Some(_) => HistoricalTransition::Unchanged,
                None => HistoricalTransition::SuppressedWithoutCounterpart,
            }
        }
        "machine_reading" | "organization_proposal" => {
            let reading_correction = later.clone().any(|(event, _)| {
                event.kind == "reading_correction" && event.origin.starts_with("human:")
            });
            if reading_correction {
                return match historical_lane(&current.memory, "human_reading_correction") {
                    Some((text, _, _)) if !text.trim().is_empty() => {
                        HistoricalTransition::HumanCorrected
                    }
                    _ => HistoricalTransition::HumanSuppressed,
                };
            }
            if selected_kind == "organization_proposal"
                && later.clone().any(|(event, _)| {
                    ["correct", "external"].contains(&event.kind.as_str())
                        && event.origin.starts_with("human:")
                })
            {
                return HistoricalTransition::SuppressedWithoutCounterpart;
            }
            match historical_lane(&current.memory, selected_kind) {
                Some((text, _, _)) if text != selected_text => {
                    HistoricalTransition::MachineReprocessed
                }
                Some(_) => HistoricalTransition::Unchanged,
                None => HistoricalTransition::SuppressedWithoutCounterpart,
            }
        }
        _ => HistoricalTransition::SuppressedWithoutCounterpart,
    }
}

fn historical_counterpart_text<'a>(
    memory: &'a VaultMemory,
    selected_kind: &str,
    transition: HistoricalTransition,
) -> Option<(&'a str, &'static str, &'static str)> {
    match transition {
        HistoricalTransition::HumanCorrected => match selected_kind {
            "human_note" => historical_lane(memory, "human_note"),
            "human_reading_correction" | "machine_reading" | "organization_proposal" => {
                historical_lane(memory, "human_reading_correction")
            }
            "human_audio_correction" | "machine_audio_transcript" => {
                historical_lane(memory, "human_audio_correction")
            }
            _ => None,
        },
        HistoricalTransition::Unchanged | HistoricalTransition::MachineReprocessed => {
            historical_lane(memory, selected_kind)
        }
        HistoricalTransition::HumanSuppressed
        | HistoricalTransition::SuppressedWithoutCounterpart => None,
    }
}
fn truncate_query_excerpt(text: &str, terms: &[String], max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let lower = text.to_lowercase();
    let mut start = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0)
        .saturating_sub(max / 3);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    let mut end = (start + max).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[start..end].to_owned()
}
fn reparse(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
/// Refuse links in every component, including the selected root's ancestors.
fn safe(path: &Path) -> Result<()> {
    let mut checked = PathBuf::new();
    for c in path.components() {
        if matches!(c, Component::ParentDir | Component::CurDir) {
            return Err("Unsafe path".into());
        }
        checked.push(c);
        match fs::symlink_metadata(&checked) {
            Ok(m) if reparse(&m) => return Err("Symlink or reparse point is not allowed".into()),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(fail(e)),
        }
    }
    Ok(())
}
fn read(path: &Path, max: u64) -> Result<Vec<u8>> {
    safe(path)?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(0x20000);
    }
    let f = opts.open(path).map_err(fail)?;
    let m = f.metadata().map_err(fail)?;
    if !m.is_file() || m.len() > max {
        return Err("Invalid file or size limit exceeded".into());
    }
    let mut bytes = Vec::new();
    f.take(max + 1).read_to_end(&mut bytes).map_err(fail)?;
    if bytes.len() as u64 > max {
        return Err("File exceeds size limit".into());
    }
    Ok(bytes)
}
/// Inspect only the stable identity header of neighbors. Their size/content is
/// validated independently when reading that memory, never charged to this one.
fn identity_prefix(path: &Path, len: usize) -> Result<Vec<u8>> {
    safe(path)?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(0x20000);
    }
    let file = opts.open(path).map_err(fail)?;
    if !file.metadata().map_err(fail)?.is_file() {
        return Err("Invalid note file".into());
    }
    let mut bytes = Vec::with_capacity(len);
    file.take(len as u64)
        .read_to_end(&mut bytes)
        .map_err(fail)?;
    Ok(bytes)
}
fn identity_matches(path: &Path, memory_id: &str, marker: &str) -> bool {
    let Ok(prefix) = identity_prefix(path, 2048) else {
        return false;
    };
    if prefix.starts_with(marker.as_bytes()) {
        return true;
    }
    let Some(header) = prefix.strip_prefix(b"---\n") else {
        return false;
    };
    let Some(end) = header.windows(5).position(|w| w == b"\n---\n") else {
        return false;
    };
    let frontmatter = &header[..end];
    let id_line = format!("id: {}", yaml(memory_id));
    if frontmatter.split(|b| *b == b'\n').next() != Some(id_line.as_bytes()) {
        return false;
    }
    let body = &header[end + 5..];
    let expected = format!("\n<!-- Recall memory {memory_id} | ");
    body.starts_with(expected.as_bytes())
}
fn sync_dir(path: &Path) -> Result<()> {
    safe(path)?;
    #[cfg(unix)]
    {
        File::open(path).map_err(fail)?.sync_all().map_err(fail)?;
    }
    // Windows publication uses write-through MoveFileEx; file data is flushed first.
    Ok(())
}
fn create(path: &Path, bytes: &[u8]) -> Result<()> {
    boundary!("create_before", path);
    safe(path)?;
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(fail)?;
    f.write_all(bytes).map_err(fail)?;
    boundary!("write_after", path);
    boundary!("sync_before", path);
    f.sync_all().map_err(fail)?;
    boundary!("sync_after", path);
    sync_dir(path.parent().ok_or("No parent")?)
}
fn immutable(path: &Path, bytes: &[u8]) -> Result<()> {
    if path.try_exists().map_err(fail)? {
        if read(path, bytes.len() as u64)? != bytes {
            return Err("Immutable file mismatch; recovery required".into());
        }
        Ok(())
    } else {
        atomic_new(path, bytes)
    }
}
fn rename(from: &Path, to: &Path) -> Result<()> {
    boundary!("rename_before", from);
    safe(from)?;
    safe(to)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Plain Unix rename replaces an intervening editor-created backup.
        // RENAME_NOREPLACE makes that precondition atomic with publication.
        use std::os::unix::ffi::OsStrExt;
        unsafe extern "C" {
            fn renameat2(
                old_dir: i32,
                old: *const std::ffi::c_char,
                new_dir: i32,
                new: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        let a = std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(fail)?;
        let b = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(fail)?;
        if unsafe { renameat2(-100, a.as_ptr(), -100, b.as_ptr(), 1) } != 0 {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(all(not(windows), not(target_os = "linux")))]
    return Err("Atomic no-replace rename is unsupported on this platform".into());
    boundary!("rename_after", to);
    sync_dir(from.parent().ok_or("No parent")?)?;
    sync_dir(to.parent().ok_or("No parent")?)
}
fn replace(from: &Path, to: &Path) -> Result<()> {
    safe(from)?;
    safe(to)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                a.as_ptr(),
                b.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(fail)?;
    sync_dir(to.parent().ok_or("No parent")?)
}
/// Stage + hard-link publishes an entire immutable file without replacing a destination.
fn atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("stage-{}", Uuid::new_v4()));
    create(&tmp, bytes)?;
    safe(path)?;
    boundary!("publish_before", path);
    fs::hard_link(&tmp, path).map_err(fail)?;
    boundary!("publish_after", path);
    sync_dir(path.parent().ok_or("No parent")?)?;
    boundary!("cleanup_before", path);
    fs::remove_file(&tmp).map_err(fail)?;
    boundary!("cleanup_after", path);
    sync_dir(path.parent().ok_or("No parent")?)
}
fn json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(fail)
}
fn decode<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T> {
    serde_json::from_slice(&read(path, MAX_JSON)?).map_err(fail)
}
fn entries(path: &Path) -> Result<Vec<PathBuf>> {
    safe(path)?;
    let mut out = Vec::new();
    for e in fs::read_dir(path).map_err(fail)? {
        out.push(e.map_err(fail)?.path());
        if out.len() > MAX_RECORDS {
            return Err("Vault exceeds record limit".into());
        }
    }
    out.sort();
    Ok(out)
}
fn image_type(bytes: &[u8]) -> Result<&'static str> {
    if bytes.len() as u64 > MAX_PHOTO {
        return Err("Photo exceeds 25 MiB limit".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9") {
        Ok("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("image/webp")
    } else {
        Err("Choose a PNG, JPEG or WebP photo with a valid signature".into())
    }
}
fn safe_import_name(name: &str) -> Result<String> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0'])
        || Path::new(name).components().count() != 1
    {
        return Err("Invalid text filename".into());
    }
    let extension = name.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    if extension.eq_ignore_ascii_case("txt") {
        Ok(extension.to_owned())
    } else if extension.eq_ignore_ascii_case("md") {
        Ok(extension.to_owned())
    } else {
        Err("Choose one .txt or .md file".into())
    }
}
fn read_import(path: &Path) -> Result<(String, String, Vec<u8>, String, String)> {
    let before = fs::symlink_metadata(path).map_err(fail)?;
    if !before.is_file() || before.file_type().is_symlink() || before.len() > MAX_NOTE as u64 {
        return Err("Text file must be a regular file no larger than 256 KiB".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if before.file_attributes() & 0x400 != 0 {
            return Err("Text file reparse points are not supported".into());
        }
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid text filename")?
        .to_owned();
    let extension = safe_import_name(&name)?;
    let mut file = File::open(path).map_err(fail)?;
    let opened = file.metadata().map_err(fail)?;
    if !same_file(&before, &opened) {
        return Err("Text file changed while it was being imported".into());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file)
        .take(MAX_NOTE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(fail)?;
    file.seek(SeekFrom::Start(0)).map_err(fail)?;
    let mut confirmation = Vec::with_capacity(bytes.len());
    (&mut file)
        .take(MAX_NOTE as u64 + 1)
        .read_to_end(&mut confirmation)
        .map_err(fail)?;
    let opened_after = file.metadata().map_err(fail)?;
    let after = fs::symlink_metadata(path).map_err(fail)?;
    if bytes.len() > MAX_NOTE
        || bytes.len() as u64 != before.len()
        || confirmation != bytes
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || before.modified().ok() != opened_after.modified().ok()
        || before.len() != opened_after.len()
        || before.file_type().is_symlink()
        || !same_file(&before, &after)
        || !same_file(&opened, &opened_after)
    {
        return Err("Text file changed while it was being imported".into());
    }
    let raw = std::str::from_utf8(&bytes).map_err(|_| "Text file must be valid UTF-8")?;
    if raw.contains('\0') {
        return Err("Text file contains NUL".into());
    }
    let semantic = raw.strip_prefix('\u{feff}').unwrap_or(raw).to_owned();
    if semantic.trim().is_empty() {
        return Err("Text file cannot be empty or whitespace only".into());
    }
    let semantic_hash = hash(semantic.as_bytes());
    Ok((name, extension, bytes, semantic, semantic_hash))
}
#[cfg(windows)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    a.file_attributes() == b.file_attributes()
}
#[cfg(unix)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}
#[cfg(not(any(windows, unix)))]
fn same_file(_: &fs::Metadata, _: &fs::Metadata) -> bool {
    true
}
fn markdown_v1_v3(m: &VaultMemory) -> String {
    let base = format!("<!-- Recall memory {} | human annotation, not OCR -->\n[Original photo](../Sources/{}.{})\n\n",m.id,m.id,m.source_name.rsplit('.').next().unwrap_or("png"));
    let Some(reading) = &m.reading else {
        return format!("{base}{}", m.note);
    };
    fn literal(s: &str) -> String {
        s.lines().map(|line| format!("    {line}\n")).collect()
    }
    let machine = &reading.machine;
    let mut out = format!("{base}## Unreviewed machine reading\n\n{}\nProvider and model:\n\n{}\nOriginal SHA-256:\n\n{}\n", literal(machine.transcription()), literal(&format!("{} / {}",machine.result.provider,machine.result.model_id)),literal(&machine.request.binding.source_sha256));
    out.push_str("### Reading uncertainty\n\n");
    if let Some(uncertainties) = machine.result.extraction["uncertainties"].as_array() {
        for u in uncertainties {
            out.push_str(&literal(u["description"].as_str().unwrap_or("")));
        }
    }
    if let Some(human) = &reading.human_correction {
        out.push_str(&format!(
            "\n## Human reading correction\n\n{}",
            literal(human)
        ));
    }
    out.push_str(&format!("\n## Human annotation\n\n{}", m.note));
    out
}
fn yaml(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}
fn md_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(
            ch,
            '\\' | '`'
                | '*'
                | '_'
                | '{'
                | '}'
                | '['
                | ']'
                | '('
                | ')'
                | '#'
                | '+'
                | '-'
                | '.'
                | '='
                | '!'
                | '|'
        ) {
            out.push('\\');
        }
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}
fn structured_search_text(m: &VaultMemory, require_summary_evidence: bool) -> String {
    let Some(reading) = &m.reading else {
        return String::new();
    };
    if reading.human_correction.is_some() {
        return String::new();
    }
    let ex = &reading.machine.result.extraction;
    let mut fields = Vec::new();
    if !require_summary_evidence
        || ex["summary_evidence"]
            .as_array()
            .is_some_and(|evidence| !evidence.is_empty())
    {
        if let Some(summary) = ex["summary"].as_str() {
            fields.push(summary.to_owned());
        }
    }
    let mention_names: BTreeMap<&str, &str> = ex["mentions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|mention| Some((mention["local_id"].as_str()?, mention["raw_text"].as_str()?)))
        .collect();
    for group in [
        "mentions",
        "statements",
        "action_suggestions",
        "uncertainties",
        "summary_evidence",
    ] {
        if let Some(items) = ex[group].as_array() {
            for item in items {
                for field in [
                    "raw_text",
                    "text",
                    "description",
                    "quote",
                    "value_text",
                    "attribution_text",
                    "temporal_text",
                    "due_text",
                ] {
                    if let Some(s) = item[field].as_str() {
                        fields.push(s.to_owned());
                    }
                }
                if let Some(name) =
                    mention_names.get(item["assignee_mention_id"].as_str().unwrap_or(""))
                {
                    fields.push((*name).to_owned());
                }
                for field in ["subject_mention_id", "object_mention_id"] {
                    if let Some(name) = mention_names.get(item[field].as_str().unwrap_or("")) {
                        fields.push((*name).to_owned());
                    }
                }
                if let Some(evidence) = item["evidence"].as_array() {
                    for ev in evidence {
                        if let Some(s) = ev["quote"].as_str() {
                            fields.push(s.to_owned());
                        }
                    }
                }
            }
        }
    }
    fields.join(" ")
}
fn v4_markdown(m: &VaultMemory) -> String {
    let ext = m.source_name.rsplit('.').next().unwrap_or("png");
    let source = format!("../Sources/{}.{}", m.id, ext);
    let source_property = format!("[[Recall/Sources/{}.{}]]", m.id, ext);
    let review = match m.reading.as_ref() {
        None => "not_read",
        Some(r) if r.human_correction.is_some() => "corrected",
        Some(_) => "unreviewed",
    };
    let mut out = format!("---\nid: {}\nstatus: {}\ncaptured: {}\nsource: {}\nreview: {}\n---\n\n<!-- Recall memory {} | human annotation, not OCR -->\n[Original photo]({source})\n\n", yaml(&m.id), yaml("saved"), yaml(&m.captured_at), yaml(&source_property), yaml(review), m.id);
    match review {
        "unreviewed" => {
            out.push_str("> Machine interpretation is unreviewed and source-bound.\n\n")
        }
        "corrected" => out.push_str(
            "> Human reading correction is current; stale machine organization is suppressed.\n\n",
        ),
        _ => out.push_str("> No machine reading has been run.\n\n"),
    }
    out.push_str("## Summary\n\n");
    let reading = m.reading.as_ref();
    let corrected = reading.and_then(|r| r.human_correction.as_ref());
    let ex = reading.map(|r| &r.machine.result.extraction);
    if let Some(human) = corrected {
        out.push_str(
            &md_text(human)
                .lines()
                .map(|line| format!("{line}\n"))
                .collect::<String>(),
        );
    } else if let Some(summary) = ex
        .and_then(|e| e["summary"].as_str())
        .filter(|s| !s.is_empty())
        .filter(|_| {
            ex.and_then(|e| e["summary_evidence"].as_array())
                .is_some_and(|evidence| !evidence.is_empty())
        })
    {
        out.push_str(&md_text(summary));
        out.push_str("\n");
    } else if let Some(transcription) = reading
        .map(|r| r.machine.transcription())
        .filter(|s| !s.is_empty())
    {
        out.push_str(&md_text(transcription));
        out.push_str("\n");
    }
    if let Some(reading) = reading.filter(|_| corrected.is_none()) {
        out.push_str("\n## Source transcription\n\n");
        out.push_str(&md_text(reading.machine.transcription()));
        out.push_str("\n");
        out.push_str(&format!(
            "\nProvider: {}  \nModel: {}  \nSource SHA-256: `{}`\n",
            md_text(&reading.machine.result.provider),
            md_text(&reading.machine.result.model_id),
            reading.machine.request.binding.source_sha256
        ));
    }
    if let Some(ex) = ex.filter(|_| corrected.is_none()) {
        if let Some(evidence) = ex["summary_evidence"].as_array() {
            if !evidence.is_empty() {
                out.push_str("\nSummary evidence:\n\n");
                for ev in evidence {
                    if let Some(quote) = ev["quote"].as_str() {
                        out.push_str(&format!("- [“{}”]({source})\n", md_text(quote)));
                    }
                }
            }
        }
        let mention_names: BTreeMap<&str, &str> = ex["mentions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|mention| {
                Some((mention["local_id"].as_str()?, mention["raw_text"].as_str()?))
            })
            .collect();
        if let Some(mentions) = ex["mentions"].as_array().filter(|a| !a.is_empty()) {
            out.push_str("\n## Mentions\n\n");
            for mention in mentions {
                if let Some(raw) = mention["raw_text"].as_str() {
                    out.push_str(&format!(
                        "- {} ({})\n",
                        md_text(raw),
                        mention["kind"].as_str().unwrap_or("topic")
                    ));
                }
                for ev in mention["evidence"].as_array().into_iter().flatten() {
                    if let Some(quote) = ev["quote"].as_str() {
                        out.push_str(&format!("  - Source: [“{}”]({source})\n", md_text(quote)));
                    }
                }
            }
        }
        if let Some(statements) = ex["statements"].as_array().filter(|a| !a.is_empty()) {
            out.push_str("\n## Statements\n\n");
            for item in statements {
                if let Some(text) = item["text"].as_str() {
                    out.push_str(&format!(
                        "- {} — {}\n",
                        md_text(text),
                        item["epistemic_state"].as_str().unwrap_or("uncertain")
                    ));
                }
                for (label, field) in [
                    ("Value", "value_text"),
                    ("Attribution", "attribution_text"),
                    ("When", "temporal_text"),
                ] {
                    if let Some(value) = item[field].as_str().filter(|s| !s.is_empty()) {
                        out.push_str(&format!("  - {label}: {}\n", md_text(value)));
                    }
                }
                for (label, field) in [
                    ("Subject mentioned", "subject_mention_id"),
                    ("Object mentioned", "object_mention_id"),
                ] {
                    if let Some(name) = mention_names.get(item[field].as_str().unwrap_or("")) {
                        out.push_str(&format!("  - {label}: {}\n", md_text(name)));
                    }
                }
                for ev in item["evidence"].as_array().into_iter().flatten() {
                    if let Some(quote) = ev["quote"].as_str() {
                        out.push_str(&format!("  - Source: [“{}”]({source})\n", md_text(quote)));
                    }
                }
            }
        }
        if let Some(actions) = ex["action_suggestions"]
            .as_array()
            .filter(|a| !a.is_empty())
        {
            out.push_str("\n## Suggested actions\n\n");
            for item in actions {
                if let Some(text) = item["text"].as_str() {
                    out.push_str(&format!("- {}\n", md_text(text)));
                }
                if let Some(due) = item["due_text"].as_str().filter(|s| !s.is_empty()) {
                    out.push_str(&format!("  - Due: {}\n", md_text(due)));
                }
                if let Some(name) =
                    mention_names.get(item["assignee_mention_id"].as_str().unwrap_or(""))
                {
                    out.push_str(&format!(
                        "  - Assigned to mentioned person: {}\n",
                        md_text(name)
                    ));
                }
                for ev in item["evidence"].as_array().into_iter().flatten() {
                    if let Some(quote) = ev["quote"].as_str() {
                        out.push_str(&format!("  - Source: [“{}”]({source})\n", md_text(quote)));
                    }
                }
            }
        }
        if let Some(uncertainties) = ex["uncertainties"].as_array().filter(|a| !a.is_empty()) {
            out.push_str("\n## Uncertainties\n\n");
            for item in uncertainties {
                if let Some(text) = item["description"].as_str() {
                    out.push_str(&format!("- {}\n", md_text(text)));
                }
                for ev in item["evidence"].as_array().into_iter().flatten() {
                    if let Some(quote) = ev["quote"].as_str() {
                        out.push_str(&format!(
                            "  - Uncertainty evidence, not fact support: [“{}”]({source})\n",
                            md_text(quote)
                        ));
                    }
                }
            }
        }
    }
    out.push_str(&format!("\n## Human annotation\n\n{}", m.note));
    out
}
fn v5_markdown(m: &VaultMemory) -> String {
    if m.source_name == "note.txt" {
        return format!(
            "---\nid: {}\nstatus: {}\ncaptured: {}\nsource: {}\nreview: not_read\n---\n\n<!-- Recall memory {} | human annotation -->\n[Original text](../Sources/{}.txt)\n\n## Human annotation\n\n{}",
            yaml(&m.id), yaml("saved"), yaml(&m.captured_at),
            yaml(&format!("[[Recall/Sources/{}.txt]]", m.id)), m.id, m.id, m.note
        );
    }
    // Preserve the v4 photo renderer byte-for-byte for the new format.
    v4_markdown(m)
}
fn markdown_text(value: &str) -> String {
    md_text(&value.replace('\r', " ").replace('\n', " "))
}
fn v6_markdown(m: &VaultMemory) -> String {
    let Some(org) = m.organization.as_ref().filter(|o| {
        !o.suppressed
            && o.review_state == "unreviewed"
            && o.binding.input_sha256
                == if o.binding.source_kind == "text" {
                    hash(m.note.as_bytes())
                } else {
                    o.binding.source_sha256.clone()
                }
    }) else {
        return v5_markdown(m);
    };
    let source = if org.binding.source_kind == "text" {
        "txt"
    } else {
        match m.source_name.rsplit('.').next().unwrap_or("") {
            "png" => "png",
            "jpg" => "jpg",
            "webp" => "webp",
            _ => "bin",
        }
    };
    let evidence_target = if org.binding.source_kind == "text"
        && org.binding.input_sha256 != org.binding.source_sha256
        && m.imported_text.is_none()
    {
        "#human-annotation".to_owned()
    } else {
        format!("../Sources/{}.{}", m.id, source)
    };
    let mut out = format!(
        "---\nid: {}\nstatus: {}\ncaptured: {}\nsource: {}\norganization: unreviewed\n---\n\n<!-- Recall memory {} | generated organization -->\n",
        yaml(&m.id), yaml("saved"), yaml(&m.captured_at), yaml(&format!("[[Recall/Sources/{}.{}]]", m.id, source)), m.id
    );
    let extraction = &org.result.extraction;
    if let Some(summary) = extraction["summary"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
    {
        out.push_str(&format!("\n## Summary\n\n{}\n", markdown_text(summary)));
        if let Some(evidence) = extraction["summary_evidence"].as_array() {
            for item in evidence {
                if let Some(quote) = item["quote"].as_str() {
                    out.push_str(&format!(
                        "\n> {}\n> — [source excerpt]({}), unreviewed\n",
                        markdown_text(quote),
                        evidence_target
                    ));
                }
            }
        }
    }
    let mention_names: BTreeMap<&str, &str> = extraction["mentions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|mention| Some((mention["local_id"].as_str()?, mention["raw_text"].as_str()?)))
        .collect();
    if let Some(mentions) = extraction["mentions"]
        .as_array()
        .filter(|items| !items.is_empty())
    {
        out.push_str("\n## Mentions (unreviewed)\n");
        for item in mentions {
            let Some(raw) = item["raw_text"].as_str() else {
                continue;
            };
            out.push_str(&format!(
                "\n- {} ({}, unreviewed)\n",
                markdown_text(raw),
                markdown_text(item["kind"].as_str().unwrap_or("topic"))
            ));
            for evidence in item["evidence"].as_array().into_iter().flatten() {
                if let Some(quote) = evidence["quote"].as_str() {
                    out.push_str(&format!(
                        "  - Source excerpt: [“{}”]({}), unreviewed\n",
                        markdown_text(quote),
                        evidence_target
                    ));
                }
            }
        }
    }
    if let Some(statements) = extraction["statements"]
        .as_array()
        .filter(|items| !items.is_empty())
    {
        out.push_str("\n## Statements (unreviewed)\n");
        for item in statements {
            if let Some(text) = item["text"].as_str() {
                out.push_str(&format!(
                    "\n- {} — {} ({}; unreviewed)\n",
                    markdown_text(text),
                    markdown_text(item["epistemic_state"].as_str().unwrap_or("uncertain")),
                    markdown_text(item["kind"].as_str().unwrap_or("claim"))
                ));
            }
            if let Some(predicate) = item["predicate"].as_str().filter(|v| !v.is_empty()) {
                out.push_str(&format!("  - Predicate: {}\n", markdown_text(predicate)));
            }
            for (label, field) in [
                ("Value", "value_text"),
                ("Attribution", "attribution_text"),
                ("When", "temporal_text"),
            ] {
                if let Some(value) = item[field].as_str().filter(|v| !v.is_empty()) {
                    out.push_str(&format!("  - {label}: {}\n", markdown_text(value)));
                }
            }
            for (label, field) in [
                ("Subject mentioned", "subject_mention_id"),
                ("Object mentioned", "object_mention_id"),
            ] {
                if let Some(name) = mention_names.get(item[field].as_str().unwrap_or("")) {
                    out.push_str(&format!("  - {label}: {}\n", markdown_text(name)));
                }
            }
            for evidence in item["evidence"].as_array().into_iter().flatten() {
                if let Some(quote) = evidence["quote"].as_str() {
                    out.push_str(&format!(
                        "  - Source excerpt: [“{}”]({}), unreviewed\n",
                        markdown_text(quote),
                        evidence_target
                    ));
                }
            }
        }
    }
    if let Some(actions) = extraction["action_suggestions"]
        .as_array()
        .filter(|items| !items.is_empty())
    {
        out.push_str("\n## Suggested actions (unreviewed)\n");
        for item in actions {
            if let Some(text) = item["text"].as_str() {
                out.push_str(&format!(
                    "\n- {} ({}, unreviewed)\n",
                    markdown_text(text),
                    markdown_text(item["kind"].as_str().unwrap_or("action"))
                ));
            }
            if let Some(due) = item["due_text"].as_str().filter(|v| !v.is_empty()) {
                out.push_str(&format!("  - Due: {}\n", markdown_text(due)));
            }
            if let Some(name) =
                mention_names.get(item["assignee_mention_id"].as_str().unwrap_or(""))
            {
                out.push_str(&format!(
                    "  - Assigned to mentioned person: {}\n",
                    markdown_text(name)
                ));
            }
            for evidence in item["evidence"].as_array().into_iter().flatten() {
                if let Some(quote) = evidence["quote"].as_str() {
                    out.push_str(&format!(
                        "  - Source excerpt: [“{}”]({}), unreviewed\n",
                        markdown_text(quote),
                        evidence_target
                    ));
                }
            }
        }
    }
    if let Some(uncertainties) = extraction["uncertainties"]
        .as_array()
        .filter(|items| !items.is_empty())
    {
        out.push_str("\n## Uncertainties (unreviewed)\n");
        for item in uncertainties {
            if let Some(description) = item["description"].as_str() {
                out.push_str(&format!(
                    "\n- {} ({}, unreviewed)\n",
                    markdown_text(description),
                    markdown_text(item["kind"].as_str().unwrap_or("other"))
                ));
            }
            for evidence in item["evidence"].as_array().into_iter().flatten() {
                if let Some(quote) = evidence["quote"].as_str() {
                    out.push_str(&format!(
                        "  - Uncertainty source, not fact support: [“{}”]({}), unreviewed\n",
                        markdown_text(quote),
                        evidence_target
                    ));
                }
            }
        }
    }
    out.push_str(&format!("\n<!-- Recall memory {} | human annotation -->\n[Original {}](../Sources/{}.{})\n\n## Human annotation\n\n{}", m.id, if source=="txt" {"text"} else {"photo"}, m.id, source, m.note));
    out
}
fn markdown_for(format: &str, m: &VaultMemory) -> String {
    match format {
        FORMAT_V4 => v4_markdown(m),
        FORMAT_V5 => v5_markdown(m),
        FORMAT_V6 => v6_markdown(m),
        FORMAT_V7 => v6_markdown(m),
        FORMAT_V8 if m.imported_text.is_some() => {
            let mut render = m.clone();
            render.source_name = "note.txt".into();
            render.note.clear();
            v8_imported_markdown(m, v6_markdown(&render))
        }
        FORMAT_V8 => v6_markdown(m),
        FORMAT_V9 if m.audio_source.is_some() => audio_markdown(m),
        FORMAT_V9 if m.imported_text.is_some() => {
            let mut render = m.clone();
            render.source_name = "note.txt".into();
            render.note.clear();
            v8_imported_markdown(m, v6_markdown(&render))
        }
        FORMAT_V9 => v6_markdown(m),
        _ => markdown_v1_v3(m),
    }
}
fn markdown_for_event(e: &Event) -> Result<String> {
    if e.format == FORMAT_V9 && e.memory.audio_source.is_some() {
        e.context_link_projection
            .as_deref()
            .ok_or("Missing v9 context link projection")?;
        return Ok(audio_markdown(&e.memory));
    }
    if [FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()) {
        let mut render_memory = e.memory.clone();
        if [FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
            && render_memory.imported_text.is_some()
        {
            render_memory.source_name = "note.txt".into();
            render_memory.note.clear();
        }
        let mut rendered = v7_markdown(
            &render_memory,
            e.context_link_projection
                .as_deref()
                .ok_or("Missing v7 context link projection")?,
        )?;
        if [FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()) && e.memory.imported_text.is_some() {
            rendered = v8_imported_markdown(&e.memory, rendered);
        }
        Ok(rendered)
    } else {
        Ok(markdown_for(&e.format, &e.memory))
    }
}
fn v8_imported_markdown(memory: &VaultMemory, output: String) -> String {
    let annotation = "## Human annotation\n\n";
    let Some(prefix) = output.strip_suffix(annotation) else {
        return output;
    };
    let captured = memory
        .imported_text
        .as_ref()
        .is_some_and(|meta| hash(memory.note.as_bytes()) == meta.semantic_sha256);
    let region = if captured {
        let source = memory
            .note
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        format!("## Imported text (inert)\n\n<pre>{source}</pre>\n\n")
    } else {
        format!(
            "## Imported text (inert)\n\n[Open original text](../Sources/{}.txt)\n\n",
            memory.id
        )
    };
    format!(
        "{prefix}{region}<!-- Recall imported annotation boundary -->\n\n{annotation}{}",
        if captured { "" } else { &memory.note }
    )
}
fn v7_markdown(memory: &VaultMemory, projection: &[ContextLinkProjection]) -> Result<String> {
    let mut output = v6_markdown(memory);
    let links = memory
        .organization
        .as_ref()
        .filter(|proposal| !proposal.suppressed && proposal.review_state == "unreviewed")
        .and_then(|proposal| proposal.result.related_context.as_ref())
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if links.is_empty() || projection.iter().all(|entry| entry.suppressed) {
        return Ok(output);
    }
    if links.len() != projection.len() {
        return Err("v7 context projection does not match its proposal".into());
    }
    let marker = format!("<!-- Recall memory {} | human annotation -->", memory.id);
    let insertion = output
        .find(&marker)
        .ok_or("Missing v7 annotation boundary")?;
    let mut block = String::from("## Related memory\n");
    for (link, entry) in links.iter().zip(projection) {
        if entry.suppressed {
            continue;
        }
        block.push_str(&format!(
            "\n- Possibly related (unreviewed): [{}]({})\n  - Source quote: “{}”\n  - Target quote: “{}”\n",
            markdown_text(entry.note_basename.trim_end_matches(".md")),
            markdown_link_target(&entry.note_basename),
            markdown_text(&link.source_quote),
            markdown_text(&link.target_quote),
        ));
    }
    block.push('\n');
    output.insert_str(insertion, &block);
    Ok(output)
}
fn markdown_link_target(basename: &str) -> String {
    basename
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
fn markdown(m: &VaultMemory) -> String {
    markdown_v1_v3(m)
}
fn with_human_note(markdown: &str, note: &str, imported_text: bool) -> Option<String> {
    let header = "## Human annotation\n\n";
    let end = if imported_text {
        let marker = "<!-- Recall imported annotation boundary -->\n\n";
        let marker_start = markdown.find(marker)?;
        let after_marker = marker_start + marker.len();
        let annotation_start = markdown[after_marker..].find(header)? + after_marker;
        annotation_start + header.len()
    } else {
        markdown.find(header)? + header.len()
    };
    Some(format!("{}{}", &markdown[..end], note))
}
fn payload(
    kind: &str,
    memory: &str,
    rev: u64,
    note: &str,
    source: &str,
    name: &str,
) -> Result<String> {
    Ok(hash(&json(&(kind, memory, rev, note, source, name))?))
}
/// Work that has provably not left the device: not yet dispatched, or `processing` with the
/// durable `sent` marker still unset. Only such work may be retired by a consent change; a
/// sent or ambiguous (`unknown`) request is resolved only through its receipt.
fn unsent_organization_work(intent: &OrganizationIntent) -> bool {
    ["prepared", "queued"].contains(&intent.state.as_str())
        || (intent.state == "processing" && !intent.sent)
}
impl Vault {
    pub fn open(root: &Path) -> Result<Self> {
        safe(root)?;
        if !root.is_dir() || !root.is_absolute() {
            return Err("Select an existing absolute vault folder".into());
        }
        let recall = root.join("Recall");
        safe(&recall)?;
        if !recall.exists() {
            // Build the whole empty subtree privately, then publish without merging.
            let staging = root.join(format!(".recall-init-{}", Uuid::new_v4()));
            fs::create_dir(&staging).map_err(fail)?;
            for d in [
                "Memories",
                "Sources",
                "History",
                "_meta",
                "_meta/journal",
                "_meta/commits",
                "_meta/preserved",
            ] {
                fs::create_dir(staging.join(d)).map_err(fail)?;
            }
            let manifest = Manifest {
                format: FORMAT.into(),
                vault_id: Uuid::new_v4().to_string(),
            };
            create(&staging.join("_meta/manifest.json"), &json(&manifest)?)?;
            for d in [
                "Memories",
                "Sources",
                "History",
                "_meta/journal",
                "_meta/commits",
                "_meta/preserved",
                "_meta",
                "",
            ] {
                sync_dir(&staging.join(d))?;
            }
            if recall.exists() {
                return Err("Recall subtree appeared during initialization".into());
            }
            rename(&staging, &recall)?;
        }
        let manifest: Manifest = decode(&recall.join("_meta/manifest.json"))?;
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
            FORMAT_V9,
        ]
        .contains(&manifest.format.as_str())
        {
            return Err("Unsupported or legacy Recall subtree".into());
        }
        id(&manifest.vault_id)?;
        let v = Self {
            root: root.to_path_buf(),
            id: manifest.vault_id,
        };
        v.validate()?;
        Ok(v)
    }
    fn path(&self, p: &str) -> PathBuf {
        self.root.join("Recall").join(p)
    }
    fn note_path(&self, id: &str) -> PathBuf {
        self.path(&format!("Memories/{id}.md"))
    }
    #[cfg(test)]
    fn source_path(&self, id: &str) -> PathBuf {
        for ext in ["png", "jpg", "webp", "txt", "wav"] {
            let p = self.path(&format!("Sources/{id}.{ext}"));
            if p.exists() {
                return p;
            }
        }
        self.path(&format!("Sources/{id}.png"))
    }
    fn history_path(&self, id: &str, rev: u64) -> PathBuf {
        self.path(&format!("History/{id}/{rev:020}.json"))
    }
    fn done_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/commits/{op}.json"))
    }
    fn journal_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/journal/{op}.json"))
    }
    fn backup_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/preserved/{op}.md"))
    }
    fn import_intent_path(&self, operation_id: &str) -> Result<PathBuf> {
        id(operation_id)?;
        Ok(self.path(&format!("_meta/imports/{operation_id}.json")))
    }
    fn ensure_imports_dir(&self) -> Result<PathBuf> {
        let root = self.path("_meta/imports");
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(root.parent().ok_or("Missing import metadata parent")?)?;
        }
        if !root.is_dir() {
            return Err("Text import storage is unavailable".into());
        }
        Ok(root)
    }
    fn ask_intent_path(&self, operation_id: &str) -> Result<PathBuf> {
        id(operation_id)?;
        Ok(self.path(&format!("_meta/ask/{operation_id}.json")))
    }
    fn ensure_ask_dir(&self) -> Result<PathBuf> {
        let root = self.path("_meta/ask");
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(root.parent().ok_or("Missing Ask metadata parent")?)?;
        }
        if !root.is_dir() {
            return Err("Ask operation storage is unavailable".into());
        }
        Ok(root)
    }
    fn ensure_organization_dir(&self) -> Result<PathBuf> {
        let root = self.path("_meta/organize");
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(
                root.parent()
                    .ok_or("Missing organization metadata parent")?,
            )?;
        }
        if !root.is_dir() {
            return Err("Organization operation storage is unavailable".into());
        }
        Ok(root)
    }
    fn organization_marker_path(&self) -> PathBuf {
        self.path("_meta/organize/consent.json")
    }
    fn organization_intent_path(&self, operation: &str) -> Result<PathBuf> {
        id(operation)?;
        Ok(self.path(&format!("_meta/organize/{operation}.json")))
    }
    fn load_organization_marker(&self) -> Result<Option<OrganizationMarker>> {
        let path = self.organization_marker_path();
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let marker: OrganizationMarker = decode(&path)?;
        if marker.schema_version != "1.0"
            || marker.vault_id != self.id
            || marker.consent_epoch == 0
            || Uuid::parse_str(&marker.local_epoch).is_err()
            || marker.policy_version.is_empty()
            || marker.policy_version.len() > 160
            || marker.connection_fingerprint.len() != 64
            || !marker
                .connection_fingerprint
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid remembered organization consent marker".into());
        }
        Ok(Some(marker))
    }
    fn save_organization_intent(
        &self,
        intent: &OrganizationIntent,
        replace_existing: bool,
    ) -> Result<()> {
        let root = self.ensure_organization_dir()?;
        let path = self.organization_intent_path(&intent.binding.operation_id)?;
        let bytes = json(intent)?;
        if bytes.len() > MAX_JSON as usize {
            return Err("Organization intent exceeds its limit".into());
        }
        if path.exists() {
            let old: OrganizationIntent = decode(&path)?;
            if !replace_existing {
                if old == *intent {
                    return Ok(());
                }
                return Err(
                    "Organization operation ID already has different retry material".into(),
                );
            }
            let context_first_bind = old.binding.schema_version == "2.0"
                && old.binding.context.is_none()
                && intent.binding.context.is_some()
                && old.binding.schema_version == intent.binding.schema_version
                && old.binding.operation_id == intent.binding.operation_id
                && old.binding.vault_id == intent.binding.vault_id
                && old.binding.memory_id == intent.binding.memory_id
                && old.binding.source_kind == intent.binding.source_kind
                && old.binding.source_sha256 == intent.binding.source_sha256
                && old.binding.expected_revision == intent.binding.expected_revision
                && old.binding.input_sha256 == intent.binding.input_sha256
                && old.binding.consent_epoch == intent.binding.consent_epoch
                && old.binding.captured_at == intent.binding.captured_at
                && old.binding.context_coverage.is_none()
                && intent.binding.context_coverage.is_some();
            if (old.binding != intent.binding && !context_first_bind)
                || old.media_type != intent.media_type
                || old.connection_fingerprint != intent.connection_fingerprint
                || old.local_epoch != intent.local_epoch
            {
                return Err("Organization retry binding changed".into());
            }
            let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
            create(&stage, &bytes)?;
            replace(&stage, &path)
        } else {
            if entries(&root)?.len() >= MAX_RECORDS {
                return Err("Organization operation retention capacity reached".into());
            }
            immutable(&path, &bytes)
        }
    }
    fn organization_intent(&self, operation: &str) -> Result<Option<OrganizationIntent>> {
        let path = self.organization_intent_path(operation)?;
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let intent: OrganizationIntent = decode(&path)?;
        if intent.schema_version != "1.0"
            || intent.binding.operation_id != operation
            || intent.binding.vault_id != self.id
            || !matches!(
                intent.state.as_str(),
                "prepared"
                    | "queued"
                    | "processing"
                    | "unknown"
                    | "organized"
                    | "failed"
                    | "stale"
                    | "saved_local"
            )
            || intent.connection_fingerprint.len() != 64
            || Uuid::parse_str(&intent.local_epoch).is_err()
        {
            return Err("Invalid organization intent".into());
        }
        Ok(Some(intent))
    }
    fn update_organization_intent(
        &self,
        intent: &mut OrganizationIntent,
        state: &str,
        error: Option<String>,
    ) -> Result<()> {
        intent.state = state.into();
        intent.error_code = error;
        // Only in-flight intents carry the `sent` key; a terminal state drops it again.
        if ["organized", "failed", "stale", "saved_local"].contains(&state) {
            intent.sent = false;
        }
        self.save_organization_intent(intent, true)
    }
    pub fn set_organization_marker(&self, marker: Option<OrganizationMarker>) -> Result<()> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let root = self.ensure_organization_dir()?;
        if let Some(marker) = marker {
            if marker.vault_id != self.id
                || marker.schema_version != "1.0"
                || marker.consent_epoch == 0
                || Uuid::parse_str(&marker.local_epoch).is_err()
            {
                return Err("Invalid organization consent marker".into());
            }
            self.fence_manifest_v6()?;
            let path = self.organization_marker_path();
            let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
            create(&stage, &json(&marker)?)?;
            if path.exists() {
                replace(&stage, &path)?;
            } else {
                rename(&stage, &path)?;
            }
            for p in entries(&root)? {
                if p.extension().and_then(|x| x.to_str()) != Some("json") || p == path {
                    continue;
                }
                let mut i: OrganizationIntent = decode(&p)?;
                if i.local_epoch != marker.local_epoch {
                    if unsent_organization_work(&i) {
                        self.update_organization_intent(
                            &mut i,
                            "stale",
                            Some("CONSENT_EPOCH_CHANGED".into()),
                        )?;
                    } else if i.state == "processing" && i.sent {
                        // Sent work must not hang on "processing": it becomes ambiguous.
                        self.update_organization_intent(
                            &mut i,
                            "unknown",
                            Some("CONSENT_EPOCH_CHANGED".into()),
                        )?;
                    }
                }
            }
        } else {
            let path = self.organization_marker_path();
            if path.exists() {
                fs::remove_file(&path).map_err(fail)?;
                sync_dir(&root)?;
            }
            for p in entries(&root)? {
                if p.extension().and_then(|x| x.to_str()) != Some("json") || p == path {
                    continue;
                }
                let mut i: OrganizationIntent = decode(&p)?;
                if unsent_organization_work(&i) {
                    self.update_organization_intent(
                        &mut i,
                        "stale",
                        Some("CONSENT_REVOKED".into()),
                    )?;
                } else if i.state == "processing" && i.sent {
                    self.update_organization_intent(
                        &mut i,
                        "unknown",
                        Some("CONSENT_REVOKED".into()),
                    )?;
                }
            }
        }
        Ok(())
    }
    pub fn organization_marker(&self) -> Result<Option<OrganizationMarker>> {
        let _lock = self.lock()?;
        self.load_organization_marker()
    }
    pub fn organization_operations(&self, memory_id: &str) -> Result<Vec<OrganizationOperation>> {
        let _lock = self.lock()?;
        id(memory_id)?;
        let root = self.path("_meta/organize");
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for p in entries(&root)? {
            if p == self.organization_marker_path()
                || p.extension().and_then(|x| x.to_str()) != Some("json")
            {
                continue;
            }
            let Some(op) = p.file_stem().and_then(|x| x.to_str()) else {
                continue;
            };
            if let Some(i) = self.organization_intent(op)? {
                if i.binding.memory_id == memory_id {
                    out.push(OrganizationOperation {
                        operation_id: op.into(),
                        memory_id: memory_id.into(),
                        state: i.state,
                        error_code: i.error_code,
                    });
                }
            }
        }
        out.sort_by(|a, b| a.operation_id.cmp(&b.operation_id));
        Ok(out)
    }
    pub fn organization_operation(&self, operation: &str) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        id(operation)?;
        let intent = self
            .organization_intent(operation)?
            .ok_or("Organization operation not found")?;
        Ok(OrganizationOperation {
            operation_id: operation.into(),
            memory_id: intent.binding.memory_id,
            state: intent.state,
            error_code: intent.error_code,
        })
    }
    pub fn organization_intents(&self) -> Result<Vec<OrganizationIntent>> {
        let _lock = self.lock()?;
        let root = self.path("_meta/organize");
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for p in entries(&root)? {
            if p == self.organization_marker_path()
                || p.extension().and_then(|x| x.to_str()) != Some("json")
            {
                continue;
            }
            let Some(op) = p.file_stem().and_then(|x| x.to_str()) else {
                continue;
            };
            if let Some(i) = self.organization_intent(op)? {
                out.push(i);
            }
        }
        out.sort_by(|a, b| {
            a.binding
                .captured_at
                .cmp(&b.binding.captured_at)
                .then(a.binding.operation_id.cmp(&b.binding.operation_id))
        });
        Ok(out)
    }
    pub fn organization_dispatch_material(
        &self,
        operation: &str,
    ) -> Result<Option<(OrganizationIntent, OrganizationRequest, Vec<u8>)>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let Some(mut intent) = self.organization_intent(operation)? else {
            return Err("Organization operation not found".into());
        };
        if !["prepared", "queued", "processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(None);
        }
        let Some(marker) = self.load_organization_marker()? else {
            if unsent_organization_work(&intent) {
                self.update_organization_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_REVOKED".into()),
                )?;
            }
            return Ok(None);
        };
        if marker.local_epoch != intent.local_epoch
            || marker.consent_epoch != intent.binding.consent_epoch
            || marker.connection_fingerprint != intent.connection_fingerprint
        {
            if unsent_organization_work(&intent) {
                self.update_organization_intent(
                    &mut intent,
                    "stale",
                    Some("CONSENT_EPOCH_CHANGED".into()),
                )?;
            }
            return Ok(None);
        }
        if intent.state == "prepared" {
            let receipt = self.receipt(&intent.binding.memory_id)?;
            if receipt
                .as_ref()
                .is_none_or(|e| e.kind != "capture" || e.memory.revision != 1)
            {
                self.update_organization_intent(
                    &mut intent,
                    "stale",
                    Some("CAPTURE_NOT_COMMITTED".into()),
                )?;
                return Ok(None);
            }
            self.update_organization_intent(&mut intent, "queued", None)?;
            intent.state = "queued".into();
        }
        let memory = self.current(&intent.binding.memory_id, &pending)?;
        if memory.state != "active"
            || memory.conflict.is_some()
            || memory.revision != intent.binding.expected_revision
            || hash(memory.note.as_bytes()) != intent.human_text_sha256
            || memory.source_sha256 != intent.binding.source_sha256
            || memory
                .reading
                .as_ref()
                .is_some_and(|r| r.human_correction.is_some())
        {
            self.update_organization_intent(
                &mut intent,
                "stale",
                Some("SOURCE_OR_REVISION_CHANGED".into()),
            )?;
            return Ok(None);
        }
        let verified = self.verify_source(&memory)?;
        let body = if intent.binding.source_kind == "text" {
            memory.note.as_bytes().to_vec()
        } else {
            verified.bytes
        };
        if hash(&body) != intent.binding.input_sha256 {
            self.update_organization_intent(&mut intent, "stale", Some("INPUT_CHANGED".into()))?;
            return Ok(None);
        }
        if intent.binding.schema_version == "2.0" && intent.binding.context.is_none() {
            let (coverage, context) = self.select_organization_context(&memory, &pending)?;
            intent.binding.context_coverage = Some(coverage);
            intent.binding.context = Some(context);
            self.save_organization_intent(&intent, true)?;
        }
        let request = OrganizationRequest {
            binding: intent.binding.clone(),
            media_type: intent.media_type.clone(),
        };
        request.validate(&body)?;
        if !self.context_binding_current(&request.binding, &pending)? {
            self.update_organization_intent(&mut intent, "stale", Some("CONTEXT_CHANGED".into()))?;
            return Ok(None);
        }
        Ok(Some((intent, request, body)))
    }
    fn context_binding_current(
        &self,
        binding: &OrganizationBinding,
        pending: &BTreeMap<String, String>,
    ) -> Result<bool> {
        let Some(context) = binding.context.as_ref() else {
            return Ok(binding.schema_version == "1.0");
        };
        let candidates = self.ask_candidates_locked(pending)?;
        for excerpt in context {
            let Ok(memory) = self.current(&excerpt.memory_id, pending) else {
                return Ok(false);
            };
            if memory.state != "active"
                || memory.conflict.is_some()
                || memory.revision != excerpt.memory_revision
                || memory.source_sha256 != excerpt.source_sha256
            {
                return Ok(false);
            }
            let Some(candidate) = candidates.iter().find(|c| c.memory.id == excerpt.memory_id)
            else {
                return Ok(false);
            };
            if candidate.evidence_kind != excerpt.evidence_kind
                || candidate.epistemic_state != excerpt.epistemic_state
                || !candidate.text.contains(&excerpt.excerpt)
            {
                return Ok(false);
            }
        }
        Ok(true)
    }
    /// Unconditional setter, for tests only. Production transitions go through
    /// [`Self::transition_organization_state`] so a retired state is never overwritten.
    #[cfg(test)]
    pub fn set_organization_operation_state(
        &self,
        operation: &str,
        state: &str,
        error: Option<String>,
    ) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self
            .organization_intent(operation)?
            .ok_or("Organization operation not found")?;
        if ![
            "prepared",
            "queued",
            "processing",
            "unknown",
            "organized",
            "failed",
            "stale",
            "saved_local",
        ]
        .contains(&state)
        {
            return Err("Invalid organization operation state".into());
        }
        self.update_organization_intent(&mut intent, state, error)?;
        Ok(OrganizationOperation {
            operation_id: operation.into(),
            memory_id: intent.binding.memory_id,
            state: intent.state,
            error_code: intent.error_code,
        })
    }
    /// Compare-and-set: move the operation to `to` only if it is currently in one of the
    /// `from` states; otherwise write nothing and return `None`.
    pub fn transition_organization_state(
        &self,
        operation: &str,
        from: &[&str],
        to: &str,
        error: Option<&str>,
    ) -> Result<Option<OrganizationOperation>> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self
            .organization_intent(operation)?
            .ok_or("Organization operation not found")?;
        if ![
            "prepared",
            "queued",
            "processing",
            "unknown",
            "organized",
            "failed",
            "stale",
            "saved_local",
        ]
        .contains(&to)
        {
            return Err("Invalid organization operation state".into());
        }
        if !from.contains(&intent.state.as_str()) {
            return Ok(None);
        }
        self.update_organization_intent(&mut intent, to, error.map(str::to_owned))?;
        Ok(Some(OrganizationOperation {
            operation_id: operation.into(),
            memory_id: intent.binding.memory_id,
            state: intent.state,
            error_code: intent.error_code,
        }))
    }
    /// Durable "may have been sent" marker, written under the vault lock right before the POST.
    /// Refused (false) unless the operation is `processing` or `unknown`.
    pub fn mark_organization_sent(&self, operation: &str) -> Result<bool> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self
            .organization_intent(operation)?
            .ok_or("Organization operation not found")?;
        if !["processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(false);
        }
        // The marker must still be the one this intent was enrolled under.
        let current_marker = self.load_organization_marker()?;
        if current_marker.as_ref().is_none_or(|marker| {
            marker.local_epoch != intent.local_epoch
                || marker.consent_epoch != intent.binding.consent_epoch
                || marker.connection_fingerprint != intent.connection_fingerprint
        }) {
            return Ok(false);
        }
        if !intent.sent {
            intent.sent = true;
            self.save_organization_intent(&intent, true)?;
        }
        Ok(true)
    }
    /// A `processing` operation that was never sent returns to `queued`.
    pub fn revert_organization_unsent(&self, operation: &str) -> Result<()> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let mut intent = self
            .organization_intent(operation)?
            .ok_or("Organization operation not found")?;
        if intent.state == "processing" && !intent.sent {
            self.update_organization_intent(&mut intent, "queued", None)?;
        }
        Ok(())
    }
    pub fn promote_organization(
        &self,
        request: &OrganizationRequest,
        body: &[u8],
        receipt: &OrganizationReceipt,
    ) -> Result<OrganizationOperation> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let mut intent = self
            .organization_intent(&request.binding.operation_id)?
            .ok_or("Organization operation not found")?;
        // A retired operation (stale after a revoke, failed, saved_local, organized) never
        // promotes late: the late result is dropped without touching the vault.
        if !["prepared", "queued", "processing", "unknown"].contains(&intent.state.as_str()) {
            return Ok(OrganizationOperation {
                operation_id: request.binding.operation_id.clone(),
                memory_id: intent.binding.memory_id,
                state: intent.state,
                error_code: intent.error_code,
            });
        }
        let marker = self
            .load_organization_marker()?
            .ok_or("Organization consent was revoked")?;
        if marker.local_epoch != intent.local_epoch
            || marker.consent_epoch != request.binding.consent_epoch
            || marker.connection_fingerprint != intent.connection_fingerprint
            || request.binding.vault_id != self.id
        {
            return Err("Organization authorization changed".into());
        }
        request.validate(body)?;
        receipt.validate(request, Some(body))?;
        if receipt.state != "complete" {
            let state = if receipt.state == "failed" {
                "failed"
            } else {
                "unknown"
            };
            self.update_organization_intent(&mut intent, state, receipt.error_code.clone())?;
            return Ok(OrganizationOperation {
                operation_id: request.binding.operation_id.clone(),
                memory_id: intent.binding.memory_id,
                state: state.into(),
                error_code: receipt.error_code.clone(),
            });
        }
        let mut memory = self.current(&request.binding.memory_id, &pending)?;
        if memory.state != "active"
            || memory.conflict.is_some()
            || memory.revision != request.binding.expected_revision
            || hash(memory.note.as_bytes()) != intent.human_text_sha256
            || memory.source_sha256 != request.binding.source_sha256
            || self.verify_source(&memory).is_err()
            || memory
                .reading
                .as_ref()
                .is_some_and(|r| r.human_correction.is_some())
        {
            self.update_organization_intent(
                &mut intent,
                "stale",
                Some("SOURCE_OR_REVISION_CHANGED".into()),
            )?;
            return self.organization_operation(&request.binding.operation_id);
        }
        if !self.context_binding_current(&request.binding, &pending)? {
            self.update_organization_intent(&mut intent, "stale", Some("CONTEXT_CHANGED".into()))?;
            return self.organization_operation(&request.binding.operation_id);
        }
        let result = receipt
            .result
            .clone()
            .ok_or("Missing organization result")?;
        memory.revision += 1;
        memory.updated_at = timestamp();
        memory.organization = Some(OrganizationProposal {
            binding: request.binding.clone(),
            media_type: request.media_type.clone(),
            payload_sha256: receipt.payload_sha256.clone(),
            review_state: "unreviewed".into(),
            result: result.clone(),
            suppressed: false,
        });
        let context_link_projection = if request.binding.schema_version == "2.0" {
            let mut projection = Vec::new();
            for link in result.related_context.as_deref().unwrap_or(&[]) {
                let target = self.current(&link.target_memory_id, &pending)?;
                let target_basename = target
                    .note_path
                    .as_deref()
                    .ok_or("Related target note path is unavailable")?;
                basename(target_basename)?;
                let bound = request
                    .binding
                    .context
                    .as_ref()
                    .and_then(|entries| {
                        entries
                            .iter()
                            .find(|entry| entry.memory_id == link.target_memory_id)
                    })
                    .ok_or("Related target is not in the bound context")?;
                if target.state != "active"
                    || target.conflict.is_some()
                    || target.revision != bound.memory_revision
                    || target.source_sha256 != bound.source_sha256
                {
                    return Err("Related target changed before publication".into());
                }
                projection.push(ContextLinkProjection {
                    target_memory_id: link.target_memory_id.clone(),
                    note_basename: target_basename.into(),
                    suppressed: false,
                });
            }
            Some(projection)
        } else {
            None
        };
        let last = self.records(&memory.id)?.pop().ok_or("Missing history")?;
        let base = payload(
            "organization",
            &memory.id,
            last.memory.revision,
            &memory.note,
            &memory.source_sha256,
            &memory.source_name,
        )?;
        let mut payload_sha256 = hash(&json(&(
            hash(&json(&(base, &memory.reading))?),
            &memory.organization,
        ))?);
        if request.binding.schema_version == "2.0" {
            payload_sha256 = hash(&json(&(payload_sha256, &context_link_projection))?);
        }
        let format = if request.binding.schema_version == "2.0" {
            FORMAT_V7
        } else {
            FORMAT_V6
        };
        let e = Event {
            format: format.into(),
            vault_id: self.id.clone(),
            operation_id: request.binding.operation_id.clone(),
            kind: "organization".into(),
            expected_revision: last.memory.revision,
            payload_sha256,
            parent_sha256: Some(self.parent_hash(&memory.id, last.memory.revision)?),
            origin: "machine:anthropic".into(),
            note_path: memory.note_path.clone(),
            expected_state: None,
            previous_markdown: Some(last.markdown),
            markdown: if format == FORMAT_V7 {
                v7_markdown(&memory, context_link_projection.as_deref().unwrap_or(&[]))?
            } else {
                markdown_for(FORMAT_V6, &memory)
            },
            memory,
            context_link_projection,
        };
        let _ = self.commit(&e)?;
        self.update_organization_intent(&mut intent, "organized", None)?;
        Ok(OrganizationOperation {
            operation_id: request.binding.operation_id.clone(),
            memory_id: intent.binding.memory_id,
            state: "organized".into(),
            error_code: None,
        })
    }
    fn prepare_capture_organization(
        &self,
        memory_id: &str,
        source_kind: &str,
        source_sha: &str,
        input_sha: &str,
        media_type: &str,
        human_text: &str,
        captured_at: &str,
    ) -> Result<Option<OrganizationIntent>> {
        let Some(marker) = self.load_organization_marker()? else {
            return Ok(None);
        };
        let operation = Uuid::new_v4().to_string();
        let binding = OrganizationBinding {
            schema_version: if marker.policy_version.starts_with("organize-v2|") {
                "2.0"
            } else {
                "1.0"
            }
            .into(),
            operation_id: operation.clone(),
            vault_id: self.id.clone(),
            memory_id: memory_id.into(),
            source_kind: source_kind.into(),
            source_sha256: source_sha.into(),
            expected_revision: 1,
            input_sha256: input_sha.into(),
            derivative_sha256: None,
            transcript_revision: None,
            transcript_evidence_kind: None,
            consent_epoch: marker.consent_epoch,
            captured_at: captured_at.into(),
            context_coverage: None,
            context: None,
        };
        let oversized = source_kind == "text"
            && (human_text.chars().count() > 30_000 || human_text.len() > 120_000)
            || source_kind == "photo" && human_text.len() > 25 * 1024 * 1024;
        let intent = OrganizationIntent {
            schema_version: "1.0".into(),
            binding,
            media_type: media_type.into(),
            human_text_sha256: hash(human_text.as_bytes()),
            connection_fingerprint: marker.connection_fingerprint,
            local_epoch: marker.local_epoch,
            state: if oversized { "saved_local" } else { "prepared" }.into(),
            error_code: oversized.then(|| "INPUT_LIMIT_EXCEEDED".into()),
            sent: false,
        };
        self.save_organization_intent(&intent, false)?;
        Ok(Some(intent))
    }
    fn finish_capture_organization(
        &self,
        intent: Option<OrganizationIntent>,
        memory: &VaultMemory,
    ) -> Result<()> {
        let Some(mut intent) = intent else {
            return Ok(());
        };
        if memory.id != intent.binding.memory_id
            || memory.revision != 1
            || self.verify_source(memory).is_err()
            || self.receipt(&memory.id)?.is_none()
        {
            return Ok(());
        }
        let marker = self.load_organization_marker()?;
        if intent.state == "prepared"
            && marker.as_ref().is_some_and(|m| {
                m.local_epoch == intent.local_epoch
                    && m.consent_epoch == intent.binding.consent_epoch
            })
        {
            self.update_organization_intent(&mut intent, "queued", None)?;
        }
        Ok(())
    }
    fn validate(&self) -> Result<()> {
        safe(&self.root)?;
        let m: Manifest = decode(&self.path("_meta/manifest.json"))?;
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
            FORMAT_V9,
        ]
        .contains(&m.format.as_str())
            || m.vault_id != self.id
        {
            return Err("Selected vault identity changed".into());
        }
        for d in [
            "Memories",
            "Sources",
            "History",
            "_meta",
            "_meta/journal",
            "_meta/commits",
            "_meta/preserved",
        ] {
            let p = self.path(d);
            safe(&p)?;
            if !p.is_dir() {
                return Err("Managed vault directory missing".into());
            }
        }
        Ok(())
    }
    fn lock(&self) -> Result<File> {
        self.validate()?;
        let p = self.path("_meta/writer.lock");
        safe(&p)?;
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(p)
            .map_err(fail)?;
        f.try_lock()
            .map_err(|_| "Vault is busy in another Recall process".to_string())?;
        self.validate()?;
        Ok(f)
    }
    fn fence_v2(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [
            FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&manifest.format.as_str())
        {
            return Ok(());
        }
        immutable(&self.path("_meta/manifest-v1.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V2.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v4(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [
            FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&manifest.format.as_str())
        {
            return Ok(());
        }
        if ![FORMAT, FORMAT_V2, FORMAT_V3].contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        immutable(&self.path("_meta/manifest-v3.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V4.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v5(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9]
            .contains(&manifest.format.as_str())
        {
            return Ok(());
        }
        if ![FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4].contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        immutable(&self.path("_meta/manifest-v4.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V5.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v6(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&manifest.format.as_str()) {
            return Ok(());
        }
        if ![FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5].contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        immutable(&self.path("_meta/manifest-v5.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V6.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v7(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&manifest.format.as_str()) {
            return Ok(());
        }
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
            FORMAT_V9,
        ]
        .contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        immutable(&self.path("_meta/manifest-v6.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V7.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v8(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if manifest.format == FORMAT_V8 {
            return Ok(());
        }
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7,
        ]
        .contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        immutable(&self.path("_meta/manifest-v7.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V8.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn fence_manifest_v9(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if manifest.format == FORMAT_V9 {
            return Ok(());
        }
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
        ]
        .contains(&manifest.format.as_str())
            || manifest.vault_id != self.id
        {
            return Err("Unsupported vault writer fence".into());
        }
        // Preserve the exact previous manifest so older writers fail closed on
        // v9 and the upgrade remains auditable.
        immutable(&self.path("_meta/manifest-v8.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V9.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn event_note_path(&self, e: &Event) -> Result<PathBuf> {
        match &e.note_path {
            Some(name) => {
                basename(name)?;
                Ok(self.path("Memories").join(name))
            }
            None => Ok(self.note_path(&e.memory.id)),
        }
    }
    // Only flat Markdown children participate. Prefix discovery still catches
    // oversized duplicates; full content and safe-path validation follow.
    fn inventory(&self, memory_id: &str, bound_name: Option<&str>) -> Result<Option<PathBuf>> {
        let canonical = self.note_path(memory_id);
        // Stable identity discovery takes precedence over the old bound name.
        // If no identity resolves, an occupied bound path is a conflict rather
        // than absence, even when an editor changed its identity header.
        let bound = bound_name
            .map(|name| -> Result<PathBuf> {
                basename(name)?;
                Ok(self.path("Memories").join(name))
            })
            .transpose()?;
        let marker = format!("<!-- Recall memory {memory_id} | ");
        let mut candidates = Vec::new();
        let mut nested = false;
        for p in entries(&self.path("Memories"))? {
            let metadata = fs::symlink_metadata(&p).map_err(fail)?;
            if metadata.is_dir() {
                nested = true;
            }
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            safe(&p)?;
            if p == canonical || identity_matches(&p, memory_id, &marker) {
                basename(
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .ok_or("Invalid note basename")?,
                )?;
                candidates.push(p);
            }
        }
        if candidates.len() > 1 {
            return Err(
                "Duplicate or occupied memory identity; preserve both files and resolve explicitly"
                    .into(),
            );
        }
        if candidates.is_empty() {
            if let Some(bound) = bound {
                safe(&bound)?;
                if bound.try_exists().map_err(fail)? {
                    return Err("Known note pathname is occupied with changed identity; resolve the conflict before confirming absence".into());
                }
            }
            if nested {
                return Err("Missing note with nested folders in Memories; nested moves require explicit resolution".into());
            }
        }
        Ok(candidates.pop())
    }
    fn parent_hash(&self, memory_id: &str, revision: u64) -> Result<String> {
        Ok(hash(&read(
            &self.history_path(memory_id, revision),
            MAX_JSON,
        )?))
    }
    fn event_valid(&self, e: &Event) -> Result<()> {
        id(&e.memory.id)?;
        id(&e.operation_id)?;
        note_valid(&e.memory.note)?;
        if ![
            FORMAT, FORMAT_V2, FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
            FORMAT_V9,
        ]
        .contains(&e.format.as_str())
            || (e.format == FORMAT
                && (e.note_path.is_some()
                    || e.expected_state.is_some()
                    || !["capture", "correct", "external"].contains(&e.kind.as_str())))
            || (e.format != FORMAT_V3
                && e.format != FORMAT_V4
                && e.format != FORMAT_V5
                && e.format != FORMAT_V6
                && e.format != FORMAT_V7
                && e.format != FORMAT_V8
                && e.format != FORMAT_V9
                && (e.memory.reading.is_some()
                    || e.memory.organization.is_some()
                    || ["machine_reading", "reading_correction"].contains(&e.kind.as_str())))
            || e.vault_id != self.id
            || e.memory.revision == 0
            || e.memory.revision > MAX_RECORDS as u64
            || e.expected_revision.checked_add(1) != Some(e.memory.revision)
            || e.memory.conflict.is_some()
            || ![
                "capture",
                "correct",
                "external",
                "restore",
                "remove",
                "machine_reading",
                "reading_correction",
                "organization",
                "context_suppress",
                "audio_transcription",
                "audio_transcript_correction",
                "audio_organization",
            ]
            .contains(&e.kind.as_str())
            || e.origin
                != if ["machine_reading", "organization", "audio_organization"]
                    .contains(&e.kind.as_str())
                {
                    "machine:anthropic"
                } else if e.kind == "audio_transcription" {
                    "machine:whisper-local"
                } else if e.kind == "context_suppress" {
                    "system:recall"
                } else if e.kind == "external" {
                    "human:obsidian"
                } else {
                    "human:recall"
                }
            || e.memory.source_sha256.len() != 64
            || e.memory.source_name.len() > 260
            || (e.memory.imported_text.is_none()
                && e.memory.audio_source.is_none()
                && !["png", "jpg", "webp", "txt"]
                    .contains(&e.memory.source_name.rsplit('.').next().unwrap_or("")))
            || e.memory.source_name.contains(['/', '\\', '\0'])
            || ((e.memory.source_name.to_ascii_lowercase().ends_with(".txt")
                || e.memory.source_name.to_ascii_lowercase().ends_with(".md"))
                && (![FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9]
                    .contains(&e.format.as_str())
                    || (e.memory.source_name != "note.txt" && e.memory.imported_text.is_none())
                    || e.memory.reading.is_some()))
            || (e.memory.imported_text.is_some()
                && (![FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
                    || e.memory.imported_text.as_ref().is_some_and(|meta| {
                        meta.original_name != e.memory.source_name
                            || meta.original_extension
                                != e.memory
                                    .source_name
                                    .rsplit_once('.')
                                    .map(|(_, ext)| ext)
                                    .unwrap_or("")
                            || safe_import_name(&meta.original_name).is_err()
                            || meta.source_media_type != "text/plain; charset=utf-8"
                            || meta.semantic_sha256.len() != 64
                            || !meta
                                .semantic_sha256
                                .bytes()
                                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                            || meta.semantic_bytes > MAX_NOTE as u64
                            || meta.semantic_characters > MAX_NOTE as u64
                            || (e.memory.revision == 1
                                && (hash(e.memory.note.as_bytes()) != meta.semantic_sha256
                                    || e.memory.note.len() as u64 != meta.semantic_bytes
                                    || e.memory.note.chars().count() as u64
                                        != meta.semantic_characters))
                    })))
            || (![FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
                && e.memory.imported_text.is_some())
            || (e.memory.audio_source.is_none()
                && !(e.memory.source_name.to_ascii_lowercase().ends_with(".txt")
                    || e.memory.source_name.to_ascii_lowercase().ends_with(".md"))
                && !["png", "jpg", "webp"]
                    .contains(&e.memory.source_name.rsplit('.').next().unwrap_or("")))
            || e.memory.captured_at.len() != 20
            || e.memory.updated_at.len() != 20
            || markdown_for_event(e).as_deref() != Ok(e.markdown.as_str())
            || ([FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()))
                != e.context_link_projection.is_some()
            || (e.memory.revision == 1) != (e.parent_sha256.is_none())
            || (e.kind == "capture") != (e.memory.revision == 1)
        {
            return Err("Malformed revision metadata".into());
        }
        if let Some(name) = &e.note_path {
            basename(name)?;
        }
        if e.format != FORMAT && e.note_path.is_none() {
            return Err("Missing bound note basename".into());
        }
        if (e.kind == "remove") != e.expected_state.is_some()
            || e.expected_state
                .as_deref()
                .is_some_and(|state| !["active", "missing"].contains(&state))
            || (["capture", "restore"].contains(&e.kind.as_str()) && e.previous_markdown.is_some())
            || ([
                "correct",
                "external",
                "machine_reading",
                "reading_correction",
                "organization",
                "context_suppress",
                "audio_transcription",
                "audio_transcript_correction",
                "audio_organization",
            ]
            .contains(&e.kind.as_str())
                && e.previous_markdown.is_none())
            || (e.kind == "capture" && e.operation_id != e.memory.id)
            || (e.kind == "remove"
                && (e.expected_state.as_deref() == Some("active")) != e.previous_markdown.is_some())
        {
            return Err("Malformed lifecycle precondition".into());
        }
        let mut expected = payload(
            &e.kind,
            &e.memory.id,
            e.expected_revision,
            &e.memory.note,
            &e.memory.source_sha256,
            &e.memory.source_name,
        )?;
        if e.kind == "remove" {
            expected = hash(&json(&(expected, &e.expected_state))?);
        }
        if [
            FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&e.format.as_str())
        {
            expected = hash(&json(&(expected, &e.memory.reading))?);
        }
        if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()) {
            expected = hash(&json(&(expected, &e.memory.organization))?);
        } else if e.memory.organization.is_some() || e.kind == "organization" {
            return Err("Organization proposals require the v6 vault fence".into());
        }
        if e.format == FORMAT_V7 {
            expected = hash(&json(&(expected, &e.context_link_projection))?);
        }
        if e.format == FORMAT_V8 {
            expected = hash(&json(&(
                expected,
                &e.context_link_projection,
                &e.memory.imported_text,
            ))?);
        }
        if e.format == FORMAT_V9 {
            expected = hash(&json(&(
                expected,
                &e.context_link_projection,
                &e.memory.imported_text,
                &e.memory.audio_source,
                &e.memory.audio_transcript,
            ))?);
        }
        // Chained only when present, so every existing v9 digest stays byte-identical.
        if e.format == FORMAT_V9 && e.memory.audio_organization.is_some() {
            expected = hash(&json(&(expected, &e.memory.audio_organization))?);
        }
        self.context_projection_valid(e)?;
        self.reading_event_valid(e)?;
        self.audio_event_valid(e)?;
        self.organization_event_valid(e)?;
        if expected != e.payload_sha256 {
            return Err("Revision payload hash mismatch".into());
        }
        Ok(())
    }
    fn context_projection_valid(&self, e: &Event) -> Result<()> {
        if ![FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()) {
            if e.context_link_projection.is_some() {
                return Err("Context projection is only valid in v7 events".into());
            }
            return Ok(());
        }
        let links = if let Some(proposal) = e.memory.organization.as_ref() {
            if (e.format == FORMAT_V7 && proposal.binding.schema_version != "2.0")
                || ([FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
                    && !["1.0", "2.0"].contains(&proposal.binding.schema_version.as_str()))
            {
                return Err("v7 event requires a v2 organization binding".into());
            }
            proposal
                .result
                .related_context
                .as_ref()
                .map(Vec::as_slice)
                .unwrap_or(&[])
        } else {
            &[]
        };
        let projection = e
            .context_link_projection
            .as_ref()
            .ok_or("Missing v7 context link projection")?;
        if links.len() != projection.len() || projection.len() > 3 {
            return Err("v7 context projection does not match its proposal".into());
        }
        let mut targets = BTreeSet::new();
        for (link, entry) in links.iter().zip(projection) {
            id(&entry.target_memory_id)?;
            basename(&entry.note_basename)?;
            if entry.target_memory_id != link.target_memory_id
                || entry.target_memory_id == e.memory.id
                || !targets.insert(entry.target_memory_id.as_str())
            {
                return Err("Invalid v7 context projection target".into());
            }
        }
        Ok(())
    }
    fn organization_event_valid(&self, e: &Event) -> Result<()> {
        if let Some(proposal) = &e.memory.organization {
            proposal.validate(
                &self.id,
                &e.memory.id,
                &e.memory.source_sha256,
                &e.memory.captured_at,
                e.memory.source_name == "note.txt" || e.memory.imported_text.is_some(),
            )?;
            if proposal.binding.expected_revision >= e.memory.revision
                || (e.kind == "organization"
                    && (proposal.binding.operation_id != e.operation_id
                        || proposal.binding.expected_revision != e.expected_revision
                        || proposal.suppressed))
            {
                return Err("Organization revision binding mismatch".into());
            }
        }
        if e.kind == "organization" && e.memory.organization.is_none() {
            return Err("Organization event must carry its proposal".into());
        }
        Ok(())
    }
    fn organization_transition(&self, prev: &Event, next: &Event) -> Result<()> {
        let before = prev.memory.organization.as_ref();
        let after = next.memory.organization.as_ref();
        if next.kind == "context_suppress"
            && ![FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&prev.format.as_str())
        {
            return Err("Context suppression requires a v7 parent event".into());
        }
        if [FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&prev.format.as_str()) {
            if (prev.format == FORMAT_V9 && next.format != FORMAT_V9)
                || (prev.format == FORMAT_V8
                    && ![FORMAT_V8, FORMAT_V9].contains(&next.format.as_str()))
                || (prev.format == FORMAT_V7
                    && ![FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&next.format.as_str()))
            {
                return Err("v7/v8 vault history cannot be downgraded".into());
            }
            let old = prev.context_link_projection.as_deref().unwrap_or(&[]);
            let new = next.context_link_projection.as_deref().unwrap_or(&[]);
            let initial_context_projection = next.kind == "organization"
                && prev.kind == "capture"
                && before.is_none()
                && prev.memory.organization.is_none()
                && prev.context_link_projection.as_deref() == Some(&[][..])
                && old.is_empty()
                && after.is_some_and(|proposal| {
                    proposal.binding.schema_version == "2.0" && !proposal.suppressed
                });
            if (!initial_context_projection && old.len() != new.len())
                || old.iter().zip(new).any(|(a, b)| {
                    a.target_memory_id != b.target_memory_id
                        || a.note_basename != b.note_basename
                        || (a.suppressed && !b.suppressed)
                })
            {
                return Err("v7 context projection changed or revived a link".into());
            }
            if next.kind == "context_suppress" {
                if before != after
                    || prev.memory.note != next.memory.note
                    || prev.memory.source_sha256 != next.memory.source_sha256
                    || old
                        .iter()
                        .zip(new)
                        .all(|(a, b)| a.suppressed == b.suppressed)
                    || old.len() != new.len()
                {
                    return Err("Malformed v7 context suppression revision".into());
                }
                return Ok(());
            }
        }
        if next.kind == "organization" {
            let proposal = after.ok_or("Organization event lost its proposal")?;
            if proposal.binding.expected_revision != prev.memory.revision
                || proposal.binding.memory_id != prev.memory.id
                || proposal.binding.source_sha256 != prev.memory.source_sha256
                || (proposal.binding.source_kind == "text"
                    && (hash(prev.memory.note.as_bytes()) != proposal.binding.input_sha256
                        || !crate::local_organization::text_result_matches_input(
                            &proposal.result.extraction,
                            &prev.memory.note,
                        )))
                || prev
                    .memory
                    .reading
                    .as_ref()
                    .is_some_and(|r| r.human_correction.is_some())
                || before.is_some_and(|p| !p.suppressed)
            {
                return Err("Stale organization cannot be promoted".into());
            }
            return Ok(());
        }
        match (before, after) {
            (None, None) => Ok(()),
            (Some(a), Some(b))
                if a.binding == b.binding
                    && a.media_type == b.media_type
                    && a.payload_sha256 == b.payload_sha256
                    && a.result == b.result
                    && a.review_state == b.review_state =>
            {
                let human_change = [
                    "correct",
                    "external",
                    "reading_correction",
                    "remove",
                    "restore",
                ]
                .contains(&next.kind.as_str());
                if (a.suppressed && !b.suppressed)
                    || (human_change && !b.suppressed)
                    || (!human_change && a.suppressed != b.suppressed)
                {
                    Err("Human edit did not suppress organization proposal".into())
                } else {
                    Ok(())
                }
            }
            _ => Err("Unrelated revision changed organization proposal".into()),
        }
    }
    fn verify_source(&self, m: &VaultMemory) -> Result<VaultSource> {
        let extension = if m.imported_text.is_some() {
            "txt"
        } else if m.audio_source.is_some() {
            "wav"
        } else {
            m.source_name
                .rsplit('.')
                .next()
                .ok_or("Missing source extension")?
        };
        let expected = self.path(&format!("Sources/{}.{extension}", m.id));
        for other in ["png", "jpg", "webp", "txt", "md", "wav"] {
            let p = self.path(&format!("Sources/{}.{other}", m.id));
            if p != expected && p.exists() {
                return Err("Duplicate source identity".into());
            }
        }
        let (bytes, mime): (Vec<u8>, String) = if extension == "wav" {
            self.verify_audio_source(m, &expected)?
        } else if extension == "txt" {
            let bytes = read(&expected, MAX_NOTE as u64)?;
            let text = std::str::from_utf8(&bytes).map_err(fail)?;
            note_valid(text)?;
            let semantic = text.strip_prefix('\u{feff}').unwrap_or(text);
            if text.trim().is_empty() || (m.source_name != "note.txt" && m.imported_text.is_none())
            {
                return Err("Invalid text source".into());
            }
            if let Some(meta) = m.imported_text.as_ref() {
                if hash(semantic.as_bytes()) != meta.semantic_sha256
                    || semantic.len() as u64 != meta.semantic_bytes
                    || semantic.chars().count() as u64 != meta.semantic_characters
                {
                    return Err("Imported semantic text does not match provenance".into());
                }
            }
            (bytes, "text/plain; charset=utf-8".into())
        } else {
            let bytes = read(&expected, MAX_PHOTO)?;
            let mime = image_type(&bytes)?.to_string();
            (bytes, mime)
        };
        if hash(&bytes) != m.source_sha256 {
            return Err(
                "Original source hash mismatch; restore original or import as new evidence".into(),
            );
        }
        Ok(VaultSource {
            bytes,
            mime_type: mime,
            sha256: m.source_sha256.clone(),
        })
    }
    fn records(&self, memory_id: &str) -> Result<Vec<Event>> {
        self.records_inner(memory_id, true)
    }
    fn records_with_event_hashes(&self, memory_id: &str) -> Result<Vec<(Event, String)>> {
        let mut records = Vec::new();
        for event in self.records(memory_id)? {
            let bytes = read(
                &self.history_path(memory_id, event.memory.revision),
                MAX_JSON,
            )?;
            records.push((event, hash(&bytes)));
        }
        Ok(records)
    }
    fn records_inner(&self, memory_id: &str, require_receipts: bool) -> Result<Vec<Event>> {
        id(memory_id)?;
        let paths: Vec<PathBuf> = entries(&self.path(&format!("History/{memory_id}")))?
            .into_iter()
            .filter(|p| {
                !p.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                    s.strip_prefix("stage-")
                        .is_some_and(|v| Uuid::parse_str(v).is_ok())
                })
            })
            .collect();
        if paths.is_empty() {
            return Err("Missing revision history".into());
        }
        let mut out: Vec<Event> = Vec::new();
        for (index, p) in paths.iter().enumerate() {
            if p != &self.history_path(memory_id, index as u64 + 1) {
                return Err("History gap or unexpected file".into());
            }
            let bytes = read(p, MAX_JSON)?;
            let e: Event = serde_json::from_slice(&bytes).map_err(fail)?;
            self.event_valid(&e)?;
            if e.memory.id != memory_id || e.memory.revision != index as u64 + 1 {
                return Err("History identity mismatch".into());
            }
            if (require_receipts || self.done_path(&e.operation_id).exists())
                && read(&self.done_path(&e.operation_id), 128)? != hash(&bytes).as_bytes()
            {
                return Err("Uncommitted or corrupted history".into());
            }
            if read(&self.journal_path(&e.operation_id), MAX_JSON)? != bytes {
                return Err("Retained journal and history bytes differ".into());
            }
            if let Some(prev) = out.last() {
                self.reading_transition(prev, &e)?;
                self.organization_transition(prev, &e)?;
                self.audio_transition(prev, &e)?;
                if e.parent_sha256 != Some(self.parent_hash(memory_id, index as u64)?)
                    || e.memory.source_sha256 != prev.memory.source_sha256
                    || e.memory.source_name != prev.memory.source_name
                    || e.memory.captured_at != prev.memory.captured_at
                    || e.memory.imported_text != prev.memory.imported_text
                    || prev.kind == "remove"
                    || (prev.format == FORMAT_V2 && e.format == FORMAT)
                    || (prev.format == FORMAT_V3
                        && ![
                            FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8,
                            FORMAT_V9,
                        ]
                        .contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V4
                        && ![
                            FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
                        ]
                        .contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V5
                        && ![FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9]
                            .contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V6
                        && ![FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9]
                            .contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V7
                        && ![FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V8
                        && ![FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()))
                    || (prev.format == FORMAT_V9 && e.format != FORMAT_V9)
                    || e.memory.audio_source != prev.memory.audio_source
                    || e.memory.imported_text != prev.memory.imported_text
                    || (["restore", "remove"].contains(&e.kind.as_str())
                        && e.memory.note != prev.memory.note)
                    || (e.previous_markdown.is_some()
                        && e.previous_markdown.as_ref() != Some(&prev.markdown))
                {
                    return Err("Broken revision chain".into());
                }
            }
            let backup = self.backup_path(&e.operation_id);
            if backup.exists()
                && Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                    != e.previous_markdown
            {
                return Err("Concurrent editor draft retained in Recall/_meta/preserved; manual resolution required".into());
            }
            out.push(e);
        }
        Ok(out)
    }
    fn recover(&self) -> Result<BTreeMap<String, String>> {
        let mut conflicts = BTreeMap::new();
        let mut groups: BTreeMap<String, Vec<Event>> = BTreeMap::new();
        for p in entries(&self.path("_meta/journal"))? {
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let decoded = decode::<Event>(&p).and_then(|e| {
                self.event_valid(&e)?;
                if p != self.journal_path(&e.operation_id) {
                    return Err("Journal identity mismatch".into());
                }
                Ok(e)
            });
            match decoded {
                Ok(e) => {
                    // A machine draft needs fresh explicit session authorization after interruption.
                    // Never turn selection/restart or cancellation into automatic result promotion.
                    let history = self.history_path(&e.memory.id, e.memory.revision);
                    if e.kind == "machine_reading"
                        && read(&history, MAX_JSON).ok() != Some(read(&p, MAX_JSON)?)
                    {
                        match self.rollback_cancelled_reading(&e) {
                            Ok(true) => continue, // Durably resolved cancellation is inert.
                            Ok(false) => (),
                            Err(error) => {
                                conflicts.insert(e.memory.id.clone(), error);
                                continue;
                            }
                        }
                        // A newer authoritative event may occupy this revision; an abandoned
                        // machine proposal must not poison that human revision as a fork.
                        if !history.exists() {
                            let current = read(&self.event_note_path(&e)?, MAX_JSON).ok();
                            let previous = e.previous_markdown.as_ref().map(|s| s.as_bytes());
                            if current.as_deref() != previous
                                && (current.as_deref() == Some(e.markdown.as_bytes())
                                    || self.backup_path(&e.operation_id).exists())
                            {
                                conflicts.insert(e.memory.id.clone(),"Interrupted reading publication; explicitly recover or resolve preserved files".into());
                            }
                        }
                        continue;
                    }
                    groups.entry(e.memory.id.clone()).or_default().push(e)
                }
                Err(error) => {
                    // Damaged metadata stays visible without disabling healthy identities.
                    let memory_id = decode::<serde_json::Value>(&p)
                        .ok()
                        .and_then(|v| v.get("memory")?.get("id")?.as_str().map(str::to_owned))
                        .filter(|v| id(v).is_ok())
                        .or_else(|| p.file_stem().and_then(|v| v.to_str()).map(str::to_owned))
                        .filter(|value| id(value).is_ok())
                        .ok_or("Unattributable malformed journal; rebuild stopped with all files retained")?;
                    conflicts.insert(memory_id, format!("Retained journal is invalid: {error}"));
                }
            }
        }
        for (memory_id, mut events) in groups {
            // Repair only events already represented by the fully validated
            // immutable chain. Pending forks must not prevent receipt repair,
            // and this pass must never select or publish a competing draft.
            if events.iter().any(|e| {
                !self.done_path(&e.operation_id).exists()
                    && self.history_path(&memory_id, e.memory.revision).exists()
            }) {
                let repaired = self.records_inner(&memory_id, false).and_then(|records| {
                    for committed in records {
                        if !self.done_path(&committed.operation_id).exists() {
                            self.preflight_capacity(&committed)?;
                            let bytes =
                                read(&self.journal_path(&committed.operation_id), MAX_JSON)?;
                            self.repair_receipt(&committed, &bytes)?;
                        }
                    }
                    Ok(())
                });
                if let Err(error) = repaired {
                    conflicts.insert(memory_id.clone(), error);
                    continue;
                }
            }
            if conflicts.contains_key(&memory_id) {
                continue;
            }
            events.sort_by_key(|e| e.memory.revision);
            if events
                .windows(2)
                .any(|w| w[0].memory.revision == w[1].memory.revision)
            {
                conflicts.insert(
                    memory_id,
                    "Competing journal revisions; neither draft was selected".into(),
                );
                continue;
            }
            for e in events {
                if self.done_path(&e.operation_id).exists() {
                    let history = self.history_path(&e.memory.id, e.memory.revision);
                    let validation = (|| {
                        let bytes = read(&history, MAX_JSON)?;
                        if read(&self.journal_path(&e.operation_id), MAX_JSON)? != bytes
                            || read(&self.done_path(&e.operation_id), 128)?
                                != hash(&bytes).as_bytes()
                        {
                            return Err("Journal, history or completion marker changed".to_string());
                        }
                        Ok(())
                    })();
                    if let Err(error) = validation {
                        conflicts.insert(memory_id.clone(), error);
                        break;
                    }
                } else {
                    if let Err(error) = self.finish(&e) {
                        conflicts.insert(memory_id.clone(), error);
                        break;
                    }
                }
            }
        }
        Ok(conflicts)
    }
    /// Reserve every directory's worst-case publication footprint before any
    /// part of a new operation is written. Immutable publication briefly needs
    /// both stage and destination entries; retained crash stages count too.
    fn preflight_capacity(&self, e: &Event) -> Result<()> {
        self.event_valid(e)?;
        if json(e)?.len() as u64 > MAX_JSON {
            return Err("Revision metadata exceeds size limit".into());
        }
        let extension = e
            .memory
            .source_name
            .rsplit('.')
            .next()
            .ok_or("Missing source extension")?;
        let physical_extension = if e.memory.imported_text.is_some() {
            "txt"
        } else if e.memory.audio_source.is_some() {
            "wav"
        } else {
            extension
        };
        let source = self.path(&format!("Sources/{}.{physical_extension}", e.memory.id));
        let history = self.history_path(&e.memory.id, e.memory.revision);
        let history_dir = history.parent().ok_or("Missing history directory")?;
        let mut additions: BTreeMap<PathBuf, usize> = BTreeMap::new();
        for path in [
            source,
            self.journal_path(&e.operation_id),
            self.done_path(&e.operation_id),
            history.clone(),
        ] {
            safe(&path)?;
            let count = if path.try_exists().map_err(fail)? {
                0
            } else {
                2
            };
            *additions
                .entry(path.parent().ok_or("Missing parent")?.to_path_buf())
                .or_default() += count;
        }
        additions.insert(
            self.path("History"),
            usize::from(!history_dir.try_exists().map_err(fail)?),
        );
        let note = self.event_note_path(e)?;
        let backup = self.backup_path(&e.operation_id);
        safe(&note)?;
        safe(&backup)?;
        let note_exists = note.try_exists().map_err(fail)?;
        let publish_note = (!["external", "remove"].contains(&e.kind.as_str())
            && read(&note, MAX_JSON).ok().as_deref() != Some(e.markdown.as_bytes()))
            || (e.kind == "external"
                && [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
                && read(&note, MAX_JSON).ok().as_deref() != Some(e.markdown.as_bytes()));
        additions.insert(
            self.path("Memories"),
            if publish_note {
                if note_exists {
                    1
                } else {
                    2
                }
            } else {
                0
            },
        );
        additions.insert(
            self.path("_meta/preserved"),
            usize::from(
                publish_note
                    && e.kind != "external"
                    && note_exists
                    && !backup.try_exists().map_err(fail)?,
            ),
        );
        for (directory, additional) in additions {
            safe(&directory)?;
            let current = if directory.try_exists().map_err(fail)? {
                entries(&directory)?.len()
            } else {
                0
            };
            if current
                .checked_add(additional)
                .is_none_or(|total| total > MAX_RECORDS)
            {
                return Err(
                    "Vault retention capacity reached; no new operation was written".into(),
                );
            }
        }
        Ok(())
    }
    fn repair_receipt(&self, e: &Event, bytes: &[u8]) -> Result<()> {
        if read(
            &self.history_path(&e.memory.id, e.memory.revision),
            MAX_JSON,
        )? != bytes
        {
            return Err("Competing committed revision".into());
        }
        self.records_inner(&e.memory.id, false)?;
        if e.format == FORMAT_V9 {
            self.fence_manifest_v9()?;
        } else if e.format == FORMAT_V8 {
            self.fence_manifest_v8()?;
        } else if e.format == FORMAT_V7 {
            self.fence_manifest_v7()?;
        } else if e.format == FORMAT_V6 {
            self.fence_manifest_v6()?;
        } else if e.format == FORMAT_V5 {
            self.fence_manifest_v5()?;
        } else if e.format == FORMAT_V4 {
            self.fence_manifest_v4()?;
        } else if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        boundary!("before_receipt", &self.done_path(&e.operation_id));
        immutable(&self.done_path(&e.operation_id), hash(bytes).as_bytes())?;
        boundary!("after_receipt", &self.done_path(&e.operation_id));
        Ok(())
    }
    fn finish(&self, e: &Event) -> Result<()> {
        self.preflight_capacity(e)?;
        let hp = self.history_path(&e.memory.id, e.memory.revision);
        let bytes = read(&self.journal_path(&e.operation_id), MAX_JSON)?;
        let journal: Event = serde_json::from_slice(&bytes).map_err(fail)?;
        if json(&journal)? != json(e)? {
            return Err("Journal changed during publication".into());
        }
        if hp.exists() {
            // An immutable historical event can only repair its own receipt.
            // Never replay its Markdown over a later head (especially a tombstone).
            return self.repair_receipt(e, &bytes);
        }
        self.verify_source(&e.memory)?;
        self.reading_publish_allowed(e)?;
        if e.expected_revision > 0 {
            let records = self.records(&e.memory.id)?;
            let last = records.last().ok_or("Missing parent")?;
            self.reading_transition(last, e)?;
            self.audio_transition(last, e)?;
            if last.kind == "remove"
                || last.memory.revision != e.expected_revision
                || e.parent_sha256 != Some(self.parent_hash(&e.memory.id, e.expected_revision)?)
                || last.memory.source_sha256 != e.memory.source_sha256
                || last.memory.source_name != e.memory.source_name
                || last.memory.captured_at != e.memory.captured_at
                || (last.format == FORMAT_V2 && e.format == FORMAT)
                || (["remove", "restore"].contains(&e.kind.as_str())
                    && last.memory.note != e.memory.note)
                || (e.previous_markdown.is_some()
                    && e.previous_markdown.as_ref() != Some(&last.markdown))
            {
                return Err("Stale or invalid journal parent; retained without publication".into());
            }
        } else if hp.parent().is_some_and(|p| p.exists())
            && !entries(hp.parent().ok_or("Missing parent")?)?.is_empty()
        {
            return Err("Capture history already exists".into());
        }
        if e.format == FORMAT_V9 {
            self.fence_manifest_v9()?;
        } else if e.format == FORMAT_V8 {
            self.fence_manifest_v8()?;
        } else if e.format == FORMAT_V7 {
            self.fence_manifest_v7()?;
        } else if e.format == FORMAT_V6 {
            self.fence_manifest_v6()?;
        } else if e.format == FORMAT_V5 {
            self.fence_manifest_v5()?;
        } else if e.format == FORMAT_V4 {
            self.fence_manifest_v4()?;
        } else if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        let dir = hp.parent().ok_or("Missing parent")?;
        safe(dir)?;
        if !dir.exists() {
            fs::create_dir(dir).map_err(fail)?;
            sync_dir(dir.parent().ok_or("Missing parent")?)?;
        }
        if e.expected_revision > 0 {
            let prev = read(
                &self.history_path(&e.memory.id, e.expected_revision),
                MAX_JSON,
            )?;
            if Some(hash(&prev)) != e.parent_sha256 {
                return Err("Parent changed during recovery".into());
            }
        }
        let np = self.event_note_path(e)?;
        boundary!("before_note", &np);
        if self
            .inventory(&e.memory.id, e.note_path.as_deref())?
            .is_some_and(|p| p != np)
        {
            return Err("Memory moved during publication; journal and files retained".into());
        }
        if e.kind == "remove" {
            boundary!("before_history", &hp);
            self.removal_precondition(e)?;
            immutable(&hp, &bytes)?;
            boundary!("before_receipt", &self.done_path(&e.operation_id));
            immutable(&self.done_path(&e.operation_id), hash(&bytes).as_bytes())?;
            boundary!("after_receipt", &self.done_path(&e.operation_id));
            self.records(&e.memory.id)?;
            return Ok(());
        }
        let backup = self.backup_path(&e.operation_id);
        let current = match read(&np, MAX_JSON) {
            Ok(b) => Some(String::from_utf8(b).map_err(fail)?),
            Err(_) if !np.exists() => None,
            Err(err) => return Err(err),
        };
        if e.kind == "restore" && current.is_some() {
            return Err(
                "Restore target reappeared; retained journal needs explicit resolution".into(),
            );
        }
        if current.as_deref() != Some(&e.markdown) {
            if e.kind == "external" {
                let expected_draft =
                    if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&e.format.as_str()) {
                        e.previous_markdown.as_deref().and_then(|old| {
                            with_human_note(old, &e.memory.note, e.memory.imported_text.is_some())
                        })
                    } else {
                        Some(e.markdown.clone())
                    };
                if current.as_deref() != expected_draft.as_deref() {
                    return Err(
                        "External note changed during reconciliation; journal and disk preserved"
                            .into(),
                    );
                }
                if current.is_none() {
                    return Err("External note disappeared during reconciliation".into());
                }
                let stage = np.with_extension(format!("stage-{}", Uuid::new_v4()));
                create(&stage, e.markdown.as_bytes())?;
                if read(&np, MAX_JSON)
                    .ok()
                    .and_then(|b| String::from_utf8(b).ok())
                    .as_deref()
                    != current.as_deref()
                {
                    return Err(
                        "External note changed during reconciliation; journal and disk preserved"
                            .into(),
                    );
                }
                replace(&stage, &np)?;
            } else if current != e.previous_markdown {
                // Crash after moving the base but before publishing the new note.
                if current.is_some()
                    || !backup.exists()
                    || Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                        != e.previous_markdown
                {
                    return Err("Concurrent Markdown edit; journal draft and disk preserved".into());
                }
            } else if current.is_some() {
                if backup.exists() {
                    return Err("Publication backup already exists; resolve conflict".into());
                }
                rename(&np, &backup)?;
                if Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                    != e.previous_markdown
                {
                    return Err(
                        "Concurrent editor draft preserved in Recall/_meta/preserved".into(),
                    );
                }
            }
            if e.kind != "external" {
                atomic_new(&np, e.markdown.as_bytes())?;
            }
        }
        boundary!("before_history", &hp);
        if self.inventory(&e.memory.id, e.note_path.as_deref())? != Some(np.clone()) {
            return Err("Memory moved or duplicated during publication".into());
        }
        // Check again immediately before committing. A concurrent edit remains intact.
        if read(&np, MAX_JSON)? != e.markdown.as_bytes() {
            return Err("Concurrent Markdown edit; retry refresh".into());
        }
        if backup.exists()
            && Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                != e.previous_markdown
        {
            return Err("Concurrent editor draft preserved in Recall/_meta/preserved".into());
        }
        immutable(&hp, &bytes)?;
        boundary!("before_receipt", &self.done_path(&e.operation_id));
        immutable(&self.done_path(&e.operation_id), hash(&bytes).as_bytes())?;
        boundary!("after_receipt", &self.done_path(&e.operation_id));
        self.records(&e.memory.id)?;
        Ok(())
    }
    fn commit(&self, e: &Event) -> Result<VaultMemory> {
        let mut normalized = e.clone();
        let manifest: Manifest = decode(&self.path("_meta/manifest.json"))?;
        if [FORMAT_V8, FORMAT_V9].contains(&e.format.as_str())
            || [FORMAT_V8, FORMAT_V9].contains(&manifest.format.as_str())
        {
            // A v9 manifest or event keeps every later mutation in the v9 envelope;
            // older-format events are never written under a v9 writer fence.
            normalized.format = if e.format == FORMAT_V9 || manifest.format == FORMAT_V9 {
                FORMAT_V9
            } else {
                FORMAT_V8
            }
            .into();
            if normalized.context_link_projection.is_none() {
                normalized.context_link_projection = if normalized.expected_revision == 0 {
                    Some(Vec::new())
                } else {
                    Some(match self.records(&normalized.memory.id)?.last() {
                        Some(event)
                            if [FORMAT_V7, FORMAT_V8, FORMAT_V9]
                                .contains(&event.format.as_str()) =>
                        {
                            event
                                .context_link_projection
                                .clone()
                                .ok_or("Missing v7 parent context projection")?
                        }
                        Some(_) => Vec::new(),
                        None => return Err("Missing v7 parent event".into()),
                    })
                };
            }
            if [
                "correct",
                "external",
                "reading_correction",
                "remove",
                "restore",
                "audio_transcript_correction",
            ]
            .contains(&normalized.kind.as_str())
            {
                if let Some(organization) = normalized.memory.organization.as_mut() {
                    organization.suppressed = true;
                }
                if let Some(projection) = normalized.context_link_projection.as_mut() {
                    projection
                        .iter_mut()
                        .for_each(|entry| entry.suppressed = true);
                }
            }
            // A corrected transcript, removal or restore retires the machine proposals that
            // were derived from the earlier wording; history keeps them.
            if [
                "audio_transcript_correction",
                "audio_transcription",
                "remove",
                "restore",
            ]
            .contains(&normalized.kind.as_str())
            {
                if let Some(proposal) = normalized.memory.audio_organization.as_mut() {
                    proposal.suppressed = true;
                }
            }
            normalized.markdown = markdown_for_event(&normalized)?;
        } else if e.format == FORMAT_V7 || manifest.format == FORMAT_V7 {
            normalized.format = FORMAT_V7.into();
            if normalized.context_link_projection.is_none() {
                normalized.context_link_projection = if normalized.expected_revision == 0 {
                    Some(Vec::new())
                } else {
                    Some(match self.records(&normalized.memory.id)?.last() {
                        Some(event) if event.format == FORMAT_V7 => event
                            .context_link_projection
                            .clone()
                            .ok_or("Missing v7 parent context projection")?,
                        Some(_) => Vec::new(),
                        None => return Err("Missing v7 parent event".into()),
                    })
                };
            }
            if [
                "correct",
                "external",
                "reading_correction",
                "remove",
                "restore",
            ]
            .contains(&normalized.kind.as_str())
            {
                if let Some(organization) = normalized.memory.organization.as_mut() {
                    organization.suppressed = true;
                }
                if let Some(projection) = normalized.context_link_projection.as_mut() {
                    projection
                        .iter_mut()
                        .for_each(|entry| entry.suppressed = true);
                }
            }
            normalized.markdown = markdown_for_event(&normalized)?;
        } else if e.kind == "external" {
            normalized.format = e.format.clone();
        } else if e.format == FORMAT_V6 || manifest.format == FORMAT_V6 {
            normalized.format = FORMAT_V6.into();
            normalized.markdown = markdown_for(&FORMAT_V6, &normalized.memory);
        } else if e.format == FORMAT_V5 || manifest.format == FORMAT_V5 {
            normalized.format = FORMAT_V5.into();
            normalized.markdown = markdown_for(&FORMAT_V5, &normalized.memory);
        } else if e.memory.reading.is_some() || manifest.format == FORMAT_V4 {
            normalized.format = FORMAT_V4.into();
            normalized.markdown = v4_markdown(&normalized.memory);
        } else if manifest.format == FORMAT_V3 {
            normalized.format = FORMAT_V3.into();
        }
        if [
            FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&normalized.format.as_str())
        {
            let mut canonical = payload(
                &normalized.kind,
                &normalized.memory.id,
                normalized.expected_revision,
                &normalized.memory.note,
                &normalized.memory.source_sha256,
                &normalized.memory.source_name,
            )?;
            if normalized.kind == "remove" {
                canonical = hash(&json(&(canonical, &normalized.expected_state))?);
            }
            normalized.payload_sha256 = hash(&json(&(canonical, &normalized.memory.reading))?);
            if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&normalized.format.as_str()) {
                normalized.payload_sha256 = hash(&json(&(
                    normalized.payload_sha256,
                    &normalized.memory.organization,
                ))?);
            }
            if normalized.format == FORMAT_V7 {
                normalized.payload_sha256 = hash(&json(&(
                    normalized.payload_sha256,
                    &normalized.context_link_projection,
                ))?);
            } else if normalized.format == FORMAT_V8 {
                normalized.payload_sha256 = hash(&json(&(
                    normalized.payload_sha256,
                    &normalized.context_link_projection,
                    &normalized.memory.imported_text,
                ))?);
            } else if normalized.format == FORMAT_V9 {
                normalized.payload_sha256 = hash(&json(&(
                    normalized.payload_sha256,
                    &normalized.context_link_projection,
                    &normalized.memory.imported_text,
                    &normalized.memory.audio_source,
                    &normalized.memory.audio_transcript,
                ))?);
            }
            if normalized.format == FORMAT_V9 && normalized.memory.audio_organization.is_some() {
                normalized.payload_sha256 = hash(&json(&(
                    normalized.payload_sha256,
                    &normalized.memory.audio_organization,
                ))?);
            }
        }
        let e = &normalized;
        self.preflight_capacity(e)?;
        if e.format == FORMAT_V9 {
            self.fence_manifest_v9()?;
        } else if e.format == FORMAT_V8 {
            self.fence_manifest_v8()?;
        } else if e.format == FORMAT_V7 {
            self.fence_manifest_v7()?;
        } else if e.format == FORMAT_V6 {
            self.fence_manifest_v6()?;
        } else if e.format == FORMAT_V5 {
            self.fence_manifest_v5()?;
        } else if e.format == FORMAT_V4 {
            self.fence_manifest_v4()?;
        } else if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        immutable(&self.journal_path(&e.operation_id), &json(e)?)?;
        self.finish(e)?;
        let mut m = e.memory.clone();
        m.note_path = self
            .event_note_path(e)?
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned);
        if e.kind == "remove" {
            m.state = "deleted".into();
        }
        Ok(m)
    }
    fn receipt(&self, operation_id: &str) -> Result<Option<Event>> {
        id(operation_id)?;
        let p = self.journal_path(operation_id);
        if !p.exists() {
            return Ok(None);
        }
        let e: Event = decode(&p)?;
        self.event_valid(&e)?;
        if e.operation_id != operation_id {
            return Err("Operation identity mismatch".into());
        }
        if read(
            &self.history_path(&e.memory.id, e.memory.revision),
            MAX_JSON,
        )? != read(&p, MAX_JSON)?
        {
            return Err("Historical receipt payload changed".into());
        }
        if !self
            .records(&e.memory.id)?
            .iter()
            .any(|r| r.operation_id == e.operation_id)
        {
            return Err("Operation is still pending; journal retained".into());
        }
        Ok(Some(e))
    }
    fn current(&self, memory_id: &str, pending: &BTreeMap<String, String>) -> Result<VaultMemory> {
        if let Some(error) = pending.get(memory_id) {
            // A validated terminal tombstone remains authoritative even when a
            // stale draft is retained. It can be inspected, never used as evidence.
            let records = self.records(memory_id)?;
            let last = records.last().ok_or("Missing history")?;
            if last.kind != "remove" {
                return Err(error.clone());
            }
            let mut m = last.memory.clone();
            m.state = "deleted".into();
            m.note_path = last.note_path.clone();
            m.conflict = Some(error.clone());
            return Ok(m);
        }
        self.reconciled(memory_id)
    }
    pub fn capture_receipt(&self, operation_id: &str, note: &str) -> Result<Option<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        note_valid(note)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "capture" || e.memory.note != note {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending).map(Some);
        }
        Ok(None)
    }
    pub fn recover_text_import(&self, operation_id: &str) -> Result<Option<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        if let Some(event) = self.receipt(operation_id)? {
            if event.kind != "capture" || event.memory.imported_text.is_none() {
                return Err("Operation ID was used for another capture".into());
            }
            self.finish_text_import_organization(&event)?;
            return self.current(&event.memory.id, &pending).map(Some);
        }
        let path = self.import_intent_path(operation_id)?;
        if !path.exists() {
            return Ok(None);
        }
        let intent: TextImportIntent = decode(&path)?;
        if intent.format != FORMAT_V8
            || intent.vault_id != self.id
            || intent.operation_id != operation_id
        {
            return Err("Text import intent identity conflict; explicit recovery required".into());
        }
        let source_path = self.path(&format!("Sources/{operation_id}.txt"));
        if !source_path.exists() {
            return Ok(None);
        }
        let bytes = read(&source_path, MAX_NOTE as u64)?;
        if bytes.len() as u64 != intent.source_bytes || hash(&bytes) != intent.source_sha256 {
            return Err("Imported source conflicts with its durable intent".into());
        }
        self.finish_text_import(intent, bytes).map(Some)
    }
    pub fn import_text_path(&self, operation_id: &str, path: &Path) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        if let Some(event) = self.receipt(operation_id)? {
            if event.kind != "capture" || event.memory.imported_text.is_none() {
                return Err("Operation ID was used for another capture".into());
            }
            self.finish_text_import_organization(&event)?;
            return self.current(&event.memory.id, &pending);
        }
        let (name, extension, bytes, semantic, semantic_hash) = read_import(path)?;
        let source_hash = hash(&bytes);
        let meta = ImportedText {
            original_name: name.clone(),
            original_extension: extension.clone(),
            source_media_type: "text/plain; charset=utf-8".into(),
            semantic_sha256: semantic_hash.clone(),
            semantic_bytes: semantic.len() as u64,
            semantic_characters: semantic.chars().count() as u64,
        };
        let organization_snapshot = self.load_organization_marker()?;
        let mut intent = TextImportIntent {
            format: FORMAT_V8.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            original_name: name,
            original_extension: extension,
            source_media_type: "text/plain; charset=utf-8".into(),
            source_sha256: source_hash,
            source_bytes: bytes.len() as u64,
            semantic_sha256: semantic_hash,
            semantic_bytes: semantic.len() as u64,
            semantic_characters: semantic.chars().count() as u64,
            captured_at: timestamp(),
            organization_snapshot,
        };
        let dir = self.ensure_imports_dir()?;
        let intent_path = self.import_intent_path(operation_id)?;
        if intent_path.exists() {
            let old: TextImportIntent = decode(&intent_path)?;
            let same_material = old.format == intent.format
                && old.vault_id == intent.vault_id
                && old.operation_id == intent.operation_id
                && old.original_name == intent.original_name
                && old.original_extension == intent.original_extension
                && old.source_media_type == intent.source_media_type
                && old.source_sha256 == intent.source_sha256
                && old.source_bytes == intent.source_bytes
                && old.semantic_sha256 == intent.semantic_sha256
                && old.semantic_bytes == intent.semantic_bytes
                && old.semantic_characters == intent.semantic_characters;
            if !same_material {
                return Err(
                    "Operation ID reused with different text file; recovery required".into(),
                );
            }
            intent.captured_at = old.captured_at;
            intent.organization_snapshot = old.organization_snapshot;
        } else {
            let intent_bytes = json(&intent)?;
            create(&intent_path, &intent_bytes)?;
            sync_dir(&dir)?;
        }
        // The consent snapshot and queue intent are durable before the original is published.
        immutable(&self.path(&format!("Sources/{operation_id}.txt")), &bytes)?;
        let organization_intent = self.import_organization_intent(&intent, true)?;
        let mut memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: semantic,
            reading: None,
            organization: None,
            source_sha256: intent.source_sha256.clone(),
            source_name: intent.original_name.clone(),
            captured_at: intent.captured_at.clone(),
            updated_at: intent.captured_at.clone(),
            conflict: None,
            state: "active".into(),
            note_path: Some(format!("{operation_id}.md")),
            related_context: Vec::new(),
            context_repair_pending: false,
            imported_text: Some(meta),
            audio_source: None,
            audio_transcript: None,
            audio_organization: None,
        };
        let base = payload(
            "capture",
            operation_id,
            0,
            &memory.note,
            &memory.source_sha256,
            &memory.source_name,
        )?;
        let digest = hash(&json(&(
            hash(&json(&(
                hash(&json(&(base, &Option::<Reading>::None))?),
                &Option::<OrganizationProposal>::None,
            ))?),
            &Some(Vec::<ContextLinkProjection>::new()),
            &memory.imported_text,
        ))?);
        let mut event = Event {
            format: FORMAT_V8.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            expected_revision: 0,
            payload_sha256: digest,
            parent_sha256: None,
            origin: "human:recall".into(),
            note_path: Some(format!("{operation_id}.md")),
            expected_state: None,
            previous_markdown: None,
            markdown: String::new(),
            memory: memory.clone(),
            context_link_projection: Some(Vec::new()),
        };
        event.markdown = markdown_for_event(&event)?;
        self.preflight_capacity(&event)?;
        memory = self.commit(&event)?;
        let _ = self.finish_capture_organization(organization_intent, &memory);
        Ok(memory)
    }
    fn finish_text_import(&self, intent: TextImportIntent, bytes: Vec<u8>) -> Result<VaultMemory> {
        let raw =
            std::str::from_utf8(&bytes).map_err(|_| "Imported source is no longer valid UTF-8")?;
        if raw.contains('\0') {
            return Err("Imported source contains NUL".into());
        }
        let semantic = raw.strip_prefix('\u{feff}').unwrap_or(raw);
        if hash(semantic.as_bytes()) != intent.semantic_sha256
            || semantic.len() as u64 != intent.semantic_bytes
            || semantic.chars().count() as u64 != intent.semantic_characters
        {
            return Err("Imported source does not match its durable intent".into());
        }
        let imported_text = ImportedText {
            original_name: intent.original_name.clone(),
            original_extension: intent.original_extension.clone(),
            source_media_type: intent.source_media_type.clone(),
            semantic_sha256: intent.semantic_sha256.clone(),
            semantic_bytes: intent.semantic_bytes,
            semantic_characters: intent.semantic_characters,
        };
        let memory = VaultMemory {
            id: intent.operation_id.clone(),
            revision: 1,
            note: semantic.into(),
            reading: None,
            organization: None,
            source_sha256: intent.source_sha256.clone(),
            source_name: intent.original_name.clone(),
            captured_at: intent.captured_at.clone(),
            updated_at: intent.captured_at.clone(),
            conflict: None,
            state: "active".into(),
            note_path: Some(format!("{}.md", intent.operation_id)),
            related_context: Vec::new(),
            context_repair_pending: false,
            imported_text: Some(imported_text),
            audio_source: None,
            audio_transcript: None,
            audio_organization: None,
        };
        // A source already published after interruption is completed with the same ID and no dispatch.
        let base = payload(
            "capture",
            &memory.id,
            0,
            &memory.note,
            &memory.source_sha256,
            &memory.source_name,
        )?;
        let digest = hash(&json(&(
            hash(&json(&(
                hash(&json(&(base, &Option::<Reading>::None))?),
                &Option::<OrganizationProposal>::None,
            ))?),
            &Some(Vec::<ContextLinkProjection>::new()),
            &memory.imported_text,
        ))?);
        let mut event = Event {
            format: FORMAT_V8.into(),
            vault_id: self.id.clone(),
            operation_id: memory.id.clone(),
            kind: "capture".into(),
            expected_revision: 0,
            payload_sha256: digest,
            parent_sha256: None,
            origin: "human:recall".into(),
            note_path: memory.note_path.clone(),
            expected_state: None,
            previous_markdown: None,
            markdown: String::new(),
            memory,
            context_link_projection: Some(Vec::new()),
        };
        event.markdown = markdown_for_event(&event)?;
        // Persist the consent-bound organization intent before capture commit. If the
        // process stops after the receipt is durable, replay can finish this intent.
        let organization_intent = self.import_organization_intent(&intent, true)?;
        let saved = self.commit(&event)?;
        let _ = self.finish_capture_organization(organization_intent, &saved);
        Ok(saved)
    }
    fn finish_text_import_organization(&self, event: &Event) -> Result<()> {
        let path = self.import_intent_path(&event.operation_id)?;
        if !path.exists() {
            return Ok(());
        }
        let import: TextImportIntent = decode(&path)?;
        if import.format != FORMAT_V8
            || import.vault_id != self.id
            || import.operation_id != event.operation_id
            || import.source_sha256 != event.memory.source_sha256
        {
            return Err("Text import intent does not match its durable capture".into());
        }
        let organization_intent = self.import_organization_intent(&import, true)?;
        let _ = self.finish_capture_organization(organization_intent, &event.memory);
        Ok(())
    }
    fn import_organization_intent(
        &self,
        import: &TextImportIntent,
        create_if_missing: bool,
    ) -> Result<Option<OrganizationIntent>> {
        let root = self.path("_meta/organize");
        if !root.exists() {
            return Ok(None);
        }
        for path in entries(&root)? {
            if path.file_name().and_then(|n| n.to_str()) == Some("consent.json")
                || path.extension().and_then(|e| e.to_str()) != Some("json")
            {
                continue;
            }
            let Ok(intent) = decode::<OrganizationIntent>(&path) else {
                continue;
            };
            if intent.binding.memory_id == import.operation_id
                && intent.binding.source_sha256 == import.source_sha256
                && intent.binding.input_sha256 == import.semantic_sha256
                && intent.binding.captured_at == import.captured_at
                && intent.binding.source_kind == "text"
            {
                return Ok(Some(intent));
            }
        }
        if !create_if_missing {
            return Ok(None);
        }
        if import.organization_snapshot.is_none()
            || self.load_organization_marker()? != import.organization_snapshot
        {
            return Ok(None);
        }
        let source = String::from_utf8(read(
            &self.path(&format!("Sources/{}.txt", import.operation_id)),
            MAX_NOTE as u64,
        )?)
        .map_err(fail)?;
        let semantic = source.strip_prefix('\u{feff}').unwrap_or(&source);
        self.prepare_capture_organization(
            &import.operation_id,
            "text",
            &import.source_sha256,
            &import.semantic_sha256,
            &import.source_media_type,
            semantic,
            &import.captured_at,
        )
    }
    pub fn capture_path(&self, operation_id: &str, note: &str, path: &Path) -> Result<VaultMemory> {
        let bytes = read(path, MAX_PHOTO)?;
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid photo name")?;
        self.capture(operation_id, name, &bytes, note)
    }
    pub fn capture(
        &self,
        operation_id: &str,
        name: &str,
        bytes: &[u8],
        note: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        note_valid(note)?;
        image_type(bytes)?;
        if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', '\0']) {
            return Err("Invalid source name".into());
        }
        let extension = match image_type(bytes)? {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            _ => "webp",
        };
        let normalized_name = if name.ends_with(&format!(".{extension}")) {
            name.to_string()
        } else {
            format!("{name}.{extension}")
        };
        let name = normalized_name.as_str();
        let source_hash = hash(bytes);
        let payload_sha256 = payload("capture", operation_id, 0, note, &source_hash, name)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.payload_sha256 != payload_sha256 {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        let now = timestamp();
        let media_type = image_type(bytes)?.to_owned();
        let organization_intent = self.prepare_capture_organization(
            operation_id,
            "photo",
            &source_hash,
            &source_hash,
            &media_type,
            note,
            &now,
        )?;
        let memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: note.into(),
            reading: None,
            organization: None,
            source_sha256: source_hash,
            source_name: name.into(),
            captured_at: now.clone(),
            updated_at: now,
            conflict: None,
            state: "active".into(),
            note_path: None,
            related_context: Vec::new(),
            context_repair_pending: false,
            imported_text: None,
            audio_source: None,
            audio_transcript: None,
            audio_organization: None,
        };
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            note_path: Some(format!("{operation_id}.md")),
            expected_state: None,
            expected_revision: 0,
            payload_sha256,
            parent_sha256: None,
            origin: "human:recall".into(),
            markdown: markdown_for(FORMAT_V2, &memory),
            previous_markdown: None,
            memory,
            context_link_projection: None,
        };
        self.preflight_capacity(&e)?;
        immutable(
            &self.path(&format!("Sources/{operation_id}.{extension}")),
            bytes,
        )?;
        let saved = self.commit(&e)?;
        let _ = self.finish_capture_organization(organization_intent, &saved);
        Ok(saved)
    }
    pub fn capture_text(&self, operation_id: &str, text: &str) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        note_valid(text)?;
        if text.trim().is_empty() {
            return Err("Text capture cannot be empty or whitespace only".into());
        }
        let bytes = text.as_bytes();
        let source_hash = hash(bytes);
        let capture_payload = payload("capture", operation_id, 0, text, &source_hash, "note.txt")?;
        let payload_sha256 = hash(&json(&(capture_payload, &Option::<Reading>::None))?);
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "capture" || e.memory.note != text || e.memory.source_name != "note.txt" {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        let now = timestamp();
        let organization_intent = self.prepare_capture_organization(
            operation_id,
            "text",
            &source_hash,
            &source_hash,
            "text/plain; charset=utf-8",
            text,
            &now,
        )?;
        let memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: text.into(),
            reading: None,
            organization: None,
            source_sha256: source_hash,
            source_name: "note.txt".into(),
            captured_at: now.clone(),
            updated_at: now,
            conflict: None,
            state: "active".into(),
            note_path: None,
            related_context: Vec::new(),
            context_repair_pending: false,
            imported_text: None,
            audio_source: None,
            audio_transcript: None,
            audio_organization: None,
        };
        let e = Event {
            format: FORMAT_V5.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            expected_revision: 0,
            payload_sha256,
            parent_sha256: None,
            origin: "human:recall".into(),
            note_path: Some(format!("{operation_id}.md")),
            expected_state: None,
            previous_markdown: None,
            markdown: markdown_for(FORMAT_V5, &memory),
            memory,
            context_link_projection: None,
        };
        self.preflight_capacity(&e)?;
        immutable(&self.path(&format!("Sources/{operation_id}.txt")), bytes)?;
        let saved = self.commit(&e)?;
        let _ = self.finish_capture_organization(organization_intent, &saved);
        Ok(saved)
    }
    fn reconciled(&self, memory_id: &str) -> Result<VaultMemory> {
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut m = last.memory.clone();
        if last.kind == "remove" {
            m.state = "deleted".into();
            m.note_path = last.note_path.clone();
            return Ok(m);
        }
        self.verify_source(&m)?;
        let np = match self.inventory(memory_id, last.note_path.as_deref()) {
            Ok(Some(p)) => p,
            Ok(None) => {
                m.state = "missing".into();
                m.conflict =
                    Some("Markdown note missing; explicitly restore or remove this memory".into());
                return Ok(m);
            }
            Err(error) => {
                m.state = "conflict".into();
                m.conflict = Some(error);
                return Ok(m);
            }
        };
        m.note_path = np.file_name().and_then(|s| s.to_str()).map(str::to_owned);
        if last.note_path.as_deref() != m.note_path.as_deref() {
            // A direct Obsidian rename has already happened; stale inbound links
            // are filtered by current_related_links while suppression repairs run.
            let _ = self.suppress_inbound_context_links(memory_id);
        }
        let disk = String::from_utf8(read(&np, MAX_JSON)?).map_err(fail)?;
        if disk == last.markdown {
            return Ok(m);
        }
        let render_format = &last.format;
        let prefix = if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9]
            .contains(&render_format.as_str())
        {
            if [FORMAT_V8, FORMAT_V9].contains(&render_format.as_str())
                && last.memory.imported_text.is_some()
            {
                let marker =
                    "<!-- Recall imported annotation boundary -->\n\n## Human annotation\n\n";
                let Some(mark) = last.markdown.find(marker) else {
                    m.state = "conflict".into();
                    m.conflict = Some(
                        "Imported-text annotation boundary changed; preserve the note and resolve explicitly"
                            .into(),
                    );
                    return Ok(m);
                };
                last.markdown[..mark + marker.len()].to_owned()
            } else {
                let marker = format!("<!-- Recall memory {} | human annotation -->", m.id);
                let Some(mark) = last.markdown.find(&marker) else {
                    m.state = "conflict".into();
                    m.conflict = Some(
                    "Managed organization marker changed; preserve the note and resolve explicitly"
                        .into(),
                );
                    return Ok(m);
                };
                let Some(heading_end) = last.markdown[mark..].find("## Human annotation\n\n")
                else {
                    m.state = "conflict".into();
                    m.conflict = Some(
                    "Human annotation boundary changed; preserve the note and resolve explicitly"
                        .into(),
                );
                    return Ok(m);
                };
                last.markdown[..mark + heading_end + "## Human annotation\n\n".len()].to_owned()
            }
        } else {
            markdown_for(
                render_format,
                &VaultMemory {
                    note: String::new(),
                    ..m.clone()
                },
            )
        };
        let Some(note) = disk.strip_prefix(&prefix) else {
            m.state = "conflict".into();
            m.conflict = Some(
                "Markdown identity or evidence link changed; restore the header to reconcile"
                    .into(),
            );
            return Ok(m);
        };
        note_valid(note)?;
        m.revision += 1;
        m.note = note.into();
        m.updated_at = timestamp();
        if let Some(organization) = m.organization.as_mut() {
            organization.suppressed = true;
        }
        let operation_id = Uuid::new_v4().to_string();
        let event_format = if [
            FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&render_format.as_str())
        {
            render_format.as_str()
        } else {
            FORMAT_V2
        };
        let mut external_payload = payload(
            "external",
            &m.id,
            last.memory.revision,
            &m.note,
            &m.source_sha256,
            &m.source_name,
        )?;
        if [
            FORMAT_V3, FORMAT_V4, FORMAT_V5, FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9,
        ]
        .contains(&event_format)
        {
            external_payload = hash(&json(&(external_payload, &m.reading))?);
            if [FORMAT_V6, FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&event_format) {
                external_payload = hash(&json(&(external_payload, &m.organization))?);
            }
        }
        let mut context_link_projection = if event_format == FORMAT_V7 {
            let mut projection = last
                .context_link_projection
                .clone()
                .ok_or("Missing v7 context projection")?;
            projection
                .iter_mut()
                .for_each(|entry| entry.suppressed = true);
            external_payload = hash(&json(&(external_payload, &Some(projection.clone())))?);
            Some(projection)
        } else {
            None
        };
        let e = Event {
            format: event_format.into(),
            vault_id: self.id.clone(),
            operation_id,
            kind: "external".into(),
            note_path: m.note_path.clone(),
            expected_state: None,
            expected_revision: last.memory.revision,
            payload_sha256: external_payload,
            parent_sha256: Some(self.parent_hash(&last.memory.id, last.memory.revision)?),
            origin: "human:obsidian".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: if event_format == FORMAT_V7 {
                v7_markdown(&m, context_link_projection.as_deref().unwrap_or(&[]))?
            } else if event_format == FORMAT_V6 {
                markdown_for(FORMAT_V6, &m)
            } else {
                disk
            },
            memory: m,
            context_link_projection: context_link_projection.take(),
        };
        let mut committed = self.commit(&e)?;
        if self.suppress_inbound_context_links(memory_id).is_err() {
            committed.context_repair_pending = true;
        }
        Ok(committed)
    }
    #[cfg(test)]
    pub fn list(&self, query: &str) -> Result<Vec<VaultMemory>> {
        self.list_with_deleted(query, false)
    }
    pub fn list_with_deleted(
        &self,
        query: &str,
        include_deleted: bool,
    ) -> Result<Vec<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        if query.len() > 4096 {
            return Err("Query too long".into());
        }
        let manifest: Manifest = decode(&self.path("_meta/manifest.json"))?;
        let require_summary_evidence = [FORMAT_V4, FORMAT_V5].contains(&manifest.format.as_str());
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let mut out = Vec::new();
        for p in entries(&self.path("History"))? {
            let memory_id = p
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid history filename")?;
            id(memory_id)?;
            let m = match self.current(memory_id, &pending) {
                Ok(m) => m,
                Err(err) => VaultMemory {
                    id: memory_id.into(),
                    revision: 0,
                    note: String::new(),
                    reading: None,
                    organization: None,
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Memory unavailable: {err}")),
                    state: "conflict".into(),
                    note_path: None,
                    related_context: Vec::new(),
                    context_repair_pending: false,
                    imported_text: None,
                    audio_source: None,
                    audio_transcript: None,
                    audio_organization: None,
                },
            };
            if m.state == "deleted" && !include_deleted {
                continue;
            }
            let note = m.note.to_lowercase();
            let reading = m
                .reading
                .as_ref()
                .map(|r| r.effective_text())
                .unwrap_or("")
                .to_lowercase();
            let filename = m.source_name.to_lowercase();
            let note_filename = m.note_path.as_deref().unwrap_or("").to_lowercase();
            let structured = if m
                .reading
                .as_ref()
                .is_some_and(|r| r.human_correction.is_none())
            {
                structured_search_text(&m, require_summary_evidence).to_lowercase()
            } else {
                String::new()
            };
            let spoken = {
                let mut text = m
                    .audio_transcript
                    .as_ref()
                    .and_then(|_| audio_current_text(&m))
                    .map(|(text, _, _)| text.to_lowercase())
                    .unwrap_or_default();
                // Current (unsuppressed) machine proposals are searchable like text organization.
                if let Some(proposal) = m.audio_organization.as_ref().filter(|p| !p.suppressed) {
                    text.push(' ');
                    text.push_str(
                        &serde_json::to_string(&proposal.result.extraction)
                            .unwrap_or_default()
                            .to_lowercase(),
                    );
                }
                text
            };
            let organized = m
                .organization
                .as_ref()
                .filter(|o| !o.suppressed && o.review_state == "unreviewed")
                .and_then(|o| serde_json::to_string(&o.result.extraction).ok())
                .unwrap_or_default()
                .to_lowercase();
            if terms.is_empty()
                || (m.state == "active"
                    && m.conflict.is_none()
                    && terms.iter().all(|term| {
                        note.contains(term)
                            || reading.contains(term)
                            || structured.contains(term)
                            || organized.contains(term)
                            || spoken.contains(term)
                            || filename.contains(term)
                            || note_filename.contains(term)
                    }))
            {
                out.push(m);
            }
        }
        for (memory_id, error) in &pending {
            if terms.is_empty()
                && !self.path(&format!("History/{memory_id}")).exists()
                && !out.iter().any(|m| m.id == *memory_id)
            {
                out.push(VaultMemory {
                    id: memory_id.clone(),
                    revision: 0,
                    note: String::new(),
                    reading: None,
                    organization: None,
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Pending capture preserved: {error}")),
                    state: "conflict".into(),
                    note_path: None,
                    related_context: Vec::new(),
                    context_repair_pending: false,
                    imported_text: None,
                    audio_source: None,
                    audio_transcript: None,
                    audio_organization: None,
                });
            }
        }
        let candidates = self.ask_candidates_locked(&pending)?;
        let by_id: std::collections::HashMap<_, _> = candidates
            .into_iter()
            .map(|candidate| (candidate.memory.id.clone(), candidate))
            .collect();
        for memory in &mut out {
            let (links, repair_pending) = self.current_related_links(memory, &by_id)?;
            memory.related_context = links;
            memory.context_repair_pending = repair_pending;
        }
        out.sort_by(|a, b| b.captured_at.cmp(&a.captured_at).then(a.id.cmp(&b.id)));
        Ok(out)
    }
    fn current_related_links(
        &self,
        source: &VaultMemory,
        candidates: &std::collections::HashMap<String, AskCandidate>,
    ) -> Result<(Vec<RelatedMemoryLink>, bool)> {
        let Some(proposal) = source
            .organization
            .as_ref()
            .filter(|proposal| !proposal.suppressed && proposal.review_state == "unreviewed")
        else {
            return Ok((Vec::new(), false));
        };
        if proposal.binding.schema_version != "2.0" {
            return Ok((Vec::new(), false));
        }
        let records = self.records(&source.id)?;
        let Some(event) = records
            .last()
            .filter(|event| [FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&event.format.as_str()))
        else {
            return Ok((Vec::new(), false));
        };
        let Some(links) = proposal.result.related_context.as_ref() else {
            return Ok((Vec::new(), true));
        };
        let Some(projection) = event.context_link_projection.as_ref() else {
            return Ok((Vec::new(), true));
        };
        if source.state != "active" || source.conflict.is_some() {
            return Ok((Vec::new(), projection.iter().any(|entry| !entry.suppressed)));
        }
        let Some(bound_context) = proposal.binding.context.as_ref() else {
            return Ok((Vec::new(), false));
        };
        let mut visible = Vec::new();
        let mut repair_pending = false;
        for (link, rendered) in links.iter().zip(projection) {
            if rendered.suppressed || rendered.target_memory_id != link.target_memory_id {
                continue;
            }
            let Some(bound) = bound_context
                .iter()
                .find(|context| context.memory_id == link.target_memory_id)
            else {
                repair_pending |= self
                    .suppress_inbound_context_links(&link.target_memory_id)
                    .is_err();
                continue;
            };
            let Some(target) = candidates.get(&link.target_memory_id) else {
                repair_pending |= self
                    .suppress_inbound_context_links(&link.target_memory_id)
                    .is_err();
                continue;
            };
            if target.memory.revision != bound.memory_revision
                || target.memory.source_sha256 != bound.source_sha256
                || target.memory.note_path.as_deref() != Some(rendered.note_basename.as_str())
                || target.evidence_kind != bound.evidence_kind
                || target.epistemic_state != bound.epistemic_state
                || !target.text.contains(&bound.excerpt)
                || !bound.excerpt.contains(&link.target_quote)
            {
                repair_pending |= self
                    .suppress_inbound_context_links(&link.target_memory_id)
                    .is_err();
                continue;
            }
            visible.push(RelatedMemoryLink {
                target_memory_id: link.target_memory_id.clone(),
                label: "Possibly related (unreviewed)".into(),
                source_quote: link.source_quote.clone(),
                target_quote: link.target_quote.clone(),
                note_basename: rendered.note_basename.clone(),
            });
        }
        Ok((visible, repair_pending))
    }
    fn suppress_inbound_context_links(&self, target_memory_id: &str) -> Result<()> {
        id(target_memory_id)?;
        let pending = self.recover()?;
        for directory in entries(&self.path("History"))? {
            let Some(source_id) = directory.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if source_id == target_memory_id || id(source_id).is_err() {
                continue;
            }
            let records = match self.records(source_id) {
                Ok(records) => records,
                Err(_) => continue,
            };
            let Some(last) = records.last() else {
                continue;
            };
            if ![FORMAT_V7, FORMAT_V8, FORMAT_V9].contains(&last.format.as_str())
                || last.kind == "remove"
            {
                continue;
            }
            let Some(previous) = last.context_link_projection.as_ref() else {
                continue;
            };
            if !previous
                .iter()
                .any(|entry| entry.target_memory_id == target_memory_id && !entry.suppressed)
            {
                continue;
            }
            if pending.contains_key(source_id) {
                return Err("Related source has an unresolved journal repair".into());
            }
            let mut projection = previous.clone();
            for entry in &mut projection {
                if entry.target_memory_id == target_memory_id {
                    entry.suppressed = true;
                }
            }
            let mut memory = last.memory.clone();
            memory.revision += 1;
            memory.updated_at = timestamp();
            let mut payload_sha256 = payload(
                "context_suppress",
                &memory.id,
                last.memory.revision,
                &memory.note,
                &memory.source_sha256,
                &memory.source_name,
            )?;
            payload_sha256 = hash(&json(&(payload_sha256, &memory.reading))?);
            payload_sha256 = hash(&json(&(payload_sha256, &memory.organization))?);
            payload_sha256 = hash(&json(&(payload_sha256, &Some(projection.clone())))?);
            let event = Event {
                format: FORMAT_V7.into(),
                vault_id: self.id.clone(),
                operation_id: Uuid::new_v4().to_string(),
                kind: "context_suppress".into(),
                expected_revision: last.memory.revision,
                payload_sha256,
                parent_sha256: Some(self.parent_hash(&memory.id, last.memory.revision)?),
                origin: "system:recall".into(),
                note_path: last.note_path.clone(),
                expected_state: None,
                previous_markdown: Some(last.markdown.clone()),
                markdown: v7_markdown(&memory, &projection)?,
                memory,
                context_link_projection: Some(projection),
            };
            self.commit(&event)?;
        }
        Ok(())
    }
    /// Select current evidence under the same writer lock used for journal
    /// recovery, direct-edit reconciliation, and immutable-source verification.
    pub fn ask_candidates(&self) -> Result<Vec<AskCandidate>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        self.ask_candidates_locked(&pending)
    }
    /// Select retained, source-verified history and its current counterpart while
    /// holding the vault writer lock across recovery, reconciliation and hashes.
    pub fn ask_history(
        &self,
        question: &str,
        start_utc: &str,
        end_exclusive_utc: &str,
        compare_to_current: bool,
    ) -> Result<HistorySelection> {
        validate_history_interval(start_utc, end_exclusive_utc)?;
        if question.trim().is_empty() || question.len() > 2_000 || question.contains('\0') {
            return Err("Invalid history question".into());
        }
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let end_second = utc_second(end_exclusive_utc)?;
        let query_terms: Vec<String> = question
            .split(|c: char| !c.is_alphanumeric())
            .map(str::to_lowercase)
            .filter(|term| term.chars().count() >= 2)
            .collect();
        let mut selected = Vec::new();
        for entry in entries(&self.path("History"))? {
            let Some(memory_id) = entry.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if id(memory_id).is_err() {
                continue;
            }
            let Ok(current) = self.current(memory_id, &pending) else {
                continue;
            };
            if current.state != "active"
                || current.conflict.is_some()
                || current.revision == 0
                || self.verify_source(&current).is_err()
            {
                continue;
            }
            let Ok(records) = self.records_with_event_hashes(memory_id) else {
                continue;
            };
            if records.is_empty()
                || records.last().is_none_or(|(event, _)| {
                    event.kind == "remove"
                        || event.memory.revision != current.revision
                        || event.memory.state != "active"
                })
            {
                continue;
            }
            let mut previous_time = None;
            let mut chronology_valid = true;
            let mut previous_revision = 0;
            for (event, _) in &records {
                let Some(time) = parse_utc_second(&event.memory.updated_at) else {
                    chronology_valid = false;
                    break;
                };
                if previous_time.is_some_and(|previous| time < previous) {
                    chronology_valid = false;
                    break;
                }
                if event.memory.revision <= previous_revision {
                    chronology_valid = false;
                    break;
                }
                previous_time = Some(time);
                previous_revision = event.memory.revision;
            }
            if !chronology_valid {
                continue;
            }
            let Some((past, event_hash)) = records.iter().rev().find(|(event, _)| {
                parse_utc_second(&event.memory.updated_at).is_some_and(|time| time < end_second)
            }) else {
                continue;
            };
            let Some((text, evidence_kind, epistemic_state)) =
                historical_text(&past.memory, &query_terms)
            else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            let transition =
                historical_transition(&records, past.memory.revision, evidence_kind, text);
            if matches!(
                transition,
                HistoricalTransition::HumanSuppressed
                    | HistoricalTransition::SuppressedWithoutCounterpart
            ) {
                continue;
            }
            if compare_to_current && current.revision == past.memory.revision {
                continue;
            }
            let mut excerpt_text = text.to_owned();
            if text.len() > 1_500 {
                let matched = query_terms
                    .iter()
                    .filter_map(|term| text.to_lowercase().find(term))
                    .min();
                let mut excerpt_start = matched.unwrap_or(0).saturating_sub(500);
                while !text.is_char_boundary(excerpt_start) {
                    excerpt_start += 1;
                }
                let mut end = (excerpt_start + 1_500).min(text.len());
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                excerpt_text = text[excerpt_start..end].to_owned();
            }
            let (quote, truncated) = (&excerpt_text, excerpt_text.len() < text.len());
            selected.push((
                current.id.clone(),
                past.memory.revision,
                event_hash.clone(),
                past.memory.source_sha256.clone(),
                past.memory.captured_at.clone(),
                past.memory.updated_at.clone(),
                current.revision,
                transition,
                evidence_kind.to_owned(),
                epistemic_state.to_owned(),
                quote.to_owned(),
                truncated,
                text.to_owned(),
            ));
        }
        // Count only evidence items whose complete correction pair can be
        // represented. A missing or intentionally empty current counterpart
        // omits the historical side too, so it must not inflate coverage.
        let mut representable = Vec::with_capacity(selected.len());
        for item in selected {
            let needs_pair = item.7 == HistoricalTransition::HumanCorrected || compare_to_current;
            if needs_pair {
                if item.6 <= item.1 {
                    continue;
                }
                let records = self.records_with_event_hashes(&item.0)?;
                let Some((current_event, _)) = records
                    .iter()
                    .find(|(event, _)| event.memory.revision == item.6)
                else {
                    continue;
                };
                if historical_counterpart_text(&current_event.memory, &item.8, item.7).is_none() {
                    continue;
                }
            }
            representable.push(item);
        }
        let mut selected = representable;
        let eligible_count: usize = selected
            .iter()
            .map(|item| {
                if compare_to_current || item.7 == HistoricalTransition::HumanCorrected {
                    2
                } else {
                    1
                }
            })
            .sum();
        selected.sort_by(|a, b| {
            let score_a = query_terms
                .iter()
                .filter(|term| a.12.to_lowercase().contains(term.as_str()))
                .count();
            let score_b = query_terms
                .iter()
                .filter(|term| b.12.to_lowercase().contains(term.as_str()))
                .count();
            score_b
                .cmp(&score_a)
                .then(b.5.cmp(&a.5))
                .then(a.0.cmp(&b.0))
        });
        let mut evidence = Vec::new();
        let mut truncated_count = 0u32;
        for item in selected {
            let needs_pair = item.7 == HistoricalTransition::HumanCorrected || compare_to_current;
            let cost = if needs_pair { 2 } else { 1 };
            if evidence.len() + cost > 8 {
                continue;
            }
            if needs_pair && item.6 <= item.1 {
                continue;
            }
            let status = if item.7 == HistoricalTransition::HumanCorrected {
                "as_of_later_corrected"
            } else {
                "as_of"
            };
            let current_counterpart = if needs_pair {
                let records = self.records_with_event_hashes(&item.0)?;
                let Some((current_event, current_hash)) = records
                    .iter()
                    .find(|(event, _)| event.memory.revision == item.6)
                else {
                    continue;
                };
                let Some((current_text, current_kind, current_epistemic)) =
                    historical_counterpart_text(&current_event.memory, &item.8, item.7)
                else {
                    // Never return the old side of a required correction pair
                    // by itself when the current reading is intentionally empty.
                    continue;
                };
                let current_excerpt = truncate_query_excerpt(current_text, &query_terms, 1_500);
                let truncated = current_excerpt.len() < current_text.len();
                Some((
                    HistoryEvidence {
                        memory_id: item.0.clone(),
                        revision: item.6,
                        event_sha256: current_hash.clone(),
                        source_sha256: current_event.memory.source_sha256.clone(),
                        captured_at: current_event.memory.captured_at.clone(),
                        recorded_at: current_event.memory.updated_at.clone(),
                        current_revision: item.6,
                        history_status: "current_counterpart".into(),
                        evidence_kind: current_kind.into(),
                        epistemic_state: current_epistemic.into(),
                        excerpt: current_excerpt,
                    },
                    truncated,
                ))
            } else {
                None
            };
            if item.11 {
                truncated_count += 1;
            }
            evidence.push(HistoryEvidence {
                memory_id: item.0.clone(),
                revision: item.1,
                event_sha256: item.2.clone(),
                source_sha256: item.3.clone(),
                captured_at: item.4.clone(),
                recorded_at: item.5.clone(),
                current_revision: item.6,
                history_status: status.into(),
                evidence_kind: item.8.clone(),
                epistemic_state: item.9.clone(),
                excerpt: item.10.clone(),
            });
            if let Some((counterpart, truncated)) = current_counterpart {
                if truncated {
                    truncated_count += 1;
                }
                evidence.push(counterpart);
            }
        }
        for (index, item) in evidence.iter_mut().enumerate() {
            item.revision = item.revision.max(1);
            let _ = index;
        }
        let selected_count = evidence.len() as u32;
        Ok(HistorySelection {
            eligible_count: eligible_count.min(u32::MAX as usize) as u32,
            selected_count,
            limited: eligible_count > selected_count as usize,
            truncated_count,
            evidence,
        })
    }
    pub fn history_citation(
        &self,
        memory_id: &str,
        revision: u64,
        event_sha256: &str,
        source_sha256: &str,
        excerpt: &str,
    ) -> Result<HistoryCitation> {
        id(memory_id)?;
        if revision == 0
            || event_sha256.len() != 64
            || source_sha256.len() != 64
            || excerpt.is_empty()
        {
            return Err("Invalid historical citation".into());
        }
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let current = self.current(memory_id, &pending)?;
        if current.state != "active"
            || current.conflict.is_some()
            || self.verify_source(&current)?.sha256 != source_sha256
        {
            return Err("STALE_EVIDENCE".into());
        }
        let records = self.records_with_event_hashes(memory_id)?;
        let Some((event, actual_hash)) = records.iter().find(|(event, hash)| {
            event.memory.revision == revision && hash.as_str() == event_sha256
        }) else {
            return Err("STALE_EVIDENCE".into());
        };
        if event.memory.source_sha256 != source_sha256
            || !historical_texts(&event.memory)
                .iter()
                .any(|(text, _, _)| text.contains(excerpt))
        {
            return Err("STALE_EVIDENCE".into());
        }
        let original = self.verify_source(&current)?;
        Ok(HistoryCitation {
            memory_id: memory_id.into(),
            revision,
            event_sha256: actual_hash.clone(),
            source_sha256: source_sha256.into(),
            current_revision: current.revision,
            current: current.revision == revision,
            quote: excerpt.into(),
            retained_revision: RetainedRevision {
                revision: event.memory.revision,
                recorded_at: event.memory.updated_at.clone(),
                kind: event.kind.clone(),
                origin: event.origin.clone(),
                note: event.memory.note.clone(),
                reading: event.memory.reading.clone(),
                organization: event.memory.organization.clone(),
                audio_transcript: event.memory.audio_transcript.clone(),
                audio_organization: event.memory.audio_organization.clone(),
            },
            original,
        })
    }
    fn ask_candidates_locked(
        &self,
        pending: &BTreeMap<String, String>,
    ) -> Result<Vec<AskCandidate>> {
        let mut out = Vec::new();
        for p in entries(&self.path("History"))? {
            let Some(memory_id) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if id(memory_id).is_err() {
                continue;
            }
            let Ok(memory) = self.current(memory_id, pending) else {
                continue;
            };
            if memory.state != "active" || memory.conflict.is_some() || memory.revision == 0 {
                continue;
            }
            if self.verify_source(&memory).is_err() {
                continue;
            }
            let mut alternate_reading = None;
            let (text, evidence_kind, epistemic_state) = if memory.audio_source.is_some() {
                let spoken = audio_current_text(&memory).map(|(t, k, s)| (t.to_owned(), k, s));
                if !memory.note.trim().is_empty() {
                    if let Some((spoken_text, kind, state)) = spoken {
                        alternate_reading = Some(AskEvidenceChoice {
                            text: spoken_text,
                            evidence_kind: kind.into(),
                            epistemic_state: state.into(),
                        });
                    }
                    (memory.note.clone(), "human_note", "reported")
                } else if let Some((spoken_text, kind, state)) = spoken {
                    (spoken_text, kind, state)
                } else {
                    continue;
                }
            } else if memory.source_name == "note.txt" || memory.imported_text.is_some() {
                (
                    memory.note.clone(),
                    if memory.revision > 1 {
                        "human_note"
                    } else {
                        "text_source"
                    },
                    "reported",
                )
            } else if !memory.note.trim().is_empty() {
                let annotation = memory.note.clone();
                if let Some(reading) = memory
                    .reading
                    .as_ref()
                    .filter(|r| r.machine.validate().is_ok())
                {
                    let effective = reading.effective_text();
                    if !effective.trim().is_empty() {
                        alternate_reading = Some(AskEvidenceChoice {
                            text: effective.to_owned(),
                            evidence_kind: if reading.human_correction.is_some() {
                                "human_reading_correction"
                            } else {
                                "machine_reading"
                            }
                            .into(),
                            epistemic_state: if reading.human_correction.is_some() {
                                "reported"
                            } else {
                                "unreviewed"
                            }
                            .into(),
                        });
                    }
                }
                if alternate_reading.is_none() {
                    if let Some(organization) = memory
                        .organization
                        .as_ref()
                        .filter(|o| !o.suppressed && o.review_state == "unreviewed")
                    {
                        let transcript = organization.result.extraction["pages"][0]
                            ["transcription"]
                            .as_str()
                            .unwrap_or("");
                        if !transcript.trim().is_empty() {
                            alternate_reading = Some(AskEvidenceChoice {
                                text: transcript.into(),
                                evidence_kind: "organization_proposal".into(),
                                epistemic_state: "unreviewed".into(),
                            });
                        }
                    }
                }
                (annotation, "human_note", "reported")
            } else if let Some(reading) = memory.reading.as_ref() {
                if reading.machine.validate().is_err() {
                    continue;
                }
                let effective = reading.effective_text();
                if effective.trim().is_empty() {
                    continue;
                }
                if reading.human_correction.is_some() {
                    (effective.to_owned(), "human_reading_correction", "reported")
                } else {
                    (effective.to_owned(), "machine_reading", "unreviewed")
                }
            } else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            let mut ranking_text = format!("{} {}", memory.source_name, memory.note);
            if let Some(reading) = memory.reading.as_ref() {
                if reading.machine.validate().is_ok() {
                    ranking_text.push(' ');
                    ranking_text.push_str(reading.effective_text());
                    if reading.human_correction.is_none() {
                        // The structured extraction is used only for stable
                        // candidate ranking; transmitted evidence remains an
                        // exact current note/correction/transcription excerpt.
                        ranking_text.push(' ');
                        ranking_text.push_str(
                            &serde_json::to_string(&reading.machine.result.extraction)
                                .map_err(fail)?,
                        );
                    }
                }
            }
            if let Some((spoken_text, _, _)) = audio_current_text(&memory) {
                ranking_text.push(' ');
                ranking_text.push_str(spoken_text);
            }
            if let Some(organization) = memory
                .organization
                .as_ref()
                .filter(|o| !o.suppressed && o.review_state == "unreviewed")
            {
                ranking_text.push(' ');
                ranking_text.push_str(
                    &serde_json::to_string(&organization.result.extraction).map_err(fail)?,
                );
            }
            out.push(AskCandidate {
                memory,
                text,
                evidence_kind: evidence_kind.into(),
                epistemic_state: epistemic_state.into(),
                alternate_reading,
                ranking_text,
            });
        }
        out.sort_by(|a, b| {
            b.memory
                .captured_at
                .cmp(&a.memory.captured_at)
                .then(a.memory.id.cmp(&b.memory.id))
        });
        Ok(out)
    }
    fn select_organization_context(
        &self,
        source: &VaultMemory,
        pending: &BTreeMap<String, String>,
    ) -> Result<(OrganizationContextCoverage, Vec<OrganizationContextExcerpt>)> {
        let mut eligible: Vec<AskCandidate> = self
            .ask_candidates_locked(pending)?
            .into_iter()
            .filter(|candidate| {
                candidate.memory.id != source.id && candidate.memory.audio_source.is_none()
            })
            .collect();
        let eligible_count = eligible.len() as u64;
        let terms: BTreeSet<String> = source
            .note
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| term.chars().count() >= 2)
            .map(str::to_lowercase)
            .collect();
        if eligible.len() > 3 {
            eligible.sort_by(|a, b| {
                let score = |candidate: &AskCandidate| {
                    let text = candidate.ranking_text.to_lowercase();
                    terms
                        .iter()
                        .filter(|term| text.contains(term.as_str()))
                        .count()
                };
                score(b)
                    .cmp(&score(a))
                    .then(b.memory.captured_at.cmp(&a.memory.captured_at))
                    .then(a.memory.id.cmp(&b.memory.id))
            });
        }
        eligible.truncate(3);
        let selected_count = eligible.len();
        let mut truncated_count = 0u64;
        let context = eligible
            .into_iter()
            .map(|candidate| {
                let excerpt = truncate_utf8(&candidate.text, 256);
                if excerpt.len() < candidate.text.len() {
                    truncated_count += 1;
                }
                OrganizationContextExcerpt {
                    memory_id: candidate.memory.id,
                    memory_revision: candidate.memory.revision,
                    source_sha256: candidate.memory.source_sha256,
                    evidence_kind: candidate.evidence_kind,
                    epistemic_state: candidate.epistemic_state,
                    excerpt,
                }
            })
            .collect();
        Ok((
            OrganizationContextCoverage {
                eligible_count,
                selected_count: selected_count as u64,
                limited: eligible_count > selected_count as u64,
                truncated_count,
            },
            context,
        ))
    }
    /// Store exact retry material once. It is operational metadata, not a
    /// semantic revision or history event. Different reuse is a hard conflict.
    pub fn save_ask_intent(&self, operation_id: &str, bytes: &[u8]) -> Result<Vec<u8>> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        if bytes.is_empty() || bytes.len() > 64 * 1024 {
            return Err("Ask intent exceeds its size limit".into());
        }
        let root = self.ensure_ask_dir()?;
        let path = self.ask_intent_path(operation_id)?;
        if path.exists() {
            let existing = read(&path, 64 * 1024)?;
            if existing != bytes {
                return Err("Ask operation ID already has different retry material".into());
            }
            return Ok(existing);
        }
        if entries(&root)?.len() >= MAX_RECORDS {
            return Err("Ask operation retention capacity reached".into());
        }
        immutable(&path, bytes)?;
        Ok(bytes.to_vec())
    }
    pub fn load_ask_intent(&self, operation_id: &str) -> Result<Option<Vec<u8>>> {
        let _lock = self.lock()?;
        let _ = self.recover()?;
        let path = self.ask_intent_path(operation_id)?;
        if !path.exists() {
            return Ok(None);
        }
        read(&path, 64 * 1024).map(Some)
    }
    pub fn correct(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        note: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(memory_id)?;
        id(operation_id)?;
        note_valid(note)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "correct"
                || e.memory.id != memory_id
                || e.expected_revision != expected_revision
                || e.memory.note != note
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let m = self.reconciled(memory_id)?;
        if m.state != "active" || m.conflict.is_some() || m.revision != expected_revision {
            return Err("Conflict: vault note changed. Refresh, review the latest note, then explicitly retry your draft".into());
        }
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut memory = m;
        memory.revision += 1;
        memory.note = note.into();
        memory.updated_at = timestamp();
        if let Some(organization) = memory.organization.as_mut() {
            organization.suppressed = true;
        }
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "correct".into(),
            note_path: memory.note_path.clone(),
            expected_state: None,
            expected_revision,
            payload_sha256: payload(
                "correct",
                memory_id,
                expected_revision,
                note,
                &memory.source_sha256,
                &memory.source_name,
            )?,
            parent_sha256: Some(self.parent_hash(&last.memory.id, last.memory.revision)?),
            origin: "human:recall".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: markdown(&memory),
            memory,
            context_link_projection: None,
        };
        let mut committed = self.commit(&e)?;
        if self.suppress_inbound_context_links(memory_id).is_err() {
            committed.context_repair_pending = true;
        }
        Ok(committed)
    }
    fn removal_precondition(&self, e: &Event) -> Result<()> {
        let candidate = self.inventory(&e.memory.id, e.note_path.as_deref())?;
        match e.expected_state.as_deref() {
            Some("missing") if candidate.is_none() => Ok(()),
            Some("active") if candidate.as_ref() == Some(&self.event_note_path(e)?) => {
                let expected = e
                    .previous_markdown
                    .as_deref()
                    .ok_or("Missing removal Markdown precondition")?;
                if read(candidate.as_ref().ok_or("Missing note")?, MAX_JSON)? == expected.as_bytes()
                {
                    Ok(())
                } else {
                    Err("Note changed during removal; confirmation is stale".into())
                }
            }
            _ => Err("Note presence changed during removal; confirmation is stale".into()),
        }
    }
    pub fn restore_note(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
    ) -> Result<VaultMemory> {
        self.lifecycle(memory_id, expected_revision, operation_id, "restore", None)
    }
    pub fn remove(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        expected_state: &str,
    ) -> Result<VaultMemory> {
        if !["active", "missing"].contains(&expected_state) {
            return Err("Removal requires active or missing expectedState".into());
        }
        self.lifecycle(
            memory_id,
            expected_revision,
            operation_id,
            "remove",
            Some(expected_state),
        )
    }
    fn lifecycle(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        kind: &str,
        expected_state: Option<&str>,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        id(memory_id)?;
        id(operation_id)?;
        let pending = self.recover()?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != kind
                || e.memory.id != memory_id
                || e.expected_revision != expected_revision
                || e.expected_state.as_deref() != expected_state
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(memory_id, &pending);
        }
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let mut m = self.reconciled(memory_id)?;
        let required_state = expected_state.unwrap_or("missing");
        if m.revision != expected_revision || m.state != required_state {
            return Err("Memory revision or state changed; refresh and confirm again".into());
        }
        let last = self.records(memory_id)?.pop().ok_or("Missing history")?;
        m.revision += 1;
        m.updated_at = timestamp();
        m.conflict = None;
        let mut payload_sha256 = payload(
            kind,
            memory_id,
            expected_revision,
            &m.note,
            &m.source_sha256,
            &m.source_name,
        )?;
        let expected_state = expected_state.map(str::to_owned);
        if kind == "remove" {
            payload_sha256 = hash(&json(&(payload_sha256, &expected_state))?);
        }
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: kind.into(),
            expected_revision,
            payload_sha256,
            parent_sha256: Some(self.parent_hash(memory_id, expected_revision)?),
            origin: "human:recall".into(),
            note_path: m
                .note_path
                .clone()
                .or(last.note_path)
                .or_else(|| Some(format!("{memory_id}.md"))),
            expected_state,
            previous_markdown: if m.state == "active" {
                Some(last.markdown)
            } else {
                None
            },
            markdown: markdown(&m),
            memory: VaultMemory {
                state: "active".into(),
                ..m
            },
            context_link_projection: None,
        };
        let mut committed = self.commit(&e)?;
        if kind == "remove" && self.suppress_inbound_context_links(memory_id).is_err() {
            committed.context_repair_pending = true;
        }
        Ok(committed)
    }
    pub fn source(&self, memory_id: &str) -> Result<VaultSource> {
        let _lock = self.lock()?;
        if let Some(error) = self.recover()?.get(memory_id) {
            return Err(error.clone());
        }
        let m = self.reconciled(memory_id)?;
        if m.state != "active" || m.conflict.is_some() {
            return Err("Resolve this memory's conflict before using its evidence".into());
        }
        self.verify_source(&m)
    }
    pub fn related_memory(
        &self,
        source_memory_id: &str,
        target_memory_id: &str,
    ) -> Result<VaultRelatedMemory> {
        let _lock = self.lock()?;
        id(source_memory_id)?;
        id(target_memory_id)?;
        let pending = self.recover()?;
        let source = self.current(source_memory_id, &pending)?;
        let target = self.current(target_memory_id, &pending)?;
        let candidates = self.ask_candidates_locked(&pending)?;
        let by_id: std::collections::HashMap<_, _> = candidates
            .into_iter()
            .map(|candidate| (candidate.memory.id.clone(), candidate))
            .collect();
        let (links, _) = self.current_related_links(&source, &by_id)?;
        if !links
            .iter()
            .any(|link| link.target_memory_id == target_memory_id)
        {
            return Err("Related memory suggestion is no longer current".into());
        }
        if target.state != "active" || target.conflict.is_some() {
            return Err("Related memory target is no longer available".into());
        }
        let note_basename = target
            .note_path
            .clone()
            .ok_or("Related memory note path is unavailable")?;
        Ok(VaultRelatedMemory {
            memory_id: target.id.clone(),
            revision: target.revision,
            source_sha256: target.source_sha256.clone(),
            source_name: target.source_name.clone(),
            note_basename,
            original: self.verify_source(&target)?,
        })
    }
    pub fn history(&self, memory_id: &str) -> Result<Vec<VaultRevision>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let records = self.records(memory_id)?;
        if let Some(error) = pending.get(memory_id) {
            if !records.last().is_some_and(|e| e.kind == "remove") {
                return Err(error.clone());
            }
        }
        Ok(records
            .into_iter()
            .map(|e| VaultRevision {
                revision: e.memory.revision,
                note: e.memory.note,
                reading: e.memory.reading,
                organization: e.memory.organization,
                audio_transcript: e.memory.audio_transcript,
                audio_organization: e.memory.audio_organization,
                recorded_at: e.memory.updated_at,
                origin: e.origin,
                kind: e.kind,
            })
            .collect())
    }
}

/// Native-selected scope only. Commands hold this mutex throughout each operation,
/// including pickers, so switching cannot redirect an in-flight capture.
#[derive(Clone)]
struct Selected {
    vault: Vault,
    token: String,
}

/// A background-operation handle that remains bound to the live selected vault.
/// It deliberately contains no mutable selection authority: callers must re-check
/// it before an external side effect or a vault promotion.
#[derive(Clone)]
pub struct SelectionGuard {
    selected: Arc<Mutex<Option<Selected>>>,
    pub vault: Vault,
    pub token: String,
}
impl SelectionGuard {
    pub fn active(&self) -> Result<()> {
        let selected = self.selected.lock().map_err(fail)?;
        let current = selected.as_ref().ok_or("Vault selection changed")?;
        if current.token != self.token || current.vault.id != self.vault.id {
            return Err("Vault selection changed".into());
        }
        Ok(())
    }
    pub fn with<T>(&self, action: impl FnOnce(&Vault) -> Result<T>) -> Result<T> {
        let selected = self.selected.lock().map_err(fail)?;
        let current = selected.as_ref().ok_or("Vault selection changed")?;
        if current.token != self.token || current.vault.id != self.vault.id {
            return Err("Vault selection changed".into());
        }
        current.vault.validate()?;
        action(&current.vault)
    }
}
pub struct LocalVaultState {
    selected: Arc<Mutex<Option<Selected>>>,
    settings: PathBuf,
    reading_sessions: Mutex<BTreeMap<(String, String), Vault>>,
}
impl LocalVaultState {
    pub fn new(settings: PathBuf) -> Self {
        // Unavailable roots remain unselected and are never silently initialized.
        let selected = decode::<VaultStatus>(&settings)
            .ok()
            .and_then(|s| {
                let root = PathBuf::from(s.root?);
                let expected = s.vault_id?;
                if !root.join("Recall/_meta/manifest.json").exists() {
                    return None;
                }
                Vault::open(&root).ok().filter(|v| v.id == expected)
            })
            .map(|vault| Selected {
                vault,
                token: Uuid::new_v4().to_string(),
            });
        Self {
            selected: Arc::new(Mutex::new(selected)),
            settings,
            reading_sessions: Mutex::new(BTreeMap::new()),
        }
    }
    pub fn status(&self) -> Result<VaultStatus> {
        let selected = self.selected.lock().map_err(fail)?;
        match selected.as_ref() {
            Some(s) => {
                s.vault.validate()?;
                Ok(VaultStatus {
                    root: Some(s.vault.root.to_string_lossy().into()),
                    vault_id: Some(s.token.clone()),
                    vault_identity: Some(s.vault.id.clone()),
                })
            }
            None => Ok(VaultStatus {
                root: None,
                vault_id: None,
                vault_identity: None,
            }),
        }
    }
    pub fn with<T>(&self, expected: &str, action: impl FnOnce(&Vault) -> Result<T>) -> Result<T> {
        let selected = self.selected.lock().map_err(fail)?;
        let s = selected.as_ref().ok_or("Select a vault first")?;
        if s.token != expected {
            return Err("Vault selection changed; refresh before retrying".into());
        }
        s.vault.validate()?;
        action(&s.vault)
    }
    pub fn session(&self, expected: &str) -> Result<SelectionGuard> {
        let selected = self.selected.lock().map_err(fail)?;
        let current = selected.as_ref().ok_or("Select a vault first")?;
        if current.token != expected {
            return Err("Vault selection changed; refresh before retrying".into());
        }
        current.vault.validate()?;
        Ok(SelectionGuard {
            selected: self.selected.clone(),
            vault: current.vault.clone(),
            token: current.token.clone(),
        })
    }
    #[cfg(test)]
    pub fn select_path(&self, root: &Path) -> Result<VaultStatus> {
        self.select_path_if(root, || Ok(()))
    }
    /// Like `select_path`, but `precheck` runs while the selection mutex is held, so a
    /// condition verified there cannot change before the swap.
    pub fn select_path_if(
        &self,
        root: &Path,
        precheck: impl FnOnce() -> Result<()>,
    ) -> Result<VaultStatus> {
        let mut selected = self.selected.lock().map_err(fail)?;
        precheck()?;
        let v = Vault::open(root)?;
        {
            let _lock = v.lock()?;
            v.recover()?;
        }
        let status = VaultStatus {
            root: Some(v.root.to_string_lossy().into()),
            vault_id: Some(v.id.clone()),
            vault_identity: Some(v.id.clone()),
        };
        // Cancel registered requests in their original vault before replacing the session.
        // Network work holds neither this mutex nor a vault lock.
        if let Some(old) = selected.as_ref() {
            for ((session, operation), vault) in self.reading_sessions.lock().map_err(fail)?.iter()
            {
                if session == &old.token {
                    vault.cancel_reading(operation)?;
                }
            }
        }
        // Preserve the previous settings until a fully flushed replacement exists.
        let temp = self
            .settings
            .with_extension(format!("stage-{}", Uuid::new_v4()));
        create(&temp, &json(&status)?)?;
        #[cfg(windows)]
        {
            // Windows rename cannot replace an existing file; use write-through replacement.
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            safe(&self.settings)?;
            let a: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let b: Vec<u16> = self
                .settings
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            if unsafe {
                MoveFileExW(
                    a.as_ptr(),
                    b.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(fail(std::io::Error::last_os_error()));
            }
        }
        #[cfg(not(windows))]
        replace(&temp, &self.settings)?;
        let token = Uuid::new_v4().to_string();
        *selected = Some(Selected {
            vault: v,
            token: token.clone(),
        });
        Ok(VaultStatus {
            vault_id: Some(token),
            ..status
        })
    }
}

#[path = "reading_storage.rs"]
mod reading_storage;
pub use reading_storage::ReadingOperation;
#[path = "local_vault_audio_org.rs"]
mod audio_org_storage;
#[path = "local_vault_audio.rs"]
mod audio_storage;
pub use audio_org_storage::AudioOrganizationIntent;
use audio_storage::{audio_current_text, audio_markdown};
#[cfg(test)]
pub use audio_storage::{classify_machine_output, AudioMachineTranscript};
pub use audio_storage::{
    read_wav_import, utc_now, AsrIdentity, AsrPhase, AsrResult, AudioSegment, AudioSource,
    AudioTranscript, RMS_GATE,
};

#[cfg(test)]
#[path = "local_vault_tests.rs"]
mod tests;
