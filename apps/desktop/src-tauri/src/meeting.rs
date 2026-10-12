//! Closed Claude layout and native Markdown rendering: models never supply claims or paths.
use crate::{jev, local_vault::VaultMemory};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub schema_version: u8,
    pub title_span: Option<usize>,
    pub category: String,
    pub observations: Vec<usize>,
    pub follow_ups: Vec<usize>,
    pub questions: Vec<usize>,
    pub related_memory_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub id: String,
    pub revision: u64,
    pub excerpt: String,
}
pub fn context(memories: &[VaultMemory], source: &str) -> Vec<Context> {
    let words: BTreeSet<_> = source
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 3)
        .map(str::to_lowercase)
        .collect();
    let mut ranked: Vec<_> = memories
        .iter()
        .filter(|m| m.state == "active" && m.conflict.is_none())
        .map(|m| {
            (
                words
                    .iter()
                    .filter(|w| m.note.to_lowercase().contains(w.as_str()))
                    .count(),
                m,
            )
        })
        .filter(|(score, _)| *score > 0)
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.id.cmp(&b.1.id)));
    ranked
        .into_iter()
        .take(4)
        .map(|(_, m)| Context {
            id: m.id.clone(),
            revision: m.revision,
            excerpt: m.note.chars().take(600).collect(),
        })
        .collect()
}
pub fn validate(
    layout: &Layout,
    parsed: &jev::ParsedSource,
    context: &[Context],
) -> Result<(), String> {
    jev::validate_parsed(
        parsed,
        &parsed.source_id,
        &parsed.transcription,
        &parsed.source_sha256,
        &parsed.model,
    )?;
    if layout.schema_version != 1
        || !["meeting", "project", "operations"].contains(&layout.category.as_str())
        || layout
            .title_span
            .is_some_and(|n| n >= parsed.candidates.len() || parsed.candidates[n].span.retracted)
        || context.len() > 4
        || context.iter().any(|c| {
            uuid::Uuid::parse_str(&c.id).map_or(true, |id| id.to_string() != c.id)
                || c.excerpt.len() > 2400
                || c.revision == 0
        })
    {
        return Err("Invalid organization identity, title or category".into());
    }
    let mut spans = BTreeSet::new();
    for n in layout
        .observations
        .iter()
        .chain(&layout.follow_ups)
        .chain(&layout.questions)
    {
        if *n >= parsed.candidates.len() || !spans.insert(*n) {
            return Err("Duplicated or unsupported source span".into());
        }
    }
    if spans.len() != parsed.candidates.len() {
        return Err("Organization omitted source evidence".into());
    }
    let mut links = BTreeSet::new();
    for id in &layout.related_memory_ids {
        if id == &parsed.source_id || !context.iter().any(|c| &c.id == id) || !links.insert(id) {
            return Err("Unauthorized or duplicate related memory".into());
        }
    }
    Ok(())
}
fn yaml(value: &str) -> String {
    serde_json::to_string(value).expect("string JSON is valid YAML scalar")
}
fn escaped(value: &str) -> String {
    // Escape Markdown syntax and HTML. Sources remain exact in immutable evidence.
    value
        .chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '\n' => " ".into(),
            '\\' | '`' | '*' | '_' | '[' | ']' | '!' | '#' | '|' => format!("\\{c}"),
            _ => c.to_string(),
        })
        .collect()
}
pub fn render(
    layout: &Layout,
    parsed: &jev::ParsedSource,
    context: &[Context],
) -> Result<String, String> {
    validate(layout, parsed, context)?;
    if uuid::Uuid::parse_str(&parsed.source_id)
        .map_or(true, |id| id.to_string() != parsed.source_id)
    {
        return Err("Invalid native source UUID".into());
    }
    let title = layout
        .title_span
        .map(|n| {
            format!(
                "Meeting — {}",
                parsed.candidates[n]
                    .span
                    .text
                    .chars()
                    .take(100)
                    .collect::<String>()
            )
        })
        .unwrap_or_else(|| "Meeting notes".into());
    let mut out=format!("---\nrecall_id: {}\ntitle: {}\ntype: {}\nsource_sha256: {}\nparser_model: {}\nstatus: needs-review\ntags: [recall/meeting, recall/needs-review]\n---\n\n# {}\n\n",yaml(&parsed.source_id),yaml(&title),yaml(&layout.category),yaml(&parsed.source_sha256),yaml(&parsed.model),escaped(&title));
    let mut sections: [Vec<usize>; 4] = Default::default();
    for n in layout
        .observations
        .iter()
        .chain(&layout.follow_ups)
        .chain(&layout.questions)
    {
        let candidate = &parsed.candidates[*n];
        let section = if candidate.span.retracted {
            3
        } else if candidate.status == "needs_review" {
            2
        } else if layout.follow_ups.contains(n)
            && candidate
                .span
                .text
                .split_whitespace()
                .next()
                .is_some_and(|word| {
                    [
                        "call", "ask", "contact", "check", "confirm", "schedule", "follow",
                    ]
                    .contains(&word.to_lowercase().as_str())
                })
        {
            1
        } else if layout.questions.contains(n) {
            2
        } else {
            0
        };
        sections[section].push(*n);
    }
    for (index, label) in [
        "Observations (source statements)",
        "Follow-ups (not confirmed commitments)",
        "Open questions and uncertainty",
        "Retracted source statements (not facts)",
    ]
    .iter()
    .enumerate()
    {
        out.push_str(&format!("## {label}\n\n"));
        if sections[index].is_empty() {
            out.push_str("No source items.\n\n");
        }
        for n in &sections[index] {
            let span = &parsed.candidates[*n].span;
            out.push_str(&format!(
                "- {} “{}” — source bytes {}–{}\n",
                if index == 1 { "[ ]" } else { "" },
                escaped(&span.text),
                span.start,
                span.end
            ));
        }
        out.push('\n');
    }
    if !parsed.mentions.is_empty() {
        out.push_str("## Unresolved entity mentions\n\n");
        for m in &parsed.mentions {
            out.push_str(&format!(
                "- “{}” — {} candidate; identity unresolved{}\n",
                escaped(&m.span.text),
                escaped(&m.kind),
                if m.span.retracted { "; retracted" } else { "" }
            ));
        }
        out.push('\n');
    }
    out.push_str("## Related memories\n\n");
    for id in &layout.related_memory_ids {
        out.push_str(&format!("- [[Recall/Memories/{id}|Related source-backed memory]] (possible relationship; review)\n"));
    }
    out.push_str(&format!("\n## Original evidence\n\n[[Recall/Sources/{}.txt|Original meeting capture]]\n\nSHA-256: `{}`\n\nOrganization is derived from source statements. Estimates, identities and dates require review.\n",parsed.source_id,parsed.source_sha256));
    Ok(out)
}
pub fn tool_schema() -> serde_json::Value {
    serde_json::json!({"type":"object","additionalProperties":false,"required":["schema_version","title_span","category","observations","follow_ups","questions","related_memory_ids"],"properties":{
        "schema_version":{"type":"integer","enum":[1]},"title_span":{"type":["integer","null"],"minimum":0},"category":{"type":"string","enum":["meeting","project","operations"]},
        "observations":{"type":"array","maxItems":64,"items":{"type":"integer","minimum":0}},"follow_ups":{"type":"array","maxItems":64,"items":{"type":"integer","minimum":0}},"questions":{"type":"array","maxItems":64,"items":{"type":"integer","minimum":0}},"related_memory_ids":{"type":"array","maxItems":4,"items":{"type":"string"}}}})
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn parsed() -> jev::ParsedSource {
        let text="Brad says maybe 5–10 MW? Utility late. Call Sarah. Need generators by Dec? Prism doing electrical? Site access north? Ask operator about gas. Crossed out: 8 MW confirmed.";
        let spans = jev::candidates(text).unwrap();
        jev::ParsedSource {
            schema_version: 1,
            source_id: uuid::Uuid::new_v4().to_string(),
            source_sha256: hex::encode(Sha256::digest(text.as_bytes())),
            transcription: text.into(),
            legibility: "text_supplied_not_visually_verified".into(),
            model: "jev-1.13.0".into(),
            input_tokens: 100,
            output_tokens: 100,
            mentions: vec![],
            candidates: spans
                .into_iter()
                .map(|span| {
                    let kind = if span.retracted {
                        "conflict"
                    } else {
                        "observation"
                    };
                    jev::ParsedCandidate {
                        source_id: String::new(),
                        kind: kind.into(),
                        confidence: 0.9,
                        status: if span.retracted {
                            "retracted"
                        } else if span.uncertain {
                            "needs_review"
                        } else {
                            "candidate"
                        }
                        .into(),
                        probabilities: [
                            "observation",
                            "quantity",
                            "date",
                            "decision",
                            "possible_commitment",
                            "follow_up",
                            "question",
                            "conflict",
                            "other",
                        ]
                        .into_iter()
                        .map(|k| (k.into(), if k == kind { 1.0 } else { 0.0 }))
                        .collect(),
                        span,
                    }
                })
                .collect(),
        }
    }
    pub(crate) fn source() -> jev::ParsedSource {
        let mut p = parsed();
        for c in &mut p.candidates {
            c.source_id = p.source_id.clone();
        }
        p
    }
    fn layout(p: &jev::ParsedSource) -> Layout {
        Layout {
            schema_version: 1,
            title_span: Some(1),
            category: "meeting".into(),
            observations: vec![],
            follow_ups: (0..p.candidates.len()).collect(),
            questions: vec![],
            related_memory_ids: vec![],
        }
    }
    #[test]
    fn mandatory_note_preserves_uncertainty_and_retraction_even_when_model_files_everything_as_follow_up(
    ) {
        let p = source();
        let out = render(&layout(&p), &p, &[]).unwrap();
        assert!(out.starts_with("---\nrecall_id:"));
        assert!(out.contains("5–10 MW?"));
        assert!(out.contains("Need generators by Dec?"));
        let retracted = out
            .split("## Retracted source statements (not facts)")
            .nth(1)
            .unwrap();
        assert!(retracted.contains("Crossed out: 8 MW confirmed"));
        assert!(!out
            .split("## Retracted")
            .next()
            .unwrap()
            .contains("8 MW confirmed"));
        assert!(out.contains("Original meeting capture"));
        assert!(out.contains(&p.source_sha256));
    }
    #[test]
    fn omissions_duplicates_paths_and_unsupported_links_are_rejected() {
        let p = source();
        let mut l = layout(&p);
        l.follow_ups.pop();
        assert!(validate(&l, &p, &[]).is_err());
        let mut l = layout(&p);
        l.observations.push(0);
        assert!(validate(&l, &p, &[]).is_err());
        let mut l = layout(&p);
        l.category = "../../user".into();
        assert!(validate(&l, &p, &[]).is_err());
        let mut l = layout(&p);
        l.related_memory_ids.push(uuid::Uuid::new_v4().to_string());
        assert!(validate(&l, &p, &[]).is_err());
    }
    #[test]
    fn invented_properties_and_entities_cannot_enter_layout() {
        let p = source();
        let mut value = serde_json::to_value(layout(&p)).unwrap();
        value["confirmed_capacity"] = "8 MW".into();
        assert!(serde_json::from_value::<Layout>(value).is_err());
    }
    #[test]
    fn source_markdown_is_escaped() {
        assert_eq!(
            escaped("[[Person]] <script>!"),
            "\\[\\[Person\\]\\] &lt;script&gt;\\!"
        );
    }
}
