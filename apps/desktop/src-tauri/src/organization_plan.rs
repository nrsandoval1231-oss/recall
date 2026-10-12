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
    Retracted,
}

fn safe_label(value: &str, max: usize) -> bool {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    !reserved
        && !value.ends_with('.')
        && !value.trim().is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(|c| c.is_control())
        && !value.contains(['/', '\\', '<', '>', '|', '[', ']', '#', ':', '*', '?', '"'])
        && value != "."
        && value != ".."
}

pub fn validate(
    p: &OrganizationProposal,
    expected_source_id: &str,
    expected_sha: &str,
    revision: u64,
) -> Result<(), String> {
    if p.schema_version != 1 {
        return Err("unsupported organization schema".into());
    }
    if p.source_id != expected_source_id
        || p.source_sha256 != expected_sha
        || p.expected_revision != revision
    {
        return Err("source or revision mismatch".into());
    }
    if p.source_sha256.len() != 64 || !p.source_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid source digest".into());
    }
    if !safe_label(&p.title, MAX_TITLE) {
        return Err("unsafe title".into());
    }
    if !matches!(
        p.category.as_str(),
        "Meetings" | "Projects" | "People" | "Ideas" | "Reference" | "Inbox"
    ) {
        return Err("unapproved folder category".into());
    }
    if p.body.is_empty() || p.body.len() > MAX_BODY || p.body.contains('\0') {
        return Err("invalid note body".into());
    }
    // Only native, explicitly declared wikilinks are permitted. Arbitrary HTML,
    // Markdown destinations and embeds can load remote content in Obsidian.
    let body_links = p.body.replace("- [ ] ", "- ").replace("- [x] ", "- ");
    let mut remaining = body_links.as_str();
    while let Some(start) = remaining.find("[[") {
        if remaining[..start].contains(['[', ']']) || remaining[..start].ends_with('!') {
            return Err("unsupported body link".into());
        }
        let tail = &remaining[start + 2..];
        let end = tail.find("]]").ok_or("unterminated wikilink")?;
        let target = &tail[..end];
        if !safe_label(target, MAX_TITLE) || !p.links.iter().any(|link| link == target) {
            return Err("undeclared or unsafe body wikilink".into());
        }
        remaining = &tail[end + 2..];
    }
    if remaining.contains(['[', ']']) || p.body.contains(['<', '>']) {
        return Err("unsupported body markup".into());
    }
    if p.tags.len() > MAX_TAGS || p.tags.iter().any(|s| !safe_label(s, 48)) {
        return Err("invalid tags".into());
    }
    if p.links.len() > MAX_LINKS || p.links.iter().any(|s| !safe_label(s, MAX_TITLE)) {
        return Err("invalid wikilinks".into());
    }
    let mut unique = BTreeSet::new();
    for link in &p.links {
        if !unique.insert(link.to_lowercase()) {
            return Err("duplicate wikilink".into());
        }
    }
    if p.evidence.is_empty() || p.evidence.len() > MAX_EVIDENCE {
        return Err("missing or excessive evidence".into());
    }
    for e in &p.evidence {
        if e.excerpt.trim().is_empty()
            || e.excerpt.len() > 2_000
            || e.source_reference.trim().is_empty()
            || e.source_reference.len() > 200
        {
            return Err("invalid evidence reference".into());
        }
        if e.source_reference != expected_source_id {
            return Err("evidence references another source".into());
        }
    }
    Ok(())
}

