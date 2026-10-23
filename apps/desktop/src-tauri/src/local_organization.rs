//! Purpose-specific native organization consent, retry state and fixed-origin transport.
use crate::{
    local_intelligence::strict_json_from_slice,
    local_vault::{LocalVaultState, SelectionGuard, Vault},
    pairing::{self, IntelligenceConnection},
};
use reqwest::{
    blocking::{Client, Response},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::Read,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const MAX_HEADER: usize = 4096;
const MAX_RESPONSE: u64 = 1024 * 1024;
const MAX_PHOTO: usize = 25 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 30_000;
const MAX_TEXT_BYTES: usize = 120_000;
const MAX_CONTEXT_BINDING: usize = 2_300;
const MAX_CONTEXT_HEADER: usize = 3_072;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationBinding {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub memory_id: String,
    pub source_kind: String,
    pub source_sha256: String,
    pub expected_revision: u64,
    pub input_sha256: String,
    // Binding 3.0 (audio transcript) only; absent from 1.0/2.0 so their bytes are unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derivative_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_evidence_kind: Option<String>,
    pub consent_epoch: u64,
    pub captured_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_coverage: Option<OrganizationContextCoverage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<Vec<OrganizationContextExcerpt>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationContextCoverage {
    pub eligible_count: u64,
    pub selected_count: u64,
    pub limited: bool,
    pub truncated_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationContextExcerpt {
    pub memory_id: String,
    pub memory_revision: u64,
    pub source_sha256: String,
    pub evidence_kind: String,
    pub epistemic_state: String,
    pub excerpt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RelatedContextLink {
    pub target_memory_id: String,
    pub source_quote: String,
    pub target_quote: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationRequest {
    pub binding: OrganizationBinding,
    pub media_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationDerivative {
    pub sha256: String,
    pub transform_version: String,
    pub media_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationValidationNote {
    pub code: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationResult {
    pub provider: String,
    pub model_id: String,
    pub input_manifest_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derivative: Option<OrganizationDerivative>,
    pub extraction: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub related_context: Option<Vec<RelatedContextLink>>,
    pub validation_notes: Vec<OrganizationValidationNote>,
    pub review_state: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationReceipt {
    pub schema_version: String,
    pub binding: OrganizationBinding,
    pub payload_sha256: String,
    pub state: String,
    #[serde(default)]
    pub result: Option<OrganizationResult>,
    #[serde(default)]
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationCapability {
    pub schema_version: String,
    pub scope: String,
    pub purpose: String,
    pub vault_id: String,
    pub policy_version: String,
    pub provider: Option<String>,
    pub consent: String,
    pub enabled: bool,
    pub consent_epoch: u64,
    pub decided_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct NativeOrganizationCapability {
    #[serde(flatten)]
    pub server: OrganizationCapability,
    pub local_readiness: String,
    pub automatic_enabled: bool,
}

fn native_capability(
    vault: &Vault,
    connection: &IntelligenceConnection,
    server: OrganizationCapability,
) -> NativeOrganizationCapability {
    let local_readiness = match vault.organization_marker() {
        Ok(Some(marker))
            if server.consent == "active"
                && marker.vault_id == vault.id
                && marker.policy_version == server.policy_version
                && marker.consent_epoch == server.consent_epoch
                && marker.connection_fingerprint == connection.fingerprint =>
        {
            "ready"
        }
        Ok(Some(_)) if matches!(server.consent.as_str(), "missing" | "outdated") => "unknown",
        Ok(Some(_)) => "needs_setup",
        Ok(None) if server.consent == "active" => "needs_setup",
        Ok(None) => "off",
        Err(_) => "unknown",
    }
    .to_string();
    NativeOrganizationCapability {
        automatic_enabled: server.enabled && local_readiness == "ready",
        server,
        local_readiness,
    }
}

pub(crate) fn requested_decision_proven(
    before: &OrganizationCapability,
    after: &OrganizationCapability,
    requested_enabled: bool,
) -> bool {
    after.consent_epoch == before.consent_epoch + 1
        && after.policy_version == before.policy_version
        && if requested_enabled {
            after.consent == "active"
        } else {
            after.consent == "missing"
        }
}

fn commit_confirmed_consent(
    vault: &Vault,
    expected_connection: &IntelligenceConnection,
    current_connection: Option<&IntelligenceConnection>,
    server: OrganizationCapability,
    enabled: bool,
) -> Result<NativeOrganizationCapability> {
    if vault.id != expected_connection.vault_id || server.vault_id != vault.id {
        return Err("Organization consent does not match the selected vault".into());
    }
    if enabled {
        let Some(connection) = current_connection.filter(|current| {
            current.vault_id == vault.id && current.fingerprint == expected_connection.fingerprint
        }) else {
            return Ok(NativeOrganizationCapability {
                server,
                local_readiness: "unknown".into(),
                automatic_enabled: false,
            });
        };
        if server.consent == "active" {
            // A failed local commit leaves the server decision visible as needs_setup/unknown.
            // It must never turn on the future-capture fence.
            let _ = vault.set_organization_marker(Some(OrganizationMarker {
                schema_version: "1.0".into(),
                vault_id: vault.id.clone(),
                policy_version: server.policy_version.clone(),
                consent_epoch: server.consent_epoch,
                local_epoch: Uuid::new_v4().to_string(),
                connection_fingerprint: connection.fingerprint.clone(),
            }));
        }
    } else {
        vault.set_organization_marker(None)?;
    }
    Ok(native_capability(vault, expected_connection, server))
}

pub(crate) fn post_if_selected<T>(
    guard: &SelectionGuard,
    post: impl FnOnce() -> Result<T>,
) -> Result<T> {
    guard.active()?;
    post()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationProposal {
    pub binding: OrganizationBinding,
    pub media_type: String,
    pub payload_sha256: String,
    pub result: OrganizationResult,
    pub review_state: String,
    #[serde(default)]
    pub suppressed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationMarker {
    pub schema_version: String,
    pub vault_id: String,
    pub policy_version: String,
    pub consent_epoch: u64,
    pub local_epoch: String,
    pub connection_fingerprint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationIntent {
    pub schema_version: String,
    pub binding: OrganizationBinding,
    pub media_type: String,
    pub human_text_sha256: String,
    pub connection_fingerprint: String,
    pub local_epoch: String,
    pub state: String,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OrganizationOperation {
    pub operation_id: String,
    pub memory_id: String,
    pub state: String,
    pub error_code: Option<String>,
}

impl OrganizationProposal {
    /// Validate a proposal projected onto a voice recording. Internal consistency only:
    /// the transcript it was derived from may since have been corrected, so the
    /// extraction's own transcription is the bound input.
    pub fn validate_audio(
        &self,
        vault_id: &str,
        memory_id: &str,
        source_sha256: &str,
        captured_at: &str,
    ) -> Result<()> {
        let b = &self.binding;
        if self.review_state != "unreviewed"
            || b.schema_version != "3.0"
            || b.source_kind != "audio_transcript"
            || b.vault_id != vault_id
            || b.memory_id != memory_id
            || b.source_sha256 != source_sha256
            || b.captured_at != captured_at
            || b.expected_revision == 0
            || self.media_type != "text/plain; charset=utf-8"
        {
            return Err("Invalid audio organization proposal binding".into());
        }
        let request = OrganizationRequest {
            binding: b.clone(),
            media_type: self.media_type.clone(),
        };
        request.validate_binding()?;
        if request.payload_sha256()? != self.payload_sha256
            || self.result.input_manifest_sha256 != self.payload_sha256
            || self.result.provider != "anthropic"
            || self.result.review_state != "unreviewed"
            || self.result.derivative.is_some()
            || self.result.related_context.is_some()
        {
            return Err("Invalid audio organization proposal digest".into());
        }
        crate::reading::validate_organization_extraction(
            &self.result.extraction,
            memory_id,
            &self.payload_sha256,
            memory_id,
        )?;
        let transcript = self.result.extraction["pages"][0]["transcription"]
            .as_str()
            .ok_or("Missing bound transcript")?;
        if sha(transcript.as_bytes()) != b.input_sha256
            || !exact_quotes(&self.result.extraction, transcript)
            || (b.transcript_evidence_kind.as_deref() == Some("machine_unreviewed")
                && self.result.extraction["pages"][0]["legibility"] == "clear")
        {
            return Err("Audio organization does not match its bound transcript".into());
        }
        Ok(())
    }
    pub fn validate(
        &self,
        vault_id: &str,
        memory_id: &str,
        source_sha256: &str,
        captured_at: &str,
        is_text: bool,
    ) -> Result<()> {
        let b = &self.binding;
        if self.review_state != "unreviewed"
            || !uuid(&b.operation_id)
            || b.vault_id != vault_id
            || b.memory_id != memory_id
            || b.source_sha256 != source_sha256
            || b.expected_revision == 0
            || b.captured_at != captured_at
            || (is_text != (b.source_kind == "text"))
            || !matches!(b.source_kind.as_str(), "text" | "photo")
            || (!is_text && b.input_sha256 != b.source_sha256)
        {
            return Err("Invalid organization proposal binding".into());
        }
        let request = OrganizationRequest {
            binding: b.clone(),
            media_type: self.media_type.clone(),
        };
        request.validate_binding()?;
        if request.payload_sha256()? != self.payload_sha256
            || self.result.input_manifest_sha256 != self.payload_sha256
            || self.result.provider != "anthropic"
            || self.result.review_state != "unreviewed"
        {
            return Err("Invalid organization proposal digest".into());
        }
        crate::reading::validate_organization_extraction(
            &self.result.extraction,
            memory_id,
            &self.payload_sha256,
            memory_id,
        )?;
        validate_related_context(b, &self.result)?;
        match b.source_kind.as_str() {
            "text"
                if self.media_type == "text/plain; charset=utf-8"
                    && self.result.derivative.is_none() =>
            {
                Ok(())
            }
            "photo"
                if matches!(
                    self.media_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                ) && self.result.derivative.as_ref().is_some_and(|d| {
                    hex64(&d.sha256)
                        && d.transform_version == "jpeg-rgb-exif-orient-v1"
                        && d.media_type == "image/jpeg"
                }) =>
            {
                Ok(())
            }
            _ => Err("Invalid organization proposal media".into()),
        }
    }
}

pub(crate) fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub(crate) fn uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|v| v.to_string() == value)
}
pub(crate) fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl OrganizationRequest {
    pub fn validate(&self, body: &[u8]) -> Result<()> {
        let b = &self.binding;
        if self.validate_binding().is_err()
            || b.captured_at.len() != 20
            || !b.captured_at.ends_with('Z')
            || b.captured_at.bytes().any(|c| !c.is_ascii())
            || sha(body) != b.input_sha256
        {
            return Err("Invalid organization binding".into());
        }
        match (b.source_kind.as_str(), self.media_type.as_str()) {
            ("text", "text/plain; charset=utf-8") => {
                let text =
                    std::str::from_utf8(body).map_err(|_| "Organizer text is invalid UTF-8")?;
                if text.is_empty()
                    || text.chars().count() > MAX_TEXT_CHARS
                    || body.len() > MAX_TEXT_BYTES
                    || text.contains('\0')
                {
                    return Err("Text exceeds the organization limit".into());
                }
            }
            ("audio_transcript", "text/plain; charset=utf-8") => {
                let text = std::str::from_utf8(body).map_err(|_| "Transcript is invalid UTF-8")?;
                if text.is_empty()
                    || text.chars().count() > MAX_TEXT_CHARS
                    || body.len() > MAX_TEXT_BYTES
                    || text.contains('\0')
                {
                    return Err("Transcript exceeds the organization limit".into());
                }
            }
            ("photo", "image/png" | "image/jpeg" | "image/webp")
                if body.len() <= MAX_PHOTO && b.input_sha256 == b.source_sha256 =>
            {
                ()
            }
            _ => return Err("Invalid organization media type".into()),
        }
        Ok(())
    }
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(&serde_json::json!({"binding": self.binding, "media_type": self.media_type, "input_sha256": self.binding.input_sha256}))
            .map_err(|_| "Cannot serialize organization binding".into())
    }
    pub fn header_value(&self) -> Result<String> {
        let bytes = serde_json::to_vec(&self.binding)
            .map_err(|_| "Cannot serialize organization binding")?;
        if self.binding.schema_version == "1.0" {
            if bytes.len() > MAX_HEADER {
                return Err("Organization binding exceeds its limit".into());
            }
            return String::from_utf8(bytes).map_err(|_| "Invalid organization binding".into());
        }
        if bytes.len() > MAX_CONTEXT_BINDING {
            return Err("Organization context binding exceeds its limit".into());
        }
        let prefix = if self.binding.schema_version == "3.0" {
            "v3"
        } else {
            "v2"
        };
        let header = format!("{prefix}.{}", base64url_no_pad(&bytes));
        if header.len() > MAX_CONTEXT_HEADER || !header.is_ascii() {
            return Err("Organization context header exceeds its limit".into());
        }
        Ok(header)
    }
    pub fn payload_sha256(&self) -> Result<String> {
        Ok(sha(&self.canonical_bytes()?))
    }
}

impl OrganizationReceipt {
    pub fn validate(&self, request: &OrganizationRequest, body: Option<&[u8]>) -> Result<()> {
        request.validate_binding()?;
        if self.schema_version != "1.0"
            || self.binding != request.binding
            || self.payload_sha256 != request.payload_sha256()?
        {
            return Err("Organization receipt binding mismatch".into());
        }
        match self.state.as_str() {
            "in_flight" => {
                if self.result.is_none() && self.error_code.is_none() {
                    Ok(())
                } else {
                    Err("Invalid organization receipt".into())
                }
            }
            "unknown" => {
                if self.result.is_none()
                    && self.error_code.as_deref() == Some("PROVIDER_OUTCOME_UNKNOWN")
                {
                    Ok(())
                } else {
                    Err("Invalid organization receipt".into())
                }
            }
            "expired" => {
                if self.result.is_none() && self.error_code.as_deref() == Some("RECEIPT_EXPIRED") {
                    Ok(())
                } else {
                    Err("Invalid organization receipt".into())
                }
            }
            "failed" => {
                if self.result.is_none()
                    && self.error_code.as_deref().is_some_and(|code| {
                        [
                            "INVALID_EXTRACTION",
                            "PROVIDER_FAILED",
                            "AUTHORIZATION_CHANGED",
                        ]
                        .contains(&code)
                    })
                {
                    Ok(())
                } else {
                    Err("Invalid organization receipt".into())
                }
            }
            "complete" => {
                if self.error_code.is_some() {
                    return Err("Invalid organization receipt".into());
                }
                let result = self.result.as_ref().ok_or("Missing organization result")?;
                if result.provider != "anthropic"
                    || result.review_state != "unreviewed"
                    || result.input_manifest_sha256 != self.payload_sha256
                {
                    return Err("Invalid organization result".into());
                }
                crate::reading::validate_organization_extraction(
                    &result.extraction,
                    &request.binding.memory_id,
                    &self.payload_sha256,
                    &request.binding.memory_id,
                )?;
                validate_related_context(&request.binding, result)?;
                match request.binding.source_kind.as_str() {
                    "text" if result.derivative.is_none() => {
                        if let Some(body) = body {
                            let text =
                                std::str::from_utf8(body).map_err(|_| "Invalid bound text")?;
                            if result.extraction["pages"][0]["transcription"] != text
                                || !exact_quotes(&result.extraction, text)
                            {
                                return Err(
                                    "Organization changed or misquoted submitted text".into()
                                );
                            }
                        }
                        Ok(())
                    }
                    "audio_transcript" if result.derivative.is_none() => {
                        if let Some(body) = body {
                            let text = std::str::from_utf8(body)
                                .map_err(|_| "Invalid bound transcript")?;
                            if result.extraction["pages"][0]["transcription"] != text
                                || !exact_quotes(&result.extraction, text)
                            {
                                return Err(
                                    "Organization changed or misquoted the submitted transcript"
                                        .into(),
                                );
                            }
                        }
                        // "clear" is never claimed for unreviewed machine wording.
                        if request.binding.transcript_evidence_kind.as_deref()
                            == Some("machine_unreviewed")
                            && result.extraction["pages"][0]["legibility"] == "clear"
                        {
                            return Err("Machine transcript cannot be marked clear".into());
                        }
                        Ok(())
                    }
                    "photo"
                        if result.derivative.as_ref().is_some_and(|d| {
                            hex64(&d.sha256)
                                && d.transform_version == "jpeg-rgb-exif-orient-v1"
                                && d.media_type == "image/jpeg"
                        }) =>
                    {
                        Ok(())
                    }
                    _ => Err("Invalid organization derivative".into()),
                }
            }
            _ => Err("Invalid organization state".into()),
        }
    }
}
pub(crate) fn exact_quotes(value: &Value, body: &str) -> bool {
    match value {
        Value::Object(map) => map.iter().all(|(key, value)| {
            if key == "quote" {
                value
                    .as_str()
                    .is_some_and(|q| !q.trim().is_empty() && body.contains(q))
            } else {
                exact_quotes(value, body)
            }
        }),
        Value::Array(items) => items.iter().all(|v| exact_quotes(v, body)),
        _ => true,
    }
}
pub(crate) fn text_result_matches_input(extraction: &Value, body: &str) -> bool {
    extraction["pages"][0]["transcription"].as_str() == Some(body) && exact_quotes(extraction, body)
}
impl OrganizationRequest {
    pub(crate) fn validate_binding(&self) -> Result<()> {
        let b = &self.binding;
        if !matches!(b.schema_version.as_str(), "1.0" | "2.0" | "3.0")
            || !uuid(&b.operation_id)
            || !uuid(&b.vault_id)
            || !uuid(&b.memory_id)
            || !hex64(&b.source_sha256)
            || !hex64(&b.input_sha256)
            || b.expected_revision == 0
            || b.expected_revision > 9_007_199_254_740_991
            || b.consent_epoch == 0
        {
            return Err("Invalid organization binding".into());
        }
        let audio_fields = (
            b.derivative_sha256.as_deref(),
            b.transcript_revision,
            b.transcript_evidence_kind.as_deref(),
        );
        if b.schema_version != "3.0" && audio_fields != (None, None, None) {
            return Err("Audio transcript fields require a 3.0 binding".into());
        }
        match b.schema_version.as_str() {
            "1.0" if b.context.is_none() && b.context_coverage.is_none() => Ok(()),
            "2.0" => {
                let coverage = b
                    .context_coverage
                    .as_ref()
                    .ok_or("Missing context coverage")?;
                let context = b.context.as_ref().ok_or("Missing bound context")?;
                if context.len() > 3
                    || coverage.selected_count != context.len() as u64
                    || coverage.eligible_count < coverage.selected_count
                    || coverage.limited != (coverage.eligible_count > coverage.selected_count)
                    || coverage.truncated_count > coverage.selected_count
                {
                    return Err("Invalid organization context coverage".into());
                }
                let mut ids = HashSet::new();
                for item in context {
                    if !uuid(&item.memory_id)
                        || item.memory_id == b.memory_id
                        || !ids.insert(item.memory_id.as_str())
                        || item.memory_revision == 0
                        || item.memory_revision > 9_007_199_254_740_991
                        || !hex64(&item.source_sha256)
                        || !matches!(
                            item.evidence_kind.as_str(),
                            "text_source"
                                | "human_note"
                                | "human_reading_correction"
                                | "machine_reading"
                                | "organization_proposal"
                        )
                        || !matches!(item.epistemic_state.as_str(), "reported" | "unreviewed")
                        || item.excerpt.trim().is_empty()
                        || item.excerpt.as_bytes().len() > 256
                    {
                        return Err("Invalid organization context excerpt".into());
                    }
                }
                let encoded = serde_json::to_vec(b).map_err(|_| "Invalid organization binding")?;
                if encoded.len() > MAX_CONTEXT_BINDING {
                    return Err("Organization context binding exceeds its limit".into());
                }
                Ok(())
            }
            "3.0" => {
                // Audio transcript binding: no related-memory context in this version.
                if b.source_kind != "audio_transcript"
                    || b.context.is_some()
                    || b.context_coverage.is_some()
                    || !audio_fields.0.is_some_and(hex64)
                    || !audio_fields
                        .1
                        .is_some_and(|r| (1..=9_007_199_254_740_991).contains(&r))
                    || !matches!(
                        audio_fields.2,
                        Some("machine_unreviewed" | "human_corrected")
                    )
                {
                    return Err("Invalid audio transcript binding".into());
                }
                let encoded = serde_json::to_vec(b).map_err(|_| "Invalid organization binding")?;
                if encoded.len() > MAX_CONTEXT_BINDING {
                    return Err("Organization binding exceeds its limit".into());
                }
                Ok(())
            }
            _ => Err("Invalid organization binding version".into()),
        }
    }
}

fn validate_related_context(
    binding: &OrganizationBinding,
    result: &OrganizationResult,
) -> Result<()> {
    let Some(context) = binding.context.as_ref() else {
        if result.related_context.is_some() {
            return Err("Related context requires a v2 binding".into());
        }
        return Ok(());
    };
    let related = result
        .related_context
        .as_ref()
        .ok_or("Missing related context result")?;
    if related.len() > 3 {
        return Err("Too many related context links".into());
    }
    let transcript = result.extraction["pages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|page| page["transcription"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let supplied: std::collections::HashMap<_, _> = context
        .iter()
        .map(|item| (item.memory_id.as_str(), item.excerpt.as_str()))
        .collect();
    let mut seen = HashSet::new();
    for link in related {
        let Some(target) = supplied.get(link.target_memory_id.as_str()) else {
            return Err("Related context target is not in the bound context".into());
        };
        if !seen.insert(link.target_memory_id.as_str())
            || link.source_quote.trim().is_empty()
            || !transcript.contains(&link.source_quote)
            || link.target_quote.trim().is_empty()
            || !target.contains(&link.target_quote)
        {
            return Err("Related context quote is unsupported".into());
        }
    }
    Ok(())
}

pub(crate) fn base64url_no_pad(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize;
        let b = chunk.get(1).copied().unwrap_or(0) as usize;
        let c = chunk.get(2).copied().unwrap_or(0) as usize;
        output.push(TABLE[a >> 2] as char);
        output.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        if chunk.len() > 1 {
            output.push(TABLE[((b & 15) << 2) | (c >> 6)] as char);
        }
        if chunk.len() > 2 {
            output.push(TABLE[c & 63] as char);
        }
    }
    output
}

pub enum OrganizationLookup {
    Receipt(OrganizationReceipt),
    NotFound,
}

pub(crate) fn recover_then_dispatch(
    lookup: Result<OrganizationLookup>,
    expected: &OrganizationRequest,
    revalidate: impl FnOnce() -> Result<(OrganizationRequest, Vec<u8>)>,
    dispatch: impl FnOnce(&OrganizationRequest, Vec<u8>) -> Result<OrganizationReceipt>,
) -> Result<Option<OrganizationReceipt>> {
    match lookup? {
        OrganizationLookup::Receipt(receipt) => Ok(Some(receipt)),
        OrganizationLookup::NotFound => {
            let (request, body) = revalidate()?;
            if &request != expected {
                return Err("Organization operation changed during recovery".into());
            }
            request.validate(&body)?;
            dispatch(&request, body).map(Some)
        }
    }
}

fn fresh_dispatch_material(
    vault: &Vault,
    operation_id: &str,
    expected: &OrganizationRequest,
    expected_body: &[u8],
    connection_fingerprint: &str,
) -> Result<Option<(OrganizationRequest, Vec<u8>)>> {
    let Some((intent, request, body)) = vault.organization_dispatch_material(operation_id)? else {
        return Ok(None);
    };
    if intent.connection_fingerprint != connection_fingerprint
        || &request != expected
        || body != expected_body
    {
        let _ = vault.set_organization_operation_state(
            operation_id,
            "stale",
            Some("SOURCE_OR_CONNECTION_CHANGED".into()),
        );
        return Ok(None);
    }
    Ok(Some((request, body)))
}

pub struct LocalOrganizationTransport {
    client: Client,
    connection: IntelligenceConnection,
}
pub(crate) fn parsed_origin(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "Organization service is unavailable")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Organization service is unavailable".into());
    }
    Ok(url)
}
pub(crate) fn bounded<T: for<'de> Deserialize<'de>>(response: Response) -> Result<T> {
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE) {
        return Err("Organization response exceeds its size limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Organization response interrupted")?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("Organization response exceeds its size limit".into());
    }
    strict_json_from_slice(&bytes).map_err(|_| "Invalid organization response".into())
}
impl LocalOrganizationTransport {
    pub fn new(connection: IntelligenceConnection) -> Result<Self> {
        parsed_origin(&connection.origin)?;
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "Organization transport unavailable")?;
        Ok(Self { client, connection })
    }
    fn url(&self, path: &str) -> Result<Url> {
        parsed_origin(&self.connection.origin)?
            .join(path)
            .map_err(|_| "Organization service unavailable".into())
    }
    pub fn capability(&self) -> Result<OrganizationCapability> {
        self.capability_at("v1/local-intelligence/organization-capability", "organize")
    }
    /// The separate, purpose-specific audio-transcript organization capability.
    pub fn audio_capability(&self) -> Result<OrganizationCapability> {
        self.capability_at(
            "v1/local-intelligence/audio-organization-capability",
            "organize_audio",
        )
    }
    fn capability_at(&self, path: &str, purpose: &str) -> Result<OrganizationCapability> {
        let response = self
            .client
            .get(self.url(path)?)
            .bearer_auth(&self.connection.secret)
            .send()
            .map_err(|_| "Organization capability unavailable")?;
        if !response.status().is_success() {
            return Err("Organization capability unavailable".into());
        }
        let cap: OrganizationCapability = bounded(response)?;
        if cap.schema_version != "1.0"
            || cap.scope != "vault_intelligence"
            || cap.purpose != purpose
            || cap.vault_id != self.connection.vault_id
            || !matches!(cap.consent.as_str(), "active" | "missing" | "outdated")
        {
            return Err("Organization capability response is invalid".into());
        }
        Ok(cap)
    }
    pub fn set_consent(
        &self,
        cap: &OrganizationCapability,
        enabled: bool,
    ) -> Result<OrganizationCapability> {
        self.set_consent_at(
            "v1/local-intelligence/organization-consent",
            "organize",
            cap,
            enabled,
        )
    }
    pub fn set_audio_consent(
        &self,
        cap: &OrganizationCapability,
        enabled: bool,
    ) -> Result<OrganizationCapability> {
        self.set_consent_at(
            "v1/local-intelligence/audio-organization-consent",
            "organize_audio",
            cap,
            enabled,
        )
    }
    fn set_consent_at(
        &self,
        path: &str,
        purpose: &str,
        cap: &OrganizationCapability,
        enabled: bool,
    ) -> Result<OrganizationCapability> {
        let body = serde_json::to_vec(&serde_json::json!({"schema_version":"1.0","policy_version":cap.policy_version,"enabled":enabled,"expected_consent_epoch":cap.consent_epoch})).map_err(|_| "Cannot encode organization consent")?;
        if body.len() > 1024 {
            return Err("Organization consent request exceeds its limit".into());
        }
        let response = self
            .client
            .post(self.url(path)?)
            .bearer_auth(&self.connection.secret)
            .header("Content-Type", "application/json")
            .body(body)
            .send();
        match response {
            Ok(r) if r.status().is_success() => bounded(r),
            Ok(r) if r.status().as_u16() == 409 => {
                Err("Organization consent changed; refresh capability".into())
            }
            Ok(_) => Err("Organization consent was rejected".into()),
            Err(_) => self.capability_at(
                if purpose == "organize" {
                    "v1/local-intelligence/organization-capability"
                } else {
                    "v1/local-intelligence/audio-organization-capability"
                },
                purpose,
            ), // ambiguous POST: authenticated GET, never repeat POST
        }
    }
    pub fn post(&self, req: &OrganizationRequest, body: Vec<u8>) -> Result<OrganizationReceipt> {
        req.validate(&body)?;
        let header = req.header_value()?;
        let response = self
            .client
            .post(self.url("v1/local-intelligence/organizations")?)
            .bearer_auth(&self.connection.secret)
            .header("Content-Type", &req.media_type)
            .header("X-Recall-Organization", header)
            .body(body.clone())
            .send()
            .map_err(|_| "Organization outcome is unknown; recover this operation")?;
        self.receipt_response(response, req, Some(&body))
    }
    pub fn get(&self, req: &OrganizationRequest) -> Result<OrganizationLookup> {
        let response = self
            .client
            .get(self.url(&format!(
                "v1/local-intelligence/organizations/{}",
                req.binding.operation_id
            ))?)
            .bearer_auth(&self.connection.secret)
            .send()
            .map_err(|_| "Organization receipt is unavailable; recover the same operation")?;
        if response.status().as_u16() == 404 {
            return Ok(OrganizationLookup::NotFound);
        }
        self.receipt_response(response, req, None)
            .map(OrganizationLookup::Receipt)
    }
    fn receipt_response(
        &self,
        response: Response,
        req: &OrganizationRequest,
        body: Option<&[u8]>,
    ) -> Result<OrganizationReceipt> {
        let status = response.status().as_u16();
        if ![200, 202].contains(&status) {
            return Err(match status {
                401 | 403 => "Organization connection or consent is no longer authorized",
                409 => "Organization operation conflicts with earlier input",
                _ => "Organization service rejected request",
            }
            .into());
        }
        let receipt: OrganizationReceipt = bounded(response)?;
        if (status == 202) != matches!(receipt.state.as_str(), "in_flight" | "unknown") {
            return Err("Organization receipt status is invalid".into());
        }
        receipt.validate(req, body)?;
        Ok(receipt)
    }
}

#[tauri::command]
pub async fn vault_organization_capability(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<NativeOrganizationCapability> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || {
        LocalOrganizationTransport::new(c)?.capability()
    })
    .await
    .map_err(|_| "Organization capability failed")??;
    state.with(&expected_vault_id, |v| {
        if v.id == connection.vault_id {
            Ok(native_capability(v, &connection, cap))
        } else {
            Err("Vault selection changed".into())
        }
    })
}
#[tauri::command]
pub async fn vault_set_organization_consent(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    enabled: bool,
    expected_consent_epoch: u64,
) -> Result<NativeOrganizationCapability> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || -> Result<OrganizationCapability> {
        let t = LocalOrganizationTransport::new(c)?;
        let before = t.capability()?;
        if before.consent_epoch != expected_consent_epoch {
            return Err("Organization consent changed; refresh capability".into());
        }
        let after = t.set_consent(&before, enabled)?;
        if !requested_decision_proven(&before, &after, enabled) {
            return Err("Organization consent outcome is unknown; refresh capability".into());
        }
        Ok(after)
    })
    .await
    .map_err(|_| "Organization consent failed")??;
    state.with(&expected_vault_id, |v| {
        if v.id != connection.vault_id {
            return Err("Vault selection changed".into());
        }
        if enabled {
            // Re-read the protected pairing after the server decision. Re-pairing
            // during the request invalidates this local future-capture fence.
            match pairing::confirmed_intelligence(&v.id) {
                Ok(current) if current.fingerprint == connection.fingerprint => {
                    return commit_confirmed_consent(v, &connection, Some(&current), cap, true);
                }
                _ => {
                    return commit_confirmed_consent(v, &connection, None, cap, true);
                }
            }
        }
        commit_confirmed_consent(v, &connection, None, cap, false)
    })
}

#[tauri::command]
pub async fn vault_reconcile_organization_consent(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<NativeOrganizationCapability> {
    let guard = state.session(&expected_vault_id)?;
    let vault_id = guard.vault.id.clone();
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || {
        LocalOrganizationTransport::new(c)?.capability()
    })
    .await
    .map_err(|_| "Organization capability failed")??;
    guard.with(|v| {
        if v.id != connection.vault_id || cap.vault_id != v.id {
            return Err("Vault selection changed".into());
        }
        if cap.consent == "active" {
            v.set_organization_marker(Some(OrganizationMarker {
                schema_version: "1.0".into(),
                vault_id: v.id.clone(),
                policy_version: cap.policy_version.clone(),
                consent_epoch: cap.consent_epoch,
                local_epoch: Uuid::new_v4().to_string(),
                connection_fingerprint: connection.fingerprint.clone(),
            }))?;
        } else if matches!(cap.consent.as_str(), "missing" | "outdated") {
            v.set_organization_marker(None)?;
        }
        Ok(native_capability(v, &connection, cap))
    })
}
#[tauri::command]
pub fn vault_organization_operations(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
) -> Result<Vec<OrganizationOperation>> {
    state.with(&expected_vault_id, |v| {
        v.organization_operations(&memory_id)
    })
}
#[tauri::command]
pub async fn vault_recover_organization(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<OrganizationOperation> {
    let guard = state.session(&expected_vault_id)?;
    process_operation(guard, &operation_id).await
}

#[tauri::command]
pub fn vault_organization_process_pending(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<()> {
    schedule_pending(state.session(&expected_vault_id)?);
    Ok(())
}

static PROCESS_GATE: OnceLock<Mutex<()>> = OnceLock::new();
const ORGANIZATION_BATCH_SIZE: usize = 10;
const ORGANIZATION_SWEEP_LIMIT: usize = 50;
pub fn schedule_pending(guard: SelectionGuard) {
    let _ = tauri::async_runtime::spawn_blocking(move || process_pending_sync(guard));
}
fn process_pending_sync(guard: SelectionGuard) -> Result<()> {
    process_pending_sync_with_attempted(guard, HashSet::new())
}
fn process_pending_sync_with_attempted(
    guard: SelectionGuard,
    mut attempted: HashSet<String>,
) -> Result<()> {
    let gate = PROCESS_GATE.get_or_init(|| Mutex::new(()));
    let process_guard = gate.lock().map_err(|_| "Organization runner unavailable")?;
    let continue_sweep = run_pending(&guard, &mut attempted)?;
    drop(process_guard);
    if continue_sweep {
        schedule_pending_continuation(guard, attempted);
    }
    Ok(())
}
fn schedule_pending_continuation(guard: SelectionGuard, attempted: HashSet<String>) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        process_pending_sync_with_attempted(guard, attempted)
    });
}
fn run_pending(guard: &SelectionGuard, attempted: &mut HashSet<String>) -> Result<bool> {
    run_scoped(guard, None, attempted)
}
fn run_specific(guard: &SelectionGuard, operation_id: &str) -> Result<()> {
    run_scoped(guard, Some(operation_id), &mut HashSet::new()).map(|_| ())
}
fn select_work(
    mut intents: Vec<OrganizationIntent>,
    operation_id: Option<&str>,
    limit: usize,
    attempted: &mut HashSet<String>,
) -> Vec<OrganizationIntent> {
    intents.retain(|intent| {
        ["prepared", "queued", "processing", "unknown"].contains(&intent.state.as_str())
            && operation_id.is_none_or(|id| intent.binding.operation_id == id)
            && !attempted.contains(&intent.binding.operation_id)
    });
    if operation_id.is_none() {
        intents.sort_by(|left, right| {
            let priority = |state: &str| match state {
                "queued" => 0,
                "prepared" => 1,
                "processing" => 2,
                "unknown" => 3,
                _ => 4,
            };
            priority(&left.state)
                .cmp(&priority(&right.state))
                .then(left.binding.captured_at.cmp(&right.binding.captured_at))
                .then(left.binding.operation_id.cmp(&right.binding.operation_id))
        });
    }
    intents.truncate(if operation_id.is_some() { 1 } else { limit });
    intents
}

fn run_batches(
    operation_id: Option<&str>,
    batch_limit: usize,
    sweep_limit: usize,
    mut load: impl FnMut() -> Result<Vec<OrganizationIntent>>,
    mut preflight: impl FnMut() -> Result<bool>,
    mut process: impl FnMut(&OrganizationIntent) -> Result<()>,
    attempted: &mut HashSet<String>,
) -> Result<bool> {
    let mut processed_this_batch_chain = 0;
    while processed_this_batch_chain < sweep_limit {
        if !preflight()? {
            return Ok(false);
        }
        let batch = select_work(load()?, operation_id, batch_limit, attempted);
        if batch.is_empty() {
            return Ok(false);
        }
        for intent in batch {
            attempted.insert(intent.binding.operation_id.clone());
            process(&intent)?;
            processed_this_batch_chain += 1;
        }
        if operation_id.is_some() {
            return Ok(false);
        }
        std::thread::yield_now();
    }

    if operation_id.is_none()
        && load()?.iter().any(|intent| {
            ["prepared", "queued"].contains(&intent.state.as_str())
                && !attempted.contains(&intent.binding.operation_id)
        })
    {
        return preflight();
    }
    Ok(false)
}

fn run_scoped(
    guard: &SelectionGuard,
    operation_id: Option<&str>,
    attempted: &mut HashSet<String>,
) -> Result<bool> {
    guard.active()?;
    let vault = &guard.vault;
    let Some(marker) = vault.organization_marker()? else {
        return Ok(false);
    };
    let connection = pairing::confirmed_intelligence(&vault.id)?;
    if connection.fingerprint != marker.connection_fingerprint {
        return Ok(false);
    }
    let transport = LocalOrganizationTransport::new(connection.clone())?;
    run_batches(
        operation_id,
        ORGANIZATION_BATCH_SIZE,
        ORGANIZATION_SWEEP_LIMIT,
        || vault.organization_intents(),
        || {
            if guard.active().is_err() {
                return Ok(false);
            }
            let Some(current_marker) = vault.organization_marker()? else {
                return Ok(false);
            };
            let current_connection = pairing::confirmed_intelligence(&vault.id)?;
            if current_marker != marker || current_connection.fingerprint != connection.fingerprint
            {
                return Ok(false);
            }
            let capability = transport.capability()?;
            Ok(capability.enabled
                && capability.consent == "active"
                && capability.vault_id == vault.id
                && capability.policy_version == marker.policy_version
                && capability.consent_epoch == marker.consent_epoch)
        },
        |pending| process_intent(guard, vault, pending, &marker, &connection, &transport),
        attempted,
    )
}

fn process_intent(
    guard: &SelectionGuard,
    vault: &Vault,
    pending: &OrganizationIntent,
    marker: &OrganizationMarker,
    connection: &IntelligenceConnection,
    transport: &LocalOrganizationTransport,
) -> Result<()> {
    guard.active()?;
    let Some((intent, request, body)) =
        vault.organization_dispatch_material(&pending.binding.operation_id)?
    else {
        return Ok(());
    };
    if intent.connection_fingerprint != connection.fingerprint {
        let _ = vault.set_organization_operation_state(
            &intent.binding.operation_id,
            "stale",
            Some("CONNECTION_CHANGED".into()),
        );
        return Ok(());
    }
    let first_send = intent.state == "queued";
    if first_send {
        vault.set_organization_operation_state(&intent.binding.operation_id, "processing", None)?;
    }
    let receipt = recover_then_dispatch(
        transport.get(&request),
        &request,
        || {
            guard.active()?;
            let current = pairing::confirmed_intelligence(&vault.id)?;
            if current.fingerprint != connection.fingerprint {
                return Err("Organization connection changed during recovery".into());
            }
            let current_marker = vault
                .organization_marker()?
                .ok_or("Organization consent was revoked")?;
            if current_marker != *marker {
                return Err("Organization consent changed during recovery".into());
            }
            let latest = transport.capability()?;
            if !latest.enabled
                || latest.consent != "active"
                || latest.policy_version != marker.policy_version
                || latest.consent_epoch != marker.consent_epoch
            {
                return Err("Organization consent changed during recovery".into());
            }
            if pairing::confirmed_intelligence(&vault.id)?.fingerprint != connection.fingerprint {
                return Err("Organization connection changed during recovery".into());
            }
            fresh_dispatch_material(
                vault,
                &intent.binding.operation_id,
                &request,
                &body,
                &connection.fingerprint,
            )?
            .ok_or_else(|| "Organization source or connection changed during recovery".to_string())
        },
        |fresh_request, fresh_body| {
            post_if_selected(guard, || transport.post(fresh_request, fresh_body))
        },
    );
    let receipt = match receipt {
        Ok(receipt) => receipt,
        Err(_) => {
            let _ = vault.set_organization_operation_state(
                &intent.binding.operation_id,
                "unknown",
                Some(
                    if first_send {
                        "NOT_DISPATCHED"
                    } else {
                        "RECEIPT_UNAVAILABLE"
                    }
                    .into(),
                ),
            );
            return Ok(());
        }
    };
    let Some(receipt) = receipt else {
        return Ok(());
    };
    receipt.validate(&request, Some(&body))?;
    match receipt.state.as_str() {
        "complete" => {
            let latest = transport.capability()?;
            let current = pairing::confirmed_intelligence(&vault.id)?;
            let current_marker = vault.organization_marker()?;
            let fresh = fresh_dispatch_material(
                vault,
                &intent.binding.operation_id,
                &request,
                &body,
                &connection.fingerprint,
            )?;
            if guard.active().is_err()
                || current.fingerprint != connection.fingerprint
                || current_marker.as_ref() != Some(marker)
                || fresh.is_none()
                || !latest.enabled
                || latest.consent != "active"
                || latest.policy_version != marker.policy_version
                || latest.consent_epoch != marker.consent_epoch
            {
                let _ = vault.set_organization_operation_state(
                    &intent.binding.operation_id,
                    "stale",
                    Some("CONSENT_CHANGED".into()),
                );
                return Ok(());
            }
            // `with` holds the selection mutex only for the validated journal
            // promotion, making the final session check and commit indivisible.
            guard.with(|current_vault| {
                let latest_marker = current_vault.organization_marker()?;
                if latest_marker.as_ref() != Some(marker) {
                    return Err("Vault selection changed".into());
                }
                current_vault
                    .promote_organization(&request, &body, &receipt)
                    .map(|_| ())
            })?;
        }
        "failed" | "expired" => {
            let _ = vault.set_organization_operation_state(
                &intent.binding.operation_id,
                "failed",
                receipt.error_code.clone(),
            );
        }
        _ => {
            let _ = vault.set_organization_operation_state(
                &intent.binding.operation_id,
                "unknown",
                receipt.error_code.clone(),
            );
        }
    }
    Ok(())
}
async fn process_operation(
    guard: SelectionGuard,
    operation_id: &str,
) -> Result<OrganizationOperation> {
    let op = operation_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let gate = PROCESS_GATE.get_or_init(|| Mutex::new(()));
        let _guard = gate.lock().map_err(|_| "Organization runner unavailable")?;
        let _ = run_specific(&guard, &op);
        guard.with(|vault| vault.organization_operation(&op))
    })
    .await
    .map_err(|_| "Organization recovery failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn synthetic_intent(state: &str) -> OrganizationIntent {
        let operation_id = Uuid::new_v4().to_string();
        OrganizationIntent {
            schema_version: "1.0".into(),
            binding: OrganizationBinding {
                schema_version: "1.0".into(),
                operation_id,
                vault_id: Uuid::new_v4().to_string(),
                memory_id: Uuid::new_v4().to_string(),
                source_kind: "text".into(),
                source_sha256: "a".repeat(64),
                expected_revision: 1,
                input_sha256: "a".repeat(64),
                derivative_sha256: None,
                transcript_revision: None,
                transcript_evidence_kind: None,
                consent_epoch: 1,
                captured_at: "2026-10-09T12:00:00Z".into(),
                context_coverage: None,
                context: None,
            },
            media_type: "text/plain; charset=utf-8".into(),
            human_text_sha256: "a".repeat(64),
            connection_fingerprint: "a".repeat(64),
            local_epoch: Uuid::new_v4().to_string(),
            state: state.into(),
            error_code: None,
        }
    }

    #[test]
    fn named_recovery_selects_operation_beyond_background_batch() {
        let intents: Vec<_> = (0..12).map(|_| synthetic_intent("unknown")).collect();
        let requested = intents
            .iter()
            .map(|i| i.binding.operation_id.as_str())
            .max()
            .unwrap()
            .to_owned();
        let background = select_work(intents.clone(), None, 10, &mut HashSet::new());
        assert_eq!(background.len(), 10);
        assert!(!background
            .iter()
            .any(|i| i.binding.operation_id == requested));

        let recovery = select_work(intents, Some(&requested), 10, &mut HashSet::new());
        assert_eq!(recovery.len(), 1);
        assert_eq!(recovery[0].binding.operation_id, requested);
    }

    #[test]
    fn queued_batches_progress_past_persistent_unknown_intents() {
        let old_unknown: Vec<_> = (0..12).map(|_| synthetic_intent("unknown")).collect();
        let queued: Vec<_> = (0..12).map(|_| synthetic_intent("queued")).collect();
        let mut all = old_unknown;
        all.extend(queued);

        let first_batch = select_work(all.clone(), None, 10, &mut HashSet::new());
        assert_eq!(first_batch.len(), 10);
        assert!(first_batch.iter().all(|i| i.state == "queued"));
        let first_ids: std::collections::HashSet<_> = first_batch
            .iter()
            .map(|i| i.binding.operation_id.clone())
            .collect();
        for intent in &mut all {
            if first_ids.contains(&intent.binding.operation_id) {
                intent.state = "unknown".into();
            }
        }
        assert_eq!(all.iter().filter(|i| i.state == "queued").count(), 2);

        let next_batch = select_work(all, None, 10, &mut first_ids.clone());
        assert_eq!(next_batch.len(), 10);
        assert_eq!(next_batch.iter().filter(|i| i.state == "queued").count(), 2);
        assert!(next_batch[..2].iter().all(|i| i.state == "queued"));
        assert!(next_batch[..2]
            .iter()
            .all(|i| !first_ids.contains(&i.binding.operation_id)));
    }

    #[test]
    fn one_scheduled_sweep_continues_batches_and_attempts_each_unknown_once() {
        use std::{cell::RefCell, collections::HashMap};
        let queued: Vec<_> = (0..24).map(|_| synthetic_intent("queued")).collect();
        let unknown: Vec<_> = (0..4).map(|_| synthetic_intent("unknown")).collect();
        let expected_queued: HashSet<_> = queued
            .iter()
            .map(|i| i.binding.operation_id.clone())
            .collect();
        let stored = RefCell::new(queued.into_iter().chain(unknown).collect::<Vec<_>>());
        let attempted = RefCell::new(HashMap::<String, usize>::new());
        let batches = RefCell::new(0usize);
        let mut attempted_ids = HashSet::new();

        let more = run_batches(
            None,
            10,
            50,
            || Ok(stored.borrow().clone()),
            || {
                *batches.borrow_mut() += 1;
                Ok(true)
            },
            |intent| {
                *attempted
                    .borrow_mut()
                    .entry(intent.binding.operation_id.clone())
                    .or_default() += 1;
                let mut state = stored.borrow_mut();
                let current = state
                    .iter_mut()
                    .find(|i| i.binding.operation_id == intent.binding.operation_id)
                    .unwrap();
                // Simulate an in-flight/unknown result; attempted IDs must keep
                // this operation out of later batches in the same sweep.
                current.state = "unknown".into();
                Ok(())
            },
            &mut attempted_ids,
        )
        .unwrap();

        assert!(!more);
        assert!(*batches.borrow() > 1);
        let attempted = attempted.borrow();
        assert_eq!(attempted.len(), 28);
        assert!(attempted.values().all(|count| *count == 1));
        assert!(expected_queued.iter().all(|id| attempted.contains_key(id)));
    }

    #[test]
    fn bounded_sweep_requests_continuation_when_queued_work_remains() {
        use std::{cell::RefCell, collections::HashMap};
        let mut work: Vec<_> = (0..60).map(|_| synthetic_intent("queued")).collect();
        work.extend((0..5).map(|_| synthetic_intent("unknown")));
        let stored = RefCell::new(work);
        let processed = RefCell::new(HashMap::<String, usize>::new());
        let mut attempted_ids = HashSet::new();
        let mut process = |intent: &OrganizationIntent| {
            *processed
                .borrow_mut()
                .entry(intent.binding.operation_id.clone())
                .or_default() += 1;
            stored
                .borrow_mut()
                .iter_mut()
                .find(|i| i.binding.operation_id == intent.binding.operation_id)
                .unwrap()
                .state = "unknown".into();
            Ok(())
        };
        let sweep =
            |attempted: &mut HashSet<String>,
             process: &mut dyn FnMut(&OrganizationIntent) -> Result<()>| {
                run_batches(
                    None,
                    10,
                    50,
                    || Ok(stored.borrow().clone()),
                    || Ok(true),
                    |i| process(i),
                    attempted,
                )
            };
        let more = sweep(&mut attempted_ids, &mut process).unwrap();
        assert!(more);
        assert_eq!(processed.borrow().len(), 50);
        let more = sweep(&mut attempted_ids, &mut process).unwrap();
        assert!(!more);
        assert_eq!(processed.borrow().len(), 65);
        assert!(processed.borrow().values().all(|count| *count == 1));
    }

    fn fixture_request() -> (OrganizationRequest, Vec<u8>) {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-organization-synthetic.json"
        ))
        .unwrap();
        let binding: OrganizationBinding =
            serde_json::from_value(fixture["binding"].clone()).unwrap();
        let request = OrganizationRequest {
            binding,
            media_type: fixture["media_type"].as_str().unwrap().into(),
        };
        let body = fixture["body_text"].as_str().unwrap().as_bytes().to_vec();
        (request, body)
    }

    #[test]
    fn unknown_recovery_never_dispatches_and_authenticated_404_dispatches_same_operation_only() {
        let (request, body) = fixture_request();
        let sent = std::cell::Cell::new(false);
        let unknown = recover_then_dispatch(
            Err::<OrganizationLookup, String>("receipt unavailable".into()),
            &request,
            || unreachable!(),
            |_, _| unreachable!(),
        );
        assert!(unknown.is_err());
        assert!(!sent.get());

        let expected_id = request.binding.operation_id.clone();
        let receipt = recover_then_dispatch(
            Ok(OrganizationLookup::NotFound),
            &request,
            || Ok((request.clone(), body.clone())),
            |retry, bytes| {
                sent.set(true);
                assert_eq!(retry.binding.operation_id, expected_id);
                assert_eq!(retry, &request);
                retry.validate(&bytes)?;
                Ok(OrganizationReceipt {
                    schema_version: "1.0".into(),
                    binding: retry.binding.clone(),
                    payload_sha256: retry.payload_sha256()?,
                    state: "in_flight".into(),
                    result: None,
                    error_code: None,
                })
            },
        )
        .unwrap()
        .unwrap();
        assert!(sent.get());
        assert_eq!(receipt.binding.operation_id, expected_id);
    }

    #[test]
    fn recovery_refuses_changed_binding_before_post() {
        let (request, body) = fixture_request();
        let mut changed = request.clone();
        changed.binding.operation_id = Uuid::new_v4().to_string();
        let result = recover_then_dispatch(
            Ok(OrganizationLookup::NotFound),
            &request,
            || Ok((changed, body)),
            |_, _| panic!("changed operation must never be posted"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn source_or_revision_change_while_receipt_get_is_in_flight_blocks_post() {
        let root = std::env::temp_dir().join(format!("recall-organize-race-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let fingerprint = "a".repeat(64);
        vault
            .set_organization_marker(Some(OrganizationMarker {
                schema_version: "1.0".into(),
                vault_id: vault.id.clone(),
                policy_version: "organize-v1|anthropic-v1|synthetic-model".into(),
                consent_epoch: 1,
                local_epoch: Uuid::new_v4().to_string(),
                connection_fingerprint: fingerprint.clone(),
            }))
            .unwrap();
        let memory = vault
            .capture_text(&Uuid::new_v4().to_string(), "original text")
            .unwrap();
        let operation = vault.organization_operations(&memory.id).unwrap().remove(0);
        let (_, request, body) = vault
            .organization_dispatch_material(&operation.operation_id)
            .unwrap()
            .unwrap();

        // Simulate a human correction while the receipt GET is awaiting its response.
        vault
            .correct(
                &memory.id,
                memory.revision,
                &Uuid::new_v4().to_string(),
                "corrected text",
            )
            .unwrap();
        assert!(fresh_dispatch_material(
            &vault,
            &operation.operation_id,
            &request,
            &body,
            &fingerprint
        )
        .unwrap()
        .is_none());
        assert_eq!(
            vault
                .organization_operation(&operation.operation_id)
                .unwrap()
                .state,
            "stale"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn unicode_binding_and_digest_match_shared_backend_golden_fixture() {
        let f: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-organization-synthetic.json"
        ))
        .unwrap();
        let binding: OrganizationBinding = serde_json::from_value(f["binding"].clone()).unwrap();
        let req = OrganizationRequest {
            binding,
            media_type: f["media_type"].as_str().unwrap().into(),
        };
        let body = f["body_text"].as_str().unwrap().as_bytes();
        req.validate(body).unwrap();
        assert_eq!(
            String::from_utf8(req.canonical_bytes().unwrap()).unwrap(),
            f["canonical_payload_json"].as_str().unwrap()
        );
        assert_eq!(
            req.payload_sha256().unwrap(),
            f["payload_sha256"].as_str().unwrap()
        );
    }

    #[test]
    fn v2_header_and_canonical_payload_match_shared_context_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-context-synthetic.json"
        ))
        .unwrap();
        let binding: OrganizationBinding =
            serde_json::from_value(fixture["binding"].clone()).unwrap();
        let request = OrganizationRequest {
            binding,
            media_type: fixture["media_type"].as_str().unwrap().into(),
        };
        let body = fixture["body_text"].as_str().unwrap().as_bytes();
        request.validate(body).unwrap();
        assert_ne!(request.binding.source_sha256, request.binding.input_sha256);
        assert_eq!(
            request.header_value().unwrap(),
            fixture["organization_header"].as_str().unwrap()
        );
        assert_eq!(
            String::from_utf8(request.canonical_bytes().unwrap()).unwrap(),
            fixture["canonical_payload_json"].as_str().unwrap()
        );
        assert_eq!(
            request.payload_sha256().unwrap(),
            fixture["payload_sha256"].as_str().unwrap()
        );

        let mut oversized = request.clone();
        oversized.binding.context.as_mut().unwrap()[0].excerpt = "é".repeat(129);
        assert!(oversized.validate(body).is_err());
        let mut duplicate = request.clone();
        let repeated = duplicate.binding.context.as_ref().unwrap()[0].clone();
        duplicate.binding.context.as_mut().unwrap().push(repeated);
        assert!(duplicate.validate(body).is_err());
    }

    #[test]
    fn ambiguous_consent_requires_requested_decision_and_exact_next_epoch() {
        let before = OrganizationCapability {
            schema_version: "1.0".into(),
            scope: "vault_intelligence".into(),
            purpose: "organize".into(),
            vault_id: Uuid::new_v4().to_string(),
            policy_version: "organize-v1|test".into(),
            provider: None,
            consent: "missing".into(),
            enabled: false,
            consent_epoch: 4,
            decided_at: None,
        };
        let mut enabled_but_unavailable = before.clone();
        enabled_but_unavailable.consent = "active".into();
        enabled_but_unavailable.consent_epoch = 5;
        // Availability is not the decision: active consent with disabled service is valid.
        assert!(requested_decision_proven(
            &before,
            &enabled_but_unavailable,
            true
        ));
        let mut unchanged = enabled_but_unavailable.clone();
        unchanged.consent_epoch = 4;
        assert!(!requested_decision_proven(&before, &unchanged, true));
        let mut later = enabled_but_unavailable.clone();
        later.consent_epoch = 6;
        assert!(!requested_decision_proven(&before, &later, true));
        assert!(!requested_decision_proven(
            &before,
            &enabled_but_unavailable,
            false
        ));
    }

    #[test]
    fn confirmed_enable_commits_future_only_marker_before_next_capture() {
        let root = std::env::temp_dir().join(format!("recall-organize-consent-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let before = vault
            .capture_text(&Uuid::new_v4().to_string(), "saved before opt-in")
            .unwrap();
        let connection = pairing::IntelligenceConnection::from_parts(
            vault.id.clone(),
            "https://synthetic.invalid".into(),
            "synthetic-secret".into(),
        );
        let server = OrganizationCapability {
            schema_version: "1.0".into(),
            scope: "vault_intelligence".into(),
            purpose: "organize".into(),
            vault_id: vault.id.clone(),
            policy_version: "organize-v1|synthetic".into(),
            provider: Some("anthropic".into()),
            consent: "active".into(),
            enabled: true,
            consent_epoch: 1,
            decided_at: Some("2026-10-09T12:00:00Z".into()),
        };

        let ready =
            commit_confirmed_consent(&vault, &connection, Some(&connection), server.clone(), true)
                .unwrap();
        assert!(ready.automatic_enabled);
        assert_eq!(ready.local_readiness, "ready");
        assert_eq!(vault.organization_operations(&before.id).unwrap().len(), 0);

        let replacement = pairing::IntelligenceConnection::from_parts(
            vault.id.clone(),
            "https://replacement.invalid".into(),
            "replacement-secret".into(),
        );
        let changed =
            commit_confirmed_consent(&vault, &connection, Some(&replacement), server, true)
                .unwrap();
        assert_eq!(changed.local_readiness, "unknown");
        assert!(!changed.automatic_enabled);
        assert_eq!(
            vault
                .organization_marker()
                .unwrap()
                .unwrap()
                .connection_fingerprint,
            connection.fingerprint
        );

        let after = vault
            .capture_text(&Uuid::new_v4().to_string(), "saved after opt-in")
            .unwrap();
        assert_eq!(
            vault.organization_operations(&after.id).unwrap()[0].state,
            "queued"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn delayed_receipt_or_capability_switch_prevents_post_callback_and_late_promotion() {
        use std::{cell::Cell, path::PathBuf};
        let root = std::env::temp_dir().join(format!("recall-organize-session-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let state = LocalVaultState::new(PathBuf::from(root.join("selection.json")));
        let first = state.select_path(&root).unwrap();
        let guard = state.session(first.vault_id.as_deref().unwrap()).unwrap();
        // This is the deliberate delayed-network boundary: selection changes before
        // the callback that would otherwise issue POST or journal promotion.
        state.select_path(&root).unwrap();
        let posted = Cell::new(false);
        assert!(post_if_selected(&guard, || {
            posted.set(true);
            Ok(())
        })
        .is_err());
        assert!(!posted.get());
        let promoted = Cell::new(false);
        assert!(guard
            .with(|_| {
                promoted.set(true);
                Ok(())
            })
            .is_err());
        assert!(!promoted.get());
        std::fs::remove_dir_all(root).unwrap();
    }
}
