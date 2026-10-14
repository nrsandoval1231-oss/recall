//! Rebuildable local lexical and explicit-link retrieval. No generated factual claims.
use crate::local_vault::{Vault, VaultMemory};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Serialize)]
pub struct Hit {
    pub memory_id: String,
    pub revision: u64,
    pub note_basename: String,
    pub current_excerpt: String,
    pub original_excerpt: String,
    pub source_sha256: String,
    pub mime_type: String,
    pub match_reason: String,
    pub linked_from_memory_id: Option<String>,
    pub original_start_byte: Option<usize>,
    pub original_end_byte: Option<usize>,
    pub captured_at: String,
    pub updated_at: String,
    pub human_corrected: bool,
}
#[derive(Debug, Serialize)]
pub struct Answer {
    pub question: String,
    pub message: String,
    pub hits: Vec<Hit>,
}
fn words(text: &str) -> Vec<(usize, String)> {
    let mut result = Vec::new();
    let mut start = None;
    for (offset, character) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if character.is_alphanumeric() {
            start.get_or_insert(offset);
        } else if let Some(begin) = start.take() {
            result.push((begin, text[begin..offset].to_lowercase()));
        }
    }
    result
}
fn terms(question: &str) -> BTreeSet<String> {
    let ignored = [
        "what", "that", "with", "about", "going", "there", "this", "were", "when", "have", "does",
        "which", "would", "could", "please", "recall", "tell", "from", "happened", "can", "you",
        "the", "for", "and", "was", "who", "how", "did", "are", "remember", "notes", "note",
        "memory", "memories", "on", "in", "of", "is", "it", "to", "do", "we", "be", "by", "an",
        "as", "at", "if", "or", "so", "up", "me", "my", "he", "she", "her", "his", "our",
    ];
    let mut terms: BTreeSet<_> = words(question)
        .into_iter()
        .map(|(_, word)| word)
        .filter(|word| {
            (word.chars().count() >= 2 || word.chars().all(char::is_numeric))
                && !ignored.contains(&word.as_str())
        })
        .collect();
    if terms
        .iter()
        .any(|w| ["delay", "delayed", "late"].contains(&w.as_str()))
    {
        terms.extend(["delay", "delayed", "late"].into_iter().map(str::to_owned));
    }
    terms
}
fn body(memory: &VaultMemory) -> &str {
    let marker = format!("---\nrecall_id: \"{}\"\n", memory.id);
    if memory.note.starts_with(&marker) {
        if let Some(end) = memory.note.find("\n---\n") {
            return &memory.note[end + 5..];
        }
    }
    &memory.note
}
// A verbatim, UTF-8-safe window near the most informative matching word.
// Offsets refer to the saved original's bytes, never to a normalized copy.
fn excerpt(text: &str, weights: &BTreeMap<String, f64>) -> (String, usize, usize) {
    let mut anchor = 0;
    let mut best = 0.0;
    for (offset, word) in words(text) {
        let weight = weights.get(&word).copied().unwrap_or(0.0);
        if weight > best {
            best = weight;
            anchor = offset;
        }
    }
    let boundaries: Vec<_> = text
        .char_indices()
        .map(|(offset, _)| offset)
        .chain(std::iter::once(text.len()))
        .collect();
    let position = boundaries.binary_search(&anchor).unwrap_or(0);
    let mut start = position.saturating_sub(200);
    let earliest = start.saturating_sub(40);
    // Prefer an entire word at the beginning without exceeding the window bound.
    while start > earliest && !text[boundaries[start]..].starts_with(char::is_whitespace) {
        start -= 1;
    }
    let end = (start + 1200).min(boundaries.len() - 1);
    let (start, end) = (boundaries[start], boundaries[end]);
    (text[start..end].to_owned(), start, end)
}
fn linked_paths(note: &str) -> BTreeSet<String> {
    note.split("[[Recall/Memories/")
        .skip(1)
        .filter_map(|part| {
            let (inside, _) = part.split_once("]]")?;
            let name = inside.split('|').next()?;
            if name.is_empty() || name.contains(['/', '\\', '\n', '\r', '[', '#']) {
                return None;
            }
            Some(format!("{}.md", name.strip_suffix(".md").unwrap_or(name)))
        })
        .collect()
}
fn hit(
    vault: &Vault,
    memory: &VaultMemory,
    weights: &BTreeMap<String, f64>,
    linked_from: Option<&VaultMemory>,
) -> Result<(Hit, VaultMemory), String> {
    let snapshot = vault.processing_snapshot(&memory.id, memory.revision)?;
    let memory = snapshot.memory;
    let (original_excerpt, original_start_byte, original_end_byte) = if snapshot.source.mime_type
        == "text/plain"
    {
        let text = std::str::from_utf8(&snapshot.source.bytes)
            .map_err(|_| "Original text is not UTF-8")?;
        let (quote, start, end) = excerpt(text, weights);
        (quote, Some(start), Some(end))
    } else {
        ("Original photo available for inspection; no unverified transcription is presented as source text.".into(), None, None)
    };
    let result = Hit {
        memory_id: memory.id.clone(), revision: memory.revision,
        note_basename: memory.note_path.clone().ok_or("Missing note destination")?,
        current_excerpt: excerpt(body(&memory), weights).0, original_excerpt,
        source_sha256: snapshot.source.sha256, mime_type: snapshot.source.mime_type,
        match_reason: linked_from.map(|source| format!("Linked context, not a direct wording match. Explicit saved link in {} at revision {}; relationship requires review.", source.note_path.as_deref().unwrap_or("source note"), source.revision))
            .unwrap_or_else(|| {
                if words(body(&memory)).iter().any(|(_, word)| weights.contains_key(word)) {
                    "Wording match in the current saved note. Review original evidence and corrections.".into()
                } else {
                    "Filename match in the saved source or note name. Filename metadata is not original evidence text; inspect the original and current note.".into()
                }
            }),
        linked_from_memory_id: linked_from.map(|source| source.id.clone()),
        original_start_byte, original_end_byte,
        captured_at: memory.captured_at.clone(), updated_at: memory.updated_at.clone(),
        human_corrected: snapshot.human_corrected,
    };
    Ok((result, memory))
}
pub fn ask(vault: &Vault, question: &str) -> Result<Answer, String> {
    if question.trim().is_empty() || question.len() > 4096 {
        return Err("Ask a bounded memory question".into());
    }
    let terms = terms(question);
    let records: Vec<_> = vault
        .list_with_deleted("", false)?
        .into_iter()
        .filter(|memory| memory.state == "active" && memory.conflict.is_none())
        .collect();
    // This projection is rebuilt from eligible portable records on every request;
    // edits, corrections and deletion cannot leave a stale persisted search index.
    let documents: Vec<Vec<_>> = records.iter().map(|memory| {
        let mut document = words(body(memory));
        document.extend(words(&memory.source_name));
        document.extend(words(memory.note_path.as_deref().unwrap_or("")));
        document
    }).collect();
    let count = documents.len() as f64;
    let average = (documents.iter().map(Vec::len).sum::<usize>() as f64 / count.max(1.0)).max(1.0);
    let weights: BTreeMap<_, _> = terms
        .iter()
        .map(|term| {
            let frequency = documents
                .iter()
                .filter(|words| words.iter().any(|(_, word)| word == term))
                .count() as f64;
            (
                term.clone(),
                (1.0 + (count - frequency + 0.5) / (frequency + 0.5)).ln(),
            )
        })
        .collect();
    let mut ranked: Vec<_> = documents
        .iter()
        .enumerate()
        .filter_map(|(index, document)| {
            let score: f64 = weights
                .iter()
                .map(|(term, weight)| {
                    let frequency = document.iter().filter(|(_, word)| word == term).count() as f64;
                    weight * frequency * 2.2
                        / (frequency + 1.2 * (0.25 + 0.75 * document.len() as f64 / average))
                })
                .sum();
            (score > 0.0).then_some((index, score))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then(records[a.0].id.cmp(&records[b.0].id))
    });
    let mut hits = Vec::new();
    let mut verified = Vec::new();
    let mut unavailable = 0;
    for (index, _) in ranked.into_iter().take(20) {
        match hit(vault, &records[index], &weights, None) {
            Ok((result, memory)) => {
                hits.push(result);
                verified.push(memory);
            }
            Err(_) => unavailable += 1,
        }
        if hits.len() == 3 {
            break;
        }
    }
    let mut seen: BTreeSet<_> = hits.iter().map(|hit| hit.memory_id.clone()).collect();
    for source in &verified {
        for path in linked_paths(body(source)) {
            if hits.len() >= 5 {
                break;
            }
            if let Some(target) = records
                .iter()
                .find(|memory| memory.note_path.as_deref() == Some(&path))
            {
                if !seen.insert(target.id.clone()) {
                    continue;
                }
                match hit(vault, target, &weights, Some(source)) {
                    Ok((result, _)) => hits.push(result),
                    Err(_) => unavailable += 1,
                }
            }
        }
    }
    let mut message = if hits.is_empty() {
        "No eligible local memory matched this wording. Try a person, place or distinctive phrase."
    } else {
        "Local keyword and saved-link retrieval. These are source excerpts, not a generated answer. Linked context is labeled separately; a newer revision does not establish a truer claim."
    }.to_string();
    if unavailable > 0 {
        message.push_str(" Some matching evidence changed or could not be verified and was withheld. Refresh or inspect library health.");
    }
    Ok(Answer {
        question: question.into(),
        message,
        hits,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vague_delay_question_retrieves_persisted_meeting_and_original() {
        use crate::librarian::organization_tests as fixture;
        let (t, v, parser, memory) = fixture::setup();
        let organization = uuid::Uuid::new_v4().to_string();
        crate::librarian::organize_selected(
            &v,
            &fixture::config(),
            &parser,
            &organization,
            true,
            &fixture::claude(),
        )
        .unwrap();
        v.publish_meeting(&parser, &organization, &uuid::Uuid::new_v4().to_string())
            .unwrap();
        let answer = ask(
            &Vault::open(&t.0).unwrap(),
            "What was going on with that utility delay?",
        )
        .unwrap();
        assert_eq!(answer.hits.len(), 1);
        assert_eq!(answer.hits[0].memory_id, memory);
        assert_eq!(answer.hits[0].revision, 2);
        assert!(answer.hits[0].original_excerpt.contains("Utility late."));
        assert!(answer.hits[0]
            .original_excerpt
            .contains("Crossed out: 8 MW confirmed."));
        assert_eq!(
            answer.hits[0].source_sha256,
            v.source(&memory).unwrap().sha256
        );
    }
    #[test]
    fn empty_unrelated_questions_do_not_invent_answers() {
        use crate::librarian::organization_tests as fixture;
        let (_t, v, _, _) = fixture::setup();
        assert!(ask(&v, " ").is_err());
        assert!(ask(&v, "unrelated zebras").unwrap().hits.is_empty());
    }
}

#[cfg(test)]
mod native_retrieval_tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn source_filename_lookup_survives_restart_without_inventing_source_text() {
        let (temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        let bytes = b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY";
        vault.capture(&id, "orchidledger.png", bytes, "Synthetic ordinary handwritten note.").unwrap();
        let reopened = Vault::open(&temp.0).unwrap();
        assert!(reopened.list("orchidledger.png").unwrap().iter().any(|m| m.id == id));
        let answer = ask(&reopened, "orchidledger.png").unwrap();
        let hit = answer.hits.first().expect("filename lookup should find the original");
        assert_eq!(hit.memory_id, id);
        assert!(hit.match_reason.contains("Filename match"));
        assert!(!hit.original_excerpt.contains("orchidledger"));
        assert!(hit.original_start_byte.is_none());
        assert_eq!(reopened.source(&id).unwrap().bytes, bytes);
    }

    #[test]
    fn note_basename_lookup_preserves_verbatim_original_after_restart() {
        let (temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        let original = "Synthetic ordinary text with no filename in its content.";
        let memory = vault.capture_note(&id, original).unwrap();
        let basename = memory.note_path.unwrap();
        let reopened = Vault::open(&temp.0).unwrap();
        let answer = ask(&reopened, &basename).unwrap();
        let hit = answer.hits.first().expect("note basename should remain searchable");
        assert_eq!(hit.memory_id, id);
        assert!(hit.match_reason.contains("Filename match"));
        assert_eq!(hit.original_excerpt, original);
        assert_eq!(hit.original_start_byte, Some(0));
        assert_eq!(hit.original_end_byte, Some(original.len()));
    }

    #[test]
    fn matching_passage_is_visible_beyond_the_first_twelve_hundred_characters() {
        let (_temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        let text = format!(
            "{}\nSynthetic: café rendezvous moved to Thursday; not confirmed.\n{}",
            "Unrelated preamble. ".repeat(180),
            "Unrelated ending. ".repeat(100)
        );
        vault.capture_note(&id, &text).unwrap();
        let answer = ask(&vault, "What about that café rendezvous?").unwrap();
        let hit = answer.hits.iter().find(|hit| hit.memory_id == id).unwrap();
        assert!(hit
            .current_excerpt
            .contains("café rendezvous moved to Thursday; not confirmed."));
        assert!(hit
            .original_excerpt
            .contains("café rendezvous moved to Thursday; not confirmed."));
        assert!(text.contains(&hit.original_excerpt));
        assert!(hit.original_excerpt.chars().count() <= 1200);
    }

    #[test]
    fn explicit_saved_links_supply_separately_inspectable_context_after_restart() {
        let (temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let target_id = Uuid::new_v4().to_string();
        let target = vault
            .capture_note(&target_id, "Synthetic: the proposed date was withdrawn.")
            .unwrap();
        let source_id = Uuid::new_v4().to_string();
        vault
            .capture_note(
                &source_id,
                &format!(
                    "Synthetic: remember zephyr permits.\n[[Recall/Memories/{}|Earlier context]]",
                    target.note_path.unwrap().trim_end_matches(".md")
                ),
            )
            .unwrap();
        let answer = ask(&Vault::open(&temp.0).unwrap(), "zephyr permits").unwrap();
        assert_eq!(answer.hits[0].memory_id, source_id);
        assert!(answer.hits.iter().any(|hit| hit.memory_id == target_id));
        assert!(answer
            .hits
            .iter()
            .find(|hit| hit.memory_id == target_id)
            .unwrap()
            .original_excerpt
            .contains("withdrawn"));
    }

    #[test]
    fn a_question_with_only_filler_does_not_match_every_note() {
        let (_temp, vault, _, _) = crate::librarian::organization_tests::setup();
        vault
            .capture_note(
                &Uuid::new_v4().to_string(),
                "Synthetic: you can ask me about the notes.",
            )
            .unwrap();
        assert!(ask(&vault, "Can you tell me about my notes?")
            .unwrap()
            .hits
            .is_empty());
    }
    #[test]
    fn corrections_remain_current_while_original_quotes_keep_their_exact_offsets() {
        let (temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        let original = "évidence ".repeat(250) + "Synthetic zephyr launch: Thursday?";
        vault.capture_note(&id, &original).unwrap();
        vault
            .correct(
                &id,
                1,
                &Uuid::new_v4().to_string(),
                "Synthetic zephyr launch: Friday, user correction. Thursday was wrong.",
            )
            .unwrap();
        let answer = ask(&Vault::open(&temp.0).unwrap(), "zephyr launch").unwrap();
        let hit = answer.hits.iter().find(|hit| hit.memory_id == id).unwrap();
        assert_eq!(hit.revision, 2);
        assert!(hit.human_corrected);
        assert!(hit.current_excerpt.contains("Friday"));
        assert!(hit.original_excerpt.contains("Thursday?"));
        assert!(!hit.original_excerpt.contains("Friday"));
        assert_eq!(
            &original[hit.original_start_byte.unwrap()..hit.original_end_byte.unwrap()],
            hit.original_excerpt
        );
    }

    #[test]
    fn deleted_link_targets_and_unresolved_names_do_not_become_related_evidence() {
        let (_temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let target_id = Uuid::new_v4().to_string();
        let target = vault
            .capture_note(&target_id, "Synthetic: Alex, identity unresolved.")
            .unwrap();
        let source_id = Uuid::new_v4().to_string();
        vault
            .capture_note(
                &source_id,
                &format!(
                    "Synthetic zephyr discussion: Alex? [[Recall/Memories/{}]]",
                    target.note_path.unwrap()
                ),
            )
            .unwrap();
        let before = ask(&vault, "zephyr").unwrap();
        let linked = before
            .hits
            .iter()
            .find(|hit| hit.memory_id == target_id)
            .unwrap();
        assert_eq!(
            linked.linked_from_memory_id.as_deref(),
            Some(source_id.as_str())
        );
        assert!(linked.match_reason.contains("not a direct wording match"));
        vault
            .remove(&target_id, 1, &Uuid::new_v4().to_string(), "active")
            .unwrap();
        let unrelated = Uuid::new_v4().to_string();
        vault
            .capture_note(&unrelated, "Synthetic: Alex is someone else.")
            .unwrap();
        let after = ask(&vault, "zephyr").unwrap();
        assert_eq!(after.hits.len(), 1);
        assert_eq!(after.hits[0].memory_id, source_id);
    }

    #[test]
    fn an_unbroken_prefix_cannot_push_the_matched_passage_out_of_its_excerpt() {
        let text = "x".repeat(4000) + " needle: uncertain.";
        let weights = BTreeMap::from([("needle".into(), 1.0)]);
        let (quote, start, end) = excerpt(&text, &weights);
        assert!(quote.contains("needle: uncertain."));
        assert_eq!(&text[start..end], quote);
        assert!(quote.chars().count() <= 1200);
    }
    #[test]
    fn two_character_unicode_names_remain_retrievable() {
        let (_temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        vault.capture_note(&id, "Synthetic: 東京 meeting remains tentative.").unwrap();
        assert!(ask(&vault, "東京").unwrap().hits.iter().any(|hit| hit.memory_id == id));
    }

    #[test]
    fn short_names_units_and_numbers_remain_searchable_without_filler_matches() {
        let (_temp, vault, _, _) = crate::librarian::organization_tests::setup();
        let id = Uuid::new_v4().to_string();
        vault
            .capture_note(&id, "Synthetic: Li asked whether 2 MW was enough?")
            .unwrap();
        for question in ["What did Li ask?", "What about 2 MW?"] {
            assert!(ask(&vault, question)
                .unwrap()
                .hits
                .iter()
                .any(|hit| hit.memory_id == id));
        }
        assert!(ask(&vault, "Can you tell me what it is?")
            .unwrap()
            .hits
            .is_empty());
    }
}
