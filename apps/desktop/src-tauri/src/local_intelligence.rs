//! Bounded, vault-grounded Ask selection, recovery, and citation promotion.
use crate::{
    local_intelligence_transport::{LocalIntelligenceTransport, ReceiptLookup},
    local_vault::{AskCandidate, HistoryEvidence, HistorySelection, LocalVaultState, Vault},
    pairing,
};
use serde::{
    de::{DeserializeOwned, MapAccess, SeqAccess, Visitor},
    Deserialize, Serialize,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(test)]
use std::sync::{Mutex, OnceLock};
use tauri::State;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const MAX_QUESTION: usize = 2_000;
const MAX_EVIDENCE: usize = 8;
const MAX_EXCERPT: usize = 1_500;
const MAX_BODY: usize = 32 * 1024;

// Production always consults the protected pairing lifecycle.  Tests may swap
// this narrow dependency while a real dispatcher is suspended at its transport
// boundary, so they exercise the production ordering without keychain access.
#[cfg(test)]
static HISTORY_CONNECTION_OVERRIDE: OnceLock<Mutex<Option<pairing::IntelligenceConnection>>> =
    OnceLock::new();

fn confirmed_history_intelligence(vault_id: &str) -> Result<pairing::IntelligenceConnection> {
    #[cfg(test)]
    if let Some(connection) = HISTORY_CONNECTION_OVERRIDE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "History connection is unavailable")?
        .clone()
    {
        return (connection.vault_id == vault_id)
            .then_some(connection)
            .ok_or_else(|| "History connection is unavailable".into());
    }
    pairing::confirmed_intelligence(vault_id)
}

