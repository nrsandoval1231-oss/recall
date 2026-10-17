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
    pub note_basename: String,
}
fn safe_target(value: &str) -> bool {
    value.ends_with(".md")
        && value.len() <= 255
        && value.len() > 3
        && !value.contains(['/', '\\', '[', ']', '#', '|'])
        && !value.chars().any(char::is_control)
}
fn connection_support<'a>(parsed: &'a jev::ParsedSource, target: &'a Context) -> Option<(&'a str, &'a str)> {
    for candidate in parsed.candidates.iter().filter(|c| !c.span.retracted) {
        for word in candidate.span.text.split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 3) {
            let word = word.to_lowercase();
            if ["this", "that", "with", "from", "have", "source", "memory", "notes", "review", "recall", "visual", "observation", "inferred"].contains(&word.as_str()) { continue; }
            if let Some(line) = target.excerpt.lines().find(|line| line.split(|c: char| !c.is_alphanumeric()).any(|token| token.to_lowercase() == word)) {
                return Some((&candidate.span.text, line));
            }
        }
    }
    None
}
pub fn context(memories: &[VaultMemory], source: &str) -> Vec<Context> {
    let words: BTreeSet<_> = source
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 3)
        .map(str::to_lowercase)
        .collect();
    let mut ranked: Vec<_> = memories
        .iter()
        .filter(|m| {
            m.state == "active"
                && m.conflict.is_none()
                && m.note_path.as_deref().is_some_and(safe_target)
        })
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
            note_basename: m.note_path.clone().expect("filtered native note path"),
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
    if ![1, 2, 3].contains(&layout.schema_version)
        || !["note", "photo", "meeting", "project", "operations"].contains(&layout.category.as_str())
        || layout
            .title_span
            .is_some_and(|n| n >= parsed.candidates.len() || parsed.candidates[n].span.retracted)
        || context.len() > 4
        || context.iter().any(|c| {
            uuid::Uuid::parse_str(&c.id).map_or(true, |id| id.to_string() != c.id)
                || c.excerpt.len() > 2400
                || c.revision == 0
                || !safe_target(&c.note_basename)
        })
    {
        return Err("Invalid organization identity, title or category".into());
    }
    if layout.schema_version >= 3 && layout.category == "meeting" && parsed.transcription.starts_with("Visual observation (inferred):") && !["meeting", "agenda", "minutes", "attendees"].iter().any(|word| parsed.transcription.to_lowercase().contains(word)) {
        return Err("A general visual observation cannot be forced into a meeting".into());
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
        if layout.schema_version >= 3 && !context.iter().find(|c| &c.id == id).is_some_and(|target| connection_support(parsed, target).is_some()) {
            return Err("Related memory has no shared source evidence".into());
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
    let title = if layout.schema_version < 3 {
        layout.title_span.map(|n| format!("Meeting — {}", parsed.candidates[n].span.text.chars().take(100).collect::<String>()))
            .unwrap_or_else(|| "Meeting notes".into())
    } else {
        layout.title_span.or_else(|| parsed.candidates.iter().position(|candidate| !candidate.span.retracted))
            .map(|n| parsed.candidates[n].span.text.chars().take(100).collect::<String>())
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| match layout.category.as_str() {
                "photo" => "Photo memory".into(),
                "meeting" => "Meeting notes".into(),
                _ => "Untitled memory".into(),
            })
    };
    let tag_category = if layout.schema_version < 3 { "meeting" } else { &layout.category };
    let mut out=format!("---\nrecall_id: {}\ntitle: {}\ntype: {}\nsource_sha256: {}\nparser_model: {}\nstatus: needs-review\ntags: [recall/{}, recall/needs-review]\n---\n\n# {}\n\n",yaml(&parsed.source_id),yaml(&title),yaml(&layout.category),yaml(&parsed.source_sha256),yaml(&parsed.model),tag_category,escaped(&title));
    if layout.schema_version >= 3 {
        let summary = parsed.candidates.iter().filter(|c| !c.span.retracted).take(2)
            .map(|c| c.span.text.as_str()).collect::<Vec<_>>().join(" ").chars().take(400).collect::<String>();
        out = out.replacen(&format!("title: {}\n", yaml(&title)), &format!("title: {}\nsummary: {}\n", yaml(&title), yaml(&summary)), 1);
        let mut tags = vec![format!("recall/{}", layout.category), "recall/needs-review".into()];
        for mention in parsed.mentions.iter().filter(|m| !m.span.retracted).take(6) {
            let tag = mention.span.text.to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').take(60).collect::<String>();
            if !tag.is_empty() && !tags.contains(&tag) { tags.push(tag); }
        }
        out = out.replacen(&format!("tags: [recall/{}, recall/needs-review]", layout.category), &format!("tags: {}", serde_json::to_string(&tags).map_err(|_| "Invalid tags")?), 1);
        let heading = format!("# {}\n\n", escaped(&title));
        out = out.replacen(&heading, &format!("{heading}{}\n\nAI interpretation — proposal for review.\n\n", escaped(&summary)), 1);
    }
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
        } else if (layout.schema_version >= 2 || layout.follow_ups.contains(n))
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
        let target = &context
            .iter()
            .find(|c| &c.id == id)
            .expect("validated native context")
            .note_basename;
        out.push_str(&format!("- [[Recall/Memories/{}|Related source-backed memory]] (possible relationship; review)\n",target.strip_suffix(".md").expect("validated native basename")));
        if layout.schema_version >= 3 {
            let related = context.iter().find(|c| &c.id == id).expect("validated context");
            if let Some((source, target)) = connection_support(parsed, related) {
                out.push_str(&format!("  Shared source wording: “{}” ↔ “{}” (target revision {}; suggestion only).\n", escaped(source), escaped(target), related.revision));
            }
        }
    }
    out.push_str(&format!("\n## Original evidence\n\n[[Recall/Sources/{}.txt|Original meeting capture]]\n\nSHA-256: `{}`\n\nOrganization is derived from source statements. Estimates, identities and dates require review.\n",parsed.source_id,parsed.source_sha256));
    Ok(out)
}
pub(crate) fn render_for_evidence(
    layout: &Layout,
    parsed: &jev::ParsedSource,
    context: &[Context],
    original_sha: &str,
    visual: Option<&crate::processing::VisualEvidence>,
) -> Result<String, String> {
    let mut document = render(layout, parsed, context)?;
    if let Some(visual) = visual {
        let extension = match visual.mime_type.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => return Err("Unsupported original visual MIME".into()),
        };
        let suffix = visual
            .transcript_basename
            .strip_prefix(&format!("{}-", parsed.source_id))
            .and_then(|v| v.strip_suffix(".txt"))
            .ok_or("Invalid native transcript basename")?;
        if uuid::Uuid::parse_str(suffix).map_or(true, |id| id.to_string() != suffix)
            || original_sha.len() != 64
            || !original_sha.bytes().all(|b| b.is_ascii_hexdigit())
            || visual.transcription_sha256 != parsed.source_sha256
        {
            return Err("Invalid native visual evidence identity".into());
        }
        document=document.replacen(&format!("source_sha256: {}\n",yaml(&parsed.source_sha256)),&format!("source_sha256: {}\ntranscription_sha256: {}\nvisual_status: unreviewed\ntranscription_model: {}\n",yaml(original_sha),yaml(&visual.transcription_sha256),yaml(&visual.reader_model)),1);
        document=document.replace(&format!("[[Recall/Sources/{}.txt|Original meeting capture]]",parsed.source_id),&format!("[[Recall/Sources/{}.{extension}|Original photo]]\n\n[[Recall/Sources/{}|Unreviewed machine transcription]]",parsed.source_id,visual.transcript_basename));
        document = document.replace(
            &format!("SHA-256: `{}`", parsed.source_sha256),
            &format!(
                "Original photo SHA-256: `{original_sha}`\n\nTranscription SHA-256: `{}`",
                visual.transcription_sha256
            ),
        );
        let mut review="## Visual transcription review\n\nAll quoted text below is an unreviewed machine reading of the original photo. No visual accuracy is claimed. Inspect the original before treating any item as established.\n\n".to_string();
        for uncertainty in &visual.uncertainties {
            review.push_str(&format!("- {}\n", escaped(uncertainty)));
        }
        review.push_str("\n## Observations (source statements)");
        document = document.replacen("## Observations (source statements)", &review, 1);
    } else if original_sha != parsed.source_sha256 {
        return Err("Text original identity mismatch".into());
    }
    Ok(document)
}
pub(crate) fn evidence_for_source(
    parsed: &jev::ParsedSource,
    context: &[Context],
    original_sha: &str,
    visual: Option<&crate::processing::VisualEvidence>,
) -> serde_json::Value {
    let mut value = evidence(parsed, context);
    if original_sha != parsed.source_sha256 {
        value["original_source_sha256"] = original_sha.into();
        value["visual_status"] = "unreviewed_transcription".into();
    }
    if let Some(visual) = visual {
        value["visual_evidence"] = serde_json::json!({"status":"unreviewed","human_review_required":true,"reader_model":visual.reader_model,"uncertainties":visual.uncertainties,"mime_type":visual.mime_type,"transcription_sha256":visual.transcription_sha256});
    }
    value
}
pub(crate) fn evidence(parsed: &jev::ParsedSource, context: &[Context]) -> serde_json::Value {
    serde_json::json!({"source_id":parsed.source_id,"source_sha256":parsed.source_sha256,
        "spans":parsed.candidates.iter().enumerate().map(|(id,c)|serde_json::json!({"id":id,"text":c.span.text,"kind":c.kind,"status":c.status})).collect::<Vec<_>>(),
        "unresolved_mentions":parsed.mentions,"existing_memories":context})
}
pub fn tool_schema() -> serde_json::Value {
    serde_json::json!({"type":"object","additionalProperties":false,"required":["schema_version","title_span","category","observations","follow_ups","questions","related_memory_ids"],"properties":{
        "schema_version":{"type":"integer","enum":[3]},"title_span":{"type":["integer","null"],"minimum":0},"category":{"type":"string","enum":["note","photo","meeting","project","operations"]},
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
        assert!(out.contains("- [ ] “Call Sarah."));
        assert!(out.contains("- [ ] “Ask operator about gas."));
        assert!(out.contains(&p.source_sha256));
    }
    #[test]
    fn provider_schema_uses_current_renderer_contract() {
        assert_eq!(
            tool_schema()["properties"]["schema_version"]["enum"],
            serde_json::json!([3])
        );
    }
    #[test]
    fn generic_photo_uses_source_title_and_photo_type() {
        let p = source();
        let mut l = layout(&p);
        l.schema_version = 3;
        l.category = "photo".into();
        l.title_span = None;
        let out = render(&l, &p, &[]).unwrap();
        assert!(out.contains("type: \"photo\""));
        assert!(out.contains("tags: [\"recall/photo\",\"recall/needs-review\"]"));
        assert!(out.contains("# Brad says maybe 5–10 MW?"));
        assert!(!out.contains("Meeting -"));
    }
    #[test]
    fn title_fallback_skips_retracted_source_spans() {
        let p = source();
        let mut l = layout(&p);
        l.schema_version = 3;
        l.title_span = None;
        let out = render(&l, &p, &[]).unwrap();
        assert!(!out.contains("# Crossed out:"));
    }
    #[test]
    fn explicit_source_actions_survive_model_section_misclassification() {
        let p = source();
        let mut l = layout(&p);
        l.schema_version = 2;
        l.observations = std::mem::take(&mut l.follow_ups);
        let out = render(&l, &p, &[]).unwrap();
        assert!(out.contains("- [ ] “Call Sarah."));
        assert!(out.contains("- [ ] “Ask operator about gas."));
        assert!(!out
            .split("## Open questions")
            .next()
            .unwrap()
            .contains("Need generators by Dec?"));
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
    fn current_connection_suggestions_require_visible_source_and_target_support() {
        let source = source(); let mut plan = layout(&source); plan.schema_version = 3;
        let mut target = Context { id: uuid::Uuid::new_v4().to_string(), revision: 2, excerpt: "Unrelated blue sphere.".into(), note_basename: "synthetic.md".into() };
        plan.related_memory_ids = vec![target.id.clone()];
        assert!(validate(&plan, &source, &[target.clone()]).is_err());
        target.excerpt = "Utility delay in the synthetic source.".into();
        let note = render(&plan, &source, &[target]).unwrap();
        assert!(note.contains("Shared source wording:")); assert!(note.contains("target revision 2"));
        assert!(note.contains("possible relationship; review"));
    }
    #[test]
    fn source_markdown_is_escaped() {
        assert_eq!(
            escaped("[[Person]] <script>!"),
            "\\[\\[Person\\]\\] &lt;script&gt;\\!"
        );
    }
}