/// Checks provenance against caller-supplied, hash-verified transcription.
/// Does not prove free-form body entailment; publication requires a separate
/// structured-claim boundary. A photo transcription is still interpretation.
pub fn validate_grounded(
    p: &OrganizationProposal,
    source_id: &str,
    sha: &str,
    revision: u64,
    source_text: &str,
) -> Result<(), String> {
    validate(p, source_id, sha, revision)?;
    if source_text.is_empty() || source_text.len() > MAX_BODY {
        return Err("invalid trusted transcription".into());
    }
    for evidence in &p.evidence {
        let contexts: Vec<&str> = source_text
            .split(['.', ';'])
            .filter(|span| span.contains(&evidence.excerpt))
            .collect();
        if contexts.is_empty() {
            return Err("excerpt not present in trusted source".into());
        }
        for context in &contexts {
            let lower = context.to_lowercase();
            if lower.contains("crossed out")
                || lower.contains("crossed-out")
                || lower.contains("~~")
            {
                if evidence.certainty != Certainty::Retracted
                    || !evidence.excerpt.contains(context.trim())
                {
                    return Err("retracted context must remain explicit".into());
                }
            } else if (context.contains('?')
                || lower.contains("maybe")
                || lower.contains("possible")
                || lower.contains("unclear")
                || contexts.len() > 1)
                && evidence.certainty == Certainty::Reported
            {
                return Err("uncertain source cannot become reported evidence".into());
            }
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
            evidence: vec![Evidence {
                excerpt: "5–10 MW?".into(),
                certainty: Certainty::Uncertain,
                source_reference: "capture-1".into(),
            }],
        }
    }
    fn check(p: &OrganizationProposal) -> Result<(), String> {
        validate(p, "capture-1", &"a".repeat(64), 1)
    }
    #[test]
    fn valid_proposal_is_accepted_without_publishing() {
        assert!(check(&sample()).is_ok());
    }
    #[test]
    fn rejects_untrusted_folder() {
        let mut p = sample();
        p.category = "../Secrets".into();
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_mismatched_source() {
        let mut p = sample();
        p.source_id = "other".into();
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_stale_revision() {
        let mut p = sample();
        p.expected_revision = 0;
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_yaml_or_path_injection_in_title() {
        let mut p = sample();
        p.title = "Meeting: hacked".into();
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_unsafe_wikilinks() {
        let mut p = sample();
        p.links = vec!["../private".into()];
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_unattributed_evidence() {
        let mut p = sample();
        p.evidence[0].source_reference = "other".into();
        assert!(check(&p).is_err());
    }
    #[test]
    fn rejects_model_verified_certainty_field() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["evidence"][0]["certainty"] = serde_json::json!("verified");
        assert!(serde_json::from_value::<OrganizationProposal>(value).is_err());
    }
    #[test]
    fn rejects_unknown_fields() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["arbitrary_path"] = serde_json::json!("/tmp/escape");
        assert!(serde_json::from_value::<OrganizationProposal>(value).is_err());
    }
    #[test]
    fn rejects_windows_device_and_normalized_names() {
        for title in ["CON", "nul.txt", "LPT1", "Meeting.", "COM9.md"] {
            let mut p = sample();
            p.title = title.into();
            assert!(check(&p).is_err(), "accepted {title}");
        }
    }
    #[test]
    fn rejects_body_links_outside_declared_links() {
        for body in [
            "[[../Secrets]]",
            "[[Unknown person]]",
            "[click](file:///private)",
            "<img src=https://example.org/pixel>",
        ] {
            let mut p = sample();
            p.body = body.into();
            assert!(check(&p).is_err(), "accepted {body}");
        }
    }
    #[test]
    fn rejects_duplicate_case_insensitive_targets() {
        let mut p = sample();
        p.links = vec!["Sarah".into(), "sarah".into()];
        assert!(check(&p).is_err());
    }
    #[test]
    fn accepts_declared_native_link() {
        let mut p = sample();
        p.body = "Related [[Permian Power Expansion]]".into();
        assert!(check(&p).is_ok());
    }

    #[test]
    fn grounded_validation_rejects_fabricated_excerpt() {
        let mut p = sample();
        p.evidence[0].excerpt = "8 MW confirmed".into();
        assert!(validate_grounded(
            &p,
            "capture-1",
            &"a".repeat(64),
            1,
            "Brad says maybe 5–10 MW?"
        )
        .is_err());
    }
    #[test]
    fn grounded_validation_preserves_uncertainty() {
        let mut p = sample();
        p.evidence[0].certainty = Certainty::Reported;
        assert!(validate_grounded(
            &p,
            "capture-1",
            &"a".repeat(64),
            1,
            "Brad says maybe 5–10 MW?"
        )
        .is_err());
    }
    #[test]
    fn grounded_validation_preserves_retracted_context() {
        let mut p = sample();
        p.evidence[0].excerpt = "8 MW confirmed".into();
        assert!(validate_grounded(
            &p,
            "capture-1",
            &"a".repeat(64),
            1,
            "Crossed out: 8 MW confirmed."
        )
        .is_err());
    }
    #[test]
    fn preserves_multiline_retraction() {
        let mut p = sample();
        p.evidence[0].excerpt = "8 MW confirmed".into();
        p.evidence[0].certainty = Certainty::Reported;
        assert!(validate_grounded(
            &p,
            "capture-1",
            &"a".repeat(64),
            1,
            "Crossed out:\n8 MW confirmed."
        )
        .is_err());
    }
}