#[cfg(test)]
fn set_history_connection_override(connection: Option<pairing::IntelligenceConnection>) {
    *HISTORY_CONNECTION_OVERRIDE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("history connection override lock") = connection;
}
fn strict_utc(value: &str) -> bool {
    if value.len() != 20
        || !value.is_ascii()
        || !value.ends_with('Z')
        || !value[..19].bytes().enumerate().all(|(i, b)| {
            if [4, 7].contains(&i) {
                b == b'-'
            } else if i == 10 {
                b == b'T'
            } else if [13, 16].contains(&i) {
                b == b':'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return false;
    }
    let year = value[0..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    let hour = value[11..13].parse::<u32>().unwrap_or(99);
    let minute = value[14..16].parse::<u32>().unwrap_or(99);
    let second = value[17..19].parse::<u32>().unwrap_or(99);
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
    year > 0
        && (1..=12).contains(&month)
        && day > 0
        && day <= days[(month.saturating_sub(1)) as usize]
        && hour < 24
        && minute < 60
        && second < 60
}
fn history_interval_valid(start: &str, end: &str) -> bool {
    fn seconds(value: &str) -> Option<u64> {
        if !strict_utc(value) {
            return None;
        }
        let year = value[0..4].parse::<i64>().ok()?;
        let month = value[5..7].parse::<i64>().ok()?;
        let day = value[8..10].parse::<i64>().ok()?;
        let y = year - i64::from(month <= 2);
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = month + if month > 2 { -3 } else { 9 };
        let doy = (153 * mp + 2) / 5 + day - 1;
        let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
        Some(
            (days * 86_400
                + value[11..13].parse::<i64>().ok()? * 3600
                + value[14..16].parse::<i64>().ok()? * 60
                + value[17..19].parse::<i64>().ok()?) as u64,
        )
    }
    let (Some(start), Some(end)) = (seconds(start), seconds(end)) else {
        return false;
    };
    end > start && (23 * 3600..=25 * 3600).contains(&(end - start))
}

enum StrictJson {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<StrictJson>),
    Object(BTreeMap<String, StrictJson>),
}
impl<'de> Deserialize<'de> for StrictJson {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct StrictVisitor;
        impl<'de> Visitor<'de> for StrictVisitor {
            type Value = StrictJson;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("strict JSON without duplicate keys or floating point numbers")
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::Null)
            }
            fn visit_none<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::Null)
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                v: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::Bool(v))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::Number(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::Number(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> std::result::Result<Self::Value, E> {
                Err(E::custom("floating point JSON numbers are forbidden"))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::String(v.into()))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictJson::String(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element()? {
                    values.push(value);
                }
                Ok(StrictJson::Array(values))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = BTreeMap::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate JSON object key"));
                    }
                    values.insert(key, map.next_value()?);
                }
                Ok(StrictJson::Object(values))
            }
        }
        deserializer.deserialize_any(StrictVisitor)
    }
}
impl From<StrictJson> for Value {
    fn from(value: StrictJson) -> Self {
        match value {
            StrictJson::Null => Value::Null,
            StrictJson::Bool(v) => Value::Bool(v),
            StrictJson::Number(v) => Value::Number(v),
            StrictJson::String(v) => Value::String(v),
            StrictJson::Array(v) => Value::Array(v.into_iter().map(Value::from).collect()),
            StrictJson::Object(v) => {
                Value::Object(v.into_iter().map(|(k, v)| (k, Value::from(v))).collect())
            }
        }
    }
}
pub(crate) fn strict_json_from_slice<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictJson::deserialize(&mut deserializer).map_err(|_| "Invalid strict JSON")?;
    deserializer.end().map_err(|_| "Invalid strict JSON")?;
    serde_json::from_value(Value::from(value)).map_err(|_| "Invalid strict JSON".into())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AskCoverage {
    pub eligible_count: u32,
    pub selected_count: u32,
    pub limited: bool,
    pub truncated_count: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AskEvidence {
    pub citation_id: String,
    pub memory_id: String,
    pub memory_revision: u64,
    pub source_sha256: String,
    pub captured_at: String,
    pub evidence_kind: String,
    pub epistemic_state: String,
    pub excerpt: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AskRequest {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub question: String,
    pub coverage: AskCoverage,
    pub evidence: Vec<AskEvidence>,
}
impl AskRequest {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != "1.0"
            || !canonical_uuid(&self.operation_id)
            || !canonical_uuid(&self.vault_id)
            || self.question.is_empty()
            || self.question.len() > MAX_QUESTION
            || self.question.contains('\0')
            || self.evidence.len() > MAX_EVIDENCE
            || self.coverage.selected_count as usize != self.evidence.len()
            || self.coverage.eligible_count < self.coverage.selected_count
            || self.coverage.limited
                != (self.coverage.eligible_count > self.coverage.selected_count)
            || self.coverage.truncated_count > self.coverage.selected_count
        {
            return Err("Invalid Ask request".into());
        }
        let mut memories = BTreeSet::new();
        for (i, e) in self.evidence.iter().enumerate() {
            if e.citation_id != format!("c{}", i + 1)
                || !canonical_uuid(&e.memory_id)
                || !memories.insert(&e.memory_id)
                || e.memory_revision == 0
                || e.memory_revision > 9_007_199_254_740_991
                || !lower_hex_64(&e.source_sha256)
                || !timezone_timestamp(&e.captured_at)
                || !matches!(
                    e.evidence_kind.as_str(),
                    "text_source"
                        | "human_note"
                        | "human_reading_correction"
                        | "machine_reading"
                        | "machine_audio_transcript"
                        | "human_audio_correction"
                )
                || !matches!(
                    e.epistemic_state.as_str(),
                    "reported" | "uncertain" | "question" | "unreviewed"
                )
                || e.excerpt.is_empty()
                || e.excerpt.len() > MAX_EXCERPT
                || e.excerpt.contains('\0')
            {
                return Err("Invalid Ask evidence".into());
            }
        }
        if self.canonical_bytes_unchecked()?.len() > MAX_BODY {
            return Err("Ask request exceeds its size limit".into());
        }
        Ok(())
    }
    fn canonical_bytes_unchecked(&self) -> Result<Vec<u8>> {
        // serde_json::Value uses recursively ordered object keys; Rust's UTF-8
        // string order preserves Unicode scalar ordering. Its writer emits
        // valid non-ASCII as UTF-8 and escapes JSON-required characters only.
        let value = serde_json::to_value(self).map_err(|_| "Invalid Ask request")?;
        serde_json::to_vec(&value).map_err(|_| "Invalid Ask request".into())
    }
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        self.canonical_bytes_unchecked()
    }
    pub fn payload_sha256(&self) -> Result<String> {
        Ok(hex::encode(Sha256::digest(self.canonical_bytes()?)))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AskCapabilityReply {
    pub scope: String,
    pub consent: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryCapabilityReply {
    pub scope: String,
    pub history_consent: String,
    pub history_enabled: bool,
    pub consent_version: u64,
    pub history_policy_version: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryConsentRequest {
    pub enable_history: bool,
    pub expected_version: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HistoryTemporal {
    pub mode: String,
    pub start_utc: String,
    pub end_exclusive_utc: String,
    pub display_date: String,
    pub display_timezone: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HistoryRequest {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub question: String,
    pub temporal: HistoryTemporal,
    pub coverage: AskCoverage,
    pub evidence: Vec<HistoryAskEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HistoryAskEvidence {
    pub citation_id: String,
    pub memory_id: String,
    pub memory_revision: u64,
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
impl HistoryRequest {
    fn validate(&self) -> Result<()> {
        if self.schema_version != "2.0"
            || !canonical_uuid(&self.operation_id)
            || !canonical_uuid(&self.vault_id)
            || self.question.is_empty()
            || self.question.len() > MAX_QUESTION
            || self.question.contains('\0')
            || !matches!(self.temporal.mode.as_str(), "as_of" | "compare_to_current")
            || !strict_utc(&self.temporal.start_utc)
            || !strict_utc(&self.temporal.end_exclusive_utc)
            || !history_interval_valid(&self.temporal.start_utc, &self.temporal.end_exclusive_utc)
            || self.evidence.len() > MAX_EVIDENCE
            || self.coverage.selected_count as usize != self.evidence.len()
            || self.coverage.eligible_count < self.coverage.selected_count
            || self.coverage.limited
                != (self.coverage.eligible_count > self.coverage.selected_count)
            || self.coverage.truncated_count > self.coverage.selected_count
        {
            return Err("Invalid history Ask request".into());
        }
        let mut roles = BTreeSet::new();
        let mut per_memory: BTreeMap<&str, usize> = BTreeMap::new();
        for (i, item) in self.evidence.iter().enumerate() {
            if item.citation_id != format!("c{}", i + 1)
                || !canonical_uuid(&item.memory_id)
                || !lower_hex_64(&item.event_sha256)
                || !lower_hex_64(&item.source_sha256)
                || !strict_utc(&item.recorded_at)
                || !strict_utc(&item.captured_at)
                || item.memory_revision == 0
                || item.current_revision < item.memory_revision
                || !matches!(
                    item.history_status.as_str(),
                    "as_of" | "as_of_later_corrected" | "current_counterpart"
                )
                || item.excerpt.is_empty()
                || item.excerpt.len() > MAX_EXCERPT
                || item.excerpt.contains('\0')
                || !roles.insert((
                    item.memory_id.as_str(),
                    item.memory_revision,
                    item.history_status.as_str(),
                ))
            {
                return Err("Invalid historical evidence".into());
            }
            let count = per_memory.entry(&item.memory_id).or_default();
            *count += 1;
            if *count > 2 {
                return Err("Too many historical items for one memory".into());
            }
        }
        if self.temporal.mode == "compare_to_current" {
            for item in &self.evidence {
                let has_counterpart = self.evidence.iter().any(|pair| {
                    pair.memory_id == item.memory_id
                        && pair.history_status == "current_counterpart"
                        && pair.memory_revision == pair.current_revision
                });
                if !has_counterpart
                    || (item.history_status == "current_counterpart"
                        && !self.evidence.iter().any(|past| {
                            past.memory_id == item.memory_id
                                && past.history_status != "current_counterpart"
                                && past.memory_revision < item.memory_revision
                        }))
                {
                    return Err("Historical comparison evidence is not paired".into());
                }
            }
        } else {
            for item in &self.evidence {
                if item.history_status == "as_of_later_corrected"
                    && !self.evidence.iter().any(|pair| {
                        pair.memory_id == item.memory_id
                            && pair.history_status == "current_counterpart"
                            && pair.memory_revision == item.current_revision
                    })
                {
                    return Err("Corrected historical evidence is not paired".into());
                }
            }
        }
        if self.canonical_bytes_unchecked()?.len() > MAX_BODY {
            return Err("History request exceeds its size limit".into());
        }
        Ok(())
    }
    fn canonical_bytes_unchecked(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(&serde_json::to_value(self).map_err(|_| "Invalid history request")?)
            .map_err(|_| "Invalid history request".into())
    }
    pub(crate) fn canonical_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        self.canonical_bytes_unchecked()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryIntent {
    schema_version: String,
    connection_fingerprint: String,
    consent_version: u64,
    request: HistoryRequest,
}
impl HistoryIntent {
    fn validate(&self, vault_id: &str, operation_id: &str) -> Result<()> {
        self.request.validate()?;
        if self.schema_version != "2.0"
            || self.request.vault_id != vault_id
            || self.request.operation_id != operation_id
            || !lower_hex_64(&self.connection_fingerprint)
        {
            return Err("History intent does not match this operation".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct HistoryAskOutcome {
    pub operation: AskOperation,
    pub answer: Option<AskAnswer>,
    pub temporal: HistoryTemporal,
    pub history_evidence: Vec<HistoryAskEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptSentence {
    pub text: String,
    pub citation_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptResult {
    pub status: String,
    pub sentences: Vec<ReceiptSentence>,
    pub limitations: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AskReceipt {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub payload_sha256: String,
    pub state: String,
    #[serde(deserialize_with = "required_option")]
    pub result: Option<ReceiptResult>,
    #[serde(deserialize_with = "required_option")]
    pub error_code: Option<String>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
impl AskReceipt {
    pub(crate) fn validate_for(&self, request: &AskRequest) -> Result<()> {
        if self.schema_version != "1.0"
            || self.operation_id != request.operation_id
            || self.vault_id != request.vault_id
            || self.payload_sha256 != request.payload_sha256()?
        {
            return Err("Ask receipt does not match this operation".into());
        }
        match self.state.as_str() {
            "in_flight" if self.result.is_none() && self.error_code.is_none() => Ok(()),
            "unknown"
                if self.result.is_none()
                    && self.error_code.as_deref() == Some("PROVIDER_OUTCOME_UNKNOWN") =>
            {
                Ok(())
            }
            "expired"
                if self.result.is_none()
                    && self.error_code.as_deref() == Some("RECEIPT_EXPIRED") =>
            {
                Ok(())
            }
            "failed"
                if self.result.is_none()
                    && self.error_code.as_deref().is_some_and(stable_error_code) =>
            {
                Ok(())
            }
            "complete" if self.error_code.is_none() => {
                let result = self
                    .result
                    .as_ref()
                    .ok_or("Ask receipt is missing its result")?;
                if !matches!(
                    result.status.as_str(),
                    "answered" | "ambiguous" | "insufficient_evidence"
                ) || result.sentences.len() > 12
                    || result.limitations.len() > 6
                    || (result.status == "insufficient_evidence" && !result.sentences.is_empty())
                    || (result.status != "insufficient_evidence" && result.sentences.is_empty())
                {
                    return Err("Invalid Ask result".into());
                }
                let allowed: BTreeSet<&str> = request
                    .evidence
                    .iter()
                    .map(|e| e.citation_id.as_str())
                    .collect();
                for sentence in &result.sentences {
                    if sentence.text.is_empty()
                        || sentence.text.chars().count() > 1_000
                        || sentence.text.contains('\0')
                        || sentence.citation_ids.is_empty()
                        || sentence.citation_ids.len() > 8
                    {
                        return Err("Invalid Ask sentence".into());
                    }
                    let mut unique = BTreeSet::new();
                    if sentence
                        .citation_ids
                        .iter()
                        .any(|id| !allowed.contains(id.as_str()) || !unique.insert(id))
                    {
                        return Err("Ask receipt contains an invalid citation".into());
                    }
                }
                if result
                    .limitations
                    .iter()
                    .any(|s| s.chars().count() > 500 || s.contains('\0'))
                {
                    return Err("Invalid Ask limitations".into());
                }
                Ok(())
            }
            _ => Err("Invalid Ask receipt state".into()),
        }
    }
    fn validate_history_for(&self, request: &HistoryRequest) -> Result<()> {
        let digest = hex::encode(Sha256::digest(request.canonical_bytes()?));
        if self.schema_version != "1.0"
            || self.operation_id != request.operation_id
            || self.vault_id != request.vault_id
            || self.payload_sha256 != digest
        {
            return Err("History receipt does not match this operation".into());
        }
        match self.state.as_str() {
            "in_flight" if self.result.is_none() && self.error_code.is_none() => return Ok(()),
            "unknown"
                if self.result.is_none()
                    && self.error_code.as_deref() == Some("PROVIDER_OUTCOME_UNKNOWN") =>
            {
                return Ok(())
            }
            "expired"
                if self.result.is_none()
                    && self.error_code.as_deref() == Some("RECEIPT_EXPIRED") =>
            {
                return Ok(())
            }
            "failed"
                if self.result.is_none()
                    && self.error_code.as_deref().is_some_and(stable_error_code) =>
            {
                return Ok(())
            }
            "complete" if self.error_code.is_none() => {}
            _ => return Err("Invalid history receipt state".into()),
        }
        {
            let result = self.result.as_ref().ok_or("Missing history result")?;
            if !matches!(
                result.status.as_str(),
                "answered" | "ambiguous" | "insufficient_evidence"
            ) || result.sentences.len() > 12
                || result.limitations.len() > 6
                || (result.status == "insufficient_evidence" && !result.sentences.is_empty())
                || (result.status != "insufficient_evidence" && result.sentences.is_empty())
            {
                return Err("Invalid history result".into());
            }
            let by_id: BTreeMap<_, _> = request
                .evidence
                .iter()
                .map(|e| (e.citation_id.as_str(), e))
                .collect();
            for sentence in &result.sentences {
                if sentence.text.is_empty()
                    || sentence.text.chars().count() > 1_000
                    || sentence.text.contains('\0')
                    || sentence.citation_ids.is_empty()
                    || sentence.citation_ids.len() > 8
                {
                    return Err("Invalid history sentence".into());
                }
                let mut unique = BTreeSet::new();
                if sentence.citation_ids.iter().any(|id| !unique.insert(id)) {
                    return Err("History receipt contains duplicate citations".into());
                }
                let cited: Vec<_> = sentence
                    .citation_ids
                    .iter()
                    .map(|id| {
                        by_id
                            .get(id.as_str())
                            .copied()
                            .ok_or_else(|| "Unknown history citation".to_string())
                    })
                    .collect::<Result<_>>()?;
                if request.temporal.mode == "compare_to_current" {
                    for item in &cited {
                        if item.history_status == "current_counterpart"
                            && !cited.iter().any(|past| {
                                past.memory_id == item.memory_id
                                    && past.history_status != "current_counterpart"
                            })
                        {
                            return Err("Comparison sentence lacks its historical pair".into());
                        }
                        if item.history_status != "current_counterpart"
                            && !cited.iter().any(|now| {
                                now.memory_id == item.memory_id
                                    && now.history_status == "current_counterpart"
                            })
                        {
                            return Err("Comparison sentence lacks its current pair".into());
                        }
                    }
                } else {
                    if !cited
                        .iter()
                        .any(|item| item.history_status != "current_counterpart")
                    {
                        return Err("Historical sentence lacks historical evidence".into());
                    }
                    for item in cited
                        .iter()
                        .filter(|item| item.history_status == "as_of_later_corrected")
                    {
                        if !cited.iter().any(|pair| {
                            pair.memory_id == item.memory_id
                                && pair.history_status == "current_counterpart"
                        }) {
                            return Err(
                                "Corrected history sentence lacks current counterpart".into()
                            );
                        }
                    }
                }
            }
            if result
                .limitations
                .iter()
                .any(|s| s.chars().count() > 500 || s.contains('\0'))
            {
                return Err("Invalid history limitations".into());
            }
        }
        Ok(())
    }
}
fn stable_error_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}
fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn timezone_timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return false;
    }
    if ![0..4, 5..7, 8..10, 11..13, 14..16, 17..19]
        .iter()
        .all(|r| b[r.clone()].iter().all(u8::is_ascii_digit))
    {
        return false;
    }
    let year = value[0..4].parse::<u32>().ok();
    let month = value[5..7].parse::<u32>().ok();
    let day = value[8..10].parse::<u32>().ok();
    let hour = value[11..13].parse::<u32>().ok();
    let minute = value[14..16].parse::<u32>().ok();
    let second = value[17..19].parse::<u32>().ok();
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) =
        (year, month, day, hour, minute, second)
    else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    if day == 0 || day > days || hour > 23 || minute > 59 || second > 60 {
        return false;
    }
    let tail = &value[19..];
    if tail == "Z" {
        return true;
    }
    tail.len() == 6
        && matches!(tail.as_bytes()[0], b'+' | b'-')
        && tail.as_bytes()[3] == b':'
        && tail.as_bytes()[1..3].iter().all(u8::is_ascii_digit)
        && tail.as_bytes()[4..6].iter().all(u8::is_ascii_digit)
        && tail[1..3].parse::<u32>().is_ok_and(|n| n <= 23)
        && tail[4..6].parse::<u32>().is_ok_and(|n| n <= 59)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AskIntent {
    schema_version: String,
    connection_fingerprint: String,
    request: AskRequest,
}
impl AskIntent {
    fn validate(&self, vault_id: &str, operation_id: &str) -> Result<()> {
        self.request.validate()?;
        if self.schema_version != "1.0"
            || self.request.vault_id != vault_id
            || self.request.operation_id != operation_id
            || !lower_hex_64(&self.connection_fingerprint)
        {
            return Err("Ask intent does not match the selected vault".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AskOperation {
    pub operation_id: String,
    pub state: String,
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AskSentence {
    pub text: String,
    pub citation_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AskCitation {
    pub citation_id: String,
    pub memory_id: String,
    pub memory_revision: u64,
    pub source_sha256: String,
    pub evidence_kind: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct AskAnswer {
    pub status: String,
    pub sentences: Vec<AskSentence>,
    pub citations: Vec<AskCitation>,
    pub limitations: Vec<String>,
    pub coverage: AskCoverage,
}
#[derive(Clone, Debug, Serialize)]
pub struct AskOutcome {
    pub operation: AskOperation,
    pub answer: Option<AskAnswer>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AskCapability {
    pub enabled: bool,
    pub scope: String,
    pub consent: String,
    pub explanation: String,
    pub history_consent: String,
    pub history_enabled: bool,
    pub consent_version: u64,
    pub history_policy_version: Option<String>,
}

fn operation(operation_id: &str, state: &str, error_code: Option<&str>) -> AskOperation {
    AskOperation {
        operation_id: operation_id.into(),
        state: state.into(),
        error_code: error_code.map(str::to_owned),
    }
}
fn unavailable(operation_id: &str, code: &str) -> AskOutcome {
    AskOutcome {
        operation: operation(operation_id, "failed", Some(code)),
        answer: None,
    }
}
fn terms(query: &str) -> Vec<String> {
    let mut out = BTreeSet::new();
    for term in query.split(|c: char| !c.is_alphanumeric()) {
        let term = term.to_lowercase();
        if term.chars().count() >= 2 {
            out.insert(term);
        }
    }
    out.into_iter().collect()
}
fn lowercase_with_offsets(text: &str) -> (String, Vec<(usize, usize)>) {
    let mut lower = String::new();
    let mut offsets = Vec::new();
    for (source_offset, ch) in text.char_indices() {
        let piece: String = ch.to_lowercase().collect();
        for (offset, _) in piece.char_indices() {
            offsets.push((lower.len() + offset, source_offset));
        }
        lower.push_str(&piece);
    }
    (lower, offsets)
}
fn earliest_term_offset(text: &str, query_terms: &[String]) -> Option<usize> {
    let (lower, offsets) = lowercase_with_offsets(text);
    query_terms
        .iter()
        .filter_map(|term| {
            lower.find(term).and_then(|at| {
                offsets
                    .iter()
                    .rev()
                    .find(|(low, _)| *low <= at)
                    .map(|(_, source)| *source)
            })
        })
        .min()
}
fn excerpt(text: &str, query_terms: &[String]) -> (String, bool) {
    if text.len() <= MAX_EXCERPT {
        return (text.to_owned(), false);
    }
    let matching = earliest_term_offset(text, query_terms);
    let mut start = matching
        .map(|p| p.saturating_sub(MAX_EXCERPT / 3))
        .unwrap_or(0);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    let mut end = (start + MAX_EXCERPT).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[start..end].to_owned(), true)
}
fn match_count(candidate: &AskCandidate, query_terms: &[String]) -> usize {
    let text = candidate.ranking_text.to_lowercase();
    query_terms
        .iter()
        .filter(|term| text.contains(term.as_str()))
        .count()
}
fn match_count_text(text: &str, query_terms: &[String]) -> usize {
    let text = text.to_lowercase();
    query_terms
        .iter()
        .filter(|term| text.contains(term.as_str()))
        .count()
}
fn selected_choice(candidate: &AskCandidate, query_terms: &[String]) -> AskCandidate {
    let Some(alternate) = candidate.alternate_reading.as_ref() else {
        return candidate.clone();
    };
    let annotation_matches = match_count_text(&candidate.text, query_terms);
    let reading_matches = match_count_text(&alternate.text, query_terms);
    if reading_matches >= annotation_matches {
        let mut selected = candidate.clone();
        selected.text = alternate.text.clone();
        selected.evidence_kind = alternate.evidence_kind.clone();
        selected.epistemic_state = alternate.epistemic_state.clone();
        selected.alternate_reading = None;
        selected
    } else {
        candidate.clone()
    }
}
fn select(
    candidates: &[AskCandidate],
    question: &str,
) -> (Vec<AskCandidate>, AskCoverage, Vec<AskEvidence>) {
    let query_terms = terms(question);
    let eligible_count = candidates.len();
    let mut ranked: Vec<_> = candidates
        .iter()
        .map(|candidate| selected_choice(candidate, &query_terms))
        .collect();
    if eligible_count > MAX_EVIDENCE {
        ranked.sort_by(|a, b| {
            match_count(b, &query_terms)
                .cmp(&match_count(a, &query_terms))
                .then(b.memory.captured_at.cmp(&a.memory.captured_at))
                .then(a.memory.id.cmp(&b.memory.id))
        });
        ranked.truncate(MAX_EVIDENCE);
    } else {
        ranked.sort_by(|a, b| {
            b.memory
                .captured_at
                .cmp(&a.memory.captured_at)
                .then(a.memory.id.cmp(&b.memory.id))
        });
    }
    let selected = ranked;
    let evidence: Vec<_> = selected
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let (text, _) = excerpt(&c.text, &query_terms);
            AskEvidence {
                citation_id: format!("c{}", i + 1),
                memory_id: c.memory.id.clone(),
                memory_revision: c.memory.revision,
                source_sha256: c.memory.source_sha256.clone(),
                captured_at: c.memory.captured_at.clone(),
                evidence_kind: c.evidence_kind.clone(),
                epistemic_state: c.epistemic_state.clone(),
                excerpt: text,
            }
        })
        .collect();
    let truncated_count = selected
        .iter()
        .filter(|c| c.text.len() > MAX_EXCERPT)
        .count();
    let coverage = AskCoverage {
        eligible_count: eligible_count as u32,
        selected_count: selected.len() as u32,
        limited: eligible_count > selected.len(),
        truncated_count: truncated_count as u32,
    };
    (selected, coverage, evidence)
}
fn request(
    operation_id: &str,
    vault_id: &str,
    question: &str,
    coverage: AskCoverage,
    evidence: Vec<AskEvidence>,
) -> Result<AskRequest> {
    let request = AskRequest {
        schema_version: "1.0".into(),
        operation_id: operation_id.into(),
        vault_id: vault_id.into(),
        question: question.into(),
        coverage,
        evidence,
    };
    request.validate()?;
    Ok(request)
}
fn evidence_matches_candidates(current: &[AskCandidate], request: &AskRequest) -> bool {
    let by_id: BTreeMap<_, _> = current.iter().map(|c| (c.memory.id.as_str(), c)).collect();
    let query_terms = terms(&request.question);
    for sent in &request.evidence {
        let Some(candidate) = by_id.get(sent.memory_id.as_str()) else {
            return false;
        };
        let candidate = selected_choice(candidate, &query_terms);
        let (current_excerpt, _) = excerpt(&candidate.text, &query_terms);
        if candidate.memory.revision != sent.memory_revision
            || candidate.memory.source_sha256 != sent.source_sha256
            || candidate.memory.captured_at != sent.captured_at
            || candidate.evidence_kind != sent.evidence_kind
            || candidate.epistemic_state != sent.epistemic_state
            || current_excerpt != sent.excerpt
        {
            return false;
        }
    }
    true
}
fn evidence_matches(vault: &Vault, request: &AskRequest) -> Result<bool> {
    let current = vault.ask_candidates()?;
    Ok(evidence_matches_candidates(&current, request))
}
fn coverage_limitations(coverage: &AskCoverage) -> Vec<String> {
    let mut out = vec!["Only current vault revisions were searched; historical revision retrieval is not included.".into()];
    if coverage.limited {
        out.push(format!("{} of {} eligible memories were considered; other memories may contain relevant evidence.", coverage.selected_count, coverage.eligible_count));
    }
    if coverage.truncated_count > 0 {
        out.push(format!(
            "{} selected source{} shortened; other passages may contain relevant evidence.",
            coverage.truncated_count,
            if coverage.truncated_count == 1 {
                " was"
            } else {
                "s were"
            }
        ));
    }
    out
}
fn zero_evidence(operation_id: &str) -> AskOutcome {
    AskOutcome {
        operation: operation(operation_id, "complete", None),
        answer: Some(AskAnswer {
            status: "insufficient_evidence".into(),
            sentences: vec![],
            citations: vec![],
            limitations: vec![
                "No eligible current vault evidence was available for this question.".into(),
                "Only current vault revisions were searched; historical revision retrieval is not included.".into(),
            ],
            coverage: AskCoverage {
                eligible_count: 0,
                selected_count: 0,
                limited: false,
                truncated_count: 0,
            },
        }),
    }
}
fn receipt_outcome(receipt: AskReceipt, intent: &AskIntent) -> Result<AskOutcome> {
    receipt.validate_for(&intent.request)?;
    match receipt.state.as_str() {
        "in_flight" => Ok(AskOutcome {
            operation: operation(&receipt.operation_id, "in_flight", None),
            answer: None,
        }),
        "unknown" => Ok(AskOutcome {
            operation: operation(
                &receipt.operation_id,
                "unknown",
                receipt.error_code.as_deref(),
            ),
            answer: None,
        }),
        "failed" | "expired" => Ok(AskOutcome {
            operation: operation(
                &receipt.operation_id,
                &receipt.state,
                receipt.error_code.as_deref(),
            ),
            answer: None,
        }),
        "complete" => {
            let result = receipt.result.as_ref().ok_or("Missing Ask result")?;
            let evidence: BTreeMap<_, _> = intent
                .request
                .evidence
                .iter()
                .map(|e| (e.citation_id.as_str(), e))
                .collect();
            let mut cited = BTreeSet::new();
            for sentence in &result.sentences {
                for id in &sentence.citation_ids {
                    cited.insert(id.as_str());
                }
            }
            let citations = cited
                .into_iter()
                .map(|id| {
                    let e = evidence.get(id).expect("receipt was validated");
                    AskCitation {
                        citation_id: e.citation_id.clone(),
                        memory_id: e.memory_id.clone(),
                        memory_revision: e.memory_revision,
                        source_sha256: e.source_sha256.clone(),
                        evidence_kind: e.evidence_kind.clone(),
                        quote: e.excerpt.clone(),
                    }
                })
                .collect();
            let mut limitations = result.limitations.clone();
            for item in coverage_limitations(&intent.request.coverage) {
                if !limitations.contains(&item) {
                    limitations.push(item);
                }
            }
            Ok(AskOutcome {
                operation: operation(&receipt.operation_id, "complete", None),
                answer: Some(AskAnswer {
                    status: result.status.clone(),
                    sentences: result
                        .sentences
                        .iter()
                        .map(|s| AskSentence {
                            text: s.text.clone(),
                            citation_ids: s.citation_ids.clone(),
                        })
                        .collect(),
                    citations,
                    limitations,
                    coverage: intent.request.coverage.clone(),
                }),
            })
        }
        _ => Err("Invalid Ask receipt state".into()),
    }
}
fn decode_intent(bytes: &[u8], vault_id: &str, operation_id: &str) -> Result<AskIntent> {
    let intent: AskIntent =
        strict_json_from_slice(bytes).map_err(|_| "Ask recovery state is unavailable")?;
    intent.validate(vault_id, operation_id)?;
    Ok(intent)
}
fn encode_intent(intent: &AskIntent) -> Result<Vec<u8>> {
    serde_json::to_vec(intent).map_err(|_| "Cannot persist Ask operation".into())
}
fn decode_history_intent(
    bytes: &[u8],
    vault_id: &str,
    operation_id: &str,
) -> Result<HistoryIntent> {
    let intent: HistoryIntent =
        strict_json_from_slice(bytes).map_err(|_| "History recovery state is unavailable")?;
    intent.validate(vault_id, operation_id)?;
    Ok(intent)
}
fn encode_history_intent(intent: &HistoryIntent) -> Result<Vec<u8>> {
    serde_json::to_vec(intent).map_err(|_| "Cannot persist history Ask operation".into())
}
fn history_request(
    operation_id: &str,
    vault_id: &str,
    question: &str,
    temporal: HistoryTemporal,
    selection: HistorySelection,
) -> Result<HistoryRequest> {
    let evidence = selection
        .evidence
        .into_iter()
        .enumerate()
        .map(|(i, item): (usize, HistoryEvidence)| HistoryAskEvidence {
            citation_id: format!("c{}", i + 1),
            memory_id: item.memory_id,
            memory_revision: item.revision,
            event_sha256: item.event_sha256,
            source_sha256: item.source_sha256,
            captured_at: item.captured_at,
            recorded_at: item.recorded_at,
            current_revision: item.current_revision,
            history_status: item.history_status,
            evidence_kind: item.evidence_kind,
            epistemic_state: item.epistemic_state,
            excerpt: item.excerpt,
        })
        .collect();
    let request = HistoryRequest {
        schema_version: "2.0".into(),
        operation_id: operation_id.into(),
        vault_id: vault_id.into(),
        question: question.into(),
        temporal,
        coverage: AskCoverage {
            eligible_count: selection.eligible_count,
            selected_count: selection.selected_count,
            limited: selection.limited,
            truncated_count: selection.truncated_count,
        },
        evidence,
    };
    request.validate()?;
    Ok(request)
}
fn history_selection_matches(vault: &Vault, request: &HistoryRequest) -> Result<bool> {
    let selection = vault.ask_history(
        &request.question,
        &request.temporal.start_utc,
        &request.temporal.end_exclusive_utc,
        request.temporal.mode == "compare_to_current",
    )?;
    let current = history_request(
        &request.operation_id,
        &request.vault_id,
        &request.question,
        request.temporal.clone(),
        selection,
    )?;
    Ok(current == *request)
}
fn history_receipt_outcome(
    receipt: &AskReceipt,
    intent: &HistoryIntent,
) -> Result<HistoryAskOutcome> {
    receipt.validate_history_for(&intent.request)?;
    let operation = match receipt.state.as_str() {
        "in_flight" => operation(&receipt.operation_id, "in_flight", None),
        "unknown" => operation(
            &receipt.operation_id,
            "unknown",
            receipt.error_code.as_deref(),
        ),
        "failed" | "expired" => operation(
            &receipt.operation_id,
            &receipt.state,
            receipt.error_code.as_deref(),
        ),
        "complete" => operation(&receipt.operation_id, "complete", None),
        _ => return Err("Invalid history receipt state".into()),
    };
    let answer = if receipt.state != "complete" {
        None
    } else {
        let result = receipt.result.as_ref().ok_or("Missing history result")?;
        let mut limitations = result.limitations.clone();
        limitations.push(
            "This answer reflects eligible retained vault revisions recorded by the selected date; it does not establish that a statement was objectively true then. Malformed, conflicting, missing, or non-monotonic revision histories are excluded."
                .into(),
        );
        if intent.request.coverage.limited {
            limitations.push(format!(
                "{} of {} eligible historical evidence items were selected.",
                intent.request.coverage.selected_count, intent.request.coverage.eligible_count
            ));
        }
        if intent.request.coverage.truncated_count > 0 {
            limitations
                .push("One or more retained excerpts were shortened around query terms.".into());
        }
        Some(AskAnswer {
            status: result.status.clone(),
            sentences: result
                .sentences
                .iter()
                .map(|s| AskSentence {
                    text: s.text.clone(),
                    citation_ids: s.citation_ids.clone(),
                })
                .collect(),
            citations: result
                .sentences
                .iter()
                .flat_map(|s| s.citation_ids.iter())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .filter_map(|id| {
                    intent
                        .request
                        .evidence
                        .iter()
                        .find(|e| &e.citation_id == id)
                        .map(|e| AskCitation {
                            citation_id: e.citation_id.clone(),
                            memory_id: e.memory_id.clone(),
                            memory_revision: e.memory_revision,
                            source_sha256: e.source_sha256.clone(),
                            evidence_kind: e.evidence_kind.clone(),
                            quote: e.excerpt.clone(),
                        })
                })
                .collect(),
            limitations,
            coverage: intent.request.coverage.clone(),
        })
    };
    Ok(HistoryAskOutcome {
        operation,
        answer,
        temporal: intent.request.temporal.clone(),
        history_evidence: intent.request.evidence.clone(),
    })
}
fn history_terminal(
    operation_id: &str,
    state: &str,
    code: &str,
    temporal: HistoryTemporal,
) -> HistoryAskOutcome {
    HistoryAskOutcome {
        operation: operation(operation_id, state, Some(code)),
        answer: None,
        temporal,
        history_evidence: Vec::new(),
    }
}
fn history_authorized(capability: &HistoryCapabilityReply, intent: &HistoryIntent) -> bool {
    capability.scope == "vault_intelligence"
        && capability.history_enabled
        && capability.history_consent == "active"
        && capability.consent_version == intent.consent_version
}
fn recover_history_receipt(
    transport: &LocalIntelligenceTransport,
    operation_id: &str,
) -> Result<ReceiptLookup> {
    transport.recover_history(operation_id)
}
fn capability_unavailable(consent: &str, explanation: &str) -> AskCapability {
    AskCapability {
        enabled: false,
        scope: "vault_intelligence".into(),
        consent: consent.into(),
        explanation: explanation.into(),
        history_consent: "unknown".into(),
        history_enabled: false,
        consent_version: 0,
        history_policy_version: None,
    }
}

#[tauri::command]
pub async fn vault_intelligence_capability(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<AskCapability> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection = match tauri::async_runtime::spawn_blocking(move || {
        pairing::confirmed_intelligence(&vault_id)
    })
    .await
    {
        Ok(Ok(c)) => c,
        _ => {
            return Ok(capability_unavailable(
                "unknown",
                "The separate Ask connection is not confirmed.",
            ))
        }
    };
    let c = connection.clone();
    let capability = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(c)?.capability()
    })
    .await;
    state.with(&expected_vault_id, |v| {
        if v.id != connection.vault_id {
            return Err("Vault selection changed".into());
        }
        Ok(())
    })?;
    match capability {
        Ok(Ok(cap)) => {
            let history_connection = connection.clone();
            let history = tauri::async_runtime::spawn_blocking(move || LocalIntelligenceTransport::new(history_connection)?.history_capability()).await;
            let (history_consent, history_enabled, consent_version, history_policy_version) = match history {
                Ok(Ok(value)) => (value.history_consent, value.history_enabled, value.consent_version, Some(value.history_policy_version)),
                _ => ("unknown".into(), false, 0, None),
            };
            Ok(AskCapability {
            enabled: cap.enabled && cap.consent == "active",
            scope: "vault_intelligence".into(),
            consent: cap.consent.clone(),
            history_consent, history_enabled, consent_version, history_policy_version,
            explanation: if cap.enabled { "Grounded Ask is available for selected vault text and memory excerpts.".into() } else if cap.consent != "active" { "Ask consent is missing; local notes and keyword search remain available.".into() } else { "Ask is configured but unavailable; local notes and keyword search remain available.".into() },
        })},
        _ => Ok(capability_unavailable("unknown", "Ask capability could not be confirmed; local notes and keyword search remain available.")),
    }
}

#[tauri::command]
pub async fn vault_ask(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
    question: String,
) -> Result<AskOutcome> {
    run_ask(
        &state,
        &expected_vault_id,
        &operation_id,
        Some(question),
        false,
    )
    .await
}
#[tauri::command]
pub async fn vault_recover_ask(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<AskOutcome> {
    run_ask(&state, &expected_vault_id, &operation_id, None, true).await
}

#[tauri::command]
pub async fn vault_set_history_consent(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    enable_history: bool,
    expected_version: u64,
) -> Result<HistoryCapabilityReply> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&vault_id))
            .await
            .map_err(|_| "History connection is unavailable")??;
    let request = HistoryConsentRequest {
        enable_history,
        expected_version,
    };
    // The selection and protected credential are both authority boundaries for
    // this mutation.  Recheck immediately before its external POST, not only
    // after the response returns.
    let verify_id = connection.vault_id.clone();
    let confirmed =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&verify_id))
            .await
            .map_err(|_| "History connection changed")??;
    if confirmed.fingerprint != connection.fingerprint {
        return Err("History connection changed".into());
    }
    state.with(&expected_vault_id, |v| {
        (v.id == connection.vault_id)
            .then_some(())
            .ok_or_else(|| "Vault selection changed".into())
    })?;
    let c = connection.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(c)?.set_history_consent(&request)
    })
    .await
    .map_err(|_| "History consent outcome is unknown")??;
    let verify_id = connection.vault_id.clone();
    let confirmed =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&verify_id))
            .await
            .map_err(|_| "History connection changed")??;
    if confirmed.fingerprint != connection.fingerprint {
        return Err("History connection changed".into());
    }
    state.with(&expected_vault_id, |v| {
        if v.id == connection.vault_id {
            Ok(())
        } else {
            Err("Vault selection changed".into())
        }
    })?;
    Ok(response)
}

#[tauri::command]
pub async fn vault_ask_history(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
    question: String,
    temporal: HistoryTemporal,
) -> Result<HistoryAskOutcome> {
    run_history_ask(
        &state,
        &expected_vault_id,
        &operation_id,
        Some((question, temporal)),
        false,
    )
    .await
}

#[tauri::command]
pub async fn vault_recover_history_ask(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<HistoryAskOutcome> {
    run_history_ask(&state, &expected_vault_id, &operation_id, None, true).await
}

#[tauri::command]
pub async fn vault_ask_history_citation(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
    citation_id: String,
) -> Result<crate::local_vault::HistoryCitation> {
    let saved = state
        .with(&expected_vault_id, |v| v.load_ask_intent(&operation_id))?
        .ok_or("History operation not found")?;
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let intent = decode_history_intent(&saved, &vault_id, &operation_id)?;
    let evidence = intent
        .request
        .evidence
        .iter()
        .find(|e| e.citation_id == citation_id)
        .ok_or("History citation not found")?;
    let conn =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&vault_id))
            .await
            .map_err(|_| "History connection is unavailable")??;
    if conn.fingerprint != intent.connection_fingerprint {
        return Err("STALE_EVIDENCE".into());
    }
    let cap_conn = conn.clone();
    let capability = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(cap_conn)?.history_capability()
    })
    .await;
    if !matches!(capability, Ok(Ok(ref c)) if history_authorized(c, &intent)) {
        return Err("STALE_EVIDENCE".into());
    }
    let verify_id = conn.vault_id.clone();
    let confirmed =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&verify_id))
            .await
            .map_err(|_| "STALE_EVIDENCE")?
            .map_err(|_| "STALE_EVIDENCE")?;
    if confirmed.fingerprint != intent.connection_fingerprint {
        return Err("STALE_EVIDENCE".into());
    }
    state.with(&expected_vault_id, |v| {
        if v.id != intent.request.vault_id || !history_selection_matches(v, &intent.request)? {
            return Err("STALE_EVIDENCE".into());
        }
        v.history_citation(
            &evidence.memory_id,
            evidence.memory_revision,
            &evidence.event_sha256,
            &evidence.source_sha256,
            &evidence.excerpt,
        )
    })
}

async fn run_history_ask(
    state: &LocalVaultState,
    session: &str,
    operation_id: &str,
    input: Option<(String, HistoryTemporal)>,
    recovery: bool,
) -> Result<HistoryAskOutcome> {
    if !canonical_uuid(operation_id) {
        return Err("Enter a valid Ask operation ID".into());
    }
    if let Some((question, temporal)) = input.as_ref() {
        if question.is_empty()
            || question.len() > MAX_QUESTION
            || question.contains('\0')
            || !matches!(temporal.mode.as_str(), "as_of" | "compare_to_current")
            || !strict_utc(&temporal.start_utc)
            || !strict_utc(&temporal.end_exclusive_utc)
            || temporal.display_date.len() != 10
            || temporal.display_timezone.is_empty()
            || temporal.display_timezone.len() > 128
        {
            return Err("Invalid historical Ask intent".into());
        }
    }
    let vault_id = state.with(session, |v| Ok(v.id.clone()))?;
    let connection = match tauri::async_runtime::spawn_blocking(move || {
        confirmed_history_intelligence(&vault_id)
    })
    .await
    {
        Ok(Ok(value)) => value,
        _ => return Err("History connection is unavailable".into()),
    };
    let cap_connection = connection.clone();
    let capability = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(cap_connection)?.history_capability()
    })
    .await
    .map_err(|_| "History capability is unavailable")??;
    if !capability.history_enabled || capability.history_consent != "active" {
        return Err("History consent or capability is unavailable".into());
    }
    state.with(session, |v| {
        if v.id == connection.vault_id {
            Ok(())
        } else {
            Err("Vault selection changed".into())
        }
    })?;
    let saved = state.with(session, |v| v.load_ask_intent(operation_id))?;
    let existing = saved.is_some();
    let intent = if let Some(bytes) = saved {
        let intent = decode_history_intent(&bytes, &connection.vault_id, operation_id)?;
        if intent.connection_fingerprint != connection.fingerprint
            || intent.consent_version != capability.consent_version
        {
            return Err("History authorization changed".into());
        }
        if input.as_ref().is_some_and(|(question, temporal)| {
            question != &intent.request.question || temporal != &intent.request.temporal
        }) {
            return Err("History operation ID already has different intent".into());
        }
        intent
    } else {
        if recovery {
            return Err("History operation not found".into());
        }
        let (question, temporal) = input.ok_or("History intent unavailable")?;
        let selection = state.with(session, |v| {
            v.ask_history(
                &question,
                &temporal.start_utc,
                &temporal.end_exclusive_utc,
                temporal.mode == "compare_to_current",
            )
        })?;
        let request = history_request(
            operation_id,
            &connection.vault_id,
            &question,
            temporal,
            selection,
        )?;
        let intent = HistoryIntent {
            schema_version: "2.0".into(),
            connection_fingerprint: connection.fingerprint.clone(),
            consent_version: capability.consent_version,
            request,
        };
        intent.validate(&connection.vault_id, operation_id)?;
        let bytes = encode_history_intent(&intent)?;
        state.with(session, |v| {
            v.save_ask_intent(operation_id, &bytes)?;
            Ok(())
        })?;
        intent
    };
    if intent.request.evidence.is_empty() {
        return Ok(HistoryAskOutcome {
            operation: operation(operation_id, "complete", None),
            answer: Some(AskAnswer {
                status: "insufficient_evidence".into(),
                sentences: vec![],
                citations: vec![],
                limitations: vec![
                    "No eligible recorded history was available for this date. This route only uses eligible retained vault revisions and does not establish objective truth; malformed, conflicting, missing, or non-monotonic revision histories are excluded.".into()
                ],
                coverage: intent.request.coverage.clone(),
            }),
            temporal: intent.request.temporal.clone(),
            history_evidence: vec![],
        });
    }
    if !state.with(session, |v| history_selection_matches(v, &intent.request))? {
        return Ok(history_terminal(
            operation_id,
            "failed",
            "STALE_EVIDENCE",
            intent.request.temporal.clone(),
        ));
    }
    let conn = connection.clone();
    let receipt = if existing || recovery {
        let operation_id = operation_id.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let transport = LocalIntelligenceTransport::new(conn)?;
            recover_history_receipt(&transport, &operation_id)
        })
        .await
        .map_err(|_| "History recovery interrupted")??
    } else {
        let fresh_id = connection.vault_id.clone();
        let fresh =
            tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&fresh_id))
                .await
                .map_err(|_| "History connection changed")??;
        if fresh.fingerprint != intent.connection_fingerprint {
            return Ok(history_terminal(
                operation_id,
                "failed",
                "HISTORY_CONNECTION_CHANGED",
                intent.request.temporal.clone(),
            ));
        }
        let fresh_conn = fresh.clone();
        let second = tauri::async_runtime::spawn_blocking(move || {
            LocalIntelligenceTransport::new(fresh_conn)?.history_capability()
        })
        .await
        .map_err(|_| "History capability is unavailable")??;
        if !second.history_enabled
            || second.history_consent != "active"
            || second.consent_version != intent.consent_version
            || !state.with(session, |v| history_selection_matches(v, &intent.request))?
        {
            return Ok(history_terminal(
                operation_id,
                "failed",
                "STALE_EVIDENCE",
                intent.request.temporal.clone(),
            ));
        }
        let verify_id = connection.vault_id.clone();
        let confirmed = tauri::async_runtime::spawn_blocking(move || {
            confirmed_history_intelligence(&verify_id)
        })
        .await;
        if !matches!(confirmed, Ok(Ok(ref c)) if c.fingerprint == intent.connection_fingerprint) {
            return Ok(history_terminal(
                operation_id,
                "failed",
                "HISTORY_CONNECTION_CHANGED",
                intent.request.temporal.clone(),
            ));
        }
        if !state.with(session, |v| history_selection_matches(v, &intent.request))? {
            return Ok(history_terminal(
                operation_id,
                "failed",
                "STALE_EVIDENCE",
                intent.request.temporal.clone(),
            ));
        }
        let post_conn = fresh;
        let request = intent.request.clone();
        let posted = tauri::async_runtime::spawn_blocking(move || {
            LocalIntelligenceTransport::new(post_conn)?.post_history(&request)
        })
        .await;
        let posted = match posted {
            Ok(Ok(receipt)) => receipt,
            _ => {
                return Ok(history_terminal(
                    operation_id,
                    "unknown",
                    "PROVIDER_OUTCOME_UNKNOWN",
                    intent.request.temporal.clone(),
                ))
            }
        };
        ReceiptLookup::Receipt(posted)
    };
    let receipt = match receipt {
        ReceiptLookup::Receipt(value) => value,
        ReceiptLookup::NotFound => {
            return Ok(history_terminal(
                operation_id,
                "unknown",
                "HISTORY_RECEIPT_NOT_FOUND",
                intent.request.temporal.clone(),
            ))
        }
    };
    let latest_conn = connection.clone();
    let latest = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(latest_conn)?.history_capability()
    })
    .await;
    if !matches!(latest, Ok(Ok(ref c)) if history_authorized(c, &intent))
        || !state.with(session, |v| history_selection_matches(v, &intent.request))?
    {
        return Ok(history_terminal(
            operation_id,
            "failed",
            "STALE_EVIDENCE",
            intent.request.temporal.clone(),
        ));
    }
    let verify_id = connection.vault_id.clone();
    let confirmed =
        tauri::async_runtime::spawn_blocking(move || confirmed_history_intelligence(&verify_id))
            .await;
    if !matches!(confirmed, Ok(Ok(ref c)) if c.fingerprint == intent.connection_fingerprint) {
        return Ok(history_terminal(
            operation_id,
            "failed",
            "HISTORY_AUTHORIZATION_CHANGED",
            intent.request.temporal.clone(),
        ));
    }
    state.with(session, |v| {
        if v.id == intent.request.vault_id {
            Ok(())
        } else {
            Err("Vault selection changed".into())
        }
    })?;
    if !state.with(session, |v| history_selection_matches(v, &intent.request))? {
        return Ok(history_terminal(
            operation_id,
            "failed",
            "STALE_EVIDENCE",
            intent.request.temporal.clone(),
        ));
    }
    history_receipt_outcome(&receipt, &intent)
}

