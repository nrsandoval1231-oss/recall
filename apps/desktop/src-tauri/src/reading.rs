//! Untrusted selected-photo wire contract. No vault paths, credentials or tools occur in results.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
type Result<T> = std::result::Result<T, String>;
pub const MAX_RESPONSE: u64 = 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReadingBinding {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub memory_id: String,
    pub source_id: String,
    pub source_sha256: String,
    pub expected_revision: u64,
    pub captured_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReadingRequest {
    pub binding: ReadingBinding,
    pub media_type: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Derivative {
    pub sha256: String,
    pub transform_version: String,
    pub media_type: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ValidationNote {
    pub code: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReadingResult {
    pub provider: String,
    pub model_id: String,
    pub input_manifest_sha256: String,
    pub derivative: Derivative,
    pub extraction: Value,
    pub validation_notes: Vec<ValidationNote>,
    pub review_state: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReadingReceipt {
    pub schema_version: String,
    pub binding: ReadingBinding,
    pub state: String,
    #[serde(deserialize_with = "required_option")]
    pub result: Option<ReadingResult>,
    #[serde(deserialize_with = "required_option")]
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MachineReading {
    pub request: ReadingRequest,
    pub result: ReadingResult,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Reading {
    pub machine: MachineReading,
    pub human_correction: Option<String>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
impl Reading {
    pub fn effective_text(&self) -> &str {
        self.human_correction
            .as_deref()
            .unwrap_or_else(|| self.machine.transcription())
    }
}
impl MachineReading {
    pub fn transcription(&self) -> &str {
        self.result.extraction["pages"][0]["transcription"]
            .as_str()
            .unwrap_or("")
    }
    pub fn validate(&self) -> Result<()> {
        self.request.validate()?;
        self.result.validate(&self.request)
    }
}
pub fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn ensure(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err("Invalid reading response".into())
    }
}
fn hex64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(s: &str, min: usize, max: usize) -> Result<()> {
    ensure(!s.contains('\0') && (min..=max).contains(&s.chars().count()))
}
impl ReadingRequest {
    pub fn validate(&self) -> Result<()> {
        let b = &self.binding;
        for id in [&b.operation_id, &b.vault_id, &b.memory_id, &b.source_id] {
            ensure(uuid::Uuid::parse_str(id).is_ok_and(|v| v.to_string() == *id))?;
        }
        ensure(
            b.schema_version == "1.0"
                && b.source_id == b.memory_id
                && hex64(&b.source_sha256)
                && (1..=9007199254740991).contains(&b.expected_revision)
                && b.captured_at.is_ascii()
                && b.captured_at.len() == 20
                && b.captured_at.ends_with('Z')
                && matches!(
                    self.media_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                ),
        )
    }
    pub fn digest(&self) -> Result<String> {
        self.validate()?;
        // serde_json::Value maps sort keys recursively (preserve_order is not enabled).
        let canonical = serde_json::json!({"binding": self.binding, "media_type": self.media_type});
        Ok(sha(
            &serde_json::to_vec(&canonical).map_err(|_| "Invalid reading request")?
        ))
    }
}
impl ReadingReceipt {
    pub fn validate(&self, request: &ReadingRequest) -> Result<()> {
        request.validate()?;
        ensure(self.schema_version == "1.0" && self.binding == request.binding)?;
        match self.state.as_str() {
            "complete" => {
                ensure(self.error_code.is_none())?;
                self.result
                    .as_ref()
                    .ok_or("Missing reading result")?
                    .validate(request)
            }
            "in_flight" => ensure(self.result.is_none() && self.error_code.is_none()),
            "unknown" => ensure(
                self.result.is_none()
                    && self.error_code.as_deref() == Some("PROVIDER_OUTCOME_UNKNOWN"),
            ),
            "expired" => ensure(
                self.result.is_none() && self.error_code.as_deref() == Some("RECEIPT_EXPIRED"),
            ),
            "failed" => ensure(
                self.result.is_none()
                    && self.error_code.as_deref().is_some_and(|v| {
                        matches!(
                            v,
                            "INVALID_EXTRACTION"
                                | "PROVIDER_REFUSED"
                                | "OUTPUT_TRUNCATED"
                                | "PROVIDER_FAILED"
                                | "AUTHORIZATION_CHANGED"
                        )
                    }),
            ),
            _ => Err("Invalid reading state".into()),
        }
    }
}
impl ReadingResult {
    fn validate(&self, request: &ReadingRequest) -> Result<()> {
        ensure(
            serde_json::to_vec(self)
                .map_err(|_| "Invalid result")?
                .len()
                <= 900000,
        )?;
        ensure(
            self.provider == "anthropic"
                && self.review_state == "unreviewed"
                && self.input_manifest_sha256 == request.digest()?
                && hex64(&self.derivative.sha256)
                && self.derivative.transform_version == "jpeg-rgb-exif-orient-v1"
                && self.derivative.media_type == "image/jpeg",
        )?;
        text(&self.model_id, 1, 200)?;
        ensure(self.validation_notes.len() <= 1000)?;
        for n in &self.validation_notes {
            text(&n.code, 1, 120)?;
            text(&n.detail, 0, 4000)?;
        }
        extraction(&self.extraction, request)
    }
}
fn keys(v: &Value, names: &[&str]) -> Result<()> {
    let obj = v.as_object().ok_or("Invalid extraction object")?;
    ensure(obj.len() == names.len() && names.iter().all(|k| obj.contains_key(*k)))
}
fn string<'a>(v: &'a Value, min: usize, max: usize) -> Result<&'a str> {
    let s = v.as_str().ok_or("Invalid extraction text")?;
    text(s, min, max)?;
    Ok(s)
}
fn optional(v: &Value, max: usize) -> Result<()> {
    if v.is_null() {
        Ok(())
    } else {
        string(v, 0, max).map(|_| ())
    }
}
fn choice(v: &Value, allowed: &[&str]) -> Result<()> {
    ensure(v.as_str().is_some_and(|s| allowed.contains(&s)))
}
fn array(v: &Value, min: usize, max: usize) -> Result<&Vec<Value>> {
    let a = v.as_array().ok_or("Invalid extraction list")?;
    ensure((min..=max).contains(&a.len()))?;
    Ok(a)
}
fn local_id(v: &Value, prefix: char) -> Result<&str> {
    let s = string(v, 2, 128)?;
    ensure(
        s.starts_with(prefix)
            && s.as_bytes()[1] != b'0'
            && s[1..].bytes().all(|b| b.is_ascii_digit()),
    )?;
    Ok(s)
}
fn normalized(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn evidence(v: &Value, min: usize, max: usize, source: &str, transcript: &str) -> Result<()> {
    for ev in array(v, min, max)? {
        keys(ev, &["page_id", "quote"])?;
        ensure(ev["page_id"] == source)?;
        let quote = string(&ev["quote"], 1, 3000)?;
        ensure(normalized(transcript).contains(&normalized(quote)))?;
    }
    Ok(())
}
/// Explicit bounded extraction 1.1 shape and references, without a local graph or executable schema engine.
fn extraction(ex: &Value, req: &ReadingRequest) -> Result<()> {
    keys(
        ex,
        &[
            "schema_version",
            "capture_id",
            "input_manifest_sha256",
            "summary",
            "summary_evidence",
            "pages",
            "mentions",
            "statements",
            "action_suggestions",
            "uncertainties",
        ],
    )?;
    ensure(
        ex["schema_version"] == "1.1"
            && ex["capture_id"] == req.binding.memory_id
            && ex["input_manifest_sha256"] == req.digest()?,
    )?;
    let page = &array(&ex["pages"], 1, 1)?[0];
    keys(page, &["page_id", "ordinal", "transcription", "legibility"])?;
    ensure(page["page_id"] == req.binding.source_id && page["ordinal"].as_u64() == Some(1))?;
    choice(&page["legibility"], &["clear", "mixed", "unreadable"])?;
    let transcript = string(&page["transcription"], 0, 30000)?;
    optional(&ex["summary"], 6000)?;
    evidence(
        &ex["summary_evidence"],
        0,
        40,
        &req.binding.source_id,
        transcript,
    )?;
    let mut mentions = BTreeSet::new();
    for m in array(&ex["mentions"], 0, 100)? {
        keys(m, &["local_id", "kind", "raw_text", "evidence"])?;
        ensure(mentions.insert(local_id(&m["local_id"], 'm')?))?;
        choice(
            &m["kind"],
            &[
                "person",
                "organization",
                "place",
                "thing",
                "event",
                "project",
                "topic",
            ],
        )?;
        string(&m["raw_text"], 1, 500)?;
        evidence(&m["evidence"], 1, 10, &req.binding.source_id, transcript)?;
    }
    for (kind, prefix, limit) in [("statements", 's', 150), ("action_suggestions", 'a', 50)] {
        let mut ids = BTreeSet::new();
        for s in array(&ex[kind], 0, limit)? {
            if kind == "statements" {
                keys(
                    s,
                    &[
                        "local_id",
                        "kind",
                        "subject_mention_id",
                        "predicate",
                        "text",
                        "value_text",
                        "epistemic_state",
                        "attribution_text",
                        "temporal_text",
                        "object_mention_id",
                        "evidence",
                    ],
                )?;
                choice(
                    &s["kind"],
                    &[
                        "observation",
                        "claim",
                        "idea",
                        "decision",
                        "preference",
                        "question",
                        "relationship",
                    ],
                )?;
                // Normalized machine output must never contain a user-confirmed/retracted assertion.
                choice(
                    &s["epistemic_state"],
                    &["reported", "uncertain", "question"],
                )?;
                let predicate = string(&s["predicate"], 1, 120)?;
                ensure(
                    predicate.as_bytes()[0].is_ascii_lowercase()
                        && predicate
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
                )?;
                for field in ["value_text", "attribution_text", "temporal_text"] {
                    optional(&s[field], 500)?;
                }
                for field in ["subject_mention_id", "object_mention_id"] {
                    if !s[field].is_null() {
                        ensure(mentions.contains(string(&s[field], 2, 128)?))?;
                    }
                }
            } else {
                keys(
                    s,
                    &[
                        "local_id",
                        "kind",
                        "text",
                        "assignee_mention_id",
                        "due_text",
                        "evidence",
                    ],
                )?;
                choice(&s["kind"], &["action", "commitment"])?;
                optional(&s["due_text"], 500)?;
                if !s["assignee_mention_id"].is_null() {
                    ensure(mentions.contains(string(&s["assignee_mention_id"], 2, 128)?))?;
                }
            }
            ensure(ids.insert(local_id(&s["local_id"], prefix)?))?;
            string(&s["text"], 1, 2000)?;
            evidence(&s["evidence"], 1, 10, &req.binding.source_id, transcript)?;
        }
    }
    for u in array(&ex["uncertainties"], 0, 100)? {
        keys(u, &["kind", "description", "evidence"])?;
        choice(
            &u["kind"],
            &[
                "handwriting",
                "identity",
                "date",
                "number",
                "unit",
                "attribution",
                "relationship",
                "other",
            ],
        )?;
        string(&u["description"], 1, 2000)?;
        evidence(&u["evidence"], 1, 10, &req.binding.source_id, transcript)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
        ))
        .unwrap()
    }
    #[test]
    fn reading_shared_backend_fixture_digest_and_response_are_compatible() {
        let f = fixture();
        let request:ReadingRequest=serde_json::from_value(serde_json::json!({"binding":f["request"]["binding"],"media_type":f["request"]["media_type"]})).unwrap();
        assert_eq!(
            request.digest().unwrap(),
            "03b8837f713e87c5eaaef4fb4c0afdc8be4587cea737a4d5c14bf72972a2b353"
        );
        let receipt: ReadingReceipt = serde_json::from_value(f["response"].clone()).unwrap();
        receipt.validate(&request).unwrap();
        for field in [
            "operation_id",
            "vault_id",
            "memory_id",
            "source_id",
            "source_sha256",
            "captured_at",
        ] {
            let mut altered = receipt.clone();
            let mut b = serde_json::to_value(&altered.binding).unwrap();
            b[field] = "wrong".into();
            altered.binding = serde_json::from_value(b).unwrap();
            assert!(altered.validate(&request).is_err(), "{field}");
        }
        for changed in [
            "nul",
            "reference",
            "too long",
            "unknown field",
            "confirmed",
            "missing field",
            "wrong digest",
        ] {
            let mut altered = receipt.clone();
            let result = altered.result.as_mut().unwrap();
            match changed {
                "nul" => result.extraction["pages"][0]["transcription"] = "bad\0text".into(),
                "reference" => {
                    result.extraction["uncertainties"][0]["evidence"][0]["page_id"] =
                        "11111111-1111-4111-8111-111111111111".into()
                }
                "too long" => {
                    result.extraction["pages"][0]["transcription"] = "x".repeat(30001).into()
                }
                "unknown field" => result.extraction["permissions"] = "approved".into(),
                "confirmed" => {
                    result.extraction["statements"][0]["epistemic_state"] =
                        "confirmed_by_user".into()
                }
                "missing field" => {
                    result
                        .extraction
                        .as_object_mut()
                        .unwrap()
                        .remove("mentions");
                }
                "wrong digest" => result.input_manifest_sha256 = "f".repeat(64),
                _ => unreachable!(),
            }
            assert!(altered.validate(&request).is_err(), "{changed}");
        }
    }
    #[test]
    fn reading_receipt_requires_explicit_null_fields() {
        let f = fixture();
        let mut r = f["response"].clone();
        r["state"] = "in_flight".into();
        r.as_object_mut().unwrap().remove("result");
        r.as_object_mut().unwrap().remove("error_code");
        assert!(serde_json::from_value::<ReadingReceipt>(r).is_err());
    }
}
