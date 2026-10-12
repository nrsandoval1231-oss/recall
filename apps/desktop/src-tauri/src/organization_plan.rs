//! RCL-INT-001: untrusted model organization proposals must pass this boundary
//! before a separate, revision-aware native vault writer may publish them.
//! No filesystem writes, provider calls, or YAML serialization occur here.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 64 * 1024;
const MAX_LINKS: usize = 32;
const MAX_TAGS: usize = 16;
const MAX_EVIDENCE: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OrganizationProposal {
    pub schema_version: u32,
    pub source_id: String,
    pub source_sha256: String,
    pub expected_revision: u64,
    pub title: String,
    /// Folder category only, not a model-selected filesystem path.
    pub category: String,
    pub body: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub evidence: Vec<Evidence>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub excerpt: String,
    /// A proposal may describe a claim, but must never mark uncertain input verified.
    pub certainty: Certainty,
    pub source_reference: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Certainty {
    Reported,
    Uncertain,
    Unreadable,
}

fn safe_label(value: &str, max: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(|c| c.is_control())
        && !value.contains(['/', '\\', '<', '>', '|', '[', ']', '#', ':', '*', '?', '"'])
        && value != "."
        && value != ".."
}

pub fn validate(p: &OrganizationProposal, expected_source_id: &str, expected_sha: &str, revision: u64) -> Result<(), String> {
    if p.schema_version != 1 { return Err("unsupported organization schema".into()); }
    if p.source_id != expected_source_id || p.source_sha256 != expected_sha || p.expected_revision != revision {
        return Err("source or revision mismatch".into());
    }
    if p.source_sha256.len() != 64 || !p.source_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid source digest".into());
    }
    if !safe_label(&p.title, MAX_TITLE) { return Err("unsafe title".into()); }
    if !matches!(p.category.as_str(), "Meetings" | "Projects" | "People" | "Ideas" | "Reference" | "Inbox") {
        return Err("unapproved folder category".into());
    }
    if p.body.is_empty() || p.body.len() > MAX_BODY || p.body.contains('\0') {
        return Err("invalid note body".into());
    }
    if p.tags.len() > MAX_TAGS || p.tags.iter().any(|s| !safe_label(s, 48)) {
        return Err("invalid tags".into());
    }
    if p.links.len() > MAX_LINKS || p.links.iter().any(|s| !safe_label(s, MAX_TITLE)) {
        return Err("invalid wikilinks".into());
    }
    let mut unique = BTreeSet::new();
    for link in &p.links {
        if !unique.insert(link) { return Err("duplicate wikilink".into()); }
    }
    if p.evidence.is_empty() || p.evidence.len() > MAX_EVIDENCE {
        return Err("missing or excessive evidence".into());
    }
    for e in &p.evidence {
        if e.excerpt.trim().is_empty() || e.excerpt.len() > 2_000 || e.source_reference.trim().is_empty() || e.source_reference.len() > 200 {
            return Err("invalid evidence reference".into());
        }
        if e.source_reference != expected_source_id {
            return Err("evidence references another source".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> OrganizationProposal {
        OrganizationProposal {
            schema_version: 1,
            source_id: "capture-1".into(),
            source_sha256: "a".repeat(64),
            expected_revision: 1,
            title: "Permian Meeting".into(),
            category: "Meetings".into(),
            body: "Possible 5–10 MW? Follow up with Sarah. Not confirmed.".into(),
            tags: vec!["meeting".into()],
            links: vec!["Permian Power Expansion".into()],
            evidence: vec![Evidence { excerpt: "5–10 MW?".into(), certainty: Certainty::Uncertain, source_reference: "capture-1".into() }],
        }
    }
    fn check(p: &OrganizationProposal) -> Result<(), String> {
        validate(p, "capture-1", &"a".repeat(64), 1)
    }
    #[test] fn valid_proposal_is_accepted_without_publishing() { assert!(check(&sample()).is_ok()); }
    #[test] fn rejects_untrusted_folder() { let mut p=sample(); p.category="../Secrets".into(); assert!(check(&p).is_err()); }
    #[test] fn rejects_mismatched_source() { let mut p=sample(); p.source_id="other".into(); assert!(check(&p).is_err()); }
    #[test] fn rejects_stale_revision() { let mut p=sample(); p.expected_revision=0; assert!(check(&p).is_err()); }
    #[test] fn rejects_yaml_or_path_injection_in_title() { let mut p=sample(); p.title="Meeting: hacked".into(); assert!(check(&p).is_err()); }
    #[test] fn rejects_unsafe_wikilinks() { let mut p=sample(); p.links=vec!["../private".into()]; assert!(check(&p).is_err()); }
    #[test] fn rejects_unattributed_evidence() { let mut p=sample(); p.evidence[0].source_reference="other".into(); assert!(check(&p).is_err()); }
    #[test] fn rejects_model_verified_certainty_field() {
        let mut value=serde_json::to_value(sample()).unwrap();
        value["evidence"][0]["certainty"]=serde_json::json!("verified");
        assert!(serde_json::from_value::<OrganizationProposal>(value).is_err());
    }
    #[test] fn rejects_unknown_fields() {
        let mut value=serde_json::to_value(sample()).unwrap();
        value["arbitrary_path"]=serde_json::json!("/tmp/escape");
        assert!(serde_json::from_value::<OrganizationProposal>(value).is_err());
    }
}