async fn run_ask(
    state: &LocalVaultState,
    session: &str,
    operation_id: &str,
    question: Option<String>,
    recovery: bool,
) -> Result<AskOutcome> {
    if !canonical_uuid(operation_id) {
        return Err("Enter a valid Ask operation ID".into());
    }
    if let Some(q) = question.as_deref() {
        if q.is_empty() || q.len() > MAX_QUESTION || q.contains('\0') {
            return Err("Question must contain 1 to 2,000 UTF-8 bytes".into());
        }
    }
    let vault_id = state.with(session, |v| Ok(v.id.clone()))?;
    let connection = match tauri::async_runtime::spawn_blocking(move || {
        pairing::confirmed_intelligence(&vault_id)
    })
    .await
    {
        Ok(Ok(connection)) => connection,
        _ => return Ok(unavailable(operation_id, "ASK_CONNECTION_UNAVAILABLE")),
    };
    if state.with(session, |v| Ok(v.id.clone()))? != connection.vault_id {
        return Ok(unavailable(operation_id, "VAULT_CHANGED"));
    }
    let check = connection.clone();
    let capability = match tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(check)?.capability()
    })
    .await
    {
        Ok(Ok(cap)) => cap,
        _ => return Ok(unavailable(operation_id, "ASK_CAPABILITY_UNKNOWN")),
    };
    state.with(session, |v| {
        if v.id == connection.vault_id {
            Ok(())
        } else {
            Err("Vault selection changed".into())
        }
    })?;
    if !capability.enabled || capability.consent != "active" {
        return Ok(unavailable(
            operation_id,
            if capability.consent != "active" {
                "ASK_CONSENT_REQUIRED"
            } else {
                "ASK_UNAVAILABLE"
            },
        ));
    }
    let (saved, candidates) = state.with(session, |v| {
        Ok((v.load_ask_intent(operation_id)?, v.ask_candidates()?))
    })?;
    let existing_intent = saved.is_some();
    let intent = if let Some(bytes) = saved {
        let intent = decode_intent(&bytes, &connection.vault_id, operation_id)?;
        if intent.connection_fingerprint != connection.fingerprint {
            return Ok(unavailable(operation_id, "ASK_CONNECTION_CHANGED"));
        }
        if question
            .as_ref()
            .is_some_and(|q| q != &intent.request.question)
        {
            return Err("Ask operation ID already has a different question".into());
        }
        intent
    } else {
        if recovery {
            return Ok(unavailable(operation_id, "ASK_OPERATION_NOT_FOUND"));
        }
        let q = question.as_deref().ok_or("Question unavailable")?;
        let (selected, coverage, evidence) = select(&candidates, q);
        let req = request(operation_id, &connection.vault_id, q, coverage, evidence)?;
        let intent = AskIntent {
            schema_version: "1.0".into(),
            connection_fingerprint: connection.fingerprint.clone(),
            request: req,
        };
        intent.validate(&connection.vault_id, operation_id)?;
        let bytes = encode_intent(&intent)?;
        state.with(session, |v| {
            if v.id != connection.vault_id {
                return Err("Vault selection changed".into());
            }
            v.save_ask_intent(operation_id, &bytes)?;
            Ok(())
        })?;
        let _ = selected;
        intent
    };
    if intent.request.evidence.is_empty() {
        return Ok(zero_evidence(operation_id));
    }
    if !evidence_matches_in_state(state, session, &connection.vault_id, &intent.request)? {
        return Ok(unavailable(operation_id, "STALE_EVIDENCE"));
    }
    let conn = connection.clone();
    let req = intent.request.clone();
    let lookup = if recovery || existing_intent {
        tauri::async_runtime::spawn_blocking(move || {
            LocalIntelligenceTransport::new(conn)?.get(&req.operation_id)
        })
        .await
        .map_err(|_| "Ask recovery interrupted")??
    } else {
        let vault_for_confirmation = connection.vault_id.clone();
        let fresh = match tauri::async_runtime::spawn_blocking(move || {
            pairing::confirmed_intelligence(&vault_for_confirmation)
        })
        .await
        {
            Ok(Ok(c)) if c.fingerprint == intent.connection_fingerprint => c,
            _ => return Ok(unavailable(operation_id, "ASK_CONNECTION_CHANGED")),
        };
        state.with(session, |v| {
            if v.id == connection.vault_id {
                Ok(())
            } else {
                Err("Vault selection changed".into())
            }
        })?;
        let capability_conn = fresh.clone();
        let second_cap = tauri::async_runtime::spawn_blocking(move || {
            LocalIntelligenceTransport::new(capability_conn)?.capability()
        })
        .await;
        if !matches!(second_cap, Ok(Ok(ref cap)) if cap.enabled && cap.consent == "active") {
            return Ok(unavailable(operation_id, "ASK_AUTHORIZATION_CHANGED"));
        }
        if !evidence_matches_in_state(state, session, &connection.vault_id, &intent.request)? {
            return Ok(unavailable(operation_id, "STALE_EVIDENCE"));
        }
        let posted_conn = fresh;
        let posted_req = intent.request.clone();
        let posted = tauri::async_runtime::spawn_blocking(move || {
            LocalIntelligenceTransport::new(posted_conn)?.post(&posted_req)
        })
        .await;
        match posted {
            Ok(Ok(receipt)) => ReceiptLookup::Receipt(receipt),
            _ => {
                return Ok(AskOutcome {
                    operation: operation(operation_id, "unknown", Some("PROVIDER_OUTCOME_UNKNOWN")),
                    answer: None,
                })
            }
        }
    };
    let receipt = match lookup {
        ReceiptLookup::Receipt(receipt) => receipt,
        ReceiptLookup::NotFound => {
            // Only an authenticated 404 permits resending the exact persisted body.
            if !evidence_matches_in_state(state, session, &connection.vault_id, &intent.request)? {
                return Ok(unavailable(operation_id, "STALE_EVIDENCE"));
            }
            let vault_for_confirmation = connection.vault_id.clone();
            let current = match tauri::async_runtime::spawn_blocking(move || {
                pairing::confirmed_intelligence(&vault_for_confirmation)
            })
            .await
            {
                Ok(Ok(c)) if c.fingerprint == intent.connection_fingerprint => c,
                _ => return Ok(unavailable(operation_id, "ASK_CONNECTION_CHANGED")),
            };
            let conn = current.clone();
            let cap = tauri::async_runtime::spawn_blocking(move || {
                LocalIntelligenceTransport::new(conn)?.capability()
            })
            .await;
            if !matches!(cap, Ok(Ok(ref c)) if c.enabled && c.consent == "active") {
                return Ok(unavailable(operation_id, "ASK_AUTHORIZATION_CHANGED"));
            }
            if !evidence_matches_in_state(state, session, &current.vault_id, &intent.request)? {
                return Ok(unavailable(operation_id, "STALE_EVIDENCE"));
            }
            let conn = current.clone();
            let req = intent.request.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                LocalIntelligenceTransport::new(conn)?.post(&req)
            })
            .await
            {
                Ok(Ok(receipt)) => receipt,
                _ => {
                    return Ok(AskOutcome {
                        operation: operation(
                            operation_id,
                            "unknown",
                            Some("PROVIDER_OUTCOME_UNKNOWN"),
                        ),
                        answer: None,
                    })
                }
            }
        }
    };
    if receipt.validate_for(&intent.request).is_err() {
        return Ok(unavailable(operation_id, "ASK_RECEIPT_INVALID"));
    }
    if receipt.state != "complete" {
        return receipt_outcome(receipt, &intent);
    }
    let check_id = connection.vault_id.clone();
    let fresh = match tauri::async_runtime::spawn_blocking(move || {
        pairing::confirmed_intelligence(&check_id)
    })
    .await
    {
        Ok(Ok(c)) if c.fingerprint == intent.connection_fingerprint => c,
        _ => return Ok(unavailable(operation_id, "ASK_AUTHORIZATION_CHANGED")),
    };
    let conn = fresh.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || {
        LocalIntelligenceTransport::new(conn)?.capability()
    })
    .await;
    if !matches!(cap, Ok(Ok(ref c)) if c.enabled && c.consent == "active") {
        return Ok(unavailable(operation_id, "ASK_AUTHORIZATION_CHANGED"));
    }
    if !evidence_matches_in_state(state, session, &connection.vault_id, &intent.request)? {
        return Ok(unavailable(operation_id, "STALE_EVIDENCE"));
    }
    let outcome = receipt_outcome(receipt, &intent)?;
    state.with(session, |v| {
        if v.id == connection.vault_id {
            Ok(())
        } else {
            Err("Vault selection changed".into())
        }
    })?;
    Ok(outcome)
}
fn evidence_matches_in_state(
    state: &LocalVaultState,
    session: &str,
    vault_id: &str,
    request: &AskRequest,
) -> Result<bool> {
    state.with(session, |v| {
        if v.id != vault_id {
            return Ok(false);
        }
        evidence_matches(v, request)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_vault::AskEvidenceChoice;
    use crate::reading::{ReadingReceipt, ReadingRequest};
    use std::{
        fs,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{mpsc, Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };
    fn photo_receipt(work: &ReadingRequest) -> ReadingReceipt {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
        ))
        .unwrap();
        let mut response = fixture["response"].clone();
        response["binding"] = serde_json::to_value(&work.binding).unwrap();
        response["result"]["input_manifest_sha256"] = work.digest().unwrap().into();
        response["result"]["extraction"]["input_manifest_sha256"] = work.digest().unwrap().into();
        response["result"]["extraction"]["capture_id"] = work.binding.memory_id.clone().into();
        let encoded = serde_json::to_string(&response)
            .unwrap()
            .replace(
                "33333333-3333-4333-8333-333333333333",
                &work.binding.source_id,
            )
            .replace("Synthetic note: 12?", "Bob met transformer specialist");
        serde_json::from_str(&encoded).unwrap()
    }
    fn synthetic(memory_id: &str, date: &str, text: &str) -> AskCandidate {
        AskCandidate {
            memory: crate::local_vault::VaultMemory {
                id: memory_id.into(),
                revision: 2,
                note: text.into(),
                reading: None,
                organization: None,
                source_sha256: "a".repeat(64),
                source_name: "note.txt".into(),
                captured_at: date.into(),
                updated_at: date.into(),
                conflict: None,
                state: "active".into(),
                note_path: Some(format!("{memory_id}.md")),
                related_context: Vec::new(),
                context_repair_pending: false,
                imported_text: None,
                audio_source: None,
                audio_transcript: None,
            },
            text: text.into(),
            evidence_kind: "text_source".into(),
            epistemic_state: "reported".into(),
            alternate_reading: None,
            ranking_text: format!("note.txt {text}"),
        }
    }
    fn photo_candidate(annotation: &str, reading: &str) -> AskCandidate {
        let mut candidate = synthetic(
            "00000000-0000-4000-8000-000000000003",
            "2026-10-09T12:00:00Z",
            annotation,
        );
        candidate.memory.source_name = "photo.png".into();
        candidate.evidence_kind = "human_note".into();
        candidate.alternate_reading = Some(AskEvidenceChoice {
            text: reading.into(),
            evidence_kind: "machine_reading".into(),
            epistemic_state: "unreviewed".into(),
        });
        candidate.ranking_text = format!("photo.png {annotation} {reading}");
        candidate
    }
    #[test]
    fn rust_canonical_digest_matches_shared_unicode_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-intelligence-synthetic.json"
        ))
        .unwrap();
        for name in ["transformer-question", "unicode-question"] {
            let request = fixture["requests"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["name"] == name)
                .unwrap();
            let req: AskRequest = serde_json::from_value(request["request"].clone()).unwrap();
            assert_eq!(
                req.canonical_bytes().unwrap(),
                request["canonical_json_utf8"].as_str().unwrap().as_bytes(),
                "canonical bytes differ for {name}"
            );
            assert_eq!(
                req.payload_sha256().unwrap(),
                request["sha256"].as_str().unwrap(),
                "canonical digest differs for {name}"
            );
        }
        let unicode = fixture["requests"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == "unicode-question")
            .unwrap();
        let req: AskRequest = serde_json::from_value(unicode["request"].clone()).unwrap();
        assert_eq!(
            req.payload_sha256().unwrap(),
            "83da2e4f0dfcfb7ee7ade51d27a25c79356cf13c0dc30673dd5d45a570683b8c"
        );
    }
    #[test]
    fn at_most_eight_eligible_records_are_all_included_for_vague_query() {
        let records = vec![
            synthetic(
                "00000000-0000-4000-8000-000000000003",
                "2026-10-09T12:00:00Z",
                "Lunch with Ada",
            ),
            synthetic(
                "00000000-0000-4000-8000-000000000004",
                "2026-10-08T12:00:00Z",
                "Transformer person in Houston",
            ),
        ];
        let (_, coverage, evidence) = select(&records, "Who did I meet?");
        assert_eq!(coverage.eligible_count, 2);
        assert_eq!(coverage.selected_count, 2);
        assert!(!coverage.limited);
        assert_eq!(evidence.len(), 2);
    }
    #[test]
    fn audio_evidence_enters_current_ask_only_through_verified_eligible_candidates() {
        use crate::audio_wav::fixtures::synthetic_wav;
        let dir = std::env::temp_dir().join(format!(
            "recall-synthetic-ask-audio-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&dir).unwrap();
        let vault = Vault::open(&dir).unwrap();
        let memory = vault
            .audio_commit_capture(
                &uuid::Uuid::new_v4().to_string(),
                &synthetic_wav(16_000, 1, 16_000),
                "recorded",
                None,
            )
            .unwrap();
        // Saved but untranscribed audio is never evidence.
        assert!(vault.ask_candidates().unwrap().is_empty());
        let machine = crate::local_vault::AudioMachineTranscript {
            operation_id: uuid::Uuid::new_v4().to_string(),
            source_sha256: memory.source_sha256.clone(),
            source_revision: 1,
            runtime_source_commit: "d".repeat(40),
            runtime_binary_sha256: "a".repeat(64),
            model_sha256: "b".repeat(64),
            derivative_sha256: "c".repeat(64),
            transform_version: crate::audio_wav::TRANSFORM_VERSION.into(),
            output_sha256: "e".repeat(64),
            text: "Remember to call the dentist tomorrow.".into(),
            segments: None,
            input_rms_pcm16: 2800.0,
            quality_flags: Vec::new(),
            eligibility: "eligible".into(),
            quality_state: "machine_unreviewed".into(),
        };
        vault
            .audio_apply_machine_transcript(&memory.id, machine)
            .unwrap();
        let candidates = vault.ask_candidates().unwrap();
        let (selected, coverage, evidence) = select(&candidates, "When do I call the dentist?");
        assert_eq!((coverage.eligible_count, coverage.selected_count), (1, 1));
        assert_eq!(evidence[0].evidence_kind, "machine_audio_transcript");
        assert_eq!(evidence[0].epistemic_state, "unreviewed");
        assert_eq!(evidence[0].source_sha256, memory.source_sha256);
        let ask = request(
            "00000000-0000-4000-8000-000000000001",
            &vault.id,
            "When do I call the dentist?",
            coverage,
            evidence,
        )
        .expect("native Ask validation accepts audio evidence kinds");
        assert!(evidence_matches_candidates(&candidates, &ask));
        assert_eq!(
            selected[0].memory.audio_source.as_ref().unwrap().media_type,
            "audio/wav"
        );
        // A later human correction changes the evidence, invalidating the old selection.
        let corrected = vault
            .audio_correct(
                &memory.id,
                2,
                &uuid::Uuid::new_v4().to_string(),
                "Call the dentist on Friday.",
            )
            .unwrap();
        assert_eq!(corrected.revision, 3);
        let current = vault.ask_candidates().unwrap();
        assert!(!evidence_matches_candidates(&current, &ask));
        let (_, _, now) = select(&current, "dentist");
        assert_eq!(now[0].evidence_kind, "human_audio_correction");
        assert_eq!(now[0].epistemic_state, "reported");
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn photo_choice_prefers_query_match_and_effective_reading_on_ties() {
        let candidate = photo_candidate("Meeting notes", "Transformer specialist");
        let (_, _, annotation_match) = select(std::slice::from_ref(&candidate), "meeting");
        assert_eq!(annotation_match[0].evidence_kind, "human_note");
        assert_eq!(annotation_match[0].excerpt, "Meeting notes");

        let (_, _, reading_match) = select(std::slice::from_ref(&candidate), "transformer");
        assert_eq!(reading_match[0].evidence_kind, "machine_reading");
        assert_eq!(reading_match[0].epistemic_state, "unreviewed");
        assert_eq!(reading_match[0].excerpt, "Transformer specialist");

        let (_, _, vague_tie) = select(&[candidate], "What happened?");
        assert_eq!(vague_tie[0].evidence_kind, "machine_reading");
        assert_eq!(vague_tie[0].excerpt, "Transformer specialist");
    }
    #[test]
    fn corrected_reading_replaces_machine_ranking_and_invalidates_old_selection() {
        let original = photo_candidate("Meeting notes", "Bob met transformer specialist");
        let (_, coverage, evidence) = select(std::slice::from_ref(&original), "Bob");
        let old_request = request(
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            "Bob",
            coverage,
            evidence,
        )
        .unwrap();
        assert!(evidence_matches_candidates(
            std::slice::from_ref(&original),
            &old_request
        ));

        let mut corrected = photo_candidate("Meeting notes", "Alice met transformer specialist");
        corrected.alternate_reading.as_mut().unwrap().evidence_kind =
            "human_reading_correction".into();
        corrected
            .alternate_reading
            .as_mut()
            .unwrap()
            .epistemic_state = "reported".into();
        corrected.ranking_text = "photo.png Meeting notes Alice met transformer specialist".into();
        assert!(!corrected.ranking_text.to_lowercase().contains("bob"));
        assert!(!evidence_matches_candidates(&[corrected], &old_request));
    }
    #[test]
    fn photo_annotation_and_effective_reading_are_revalidated_as_distinct_current_evidence() {
        let root = std::env::temp_dir().join(format!("recall-ask-photo-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let captured = vault
            .capture(
                &Uuid::new_v4().to_string(),
                "synthetic.png",
                b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY",
                "Meeting notes",
            )
            .unwrap();
        let work = vault
            .prepare_reading(&captured.id, captured.revision, &Uuid::new_v4().to_string())
            .unwrap();
        vault.accept_reading(&work, &photo_receipt(&work)).unwrap();

        let candidates = vault.ask_candidates().unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].text, "Meeting notes");
        assert_eq!(
            candidates[0].alternate_reading.as_ref().unwrap().text,
            "Bob met transformer specialist"
        );
        assert!(candidates[0].ranking_text.contains("Meeting notes"));
        assert!(candidates[0]
            .ranking_text
            .contains("Bob met transformer specialist"));
        let (_, coverage, evidence) = select(&candidates, "transformer specialist");
        assert_eq!(evidence[0].evidence_kind, "machine_reading");
        assert_eq!(evidence[0].excerpt, "Bob met transformer specialist");
        let old_request = request(
            &Uuid::new_v4().to_string(),
            &vault.id,
            "transformer specialist",
            coverage,
            evidence,
        )
        .unwrap();
        assert!(evidence_matches(&vault, &old_request).unwrap());

        vault
            .correct_reading(
                &captured.id,
                2,
                &Uuid::new_v4().to_string(),
                "Alice met transformer specialist",
            )
            .unwrap();
        let corrected = vault.ask_candidates().unwrap();
        assert!(!corrected[0].ranking_text.to_lowercase().contains("bob"));
        assert!(corrected[0]
            .ranking_text
            .contains("Alice met transformer specialist"));
        assert!(!evidence_matches(&vault, &old_request).unwrap());
        let (_, _, annotation_evidence) = select(&corrected, "meeting");
        assert_eq!(annotation_evidence[0].evidence_kind, "human_note");
        let (_, _, corrected_evidence) = select(&corrected, "transformer");
        assert_eq!(
            corrected_evidence[0].evidence_kind,
            "human_reading_correction"
        );
        let (_, _, vague_evidence) = select(&corrected, "What happened?");
        assert_eq!(vague_evidence[0].evidence_kind, "human_reading_correction");

        vault
            .correct_reading(&captured.id, 3, &Uuid::new_v4().to_string(), "")
            .unwrap();
        let empty = vault.ask_candidates().unwrap();
        assert!(empty[0].alternate_reading.is_none());
        assert!(!empty[0].ranking_text.to_lowercase().contains("bob"));
        assert!(!empty[0].ranking_text.to_lowercase().contains("alice"));
        drop(vault);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn over_eight_ranks_any_term_deterministically_and_reports_coverage() {
        let mut records: Vec<_> = (0..10)
            .map(|i| {
                synthetic(
                    &format!("00000000-0000-4000-8000-{i:012}"),
                    &format!("2026-10-{:02}T12:00:00Z", 9 - i),
                    if i == 9 {
                        "Houston meeting"
                    } else {
                        "Unrelated text"
                    },
                )
            })
            .collect();
        records.reverse();
        let (selected_a, coverage_a, evidence_a) = select(&records, "transformer Houston");
        let (selected_b, coverage_b, evidence_b) = select(&records, "transformer Houston");
        assert_eq!(
            selected_a.iter().map(|r| &r.memory.id).collect::<Vec<_>>(),
            selected_b.iter().map(|r| &r.memory.id).collect::<Vec<_>>()
        );
        assert_eq!(
            evidence_a.iter().map(|e| &e.memory_id).collect::<Vec<_>>(),
            evidence_b.iter().map(|e| &e.memory_id).collect::<Vec<_>>()
        );
        assert_eq!(coverage_a, coverage_b);
        assert!(coverage_a.limited);
        assert_eq!(
            (coverage_a.eligible_count, coverage_a.selected_count),
            (10, 8)
        );
        assert!(selected_a
            .iter()
            .any(|r| r.memory.id.ends_with("000000000009")));
    }
    #[test]
    fn long_source_excerpt_is_exact_query_near_utf8_substring_and_disclosed() {
        let long = format!(
            "{}🌱{} transformer in Zürich — uncertain",
            "prefix ".repeat(230),
            " middle ".repeat(200)
        );
        let candidate = synthetic(
            "00000000-0000-4000-8000-000000000003",
            "2026-10-09T12:00:00Z",
            &long,
        );
        let (_, coverage, evidence) = select(&[candidate], "transformer Zürich");
        assert_eq!(coverage.truncated_count, 1);
        assert!(evidence[0].excerpt.contains("transformer in Zürich"));
        assert!(long.contains(&evidence[0].excerpt));
        assert!(evidence[0].excerpt.len() <= MAX_EXCERPT);
        assert!(evidence[0]
            .excerpt
            .is_char_boundary(evidence[0].excerpt.len()));
        assert!(coverage_limitations(&coverage)
            .iter()
            .any(|item| item.contains("shortened")));
    }
    #[test]
    fn malformed_receipt_citations_and_unbounded_strings_are_rejected() {
        let req = request(
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            "question",
            AskCoverage {
                eligible_count: 1,
                selected_count: 1,
                limited: false,
                truncated_count: 0,
            },
            vec![AskEvidence {
                citation_id: "c1".into(),
                memory_id: "00000000-0000-4000-8000-000000000003".into(),
                memory_revision: 1,
                source_sha256: "a".repeat(64),
                captured_at: "2026-10-09T12:00:00Z".into(),
                evidence_kind: "human_note".into(),
                epistemic_state: "reported".into(),
                excerpt: "Evidence".into(),
            }],
        )
        .unwrap();
        let bad = AskReceipt {
            schema_version: "1.0".into(),
            operation_id: req.operation_id.clone(),
            vault_id: req.vault_id.clone(),
            payload_sha256: req.payload_sha256().unwrap(),
            state: "complete".into(),
            result: Some(ReceiptResult {
                status: "answered".into(),
                sentences: vec![ReceiptSentence {
                    text: "Answer".into(),
                    citation_ids: vec!["c99".into()],
                }],
                limitations: vec![],
            }),
            error_code: None,
        };
        assert!(bad.validate_for(&req).is_err());
        assert!(request(
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            &"q".repeat(MAX_QUESTION + 1),
            AskCoverage {
                eligible_count: 0,
                selected_count: 0,
                limited: false,
                truncated_count: 0
            },
            vec![]
        )
        .is_err());
    }
    #[test]
    fn receipt_mapping_appends_separate_record_and_excerpt_limitations() {
        let req = request(
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            "question",
            AskCoverage {
                eligible_count: 9,
                selected_count: 1,
                limited: true,
                truncated_count: 1,
            },
            vec![AskEvidence {
                citation_id: "c1".into(),
                memory_id: "00000000-0000-4000-8000-000000000003".into(),
                memory_revision: 1,
                source_sha256: "a".repeat(64),
                captured_at: "2026-10-09T12:00:00Z".into(),
                evidence_kind: "human_note".into(),
                epistemic_state: "reported".into(),
                excerpt: "Evidence".into(),
            }],
        )
        .unwrap();
        let receipt = AskReceipt {
            schema_version: "1.0".into(),
            operation_id: req.operation_id.clone(),
            vault_id: req.vault_id.clone(),
            payload_sha256: req.payload_sha256().unwrap(),
            state: "complete".into(),
            result: Some(ReceiptResult {
                status: "answered".into(),
                sentences: vec![ReceiptSentence {
                    text: "Answer".into(),
                    citation_ids: vec!["c1".into()],
                }],
                limitations: vec![],
            }),
            error_code: None,
        };
        let out = receipt_outcome(
            receipt,
            &AskIntent {
                schema_version: "1.0".into(),
                connection_fingerprint: "b".repeat(64),
                request: req,
            },
        )
        .unwrap();
        let answer = out.answer.unwrap();
        assert_eq!(answer.citations[0].quote, "Evidence");
        assert_eq!(answer.limitations.len(), 3);
        assert!(answer.limitations[0].contains("Only current vault revisions"));
        assert!(answer.limitations[1].contains("1 of 9"));
        assert!(answer.limitations[2].contains("shortened"));
    }
    #[test]
    fn required_option_rejects_missing_receipt_fields() {
        let raw = r#"{"schema_version":"1.0","operation_id":"00000000-0000-4000-8000-000000000001","vault_id":"00000000-0000-4000-8000-000000000002","payload_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","state":"failed","error_code":"ASK_FAILED"}"#;
        assert!(serde_json::from_str::<AskReceipt>(raw).is_err());
    }
    #[test]
    fn strict_json_rejects_duplicate_keys_floats_and_trailing_data() {
        for raw in [
            br#"{"schema_version":"1.0","schema_version":"1.0"}"#.as_slice(),
            br#"{"coverage":{"selected_count":1.0}}"#.as_slice(),
            br#"{} {}"#.as_slice(),
        ] {
            assert!(strict_json_from_slice::<Value>(raw).is_err());
        }
    }

    #[test]
    fn history_v2_bytes_and_both_capability_dtos_match_frozen_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-history-synthetic.json"
        ))
        .unwrap();
        for name in ["history-as-of-unicode", "history-comparison-paired"] {
            let row = fixture["requests"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"] == name)
                .unwrap();
            let request: HistoryRequest = serde_json::from_value(row["request"].clone()).unwrap();
            let bytes = request.canonical_bytes().unwrap();
            assert_eq!(
                bytes,
                row["canonical_json_utf8"].as_str().unwrap().as_bytes()
            );
            assert_eq!(
                hex::encode(Sha256::digest(bytes)),
                row["sha256"].as_str().unwrap()
            );
        }
        let capabilities = &fixture["capability_dtos"];
        for name in ["legacy_v1_active", "legacy_v1_missing"] {
            strict_json_from_slice::<AskCapabilityReply>(capabilities[name].to_string().as_bytes())
                .unwrap();
        }
        for name in ["history_active", "history_missing", "history_outdated"] {
            strict_json_from_slice::<HistoryCapabilityReply>(
                capabilities[name].to_string().as_bytes(),
            )
            .unwrap();
        }
        assert!(strict_json_from_slice::<AskCapabilityReply>(
            capabilities["history_active"].to_string().as_bytes()
        )
        .is_err());
    }

    #[test]
    fn history_consent_version_change_invalidates_completion_and_current_revision_change_is_stale()
    {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-history-synthetic.json"
        ))
        .unwrap();
        let request: HistoryRequest =
            serde_json::from_value(fixture["requests"][1]["request"].clone()).unwrap();
        let intent = HistoryIntent {
            schema_version: "2.0".into(),
            connection_fingerprint: "a".repeat(64),
            consent_version: 2,
            request,
        };
        let active: HistoryCapabilityReply =
            serde_json::from_value(fixture["capability_dtos"]["history_active"].clone()).unwrap();
        let outdated: HistoryCapabilityReply =
            serde_json::from_value(fixture["capability_dtos"]["history_outdated"].clone()).unwrap();
        assert!(history_authorized(&active, &intent));
        assert!(!history_authorized(&outdated, &intent));

        let root = std::env::temp_dir().join(format!("recall-history-stale-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let saved = vault
            .capture_text(
                "00000000-0000-4000-8000-000000000019",
                "The retained answer was Zürich.",
            )
            .unwrap();
        let temporal = HistoryTemporal {
            mode: "as_of".into(),
            start_utc: "9999-12-30T00:00:00Z".into(),
            end_exclusive_utc: "9999-12-31T00:00:00Z".into(),
            display_date: "9999-12-30".into(),
            display_timezone: "UTC".into(),
        };
        let selection = vault
            .ask_history(
                "retained answer",
                &temporal.start_utc,
                &temporal.end_exclusive_utc,
                false,
            )
            .unwrap();
        let request = history_request(
            "00000000-0000-4000-8000-000000000020",
            &vault.id,
            "retained answer",
            temporal,
            selection,
        )
        .unwrap();
        assert!(history_selection_matches(&vault, &request).unwrap());
        vault
            .correct(
                &saved.id,
                saved.revision,
                "00000000-0000-4000-8000-000000000021",
                "The retained answer was Geneva.",
            )
            .unwrap();
        assert!(!history_selection_matches(&vault, &request).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    fn accept_history_request(
        listener: &TcpListener,
        shutdown: &mpsc::Receiver<()>,
    ) -> Result<Option<TcpStream>> {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if shutdown.try_recv().is_ok() {
                return Ok(None);
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    // The listener is nonblocking so the helper can observe shutdown. Windows
                    // accepted sockets can inherit that mode, so normalize before bounded reads.
                    stream
                        .set_nonblocking(false)
                        .map_err(|error| error.to_string())?;
                    return Ok(Some(stream));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err("Timed out waiting for history HTTP request".into());
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    fn read_history_http_request(stream: &mut TcpStream) -> Result<(String, Vec<u8>)> {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        let mut chunk = [0; 2048];
        let header_end = loop {
            let count = stream.read(&mut chunk).map_err(|error| error.to_string())?;
            if count == 0 {
                return Err("History HTTP request ended before headers".into());
            }
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break end + 4;
            }
            if bytes.len() > 8 * 1024 {
                return Err("History HTTP headers exceeded test bound".into());
            }
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
        let length = headers
            .lines()
            .find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        if length > MAX_BODY {
            return Err("History HTTP request exceeded test body bound".into());
        }
        while bytes.len() < header_end + length {
            let count = stream.read(&mut chunk).map_err(|error| error.to_string())?;
            if count == 0 {
                return Err("History HTTP request ended before body".into());
            }
            bytes.extend_from_slice(&chunk[..count]);
        }
        let path = headers
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or("History HTTP request omitted route")?
            .to_owned();
        if !headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case("authorization: bearer 1111111111111111111111111111111111111111111111111111111111111111"))
        {
            return Err("History HTTP request omitted expected bearer".into());
        }
        Ok((path, bytes[header_end..header_end + length].to_vec()))
    }

    fn send_history_http_reply(stream: &mut TcpStream, body: &str) -> Result<()> {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .map_err(|error| error.to_string())
    }

    #[derive(Clone, Copy, Debug)]
    enum SuspendedHistoryMutation {
        Fingerprint,
        SourceBytes,
        Consent,
        SelectedSession,
    }

    #[test]
    fn suspended_history_post_revalidates_each_independent_mutation() {
        for mutation in [
            SuspendedHistoryMutation::Fingerprint,
            SuspendedHistoryMutation::SourceBytes,
            SuspendedHistoryMutation::Consent,
            SuspendedHistoryMutation::SelectedSession,
        ] {
            let root = std::env::temp_dir().join(format!("recall-history-race-{}", Uuid::new_v4()));
            let vault_root = root.join("vault");
            let other_vault_root = root.join("other-vault");
            fs::create_dir_all(&vault_root).unwrap();
            fs::create_dir_all(&other_vault_root).unwrap();
            let state = Arc::new(LocalVaultState::new(root.join("selected.json")));
            let session = state.select_path(&vault_root).unwrap().vault_id.unwrap();
            let saved = state
                .with(&session, |v| {
                    v.capture_text(&Uuid::new_v4().to_string(), "retained history")
                })
                .unwrap();
            let vault_id = state.with(&session, |v| Ok(v.id.clone())).unwrap();
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let first = pairing::IntelligenceConnection::from_parts(
                vault_id.clone(),
                format!("http://{address}/"),
                "11".repeat(32),
            );
            set_history_connection_override(Some(first));
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let release_rx = Arc::new(Mutex::new(release_rx));
            crate::local_intelligence_transport::set_history_post_hook(Some(Arc::new(move || {
                let _ = entered_tx.send(());
                if let Ok(receiver) = release_rx.lock() {
                    let _ = receiver.recv_timeout(Duration::from_secs(8));
                }
            })));
            let (shutdown_tx, shutdown_rx) = mpsc::channel();
            let server = thread::spawn(move || -> Result<Vec<(String, String)>> {
                let mut seen = Vec::new();
                for index in 0..4 {
                    let Some(mut stream) = accept_history_request(&listener, &shutdown_rx)? else {
                        break;
                    };
                    let (path, body) = read_history_http_request(&mut stream)?;
                    let reply = if path.ends_with("/ask") {
                        let request: HistoryRequest = strict_json_from_slice(&body)?;
                        let receipt = serde_json::json!({
                            "schema_version":"1.0",
                            "operation_id":request.operation_id,
                            "vault_id":request.vault_id,
                            "payload_sha256":hex::encode(Sha256::digest(request.canonical_bytes()?)),
                            "state":"complete",
                            "result":{"status":"answered","sentences":[{"text":"retained history","citation_ids":["c1"]}],"limitations":[]},
                            "error_code":null
                        });
                        receipt.to_string()
                    } else if index == 3 && matches!(mutation, SuspendedHistoryMutation::Consent) {
                        r#"{"scope":"vault_intelligence","history_consent":"outdated","history_enabled":true,"consent_version":2,"history_policy_version":"ask-history-v1"}"#.into()
                    } else {
                        r#"{"scope":"vault_intelligence","history_consent":"active","history_enabled":true,"consent_version":1,"history_policy_version":"ask-history-v1"}"#.into()
                    };
                    seen.push((path, String::from_utf8_lossy(&body).into_owned()));
                    send_history_http_reply(&mut stream, &reply)?;
                }
                Ok(seen)
            });
            let run_state = state.clone();
            let run_session = session.clone();
            let operation_id = Uuid::new_v4().to_string();
            let worker = thread::spawn(move || {
                tauri::async_runtime::block_on(run_history_ask(
                    &run_state,
                    &run_session,
                    &operation_id,
                    Some((
                        "retained history".into(),
                        HistoryTemporal {
                            mode: "as_of".into(),
                            start_utc: "9999-12-30T00:00:00Z".into(),
                            end_exclusive_utc: "9999-12-31T00:00:00Z".into(),
                            display_date: "9999-12-30".into(),
                            display_timezone: "UTC".into(),
                        },
                    )),
                    false,
                ))
            });
            let reached_post = entered_rx.recv_timeout(Duration::from_secs(8)).is_ok();
            let mutation_result = if reached_post {
                match mutation {
                    SuspendedHistoryMutation::Fingerprint => {
                        set_history_connection_override(Some(
                            pairing::IntelligenceConnection::from_parts(
                                vault_id.clone(),
                                format!("http://{address}/"),
                                "22".repeat(32),
                            ),
                        ));
                        Ok(())
                    }
                    SuspendedHistoryMutation::SourceBytes => fs::write(
                        vault_root
                            .join("Recall/Sources")
                            .join(format!("{}.txt", saved.id)),
                        b"tampered source bytes",
                    )
                    .map_err(|error| error.to_string()),
                    SuspendedHistoryMutation::Consent => Ok(()),
                    SuspendedHistoryMutation::SelectedSession => state
                        .select_path(&other_vault_root)
                        .map(|_| ())
                        .map_err(|error| error.to_string()),
                }
            } else {
                Ok(())
            };
            let _ = release_tx.send(());
            let outcome = worker
                .join()
                .map_err(|_| "History worker panicked".to_string());
            let _ = shutdown_tx.send(());
            let requests = server
                .join()
                .map_err(|_| "History test server panicked".to_string());
            crate::local_intelligence_transport::set_history_post_hook(None);
            set_history_connection_override(None);
            let _ = fs::remove_dir_all(&root);

            mutation_result.unwrap_or_else(|error| panic!("{mutation:?}: {error}"));
            let requests = requests.unwrap_or_else(|error| panic!("{mutation:?}: {error}"));
            let requests = requests.unwrap_or_else(|error| panic!("{mutation:?}: {error}"));
            let outcome_summary = match &outcome {
                Ok(Ok(outcome)) => format!(
                    "state={} code={:?}",
                    outcome.operation.state, outcome.operation.error_code
                ),
                Ok(Err(error)) => format!("error={error}"),
                Err(error) => format!("join={error}"),
            };
            assert!(
                reached_post,
                "{mutation:?} did not reach POST; {outcome_summary}; {requests:?}"
            );
            assert_eq!(requests.len(), 4, "{mutation:?}: {requests:?}");
            assert_eq!(
                requests
                    .iter()
                    .filter(|(path, _)| path.ends_with("/ask"))
                    .count(),
                1,
                "{mutation:?}: {requests:?}"
            );
            assert_eq!(requests[0].0, "/v1/local-intelligence/history-capability");
            assert_eq!(requests[1].0, "/v1/local-intelligence/history-capability");
            assert_eq!(requests[2].0, "/v1/local-intelligence/ask");
            assert_eq!(requests[3].0, "/v1/local-intelligence/history-capability");
            match outcome {
                Ok(Ok(outcome)) => {
                    assert_eq!(outcome.operation.state, "failed", "{mutation:?}");
                    assert!(outcome.answer.is_none(), "{mutation:?}");
                    let expected = match mutation {
                        SuspendedHistoryMutation::Fingerprint => "HISTORY_AUTHORIZATION_CHANGED",
                        SuspendedHistoryMutation::SourceBytes
                        | SuspendedHistoryMutation::Consent => "STALE_EVIDENCE",
                        SuspendedHistoryMutation::SelectedSession => unreachable!(),
                    };
                    assert_eq!(outcome.operation.error_code.as_deref(), Some(expected));
                }
                Ok(Err(error)) if matches!(mutation, SuspendedHistoryMutation::SelectedSession) => {
                    assert!(error.contains("Vault selection changed"), "{error}");
                }
                other => panic!("{mutation:?} unexpectedly returned {other:?}"),
            }
        }
    }

    #[test]
    fn history_receipt_rejects_malformed_result_state_text_limits_and_citations() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-history-synthetic.json"
        ))
        .unwrap();
        let request: HistoryRequest =
            serde_json::from_value(fixture["requests"][1]["request"].clone()).unwrap();
        let valid = AskReceipt {
            schema_version: "1.0".into(),
            operation_id: request.operation_id.clone(),
            vault_id: request.vault_id.clone(),
            payload_sha256: hex::encode(Sha256::digest(request.canonical_bytes().unwrap())),
            state: "complete".into(),
            result: Some(ReceiptResult {
                status: "answered".into(),
                sentences: vec![ReceiptSentence {
                    text: "The remembered wording was Zürich.".into(),
                    citation_ids: vec!["c1".into()],
                }],
                limitations: vec![],
            }),
            error_code: None,
        };
        assert!(valid.validate_history_for(&request).is_ok());
        let mut cases = Vec::new();

        let mut malformed = valid.clone();
        malformed.error_code = Some("ASK_FAILED".into());
        cases.push(("complete with error code", malformed));

        let mut malformed = valid.clone();
        malformed.state = "in_flight".into();
        cases.push(("noncomplete state with result", malformed));

        let mut malformed = valid.clone();
        malformed.state = "unknown".into();
        malformed.result = None;
        malformed.error_code = Some("ASK_FAILED".into());
        cases.push(("unknown state with wrong error code", malformed));

        let mut malformed = valid.clone();
        malformed.result.as_mut().unwrap().sentences[0].text = "x".repeat(1_001);
        cases.push(("oversized sentence", malformed));

        let mut malformed = valid.clone();
        malformed.result.as_mut().unwrap().sentences[0].text = "bad\0sentence".into();
        cases.push(("NUL sentence", malformed));

        let mut malformed = valid.clone();
        malformed.result.as_mut().unwrap().limitations = vec!["x".repeat(501)];
        cases.push(("oversized limitation", malformed));

        let mut malformed = valid.clone();
        malformed.result.as_mut().unwrap().limitations = vec!["bad\0limitation".into()];
        cases.push(("NUL limitation", malformed));

        let mut malformed = valid.clone();
        malformed.result.as_mut().unwrap().sentences[0].citation_ids =
            vec!["c1".into(), "c1".into()];
        cases.push(("duplicate citations", malformed));

        let mut malformed = valid;
        malformed.result.as_mut().unwrap().sentences[0].citation_ids =
            (1..=9).map(|index| format!("c{index}")).collect();
        cases.push(("too many citations", malformed));

        for (case, receipt) in cases {
            assert!(
                receipt.validate_history_for(&request).is_err(),
                "accepted malformed history receipt: {case}"
            );
        }
    }

    #[test]
    fn real_filesystem_ask_snapshot_uses_current_text_and_intent_is_operational_only() {
        let root = std::env::temp_dir().join(format!("recall-ask-native-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let capture_id = Uuid::new_v4().to_string();
        let original = "The transformer specialist was in Houston; first name uncertain.";
        let captured = vault.capture_text(&capture_id, original).unwrap();
        let first = vault.ask_candidates().unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].evidence_kind, "text_source");
        assert_eq!(first[0].text, original);
        let correction = Uuid::new_v4().to_string();
        vault
            .correct(
                &captured.id,
                captured.revision,
                &correction,
                "Current user text replaces the draft.",
            )
            .unwrap();
        let current = vault.ask_candidates().unwrap();
        assert_eq!(current[0].text, "Current user text replaces the draft.");
        assert_eq!(current[0].memory.revision, 2);
        assert_eq!(current[0].evidence_kind, "human_note");
        assert_eq!(current[0].memory.source_sha256, captured.source_sha256);
        assert_eq!(vault.history(&captured.id).unwrap().len(), 2);
        let (_, coverage, evidence) = select(&current, "transformer Houston");
        let selected_request = request(
            &Uuid::new_v4().to_string(),
            &vault.id,
            "transformer Houston",
            coverage,
            evidence,
        )
        .unwrap();
        assert!(evidence_matches(&vault, &selected_request).unwrap());

        let operation = Uuid::new_v4().to_string();
        let intent = br#"{"schema_version":"1.0","synthetic_intent":true}"#;
        assert_eq!(vault.save_ask_intent(&operation, intent).unwrap(), intent);
        assert_eq!(vault.load_ask_intent(&operation).unwrap().unwrap(), intent);
        assert!(vault.save_ask_intent(&operation, b"different").is_err());
        assert_eq!(vault.history(&captured.id).unwrap().len(), 2);
        fs::write(
            root.join(format!("Recall/Sources/{capture_id}.txt")),
            "tampered source",
        )
        .unwrap();
        assert!(vault.ask_candidates().unwrap().is_empty());
        assert!(!evidence_matches(&vault, &selected_request).unwrap());
        drop(vault);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn empty_current_text_does_not_revive_immutable_original() {
        let root = std::env::temp_dir().join(format!("recall-ask-empty-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let captured = vault
            .capture_text(
                &Uuid::new_v4().to_string(),
                "Original text removed by owner.",
            )
            .unwrap();
        vault
            .correct(&captured.id, 1, &Uuid::new_v4().to_string(), "")
            .unwrap();
        assert!(vault.ask_candidates().unwrap().is_empty());
        drop(vault);
        fs::remove_dir_all(root).unwrap();
    }
}
