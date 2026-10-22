use super::*;
use crate::local_organization::OrganizationResult;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("recall-synthetic-{}", Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn vault(&self) -> Vault {
        Vault::open(&self.0).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn text_file(name: &str, bytes: &[u8]) -> (PathBuf, Fixture) {
    let fixture = Fixture::new();
    let path = fixture.0.join(name);
    fs::write(&path, bytes).unwrap();
    (path, fixture)
}
fn history_day_ending(end: &str) -> (String, String) {
    let end_second = utc_second(end).unwrap();
    let start_second = end_second - 86_400;
    let format = |value: u64| {
        let days = (value / 86_400) as i64;
        let z = days + 719468;
        let era = z.div_euclid(146097);
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let mut year = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = mp + if mp < 10 { 3 } else { -9 };
        year += i64::from(month <= 2);
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            value / 3600 % 24,
            value / 60 % 60,
            value % 60
        )
    };
    (format(start_second), format(end_second))
}

#[test]
fn history_selection_pairs_later_correction_and_revalidates_exact_event() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let created = vault
        .capture_text(&op(), "The meeting was in Zürich.")
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct(
            &created.id,
            created.revision,
            &op(),
            "The meeting was in Geneva.",
        )
        .unwrap();
    let (start, end) = history_day_ending(&corrected.updated_at);
    let selected = vault
        .ask_history("Where was the meeting?", &start, &end, false)
        .unwrap();
    assert_eq!(selected.selected_count, 2);
    assert_eq!(selected.evidence[0].revision, created.revision);
    assert_eq!(selected.evidence[0].history_status, "as_of_later_corrected");
    assert_eq!(selected.evidence[1].revision, corrected.revision);
    assert_eq!(selected.evidence[1].history_status, "current_counterpart");
    let citation = vault
        .history_citation(
            &created.id,
            selected.evidence[0].revision,
            &selected.evidence[0].event_sha256,
            &selected.evidence[0].source_sha256,
            &selected.evidence[0].excerpt,
        )
        .unwrap();
    assert_eq!(citation.event_sha256, selected.evidence[0].event_sha256);
    assert_eq!(citation.original.sha256, created.source_sha256);
    assert!(!citation.current);
    assert!(vault
        .history_citation(
            &created.id,
            created.revision,
            &"0".repeat(64),
            &created.source_sha256,
            &selected.evidence[0].excerpt
        )
        .is_err());
}

#[test]
fn historical_ask_pairs_explicit_human_reading_correction_for_photo_transcription() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let captured = publish_synthetic_photo_organization(&vault, "");
    let memory = vault
        .records(&captured.id)
        .unwrap()
        .last()
        .unwrap()
        .memory
        .clone();
    assert!(memory.note.is_empty());
    assert!(memory.reading.is_none());

    let organization_event = fs::read(vault.history_path(&memory.id, memory.revision)).unwrap();
    let organization_journal = fs::read(
        vault.journal_path(
            &vault
                .records(&memory.id)
                .unwrap()
                .last()
                .unwrap()
                .operation_id,
        ),
    )
    .unwrap();
    let original = vault.verify_source(&memory).unwrap();
    let selected = vault
        .ask_history(
            "What did the photo transcription say about the synthetic note?",
            "9999-12-30T00:00:00Z",
            "9999-12-31T00:00:00Z",
            false,
        )
        .unwrap();
    assert_eq!(selected.evidence.len(), 1);
    let historical = &selected.evidence[0];
    assert_eq!(historical.revision, memory.revision);
    assert_eq!(historical.evidence_kind, "organization_proposal");
    assert_eq!(historical.epistemic_state, "unreviewed");
    assert_eq!(historical.excerpt, "Synthetic note: 12?");
    let citation = vault
        .history_citation(
            &memory.id,
            historical.revision,
            &historical.event_sha256,
            &historical.source_sha256,
            &historical.excerpt,
        )
        .unwrap();
    assert_eq!(citation.quote, historical.excerpt);
    assert_eq!(
        citation
            .retained_revision
            .organization
            .as_ref()
            .unwrap()
            .result
            .extraction["pages"][0]["transcription"],
        "Synthetic note: 12?"
    );
    assert_eq!(citation.original.sha256, original.sha256);

    let request = vault
        .prepare_reading(&memory.id, memory.revision, &op())
        .unwrap();
    let machine_reading = vault
        .accept_reading(&request, &reading_response(&request))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct_reading(
            &memory.id,
            machine_reading.revision,
            &op(),
            "A human corrected the photo transcription.",
        )
        .unwrap();
    assert!(corrected.organization.as_ref().unwrap().suppressed);
    let (start, end) = history_day_ending(&corrected.updated_at);
    let selected = vault
        .ask_history(
            "What did the photo transcription say about the synthetic note?",
            &start,
            &end,
            false,
        )
        .unwrap();
    assert_eq!(selected.evidence.len(), 2);
    assert_eq!(selected.evidence[0].revision, machine_reading.revision);
    assert_eq!(selected.evidence[0].history_status, "as_of_later_corrected");
    assert_eq!(selected.evidence[0].evidence_kind, "machine_reading");
    assert_eq!(selected.evidence[1].revision, corrected.revision);
    assert_eq!(selected.evidence[1].history_status, "current_counterpart");
    assert_eq!(
        selected.evidence[1].evidence_kind,
        "human_reading_correction"
    );
    assert_eq!(
        fs::read(vault.history_path(&memory.id, memory.revision)).unwrap(),
        organization_event
    );
    assert_eq!(
        fs::read(vault.journal_path(&vault.records(&memory.id).unwrap()[1].operation_id)).unwrap(),
        organization_journal
    );
}

#[test]
fn history_machine_reread_uses_machine_lane_not_unrelated_annotation() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let annotation = "Separate human annotation that is not a transcript correction.";
    let captured = vault
        .capture(&op(), "synthetic.png", &photo(), annotation)
        .unwrap();
    let first_request = vault
        .prepare_reading(&captured.id, captured.revision, &op())
        .unwrap();
    let first = vault
        .accept_reading(&first_request, &reading_response(&first_request))
        .unwrap();
    let first_event = fs::read(vault.history_path(&first.id, first.revision)).unwrap();
    let original = vault.source(&first.id).unwrap().bytes;
    std::thread::sleep(std::time::Duration::from_secs(1));
    let second_request = vault
        .prepare_reading(&first.id, first.revision, &op())
        .unwrap();
    let mut second_response = reading_response(&second_request);
    let encoded = serde_json::to_string(&second_response)
        .unwrap()
        .replace("Synthetic note: 12?", "Synthetic reread B?");
    second_response = serde_json::from_str(&encoded).unwrap();
    let second = vault
        .accept_reading(&second_request, &second_response)
        .unwrap();
    assert_eq!(second.note, annotation);

    let (start, end) = history_day_ending(&second.updated_at);
    let as_of = vault.ask_history("synthetic", &start, &end, false).unwrap();
    assert_eq!(as_of.selected_count, 1);
    assert_eq!(as_of.evidence[0].revision, first.revision);
    assert_eq!(as_of.evidence[0].history_status, "as_of");
    assert_eq!(as_of.evidence[0].evidence_kind, "machine_reading");
    assert_eq!(as_of.evidence[0].epistemic_state, "unreviewed");

    let comparison = vault.ask_history("synthetic", &start, &end, true).unwrap();
    assert_eq!(comparison.selected_count, 2);
    assert_eq!(comparison.evidence[0].revision, first.revision);
    assert_eq!(comparison.evidence[0].evidence_kind, "machine_reading");
    assert_eq!(comparison.evidence[0].epistemic_state, "unreviewed");
    assert_eq!(comparison.evidence[1].revision, second.revision);
    assert_eq!(comparison.evidence[1].history_status, "current_counterpart");
    assert_eq!(comparison.evidence[1].evidence_kind, "machine_reading");
    assert_eq!(comparison.evidence[1].epistemic_state, "unreviewed");
    assert_ne!(comparison.evidence[1].excerpt, annotation);
    assert_eq!(
        fs::read(vault.history_path(&first.id, first.revision)).unwrap(),
        first_event
    );
    assert_eq!(vault.source(&first.id).unwrap().bytes, original);
}

#[test]
fn history_annotation_only_edit_suppresses_organization_without_machine_to_note_pair() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let captured = publish_synthetic_photo_organization(&vault, "annotation A");
    let memory = vault
        .records(&captured.id)
        .unwrap()
        .last()
        .unwrap()
        .memory
        .clone();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let edited = vault
        .correct(&memory.id, memory.revision, &op(), "annotation B")
        .unwrap();
    let (start, end) = history_day_ending(&edited.updated_at);
    let selected = vault
        .ask_history("synthetic note", &start, &end, false)
        .unwrap();
    assert!(selected.evidence.is_empty());
    assert_eq!(selected.eligible_count, 0);
    assert_eq!(selected.selected_count, 0);
    assert!(!selected.limited);
}

#[test]
fn empty_human_reading_correction_suppresses_photo_history_without_one_sided_machine_evidence() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let captured = publish_synthetic_photo_organization(&vault, "");
    let organized = vault
        .records(&captured.id)
        .unwrap()
        .last()
        .unwrap()
        .memory
        .clone();
    let read_request = vault
        .prepare_reading(&organized.id, organized.revision, &op())
        .unwrap();
    let machine_reading = vault
        .accept_reading(&read_request, &reading_response(&read_request))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct_reading(&machine_reading.id, machine_reading.revision, &op(), "")
        .unwrap();
    assert_eq!(corrected.reading.as_ref().unwrap().effective_text(), "");
    assert!(corrected.organization.as_ref().unwrap().suppressed);
    assert!(historical_texts(&corrected).is_empty());

    let (start, end) = history_day_ending(&corrected.updated_at);
    let selection = vault
        .ask_history("What did the synthetic note say?", &start, &end, false)
        .unwrap();
    assert!(selection.evidence.is_empty());
    assert_eq!(selection.eligible_count, 0);
    assert_eq!(selection.selected_count, 0);
    assert!(!selection.limited);
}

#[test]
fn blank_text_correction_omits_only_its_pair_and_preserves_other_history() {
    for blank_correction in ["", "   "] {
        let fixture = Fixture::new();
        let vault = fixture.vault();
        let corrected_memory = vault
            .capture_text(&op(), "Synthetic history marker: removed claim.")
            .unwrap();
        let remaining_memory = vault
            .capture_text(&op(), "Synthetic history marker: retained claim.")
            .unwrap();
        let source_before = vault.source(&corrected_memory.id).unwrap().bytes;
        let historical_event_before =
            fs::read(vault.history_path(&corrected_memory.id, corrected_memory.revision)).unwrap();

        std::thread::sleep(std::time::Duration::from_secs(1));
        let corrected = vault
            .correct(
                &corrected_memory.id,
                corrected_memory.revision,
                &op(),
                blank_correction,
            )
            .unwrap();
        let (start, end) = history_day_ending(&corrected.updated_at);
        let selection = vault
            .ask_history("Synthetic history marker", &start, &end, false)
            .unwrap();

        assert_eq!(selection.eligible_count, 1);
        assert_eq!(selection.selected_count, 1);
        assert!(!selection.limited);
        assert_eq!(selection.evidence[0].memory_id, remaining_memory.id);
        assert_eq!(selection.evidence[0].excerpt, remaining_memory.note);
        let citation = vault
            .history_citation(
                &selection.evidence[0].memory_id,
                selection.evidence[0].revision,
                &selection.evidence[0].event_sha256,
                &selection.evidence[0].source_sha256,
                &selection.evidence[0].excerpt,
            )
            .unwrap();
        assert_eq!(citation.quote, remaining_memory.note);
        assert_eq!(
            vault.source(&corrected_memory.id).unwrap().bytes,
            source_before
        );
        assert_eq!(
            fs::read(vault.history_path(&corrected_memory.id, corrected_memory.revision)).unwrap(),
            historical_event_before
        );
    }
}

#[test]
fn blank_photo_reading_correction_cannot_fall_back_to_separate_annotation() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let annotation = "Separate photo annotation unrelated to the transcript.";
    let captured = publish_synthetic_photo_organization(&vault, annotation);
    let organized = vault
        .records(&captured.id)
        .unwrap()
        .last()
        .unwrap()
        .memory
        .clone();
    let source_before = vault.source(&organized.id).unwrap().bytes;
    let organization_event_before =
        fs::read(vault.history_path(&organized.id, organized.revision)).unwrap();
    let request = vault
        .prepare_reading(&organized.id, organized.revision, &op())
        .unwrap();
    let machine_reading = vault
        .accept_reading(&request, &reading_response(&request))
        .unwrap();
    let machine_event_before =
        fs::read(vault.history_path(&machine_reading.id, machine_reading.revision)).unwrap();
    let remaining_memory = vault
        .capture_text(&op(), "Synthetic note: separate eligible memory.")
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct_reading(&machine_reading.id, machine_reading.revision, &op(), "   ")
        .unwrap();
    assert_eq!(corrected.note, annotation);
    assert_eq!(
        corrected
            .reading
            .as_ref()
            .unwrap()
            .human_correction
            .as_deref(),
        Some("   ")
    );
    assert!(corrected.organization.as_ref().unwrap().suppressed);

    let (start, end) = history_day_ending(&corrected.updated_at);
    let selection = vault
        .ask_history("Synthetic note", &start, &end, false)
        .unwrap();
    assert_eq!(selection.eligible_count, 1);
    assert_eq!(selection.selected_count, 1);
    assert!(!selection.limited);
    assert_eq!(selection.evidence[0].memory_id, remaining_memory.id);
    assert_eq!(selection.evidence[0].excerpt, remaining_memory.note);
    let citation = vault
        .history_citation(
            &selection.evidence[0].memory_id,
            selection.evidence[0].revision,
            &selection.evidence[0].event_sha256,
            &selection.evidence[0].source_sha256,
            &selection.evidence[0].excerpt,
        )
        .unwrap();
    assert_eq!(citation.quote, remaining_memory.note);
    assert_eq!(vault.source(&organized.id).unwrap().bytes, source_before);
    assert_eq!(
        fs::read(vault.history_path(&organized.id, organized.revision)).unwrap(),
        organization_event_before
    );
    assert_eq!(
        fs::read(vault.history_path(&machine_reading.id, machine_reading.revision)).unwrap(),
        machine_event_before
    );
}

#[test]
fn blank_photo_annotation_cannot_fall_back_to_machine_reading() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let annotation = "Project Lantern handoff location is Boston.";
    let captured = vault
        .capture(&op(), "synthetic.png", &photo(), annotation)
        .unwrap();
    let request = vault
        .prepare_reading(&captured.id, captured.revision, &op())
        .unwrap();
    let machine_reading = vault
        .accept_reading(&request, &reading_response(&request))
        .unwrap();
    let source_before = vault.source(&captured.id).unwrap().bytes;
    let historical_event_before =
        fs::read(vault.history_path(&captured.id, machine_reading.revision)).unwrap();
    let remaining_memory = vault
        .capture_text(&op(), "Project Lantern handoff: retained evidence.")
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct(&captured.id, machine_reading.revision, &op(), "")
        .unwrap();
    assert!(corrected.note.is_empty());
    assert!(!corrected
        .reading
        .as_ref()
        .unwrap()
        .effective_text()
        .trim()
        .is_empty());

    let (start, end) = history_day_ending(&corrected.updated_at);
    let selection = vault
        .ask_history("Project Lantern handoff Boston", &start, &end, false)
        .unwrap();
    assert_eq!(selection.eligible_count, 1);
    assert_eq!(selection.selected_count, 1);
    assert!(!selection.limited);
    assert_eq!(selection.evidence[0].memory_id, remaining_memory.id);
    assert_eq!(selection.evidence[0].excerpt, remaining_memory.note);
    let citation = vault
        .history_citation(
            &selection.evidence[0].memory_id,
            selection.evidence[0].revision,
            &selection.evidence[0].event_sha256,
            &selection.evidence[0].source_sha256,
            &selection.evidence[0].excerpt,
        )
        .unwrap();
    assert_eq!(citation.quote, remaining_memory.note);
    assert_eq!(vault.source(&captured.id).unwrap().bytes, source_before);
    assert_eq!(
        fs::read(vault.history_path(&captured.id, machine_reading.revision)).unwrap(),
        historical_event_before
    );
}

#[test]
fn history_coverage_counts_complete_pairs_beyond_eight_item_selection() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let mut originals = Vec::new();
    for index in 0..5 {
        originals.push(
            vault
                .capture_text(&op(), &format!("Project city evidence {index}: Zürich."))
                .unwrap(),
        );
    }
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = originals
        .iter()
        .map(|original| {
            vault
                .correct(
                    &original.id,
                    original.revision,
                    &op(),
                    &original.note.replace("Zürich", "Geneva"),
                )
                .unwrap()
        })
        .collect::<Vec<_>>();
    let (start, end) = history_day_ending(&corrected[0].updated_at);
    let selection = vault
        .ask_history("Project city evidence", &start, &end, false)
        .unwrap();

    assert_eq!(selection.eligible_count, 10);
    assert_eq!(selection.selected_count, 8);
    assert!(selection.limited);
    assert_eq!(selection.evidence.len(), 8);
    for pair in selection.evidence.chunks_exact(2) {
        assert_eq!(pair[0].history_status, "as_of_later_corrected");
        assert_eq!(pair[1].history_status, "current_counterpart");
        assert_eq!(pair[0].memory_id, pair[1].memory_id);
    }
}

#[test]
fn history_comparison_pairs_same_second_revisions_and_checks_dst_span() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let created = vault
        .capture_text(&op(), "Project notes say Zürich.")
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct(
            &created.id,
            created.revision,
            &op(),
            "Project notes say Geneva.",
        )
        .unwrap();
    let (start, end) = history_day_ending(&corrected.updated_at);
    let selected = vault
        .ask_history("project city", &start, &end, true)
        .unwrap();
    assert_eq!(selected.selected_count, 2);
    assert_eq!(selected.evidence[0].revision, created.revision);
    assert_eq!(selected.evidence[1].revision, created.revision + 1);
    assert_eq!(selected.evidence[1].history_status, "current_counterpart");
    assert!(vault
        .ask_history("x", "9999-12-30T05:00:00Z", "9999-12-31T03:00:00Z", false)
        .is_err());
    assert!(vault
        .ask_history("x", "2026-02-30T05:00:00Z", "2026-03-01T05:00:00Z", false)
        .is_err());
}

#[test]
fn historical_selection_omits_removed_missing_conflicted_and_tampered_sources() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let removed = vault
        .capture_text(&op(), "removed synthetic memory")
        .unwrap();
    vault
        .remove(&removed.id, removed.revision, &op(), "active")
        .unwrap();
    let missing = vault
        .capture_text(&op(), "missing synthetic memory")
        .unwrap();
    fs::remove_file(vault.path(&format!("Memories/{}.md", missing.id))).unwrap();
    let source = vault
        .capture_text(&op(), "tampered synthetic memory")
        .unwrap();
    fs::write(
        vault.path(&format!("Sources/{}.txt", source.id)),
        b"changed original",
    )
    .unwrap();
    let conflicted = vault
        .capture_text(&op(), "conflicted synthetic memory")
        .unwrap();
    fs::write(
        vault.path(&format!("Memories/{}.md", conflicted.id)),
        "edited managed header",
    )
    .unwrap();
    let selected = vault
        .ask_history(
            "synthetic memory",
            "9999-12-30T00:00:00Z",
            "9999-12-31T00:00:00Z",
            false,
        )
        .unwrap();
    assert!(selected.evidence.is_empty());
}

#[test]
fn historical_selection_reconciles_direct_obsidian_edit_without_rewriting_prior_event() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let memory = vault
        .capture(&op(), "synthetic.png", &photo(), "before edit")
        .unwrap();
    let retained_before = fs::read(vault.history_path(&memory.id, 1)).unwrap();
    let path = vault.note_path(&memory.id);
    let disk = fs::read_to_string(&path)
        .unwrap()
        .replace("before edit", "Obsidian edited historical annotation");
    fs::write(path, disk).unwrap();
    let selected = vault
        .ask_history(
            "historical annotation",
            "9999-12-30T00:00:00Z",
            "9999-12-31T00:00:00Z",
            false,
        )
        .unwrap();
    assert_eq!(selected.evidence.len(), 1);
    assert_eq!(selected.evidence[0].revision, 2);
    assert!(selected.evidence[0].excerpt.contains("Obsidian edited"));
    assert_eq!(
        fs::read(vault.history_path(&memory.id, 1)).unwrap(),
        retained_before
    );
}

#[test]
fn history_read_keeps_legacy_v1_and_current_v7_event_and_markdown_bytes_stable() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let legacy = vault
        .capture_text(&op(), "legacy retained evidence")
        .unwrap();
    vault.fence_manifest_v7().unwrap();
    let current = vault
        .capture_text(&op(), "current retained evidence")
        .unwrap();
    let snapshots = [&legacy, &current].map(|memory| {
        (
            fs::read(vault.history_path(&memory.id, memory.revision)).unwrap(),
            fs::read(vault.journal_path(&vault.records(&memory.id).unwrap()[0].operation_id))
                .unwrap(),
            fs::read(vault.note_path(&memory.id)).unwrap(),
        )
    });
    let result = vault
        .ask_history(
            "retained evidence",
            "9999-12-30T00:00:00Z",
            "9999-12-31T00:00:00Z",
            false,
        )
        .unwrap();
    assert_eq!(result.selected_count, 2);
    for (memory, before) in [&legacy, &current].into_iter().zip(snapshots) {
        assert_eq!(
            fs::read(vault.history_path(&memory.id, memory.revision)).unwrap(),
            before.0
        );
        assert_eq!(
            fs::read(vault.journal_path(&vault.records(&memory.id).unwrap()[0].operation_id))
                .unwrap(),
            before.1
        );
        assert_eq!(fs::read(vault.note_path(&memory.id)).unwrap(), before.2);
    }
}

#[test]
fn text_file_import_preserves_exact_bytes_and_bom_crlf_semantics_and_replays_without_picker() {
    let bytes = b"\xef\xbb\xbf---\r\nid: attacker\r\n---\r\n# Literal <script> heading\r\nCaf\xc3\xa9\r\n## Human annotation\n\n<!-- Recall imported annotation boundary -->\n";
    let (path, fixture) = text_file("notes.Md", bytes);
    let vault = fixture.vault();
    vault
        .set_organization_marker(Some(organize_marker(&vault)))
        .unwrap();
    let operation = op();
    let imported = vault.import_text_path(&operation, &path).unwrap();
    let dispatch_operation = vault
        .organization_operations(&imported.id)
        .unwrap()
        .remove(0);
    let dispatch = vault
        .organization_dispatch_material(&dispatch_operation.operation_id)
        .unwrap()
        .unwrap();
    assert_eq!(dispatch.2, imported.note.as_bytes());
    assert_eq!(dispatch.1.binding.source_sha256, hash(bytes));
    assert_eq!(
        dispatch.1.binding.input_sha256,
        hash(imported.note.as_bytes())
    );
    assert_ne!(
        dispatch.1.binding.source_sha256,
        dispatch.1.binding.input_sha256
    );
    assert_eq!(
        imported.note,
        "---\r\nid: attacker\r\n---\r\n# Literal <script> heading\r\nCafé\r\n## Human annotation\n\n<!-- Recall imported annotation boundary -->\n"
    );
    assert_eq!(imported.source_name, "notes.Md");
    let provenance = imported.imported_text.as_ref().unwrap();
    assert_eq!(provenance.original_extension, "Md");
    assert_eq!(provenance.source_media_type, "text/plain; charset=utf-8");
    assert_eq!(provenance.semantic_sha256, hash(imported.note.as_bytes()));
    assert_eq!(vault.source(&imported.id).unwrap().bytes, bytes);
    let markdown = fs::read_to_string(vault.note_path(&imported.id)).unwrap();
    assert!(markdown.contains("## Imported text (inert)"));
    assert!(markdown.contains("&lt;script&gt;"));
    assert!(markdown.contains("## Human annotation\n\n"));
    assert_eq!(markdown.matches("## Human annotation\n\n").count(), 2);
    assert_eq!(
        markdown
            .matches("<!-- Recall imported annotation boundary -->")
            .count(),
        1
    );
    assert_eq!(vault.list("").unwrap()[0].revision, 1);
    assert_eq!(
        decode::<Manifest>(&vault.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V8
    );
    let recovered = vault.recover_text_import(&operation).unwrap().unwrap();
    assert_eq!(recovered.id, imported.id);
    assert_eq!(recovered.revision, 1);
    assert_eq!(fs::read(vault.source_path(&imported.id)).unwrap(), bytes);
}

#[test]
fn text_file_import_rejects_invalid_and_unsupported_files_and_keeps_oversized_organization_local() {
    let (bad_utf8, bad_fixture) = text_file("bad.txt", b"\xff");
    assert!(bad_fixture
        .vault()
        .import_text_path(&op(), &bad_utf8)
        .is_err());
    let (nul, nul_fixture) = text_file("bad.md", b"valid\0invalid");
    assert!(nul_fixture.vault().import_text_path(&op(), &nul).is_err());
    let (empty, empty_fixture) = text_file("empty.txt", b"\xef\xbb\xbf \r\n");
    assert!(empty_fixture
        .vault()
        .import_text_path(&op(), &empty)
        .is_err());
    let (unsupported, unsupported_fixture) = text_file("notes.pdf", b"synthetic");
    assert!(unsupported_fixture
        .vault()
        .import_text_path(&op(), &unsupported)
        .is_err());

    let (large, large_fixture) = text_file("long.txt", &vec![b'x'; 30_001]);
    let vault = large_fixture.vault();
    vault
        .set_organization_marker(Some(organize_marker(&vault)))
        .unwrap();
    let imported = vault.import_text_path(&op(), &large).unwrap();
    let operation = vault
        .organization_operations(&imported.id)
        .unwrap()
        .remove(0);
    assert_eq!(operation.state, "saved_local");
    assert_eq!(
        operation.error_code.as_deref(),
        Some("INPUT_LIMIT_EXCEEDED")
    );
    assert!(vault
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .is_none());
    assert_eq!(vault.source(&imported.id).unwrap().bytes.len(), 30_001);
}

#[test]
fn interrupted_text_import_recovers_the_durable_source_with_the_same_operation() {
    let original = b"Durable source survives interruption.";
    let (path, fixture) = text_file("recover.md", original);
    let vault = fixture.vault();
    vault
        .set_organization_marker(Some(organize_marker(&vault)))
        .unwrap();
    let operation = op();
    let source_name = format!("{operation}.txt");
    let fault = FaultGuard::set(move |point, path| {
        if point == "cleanup_after"
            && path.file_name().and_then(|name| name.to_str()) == Some(source_name.as_str())
        {
            return Err("INJECTED import publication interruption".into());
        }
        Ok(())
    });
    assert!(vault.import_text_path(&operation, &path).is_err());
    drop(fault);
    assert_eq!(fs::read(vault.source_path(&operation)).unwrap(), original);
    assert!(!vault.history_path(&operation, 1).exists());

    let recovered = vault.recover_text_import(&operation).unwrap().unwrap();
    assert_eq!(recovered.id, operation);
    assert_eq!(recovered.note, "Durable source survives interruption.");
    assert_eq!(fs::read(vault.source_path(&operation)).unwrap(), original);
    assert_eq!(vault.records(&operation).unwrap().len(), 1);
    let pending = vault.organization_operations(&operation).unwrap();
    assert_eq!(pending.len(), 1);
    assert!(vault
        .organization_dispatch_material(&pending[0].operation_id)
        .unwrap()
        .is_some());
}

#[test]
fn text_import_recovery_never_enrolls_a_capture_under_later_or_changed_consent() {
    for initially_enabled in [false, true] {
        let original = b"Local-only operation snapshot.";
        let (path, fixture) = text_file("snapshot.txt", original);
        let vault = fixture.vault();
        let original_marker = initially_enabled.then(|| organize_marker(&vault));
        if let Some(marker) = original_marker.clone() {
            vault.set_organization_marker(Some(marker)).unwrap();
        }
        let operation = op();
        let source_name = format!("{operation}.txt");
        let fault = FaultGuard::set(move |point, path| {
            if point == "cleanup_after"
                && path.file_name().and_then(|name| name.to_str()) == Some(source_name.as_str())
            {
                return Err("INJECTED after durable source".into());
            }
            Ok(())
        });
        assert!(vault.import_text_path(&operation, &path).is_err());
        drop(fault);

        if !initially_enabled {
            vault
                .set_organization_marker(Some(organize_marker(&vault)))
                .unwrap();
        } else {
            let mut changed = original_marker.unwrap();
            changed.consent_epoch += 1;
            changed.local_epoch = Uuid::new_v4().to_string();
            vault.set_organization_marker(Some(changed)).unwrap();
        }
        let recovered = vault.recover_text_import(&operation).unwrap().unwrap();
        assert_eq!(recovered.id, operation);
        assert!(vault
            .organization_operations(&operation)
            .unwrap()
            .is_empty());
    }
}

#[test]
fn text_import_receipt_replay_finishes_only_its_original_consent_bound_intent() {
    for consent_case in ["none", "matching", "changed"] {
        let (path, fixture) = text_file("receipt-replay.txt", b"receipt replay source");
        let vault = fixture.vault();
        let original_marker = (consent_case != "none").then(|| organize_marker(&vault));
        if let Some(marker) = original_marker.clone() {
            vault.set_organization_marker(Some(marker)).unwrap();
        }
        let operation = op();
        let done_name = format!("{operation}.json");
        let fault = FaultGuard::set(move |point, path| {
            if point == "after_receipt"
                && path.file_name().and_then(|name| name.to_str()) == Some(done_name.as_str())
            {
                return Err("INJECTED after capture receipt".into());
            }
            Ok(())
        });
        assert!(vault.import_text_path(&operation, &path).is_err());
        drop(fault);
        assert!(vault.history_path(&operation, 1).exists());

        if consent_case == "changed" {
            let mut changed = original_marker.unwrap();
            changed.consent_epoch += 1;
            changed.local_epoch = Uuid::new_v4().to_string();
            vault.set_organization_marker(Some(changed)).unwrap();
        }
        let recovered = vault.recover_text_import(&operation).unwrap().unwrap();
        assert_eq!(recovered.id, operation);
        let operations = vault.organization_operations(&operation).unwrap();
        match consent_case {
            "matching" => {
                assert_eq!(operations.len(), 1);
                assert_eq!(operations[0].state, "queued");
                assert!(vault
                    .organization_dispatch_material(&operations[0].operation_id)
                    .unwrap()
                    .is_some());
            }
            "changed" => {
                assert_eq!(operations.len(), 1);
                assert_eq!(operations[0].state, "stale");
                assert!(vault
                    .organization_dispatch_material(&operations[0].operation_id)
                    .unwrap()
                    .is_none());
            }
            "none" => assert!(operations.is_empty()),
            _ => unreachable!(),
        }
    }
}

#[test]
fn upgraded_v8_vault_keeps_typed_and_photo_capture_and_prior_v7_event_bytes() {
    let (path, fixture) = text_file("source.txt", b"Imported source");
    let vault = fixture.vault();
    let prior = vault.capture_text(&op(), "prior retained note").unwrap();
    vault.fence_manifest_v7().unwrap();
    let prior_event = fs::read(vault.history_path(&prior.id, 1)).unwrap();
    let prior_note = fs::read(vault.note_path(&prior.id)).unwrap();
    vault.import_text_path(&op(), &path).unwrap();
    let v8_manifest = fs::read(vault.path("_meta/manifest.json")).unwrap();
    vault.fence_manifest_v7().unwrap();
    assert_eq!(
        fs::read(vault.path("_meta/manifest.json")).unwrap(),
        v8_manifest
    );
    let typed = vault.capture_text(&op(), "typed after upgrade").unwrap();
    let photo = vault
        .capture(&op(), "synthetic.png", &photo(), "photo after upgrade")
        .unwrap();
    assert_eq!(vault.records(&typed.id).unwrap()[0].format, FORMAT_V8);
    assert_eq!(vault.records(&photo.id).unwrap()[0].format, FORMAT_V8);
    assert_eq!(vault.source(&photo.id).unwrap().mime_type, "image/png");
    let reading = vault
        .prepare_reading(&photo.id, photo.revision, &op())
        .unwrap();
    let read = vault
        .accept_reading(&reading, &reading_response(&reading))
        .unwrap();
    assert_eq!(read.revision, photo.revision + 1);
    assert!(read.reading.is_some());
    assert_eq!(vault.records(&photo.id).unwrap()[1].format, FORMAT_V8);
    assert_eq!(
        fs::read(vault.history_path(&prior.id, 1)).unwrap(),
        prior_event
    );
    assert_eq!(fs::read(vault.note_path(&prior.id)).unwrap(), prior_note);
}

#[test]
fn imported_text_remains_current_and_historical_ask_evidence_after_correction() {
    let original = b"Original imported text mentions Houston transformer.\n## Human annotation\n\n<!-- Recall imported annotation boundary -->";
    let (path, fixture) = text_file("untrusted-name.md", original);
    let vault = fixture.vault();
    let imported = vault.import_text_path(&op(), &path).unwrap();
    let current = vault.ask_candidates().unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].text, imported.note);
    assert_eq!(current[0].memory.source_sha256, hash(original));

    std::thread::sleep(std::time::Duration::from_secs(1));
    let corrected = vault
        .correct(
            &imported.id,
            imported.revision,
            &op(),
            "Human correction: the transformer was in Dallas.",
        )
        .unwrap();
    let current = vault.ask_candidates().unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(
        current[0].text,
        "Human correction: the transformer was in Dallas."
    );
    assert_eq!(current[0].memory.revision, corrected.revision);

    let (start, end) = history_day_ending(&corrected.updated_at);
    let history = vault
        .ask_history("Where was the transformer?", &start, &end, false)
        .unwrap();
    assert!(history.evidence.iter().any(|evidence| evidence
        .excerpt
        .contains("Original imported text mentions Houston transformer.")));
    assert!(history.evidence.iter().any(|evidence| evidence
        .excerpt
        .contains("Human correction: the transformer was in Dallas.")));

    let note_path = vault.note_path(&imported.id);
    let disk = fs::read_to_string(&note_path).unwrap();
    let edited = disk.replace(
        "Human correction: the transformer was in Dallas.",
        "Obsidian edit: the transformer was in Austin.",
    );
    fs::write(&note_path, &edited).unwrap();
    let reconciled = vault.list("").unwrap().remove(0);
    assert_eq!(
        reconciled.note,
        "Obsidian edit: the transformer was in Austin."
    );
    assert!(reconciled.imported_text.is_some());
    assert_eq!(fs::read_to_string(note_path).unwrap(), edited);
    assert_eq!(vault.ask_candidates().unwrap()[0].text, reconciled.note);
}

#[test]
fn first_obsidian_edit_after_adversarial_import_uses_recall_owned_annotation_boundary() {
    let original =
        b"Untrusted intro\n## Human annotation\n\n<!-- Recall imported annotation boundary -->\n";
    let (path, fixture) = text_file("first-edit.md", original);
    let vault = fixture.vault();
    let imported = vault.import_text_path(&op(), &path).unwrap();
    let note_path = vault.note_path(&imported.id);
    let markdown = fs::read_to_string(&note_path).unwrap();
    let marker = "<!-- Recall imported annotation boundary -->\n\n";
    assert_eq!(markdown.matches(marker).count(), 1);
    let boundary = markdown.find(marker).unwrap() + marker.len();
    let heading = "## Human annotation\n\n";
    let annotation_start = markdown[boundary..].find(heading).unwrap() + boundary + heading.len();
    fs::write(
        &note_path,
        format!("{}Obsidian first edit.\n", &markdown[..annotation_start]),
    )
    .unwrap();

    let edited = fs::read(&note_path).unwrap();
    let reconciled = vault.list("").unwrap().remove(0);
    assert_eq!(reconciled.revision, 2);
    assert_eq!(reconciled.note, "Obsidian first edit.\n");
    let reconciled_bytes = fs::read(&note_path).unwrap();
    assert_ne!(reconciled_bytes, edited);
    let repeated = vault.list("").unwrap().remove(0);
    assert_eq!(repeated.revision, 2);
    assert_eq!(repeated.note, reconciled.note);
    assert_eq!(fs::read(&note_path).unwrap(), reconciled_bytes);
    assert_eq!(vault.history(&imported.id).unwrap().len(), 2);
}

#[test]
fn malformed_retained_timestamp_chain_is_omitted_from_history() {
    let fixture = Fixture::new();
    let vault = fixture.vault();
    let first = vault
        .capture_text(&op(), "chronology synthetic memory")
        .unwrap();
    let second = vault
        .correct(
            &first.id,
            first.revision,
            &op(),
            "chronology corrected synthetic memory",
        )
        .unwrap();
    let mut event = vault
        .records(&first.id)
        .unwrap()
        .into_iter()
        .nth(1)
        .unwrap();
    event.memory.updated_at = "not-a-valid-timestamp".into();
    let bytes = json(&event).unwrap();
    fs::write(vault.history_path(&first.id, second.revision), &bytes).unwrap();
    fs::write(vault.journal_path(&event.operation_id), &bytes).unwrap();
    fs::write(
        vault.done_path(&event.operation_id),
        hash(&bytes).as_bytes(),
    )
    .unwrap();
    let selected = vault
        .ask_history(
            "chronology memory",
            "9999-12-30T00:00:00Z",
            "9999-12-31T00:00:00Z",
            false,
        )
        .unwrap();
    assert!(selected.evidence.is_empty());
}
fn photo() -> Vec<u8> {
    b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY".to_vec()
}
fn organize_marker(vault: &Vault) -> OrganizationMarker {
    OrganizationMarker {
        schema_version: "1.0".into(),
        vault_id: vault.id.clone(),
        policy_version: "organize-v1|anthropic-v1|synthetic-model".into(),
        consent_epoch: 1,
        local_epoch: Uuid::new_v4().to_string(),
        connection_fingerprint: "a".repeat(64),
    }
}
fn organize_v2_marker(vault: &Vault) -> OrganizationMarker {
    let mut marker = organize_marker(vault);
    marker.policy_version = "organize-v2|anthropic-v1|synthetic-model".into();
    marker.consent_epoch = 2;
    marker
}
fn complete_text_receipt(request: &OrganizationRequest, body: &[u8]) -> OrganizationReceipt {
    let text = std::str::from_utf8(body).unwrap();
    let digest = request.payload_sha256().unwrap();
    let memory_id = &request.binding.memory_id;
    let evidence_quote = truncate_utf8(text, 40);
    let extraction = serde_json::json!({
        "schema_version":"1.1","capture_id":memory_id,"input_manifest_sha256":digest,
        "summary":"A synthetic memory about déjà vu.","summary_evidence":[{"page_id":memory_id,"quote":evidence_quote}],
        "pages":[{"page_id":memory_id,"ordinal":1,"transcription":text,"legibility":"clear"}],
        "mentions":[],"statements":[],"action_suggestions":[],"uncertainties":[]
    });
    OrganizationReceipt {
        schema_version: "1.0".into(),
        binding: request.binding.clone(),
        payload_sha256: digest.clone(),
        state: "complete".into(),
        result: Some(OrganizationResult {
            provider: "anthropic".into(),
            model_id: "synthetic-model".into(),
            input_manifest_sha256: digest,
            derivative: None,
            extraction,
            related_context: request.binding.context.as_ref().map(|_| Vec::new()),
            validation_notes: Vec::new(),
            review_state: "unreviewed".into(),
        }),
        error_code: None,
    }
}
fn publish_synthetic_related_pair(vault: &Vault) -> (VaultMemory, VaultMemory) {
    vault
        .set_organization_marker(Some(organize_v2_marker(vault)))
        .unwrap();
    let target = vault
        .capture_text(&op(), "Project Lantern scope includes backup power.")
        .unwrap();
    let source_text = "Project Lantern meeting will evaluate backup power.";
    let source = vault.capture_text(&op(), source_text).unwrap();
    let operation = vault.organization_operations(&source.id).unwrap().remove(0);
    let (_, request, body) = vault
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    let mut receipt = complete_text_receipt(&request, &body);
    let extraction = &mut receipt.result.as_mut().unwrap().extraction;
    extraction["summary"] = "Project Lantern backup power.".into();
    extraction["summary_evidence"][0]["quote"] = "Project Lantern".into();
    extraction["pages"][0]["transcription"] = source_text.into();
    receipt.result.as_mut().unwrap().related_context =
        Some(vec![crate::local_organization::RelatedContextLink {
            target_memory_id: target.id.clone(),
            source_quote: "evaluate backup power".into(),
            target_quote: "Project Lantern scope includes backup power.".into(),
        }]);
    receipt.validate(&request, Some(&body)).unwrap();
    vault
        .promote_organization(&request, &body, &receipt)
        .unwrap();
    (source, target)
}

fn publish_synthetic_photo_organization(vault: &Vault, annotation: &str) -> VaultMemory {
    vault
        .set_organization_marker(Some(organize_v2_marker(vault)))
        .unwrap();
    let memory = vault
        .capture(&op(), "synthetic.png", &photo(), annotation)
        .unwrap();
    let operation = vault.organization_operations(&memory.id).unwrap().remove(0);
    let (_, request, body) = vault
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
    ))
    .unwrap();
    let digest = request.payload_sha256().unwrap();
    let old_id = "33333333-3333-4333-8333-333333333333";
    let mut extraction = fixture["response"]["result"]["extraction"].clone();
    let encoded = serde_json::to_string(&extraction)
        .unwrap()
        .replace(old_id, &memory.id);
    extraction = serde_json::from_str(&encoded).unwrap();
    extraction["input_manifest_sha256"] = digest.clone().into();
    let receipt = OrganizationReceipt {
        schema_version: "1.0".into(),
        binding: request.binding.clone(),
        payload_sha256: digest.clone(),
        state: "complete".into(),
        result: Some(OrganizationResult {
            provider: "anthropic".into(),
            model_id: "synthetic-model".into(),
            input_manifest_sha256: digest,
            derivative: Some(crate::local_organization::OrganizationDerivative {
                sha256: "a".repeat(64),
                transform_version: "jpeg-rgb-exif-orient-v1".into(),
                media_type: "image/jpeg".into(),
            }),
            extraction,
            related_context: request.binding.context.as_ref().map(|_| Vec::new()),
            validation_notes: Vec::new(),
            review_state: "unreviewed".into(),
        }),
        error_code: None,
    };
    receipt.validate(&request, Some(&body)).unwrap();
    vault
        .promote_organization(&request, &body, &receipt)
        .unwrap();
    memory
}

#[test]
fn organization_opt_in_fences_future_capture_and_prepares_only_after_commit() {
    let f = Fixture::new();
    let v = f.vault();
    let old = v.capture_text(&op(), "pre-opt-in backlog").unwrap();
    assert!(v.organization_operations(&old.id).unwrap().is_empty());
    let previous_manifest = fs::read(v.path("_meta/manifest.json")).unwrap();
    v.set_organization_marker(Some(organize_marker(&v)))
        .unwrap();
    assert_eq!(
        fs::read(v.path("_meta/manifest-v5.json")).unwrap(),
        previous_manifest
    );
    let new = v.capture_text(&op(), "Café — déjà vu").unwrap();
    let operations = v.organization_operations(&new.id).unwrap();
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].state, "queued");
    let (intent, request, body) = v
        .organization_dispatch_material(&operations[0].operation_id)
        .unwrap()
        .unwrap();
    assert_eq!(intent.state, "queued");
    assert_eq!(body, b"Caf\xc3\xa9 \xe2\x80\x94 d\xc3\xa9j\xc3\xa0 vu");
    request.validate(&body).unwrap();
    assert_eq!(v.receipt(&new.id).unwrap().unwrap().kind, "capture");
    assert_eq!(v.source(&new.id).unwrap().sha256, new.source_sha256);
    let manifest: Manifest = decode(&v.path("_meta/manifest.json")).unwrap();
    assert_eq!(manifest.format, FORMAT_V6);
    let corrected = v
        .correct(&new.id, new.revision, &op(), "corrected by a person")
        .unwrap();
    assert_eq!(corrected.note, "corrected by a person");
    assert!(v
        .organization_dispatch_material(&operations[0].operation_id)
        .unwrap()
        .is_none());
    assert_eq!(
        v.organization_operation(&operations[0].operation_id)
            .unwrap()
            .state,
        "stale"
    );
}

#[test]
fn oversize_text_stays_saved_local_and_does_not_poison_later_organization_work() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_marker(&v)))
        .unwrap();
    let too_large = v.capture_text(&op(), &"x".repeat(30_001)).unwrap();
    let eligible = v.capture_text(&op(), "ordinary later capture").unwrap();
    let old = v.organization_operations(&too_large.id).unwrap().remove(0);
    let next = v.organization_operations(&eligible.id).unwrap().remove(0);
    assert_eq!(old.state, "saved_local");
    assert_eq!(old.error_code.as_deref(), Some("INPUT_LIMIT_EXCEEDED"));
    assert!(v
        .organization_dispatch_material(&old.operation_id)
        .unwrap()
        .is_none());
    assert_eq!(next.state, "queued");
    assert!(v
        .organization_dispatch_material(&next.operation_id)
        .unwrap()
        .is_some());
}

#[test]
fn selection_guard_is_revoked_by_same_vault_reselection_before_late_work_can_continue() {
    let f = Fixture::new();
    let settings = f.0.join("selected.json");
    let state = LocalVaultState::new(settings);
    let first = state.select_path(&f.0).unwrap();
    let guard = state.session(first.vault_id.as_deref().unwrap()).unwrap();
    let second = state.select_path(&f.0).unwrap();
    assert_ne!(first.vault_id, second.vault_id);
    assert!(guard.active().is_err());
    assert!(guard.with(|_| Ok(())).is_err());
}

#[test]
fn interrupted_marker_then_reconcile_creates_a_fresh_future_only_fence() {
    let f = Fixture::new();
    let v = f.vault();
    let fault = FaultGuard::set(|point, path| {
        if point == "create_before" && path.to_string_lossy().contains("consent.stage-") {
            return Err("INJECTED marker interruption".into());
        }
        Ok(())
    });
    assert!(v
        .set_organization_marker(Some(organize_marker(&v)))
        .is_err());
    drop(fault);
    let before_reconcile = v
        .capture_text(&op(), "saved while setup was interrupted")
        .unwrap();
    assert!(v
        .organization_operations(&before_reconcile.id)
        .unwrap()
        .is_empty());
    let fresh = organize_marker(&v);
    v.set_organization_marker(Some(fresh.clone())).unwrap();
    let after_reconcile = v
        .capture_text(&op(), "captured after explicit setup")
        .unwrap();
    assert_eq!(
        v.organization_operations(&after_reconcile.id).unwrap()[0].state,
        "queued"
    );
    assert!(v
        .organization_operations(&before_reconcile.id)
        .unwrap()
        .is_empty());
}

#[test]
fn organization_promotion_is_source_bound_and_human_edit_suppresses_current_semantics() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_marker(&v)))
        .unwrap();
    let memory = v.capture_text(&op(), "Café — déjà vu").unwrap();
    let operation = v.organization_operations(&memory.id).unwrap().remove(0);
    let (_, request, body) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    let receipt = complete_text_receipt(&request, &body);
    receipt.validate(&request, Some(&body)).unwrap();
    assert_eq!(
        v.promote_organization(&request, &body, &receipt)
            .unwrap()
            .state,
        "organized"
    );
    let current = v.list("déjà vu").unwrap().remove(0);
    assert!(current.organization.is_some());
    let note = fs::read_to_string(v.note_path(&memory.id)).unwrap();
    assert!(note.contains("A synthetic memory about déjà vu\\."));
    assert!(note.contains("organization: unreviewed"));
    assert!(v.ask_candidates().unwrap()[0]
        .ranking_text
        .contains("A synthetic memory about déjà vu."));
    fs::write(v.note_path(&memory.id), format!("{note}\nHuman addition.")).unwrap();
    let reconciled = v.list("Human addition").unwrap().remove(0);
    assert!(reconciled.organization.as_ref().unwrap().suppressed);
    assert!(!v
        .list("synthetic memory")
        .unwrap()
        .iter()
        .any(|m| m.id == memory.id));
    assert!(!v.ask_candidates().unwrap()[0]
        .ranking_text
        .contains("A synthetic memory about déjà vu."));
    let rendered = fs::read_to_string(v.note_path(&memory.id)).unwrap();
    assert!(!rendered.contains("organization: unreviewed"));
    assert!(rendered.contains("Human addition."));
    let history = v.history(&memory.id).unwrap();
    assert_eq!(history[1].kind, "organization");
    assert!(!history[1].organization.as_ref().unwrap().suppressed);
    assert!(history[2].organization.as_ref().unwrap().suppressed);
}

#[test]
fn organization_v6_preserves_question_uncertainty_attribution_all_evidence_and_action_due_safely() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_marker(&v)))
        .unwrap();
    let source_text = "Paul said maybe 12? on Monday; ask Sam Friday [tentative].";
    let memory = v.capture_text(&op(), source_text).unwrap();
    let operation = v.organization_operations(&memory.id).unwrap().remove(0);
    let (_, request, body) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    let mut receipt = complete_text_receipt(&request, &body);
    let extraction = &mut receipt.result.as_mut().unwrap().extraction;
    extraction["summary"] = "Possible value 12?".into();
    extraction["summary_evidence"] = serde_json::json!([{"page_id":memory.id,"quote":"12?"}]);
    extraction["pages"][0]["transcription"] = source_text.into();
    extraction["mentions"] = serde_json::json!([{
        "local_id":"m1", "kind":"person", "raw_text":"Sam",
        "evidence":[{"page_id":memory.id,"quote":"Sam"}]
    }]);
    extraction["statements"] = serde_json::json!([{
        "local_id":"s1", "kind":"question", "subject_mention_id":"m1", "predicate":"estimate",
        "text":"Could the value be 12?", "value_text":"12?", "epistemic_state":"question",
        "attribution_text":"Paul said", "temporal_text":"Monday", "object_mention_id":null,
        "evidence":[{"page_id":memory.id,"quote":"12?"},{"page_id":memory.id,"quote":"Paul said"}]
    }]);
    extraction["action_suggestions"] = serde_json::json!([{
        "local_id":"a1", "kind":"action", "text":"Ask Sam", "assignee_mention_id":"m1",
        "due_text":"Friday [tentative]\n## forged", "evidence":[{"page_id":memory.id,"quote":"Sam Friday"}]
    }]);
    receipt.validate(&request, Some(&body)).unwrap();
    v.promote_organization(&request, &body, &receipt).unwrap();

    let note = fs::read_to_string(v.note_path(&memory.id)).unwrap();
    assert!(note.contains("## Statements (unreviewed)"));
    assert!(note.contains("Could the value be 12? — question (question; unreviewed)"));
    assert!(note.contains("Value: 12?"));
    assert!(note.contains("Attribution: Paul said"));
    assert!(note.contains("When: Monday"));
    assert!(note.contains("Source excerpt: [“12?”](../Sources/"));
    assert!(note.contains("Source excerpt: [“Paul said”](../Sources/"));
    assert!(note.contains("Sam (person, unreviewed)"));
    assert!(note.contains("Due: Friday \\[tentative\\] \\#\\# forged"));
    assert!(!note.contains("\n## forged"));
    assert!(note.contains("organization: unreviewed"));
}

#[test]
fn v2_context_freezes_before_dispatch_and_v7_related_link_is_current_and_click_revalidated() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_v2_marker(&v)))
        .unwrap();
    let target = v
        .capture_text(&op(), "Project Lantern scope includes backup power.")
        .unwrap();
    let source_text = "Project Lantern meeting will evaluate backup power.";
    let source = v.capture_text(&op(), source_text).unwrap();
    let operation = v.organization_operations(&source.id).unwrap().remove(0);
    let (_, request, body) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    assert_eq!(request.binding.schema_version, "2.0");
    assert_eq!(
        request
            .binding
            .context_coverage
            .as_ref()
            .unwrap()
            .selected_count,
        1
    );
    let bound = request.binding.context.as_ref().unwrap();
    assert_eq!(bound.len(), 1);
    assert_eq!(bound[0].memory_id, target.id);
    assert!(bound[0].excerpt.len() <= 256);

    let mut receipt = complete_text_receipt(&request, &body);
    receipt.result.as_mut().unwrap().extraction["summary"] = "Project Lantern backup power.".into();
    receipt.result.as_mut().unwrap().extraction["summary_evidence"][0]["quote"] =
        "Project Lantern".into();
    receipt.result.as_mut().unwrap().extraction["pages"][0]["transcription"] = source_text.into();
    receipt.result.as_mut().unwrap().related_context =
        Some(vec![crate::local_organization::RelatedContextLink {
            target_memory_id: target.id.clone(),
            source_quote: "evaluate backup power".into(),
            target_quote: "Project Lantern scope includes backup power.".into(),
        }]);
    receipt.validate(&request, Some(&body)).unwrap();
    v.promote_organization(&request, &body, &receipt).unwrap();
    let promoted = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert_eq!(promoted.related_context.len(), 1);
    assert_eq!(promoted.related_context[0].target_memory_id, target.id);
    let source_records = v.records(&source.id).unwrap();
    let event = source_records.last().unwrap();
    assert_eq!(event.format, FORMAT_V7);
    assert_eq!(event.context_link_projection.as_ref().unwrap().len(), 1);
    let published = fs::read_to_string(v.note_path(&source.id)).unwrap();
    assert!(published.contains("Possibly related (unreviewed)"));
    let target_basename = target.note_path.as_ref().unwrap();
    assert!(published.contains(&format!("]({target_basename})")));

    let click = v.related_memory(&source.id, &target.id).unwrap();
    assert_eq!(click.memory_id, target.id);
    assert_eq!(click.revision, target.revision);
    assert_eq!(click.original.sha256, target.source_sha256);
    assert_eq!(
        click.original.bytes,
        b"Project Lantern scope includes backup power."
    );

    let old_source_markdown = event.markdown.clone();
    let previous_source_event = &source_records[0];
    v.reading_transition(previous_source_event, event).unwrap();
    let mut downgraded = event.clone();
    downgraded.format = FORMAT_V6.into();
    assert!(v.reading_transition(event, &downgraded).is_err());
    let old_source_event = fs::read(v.history_path(&source.id, event.memory.revision)).unwrap();
    v.correct(
        &target.id,
        target.revision,
        &op(),
        "Human corrected target text.",
    )
    .unwrap();
    assert!(v.related_memory(&source.id, &target.id).is_err());
    let current_source = v
        .list_with_deleted("", false)
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(current_source.related_context.is_empty());
    assert_eq!(
        v.history(&source.id).unwrap().last().unwrap().kind,
        "context_suppress"
    );
    assert_eq!(
        fs::read(v.history_path(&source.id, event.memory.revision)).unwrap(),
        old_source_event
    );
    assert!(old_source_markdown.contains("Possibly related (unreviewed)"));
}

#[test]
fn v7_source_human_correction_suppresses_projection_and_replays_exact_history() {
    let f = Fixture::new();
    let v = f.vault();
    let (source, target) = publish_synthetic_related_pair(&v);
    let source = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|m| m.id == source.id)
        .unwrap();
    let before = v.records(&source.id).unwrap().last().unwrap().clone();
    let corrected = v
        .correct(
            &source.id,
            source.revision,
            &op(),
            "Human source correction.",
        )
        .unwrap();
    assert_eq!(corrected.revision, source.revision + 1);
    assert!(corrected.organization.as_ref().unwrap().suppressed);
    let history = v.records(&source.id).unwrap();
    let event = history.last().unwrap();
    assert_eq!(event.format, FORMAT_V7);
    assert_eq!(event.kind, "correct");
    assert!(event
        .context_link_projection
        .as_ref()
        .unwrap()
        .iter()
        .all(|entry| entry.suppressed));
    assert!(!fs::read_to_string(v.note_path(&source.id))
        .unwrap()
        .contains("Possibly related (unreviewed)"));
    assert_eq!(v.history(&source.id).unwrap().len(), 3);
    assert!(v.related_memory(&source.id, &target.id).is_err());
    assert_eq!(v.records(&source.id).unwrap()[1].markdown, before.markdown);
}

#[test]
fn v7_vault_can_publish_new_bound_context_on_a_later_capture() {
    let f = Fixture::new();
    let v = f.vault();
    let (_source1, target1) = publish_synthetic_related_pair(&v);
    let second_target = v
        .capture_text(&op(), "Follow-up context remains eligible.")
        .unwrap();
    let source2 = v.capture_text(&op(), "Follow-up source capture.").unwrap();
    let operation = v.organization_operations(&source2.id).unwrap().remove(0);
    let (_, request, body) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    assert_eq!(request.binding.schema_version, "2.0");
    assert!(request
        .binding
        .context
        .as_ref()
        .unwrap()
        .iter()
        .any(|bound| bound.memory_id == second_target.id));
    let mut receipt = complete_text_receipt(&request, &body);
    let extraction = &mut receipt.result.as_mut().unwrap().extraction;
    extraction["summary"] = "Follow-up context.".into();
    extraction["summary_evidence"][0]["quote"] = "Follow-up".into();
    extraction["pages"][0]["transcription"] = "Follow-up source capture.".into();
    receipt.result.as_mut().unwrap().related_context =
        Some(vec![crate::local_organization::RelatedContextLink {
            target_memory_id: second_target.id.clone(),
            source_quote: "Follow-up source".into(),
            target_quote: "Follow-up context".into(),
        }]);
    receipt.validate(&request, Some(&body)).unwrap();
    v.promote_organization(&request, &body, &receipt).unwrap();
    let event = v.records(&source2.id).unwrap().pop().unwrap();
    assert_eq!(event.format, FORMAT_V7);
    assert_eq!(event.context_link_projection.as_ref().unwrap().len(), 1);
    assert_eq!(
        event.context_link_projection.as_ref().unwrap()[0].target_memory_id,
        second_target.id
    );
    assert_eq!(
        v.related_memory(&source2.id, &second_target.id)
            .unwrap()
            .memory_id,
        second_target.id
    );
    let inserted = crate::local_vault::ContextLinkProjection {
        target_memory_id: target1.id.clone(),
        note_basename: target1.note_path.clone().unwrap(),
        suppressed: false,
    };
    let mut second_insertion = event.clone();
    second_insertion.kind = "context_suppress".into();
    second_insertion
        .context_link_projection
        .as_mut()
        .unwrap()
        .push(inserted.clone());
    assert!(v
        .organization_transition(&event, &second_insertion)
        .is_err());
    let mut retargeted = event.clone();
    retargeted.kind = "context_suppress".into();
    retargeted.context_link_projection.as_mut().unwrap()[0].target_memory_id = target1.id.clone();
    assert!(v.organization_transition(&event, &retargeted).is_err());
    let mut renamed_projection = event.clone();
    renamed_projection.kind = "context_suppress".into();
    renamed_projection.context_link_projection.as_mut().unwrap()[0].note_basename =
        "Changed basename.md".into();
    assert!(v
        .organization_transition(&event, &renamed_projection)
        .is_err());
    let mut human_insertion = event.clone();
    human_insertion.kind = "correct".into();
    human_insertion
        .context_link_projection
        .as_mut()
        .unwrap()
        .push(inserted);
    assert!(v.organization_transition(&event, &human_insertion).is_err());
    let mut suppressed = event.clone();
    suppressed.kind = "context_suppress".into();
    suppressed.context_link_projection.as_mut().unwrap()[0].suppressed = true;
    v.organization_transition(&event, &suppressed).unwrap();
    let mut revived = suppressed.clone();
    revived.context_link_projection.as_mut().unwrap()[0].suppressed = false;
    assert!(v.organization_transition(&suppressed, &revived).is_err());
    assert_eq!(target1.state, "active");
}

#[test]
fn v7_source_removal_and_missing_restore_keep_monotone_projection() {
    let f = Fixture::new();
    let v = f.vault();
    let (removed_source, _) = publish_synthetic_related_pair(&v);
    let removed_source = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|m| m.id == removed_source.id)
        .unwrap();
    let removed = v
        .remove(&removed_source.id, removed_source.revision, &op(), "active")
        .unwrap();
    assert_eq!(removed.state, "deleted");
    let removed_event = v.records(&removed_source.id).unwrap().pop().unwrap();
    assert_eq!(removed_event.format, FORMAT_V7);
    assert_eq!(removed_event.kind, "remove");
    assert!(removed_event
        .context_link_projection
        .as_ref()
        .unwrap()
        .iter()
        .all(|entry| entry.suppressed));
    assert_eq!(v.history(&removed_source.id).unwrap().len(), 3);

    let f2 = Fixture::new();
    let v2 = f2.vault();
    let (missing_source, _) = publish_synthetic_related_pair(&v2);
    let missing_source = v2
        .list("")
        .unwrap()
        .into_iter()
        .find(|m| m.id == missing_source.id)
        .unwrap();
    fs::remove_file(v2.note_path(&missing_source.id)).unwrap();
    let restored = v2
        .restore_note(&missing_source.id, missing_source.revision, &op())
        .unwrap();
    assert_eq!(restored.state, "active");
    assert_eq!(restored.revision, missing_source.revision + 1);
    let restored_event = v2.records(&missing_source.id).unwrap().pop().unwrap();
    assert_eq!(restored_event.format, FORMAT_V7);
    assert_eq!(restored_event.kind, "restore");
    assert!(restored_event
        .context_link_projection
        .as_ref()
        .unwrap()
        .iter()
        .all(|entry| entry.suppressed));
    assert!(!fs::read_to_string(v2.note_path(&missing_source.id))
        .unwrap()
        .contains("Possibly related (unreviewed)"));
    assert_eq!(v2.history(&missing_source.id).unwrap().len(), 3);
}

#[test]
fn v7_photo_human_reading_correction_keeps_v7_manifest_hash_and_projection() {
    let f = Fixture::new();
    let v = f.vault();
    let memory = publish_synthetic_photo_organization(&v, "photo annotation");
    let memory = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|m| m.id == memory.id)
        .unwrap();
    let request = v
        .prepare_reading(&memory.id, memory.revision, &op())
        .unwrap();
    let accepted = v
        .accept_reading(&request, &reading_response(&request))
        .unwrap();
    assert_eq!(accepted.revision, memory.revision + 1);
    let corrected = v
        .correct_reading(
            &memory.id,
            accepted.revision,
            &op(),
            "Human reading correction?",
        )
        .unwrap();
    assert_eq!(corrected.revision, accepted.revision + 1);
    assert_eq!(
        corrected.reading.as_ref().unwrap().effective_text(),
        "Human reading correction?"
    );
    assert!(corrected.organization.as_ref().unwrap().suppressed);
    let history = v.records(&memory.id).unwrap();
    let last = history.last().unwrap();
    assert_eq!(last.kind, "reading_correction");
    assert_eq!(last.format, FORMAT_V7);
    assert_eq!(last.context_link_projection.as_deref(), Some(&[][..]));
    v.event_valid(last).unwrap();
    v.reading_transition(&history[history.len() - 2], last)
        .unwrap();
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V7
    );
    assert_eq!(v.history(&memory.id).unwrap().len(), 4);
    assert!(v.list("Synthetic note: 12?").unwrap().is_empty());
}

#[test]
fn v2_context_is_not_reselected_after_target_changes_before_first_dispatch() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_v2_marker(&v)))
        .unwrap();
    let target = v
        .capture_text(&op(), "Stable context before dispatch.")
        .unwrap();
    let source = v.capture_text(&op(), "A source capture.").unwrap();
    let operation = v.organization_operations(&source.id).unwrap().remove(0);
    let (intent, request, _) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    let frozen = intent.binding.context.clone().unwrap();
    assert!(frozen.iter().any(|item| item.memory_id == target.id));
    v.correct(&target.id, target.revision, &op(), "Changed after binding.")
        .unwrap();
    assert!(v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .is_none());
    assert_eq!(
        v.organization_operation(&operation.operation_id)
            .unwrap()
            .state,
        "stale"
    );
    let durable: OrganizationIntent =
        decode(&v.organization_intent_path(&operation.operation_id).unwrap()).unwrap();
    assert_eq!(durable.binding.context.unwrap(), frozen);
    assert_eq!(request.binding.context.unwrap(), frozen);
}

#[test]
fn direct_target_rename_suppresses_link_and_source_conflict_preserves_editor_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    let (source, target) = publish_synthetic_related_pair(&v);
    let source_event_bytes = fs::read(v.history_path(&source.id, 2)).unwrap();
    let source_before = v
        .records(&source.id)
        .unwrap()
        .last()
        .unwrap()
        .markdown
        .clone();
    let target_path = v.note_path(&target.id);
    let renamed_path = v.path("Memories/Project Lantern renamed.md");
    fs::rename(&target_path, &renamed_path).unwrap();
    let source_now = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(source_now.related_context.is_empty());
    assert_eq!(
        v.history(&source.id).unwrap().last().unwrap().kind,
        "context_suppress"
    );
    assert_eq!(
        fs::read(v.history_path(&source.id, 2)).unwrap(),
        source_event_bytes
    );
    assert!(source_before.contains("Possibly related (unreviewed)"));
    assert!(!fs::read_to_string(v.note_path(&source.id))
        .unwrap()
        .contains("Possibly related (unreviewed)"));
    assert!(renamed_path.exists());
    drop(v);
    let reopened = f.vault();
    assert_eq!(reopened.history(&source.id).unwrap().len(), 3);
    assert_eq!(
        fs::read(reopened.history_path(&source.id, 2)).unwrap(),
        source_event_bytes
    );
    assert!(reopened
        .list("")
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap()
        .related_context
        .is_empty());

    let f2 = Fixture::new();
    let v2 = f2.vault();
    let (source2, target2) = publish_synthetic_related_pair(&v2);
    let source_note = v2.note_path(&source2.id);
    let editor_bytes = b"direct Obsidian editor draft; preserve me".to_vec();
    fs::write(&source_note, &editor_bytes).unwrap();
    let target_path = v2.note_path(&target2.id);
    fs::rename(&target_path, v2.path("Memories/Conflict case target.md")).unwrap();
    let records = v2.list_with_deleted("", false).unwrap();
    let conflicted_source = records
        .iter()
        .find(|memory| memory.id == source2.id)
        .unwrap();
    assert_eq!(conflicted_source.state, "conflict");
    assert!(conflicted_source.related_context.is_empty());
    assert!(conflicted_source.context_repair_pending);
    assert_eq!(fs::read(source_note).unwrap(), editor_bytes);
    assert!(v2.related_memory(&source2.id, &target2.id).is_err());
    assert!(!v2.history_path(&source2.id, 3).exists());
}

#[test]
fn direct_target_rename_interruption_hides_link_and_retries_journaled_suppression() {
    let f = Fixture::new();
    let v = f.vault();
    let (source, target) = publish_synthetic_related_pair(&v);
    let original_source_markdown = fs::read(v.note_path(&source.id)).unwrap();
    fs::rename(
        v.note_path(&target.id),
        v.path("Memories/Interrupted target rename.md"),
    )
    .unwrap();
    let source_id = source.id.clone();
    let fault = FaultGuard::set(move |point, path| {
        if point == "before_history" && path.to_string_lossy().contains(&source_id) {
            return Err("INJECTED crash before context suppression history".into());
        }
        Ok(())
    });
    let during = v.list("").unwrap();
    let during_source = during.iter().find(|memory| memory.id == source.id).unwrap();
    assert!(during_source.related_context.is_empty());
    assert!(during_source.context_repair_pending);
    drop(fault);

    let recovered = v.list("").unwrap();
    let recovered_source = recovered
        .iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(recovered_source.related_context.is_empty());
    assert!(!recovered_source.context_repair_pending);
    assert_eq!(
        v.history(&source.id).unwrap().last().unwrap().kind,
        "context_suppress"
    );
    assert_eq!(
        fs::read(v.note_path(&source.id)).unwrap(),
        v.records(&source.id)
            .unwrap()
            .last()
            .unwrap()
            .markdown
            .as_bytes()
    );
    assert_ne!(
        fs::read(v.note_path(&source.id)).unwrap(),
        original_source_markdown
    );
}

#[test]
fn direct_target_markdown_edit_is_preserved_and_stale_link_is_suppressed() {
    let f = Fixture::new();
    let v = f.vault();
    let (source, target) = publish_synthetic_related_pair(&v);
    let target_note = v.note_path(&target.id);
    let editor_bytes = b"unrecognized editor draft; retain exactly".to_vec();
    fs::write(&target_note, &editor_bytes).unwrap();
    let memories = v.list("").unwrap();
    let current_target = memories
        .iter()
        .find(|memory| memory.id == target.id)
        .unwrap();
    assert_eq!(current_target.state, "conflict");
    assert_eq!(fs::read(&target_note).unwrap(), editor_bytes);
    let current_source = memories
        .iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(current_source.related_context.is_empty());
    assert_eq!(
        v.history(&source.id).unwrap().last().unwrap().kind,
        "context_suppress"
    );
}

#[test]
fn target_removal_does_not_block_human_action_and_suppresses_inbound_link() {
    let f = Fixture::new();
    let v = f.vault();
    let (source, target) = publish_synthetic_related_pair(&v);
    let removed = v
        .remove(&target.id, target.revision, &op(), "active")
        .unwrap();
    assert_eq!(removed.state, "deleted");
    assert!(v.related_memory(&source.id, &target.id).is_err());
    let source_after = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(source_after.related_context.is_empty());
    assert_eq!(
        v.history(&source.id).unwrap().last().unwrap().kind,
        "context_suppress"
    );
}

#[test]
fn v2_delayed_provider_result_is_rejected_after_bound_target_changes() {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_v2_marker(&v)))
        .unwrap();
    let target = v
        .capture_text(&op(), "Context before provider dispatch.")
        .unwrap();
    let source = v
        .capture_text(&op(), "Source before provider dispatch.")
        .unwrap();
    let operation = v.organization_operations(&source.id).unwrap().remove(0);
    let (_, request, body) = v
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    v.correct(
        &target.id,
        target.revision,
        &op(),
        "Human changed the target during request.",
    )
    .unwrap();
    let receipt = complete_text_receipt(&request, &body);
    assert!(v.promote_organization(&request, &body, &receipt).is_err());
    assert_eq!(
        v.organization_operation(&operation.operation_id)
            .unwrap()
            .state,
        "stale"
    );
    let source_after = v
        .list("")
        .unwrap()
        .into_iter()
        .find(|memory| memory.id == source.id)
        .unwrap();
    assert!(source_after.organization.is_none());

    let f2 = Fixture::new();
    let v2 = f2.vault();
    v2.set_organization_marker(Some(organize_v2_marker(&v2)))
        .unwrap();
    let _target = v2.capture_text(&op(), "Context stays current.").unwrap();
    let source = v2
        .capture_text(&op(), "Source changes while the provider waits.")
        .unwrap();
    let operation = v2.organization_operations(&source.id).unwrap().remove(0);
    let (_, request, body) = v2
        .organization_dispatch_material(&operation.operation_id)
        .unwrap()
        .unwrap();
    v2.correct(
        &source.id,
        source.revision,
        &op(),
        "Human changed the source.",
    )
    .unwrap();
    let receipt = complete_text_receipt(&request, &body);
    assert!(v2.promote_organization(&request, &body, &receipt).is_err());
    assert_eq!(
        v2.organization_operation(&operation.operation_id)
            .unwrap()
            .state,
        "stale"
    );
}

#[test]
fn organization_prepared_intent_without_durable_capture_is_never_dispatchable_and_revoke_stales_queue(
) {
    let f = Fixture::new();
    let v = f.vault();
    v.set_organization_marker(Some(organize_marker(&v)))
        .unwrap();
    let memory_id = op();
    let source = "synthetic pending capture";
    let captured_at = timestamp();
    let source_hash = hash(source.as_bytes());
    let intent = v
        .prepare_capture_organization(
            &memory_id,
            "text",
            &source_hash,
            &source_hash,
            "text/plain; charset=utf-8",
            source,
            &captured_at,
        )
        .unwrap()
        .unwrap();
    assert!(v
        .organization_dispatch_material(&intent.binding.operation_id)
        .unwrap()
        .is_none());
    assert_eq!(
        v.organization_operation(&intent.binding.operation_id)
            .unwrap()
            .state,
        "stale"
    );
    let saved = v.capture_text(&op(), "queued before revoke").unwrap();
    let queued = v.organization_operations(&saved.id).unwrap().remove(0);
    v.set_organization_marker(None).unwrap();
    assert_eq!(
        v.organization_operation(&queued.operation_id)
            .unwrap()
            .state,
        "stale"
    );
}
#[test]
fn capture_reopens_with_original_hash_and_history() {
    let f = Fixture::new();
    let m = f
        .vault()
        .capture(&op(), "synthetic.png", &photo(), "800 psi?")
        .unwrap();
    let v = f.vault();
    assert_eq!(v.list("").unwrap()[0].note, "800 psi?");
    assert_eq!(v.source(&m.id).unwrap().bytes, photo());
    assert_eq!(v.source(&m.id).unwrap().sha256, m.source_sha256);
    assert_eq!(v.history(&m.id).unwrap().len(), 1);
}

#[test]
fn text_capture_preserves_exact_utf8_source_and_reopens_searchable_memory() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let text = "  Café?\r\nline two\n";
    let m = v.capture_text(&operation, text).unwrap();
    assert_eq!(m.note, text);
    assert_eq!(m.source_name, "note.txt");
    assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), text.as_bytes());
    assert_eq!(
        v.source(&m.id).unwrap().mime_type,
        "text/plain; charset=utf-8"
    );
    assert_eq!(v.source(&m.id).unwrap().sha256, hash(text.as_bytes()));
    assert_eq!(v.capture_text(&operation, text).unwrap().note, text);
    let reopened = f.vault();
    assert_eq!(reopened.list("café?").unwrap()[0].note, text);
    assert_eq!(reopened.history(&m.id).unwrap()[0].kind, "capture");
    let manifest: Manifest = decode(&reopened.path("_meta/manifest.json")).unwrap();
    assert_eq!(manifest.format, FORMAT_V5);
    let markdown = fs::read_to_string(reopened.note_path(&m.id)).unwrap();
    assert!(markdown.contains(&format!("[Original text](../Sources/{}.txt)", m.id)));
    assert!(markdown.ends_with(&format!("## Human annotation\n\n{text}")));
}

#[test]
fn v5_text_writer_keeps_existing_v4_photo_history_and_markdown_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    v.fence_manifest_v4().unwrap();
    let photo_memory = v
        .capture(&op(), "synthetic.png", &photo(), "photo annotation")
        .unwrap();
    let note_path = v.note_path(&photo_memory.id);
    let note_bytes = fs::read(&note_path).unwrap();
    let history_bytes = fs::read(v.history_path(&photo_memory.id, 1)).unwrap();
    let text_memory = v.capture_text(&op(), "independent text").unwrap();
    assert_eq!(text_memory.note, "independent text");
    assert_eq!(fs::read(note_path).unwrap(), note_bytes);
    assert_eq!(
        fs::read(v.history_path(&photo_memory.id, 1)).unwrap(),
        history_bytes
    );
    assert_eq!(v.list("").unwrap().len(), 2);
}

#[test]
fn text_capture_keeps_original_across_direct_edit_and_correction_then_remove_restore() {
    let f = Fixture::new();
    let v = f.vault();
    let original = "Original sentence.\n";
    let memory = v.capture_text(&op(), original).unwrap();
    let path = v.note_path(&memory.id);
    let mut markdown = fs::read_to_string(&path).unwrap();
    markdown.push_str("Obsidian addition.\n");
    fs::write(&path, &markdown).unwrap();
    let current = v.list("").unwrap().remove(0);
    assert_eq!(
        current.note,
        format!("{original}Obsidian addition.\n"),
        "{current:?}"
    );
    let corrected = v
        .correct(&memory.id, current.revision, &op(), "Human correction.")
        .unwrap();
    assert_eq!(corrected.note, "Human correction.");
    assert_eq!(
        v.capture_text(&memory.id, original).unwrap().note,
        "Human correction."
    );
    assert_eq!(
        fs::read(v.source_path(&memory.id)).unwrap(),
        original.as_bytes()
    );
    fs::remove_file(&path).unwrap();
    let missing = v.list("").unwrap().remove(0);
    assert_eq!(missing.state, "missing");
    let restored = v.restore_note(&memory.id, missing.revision, &op()).unwrap();
    assert_eq!(restored.state, "active");
    let removed = v
        .remove(&memory.id, restored.revision, &op(), "active")
        .unwrap();
    assert_eq!(removed.state, "deleted");
    assert_eq!(
        v.capture_text(&memory.id, original).unwrap().state,
        "deleted"
    );
    assert_eq!(
        fs::read(v.source_path(&memory.id)).unwrap(),
        original.as_bytes()
    );
}

#[test]
fn text_capture_rejects_empty_oversized_and_cross_kind_operation_reuse() {
    let f = Fixture::new();
    let v = f.vault();
    assert!(v.capture_text(&op(), " \n\t").is_err());
    assert!(v.capture_text(&op(), &"x".repeat(MAX_NOTE + 1)).is_err());
    assert!(v.capture_text(&op(), "bad\0text").is_err());
    let operation = op();
    v.capture(&operation, "synthetic.png", &photo(), "photo")
        .unwrap();
    assert!(v.capture_text(&operation, "photo").is_err());
    let operation = op();
    v.capture_text(&operation, "text").unwrap();
    assert!(v
        .capture(&operation, "synthetic.png", &photo(), "text")
        .is_err());
}

#[test]
fn text_v5_fence_interruption_recovers_without_losing_original() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let fault = FaultGuard::set(|point, path| {
        if point == "fence_before" && path.ends_with("manifest.json") {
            return Err("synthetic fence interruption".into());
        }
        Ok(())
    });
    assert!(v.capture_text(&operation, "retained text").is_err());
    drop(fault);
    assert_eq!(
        fs::read(v.path(&format!("Sources/{operation}.txt")).as_path()).unwrap(),
        b"retained text"
    );
    let recovered = v.capture_text(&operation, "retained text").unwrap();
    assert_eq!(recovered.note, "retained text");
    assert_eq!(v.history(&operation).unwrap().len(), 1);
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V5
    );
}

#[test]
fn photo_reading_rejects_text_before_fencing_or_creating_a_request() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture_text(&op(), "never send text to photo reader")
        .unwrap();
    let manifest_path = v.path("_meta/manifest.json");
    let before = fs::read(&manifest_path).unwrap();
    assert!(v.prepare_reading(&m.id, m.revision, &op()).is_err());
    assert_eq!(fs::read(manifest_path).unwrap(), before);
    assert!(!v.path("_meta/readings").exists());
}
#[test]
fn operation_retry_is_identical_and_changed_payload_rejected() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let a = v
        .capture(&o, "synthetic.png", &photo(), "uncertain?")
        .unwrap();
    assert_eq!(
        v.capture(&o, "synthetic.png", &photo(), "uncertain?")
            .unwrap()
            .id,
        a.id
    );
    assert!(v.capture(&o, "synthetic.png", &photo(), "changed").is_err());
}
#[test]
fn direct_edit_ingests_and_stale_correction_preserves_disk() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let p = v.note_path(&m.id);
    let edited = fs::read_to_string(&p)
        .unwrap()
        .replace("base", "Obsidian uncertain?");
    fs::write(&p, &edited).unwrap();
    assert!(v.correct(&m.id, 1, &op(), "Recall draft").is_err());
    let listed = v.list("").unwrap();
    assert_eq!(listed[0].revision, 2);
    assert_eq!(listed[0].note, "Obsidian uncertain?");
    assert_eq!(fs::read_to_string(p).unwrap(), edited);
    assert_eq!(v.history(&m.id).unwrap().len(), 2);
}
#[test]
fn correction_retains_versions_and_retry_receipt() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let o = op();
    assert_eq!(v.correct(&m.id, 1, &o, "human?").unwrap().revision, 2);
    assert_eq!(v.correct(&m.id, 1, &o, "human?").unwrap().revision, 2);
    assert!(v.correct(&m.id, 1, &o, "changed").is_err());
    assert_eq!(v.history(&m.id).unwrap()[0].note, "base");
}
#[test]
fn corrupt_original_never_produces_evidence() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::write(v.source_path(&m.id), b"bad").unwrap();
    assert!(v.source(&m.id).is_err());
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert!(v.list("base").unwrap().is_empty());
}
#[test]
fn corrupt_history_is_not_indexed() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::write(v.history_path(&m.id, 1), b"{}").unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert!(v.list("base").unwrap().is_empty());
}
#[test]
fn missing_note_is_not_resurrected() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert!(!v.note_path(&m.id).exists());
    assert!(v.correct(&m.id, 1, &op(), "new").is_err());
}
#[test]
fn independent_vaults_and_unsafe_ids() {
    let a = Fixture::new();
    let b = Fixture::new();
    a.vault()
        .capture(&op(), "synthetic.png", &photo(), "private")
        .unwrap();
    assert!(b.vault().list("").unwrap().is_empty());
    assert!(a.vault().source("../outside").is_err());
}
#[cfg(unix)]
#[test]
fn symlink_escape_rejected() {
    let f = Fixture::new();
    let outside = Fixture::new();
    std::os::unix::fs::symlink(&outside.0, f.0.join("Recall")).unwrap();
    assert!(Vault::open(&f.0).is_err());
}
#[test]
fn unrelated_recall_tree_refused() {
    let f = Fixture::new();
    fs::create_dir(f.0.join("Recall")).unwrap();
    fs::write(f.0.join("Recall/user.md"), "private").unwrap();
    assert!(Vault::open(&f.0).is_err());
}
#[test]
fn interrupted_commit_finishes_from_durable_journal() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let m = v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    assert_eq!(f.vault().list("").unwrap()[0].id, m.id);
    assert!(v.done_path(&o).exists());
}
#[test]
fn late_write_to_preserved_editor_inode_is_diagnosed() {
    use std::io::{Seek, SeekFrom};
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let mut editor = OpenOptions::new()
        .write(true)
        .open(v.note_path(&m.id))
        .unwrap();
    v.correct(&m.id, 1, &op(), "Recall changed").unwrap();
    editor.seek(SeekFrom::Start(0)).unwrap();
    editor.write_all(b"LATE OBSIDIAN DRAFT").unwrap();
    editor.sync_all().unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert!(v.source(&m.id).is_err());
}
#[test]
fn duplicate_note_identity_is_diagnosed() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::copy(v.note_path(&m.id), v.path("Memories/duplicate.md")).unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
}
#[test]
fn changed_source_retry_payload_is_rejected() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    let mut other = photo();
    other.push(1);
    assert!(v.capture(&o, "synthetic.png", &other, "base").is_err());
    assert!(v.capture_receipt(&o, "changed").is_err());
    assert!(v.capture_receipt(&o, "base").unwrap().is_some());
}
#[test]
fn healthy_memory_survives_corrupt_neighbor() {
    let f = Fixture::new();
    let v = f.vault();
    let bad = v
        .capture(&op(), "synthetic.png", &photo(), "broken")
        .unwrap();
    let good = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    fs::write(v.history_path(&bad.id, 1), b"{").unwrap();
    assert_eq!(v.list("").unwrap().len(), 2);
    assert_eq!(v.list("healthy").unwrap()[0].id, good.id);
}
#[test]
fn second_process_writer_lock_is_rejected() {
    let f = Fixture::new();
    let v = f.vault();
    let _lock = v.lock().unwrap();
    assert!(f
        .vault()
        .capture(&op(), "synthetic.png", &photo(), "base")
        .is_err());
}
#[test]
fn recovery_does_not_overwrite_external_edit() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let m = v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    let edited = fs::read_to_string(v.note_path(&m.id))
        .unwrap()
        .replace("base", "external");
    fs::write(v.note_path(&m.id), &edited).unwrap();
    let current = f.vault().capture_receipt(&o, "base").unwrap().unwrap();
    assert_eq!(current.note, "external");
    assert_eq!(current.revision, 2);
    assert_eq!(fs::read_to_string(v.note_path(&m.id)).unwrap(), edited);
}
#[test]
fn settings_restart_and_same_root_reselection_invalidate_requests() {
    let f = Fixture::new();
    let settings = Fixture::new();
    let state = LocalVaultState::new(settings.0.join("settings.json"));
    let first = state.select_path(&f.0).unwrap();
    let token = first.vault_id.unwrap();
    assert!(state.with(&token, |v| v.list("")).is_ok());
    let second = state.select_path(&f.0).unwrap();
    assert_ne!(Some(token.clone()), second.vault_id);
    assert!(state.with(&token, |v| v.list("")).is_err());
    let reopened = LocalVaultState::new(settings.0.join("settings.json"));
    assert_eq!(reopened.status().unwrap().root, first.root);
}
#[test]
fn recover_capture_after_journal_before_note_or_history() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let m = v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    fs::remove_file(v.history_path(&m.id, 1)).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    let recovered = f.vault().capture_receipt(&o, "base").unwrap().unwrap();
    assert_eq!(recovered.id, m.id);
    assert_eq!(v.source(&m.id).unwrap().bytes, photo());
}
#[test]
fn recover_correction_after_base_moved_before_new_note() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let o = op();
    v.correct(&m.id, 1, &o, "corrected").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    fs::remove_file(v.history_path(&m.id, 2)).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    assert_eq!(
        f.vault()
            .correct(&m.id, 1, &o, "corrected")
            .unwrap()
            .revision,
        2
    );
    assert_eq!(v.history(&m.id).unwrap().len(), 2);
}
#[test]
fn interrupted_source_before_journal_reuses_immutable_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    atomic_new(&v.source_path(&o), &photo()).unwrap();
    assert_eq!(
        f.vault()
            .capture(&o, "synthetic.png", &photo(), "base")
            .unwrap()
            .id,
        o
    );
}
#[test]
fn truncated_journal_errors_without_discarding_original() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let m = v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    fs::write(v.journal_path(&o), b"{").unwrap();
    assert!(f.vault().capture_receipt(&o, "base").is_err());
    assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), photo());
}
#[test]
fn pending_conflict_does_not_block_healthy_neighbor() {
    let f = Fixture::new();
    let v = f.vault();
    let a = op();
    let m = v.capture(&a, "synthetic.png", &photo(), "bad").unwrap();
    let good = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    fs::remove_file(v.done_path(&a)).unwrap();
    fs::write(v.note_path(&m.id), "changed by editor").unwrap();
    assert_eq!(v.list("healthy").unwrap()[0].id, good.id);
    assert!(v
        .list("")
        .unwrap()
        .iter()
        .find(|m| m.id == a)
        .unwrap()
        .conflict
        .is_some());
}
#[test]
fn write_failure_cannot_acknowledge_capture() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    fs::create_dir(v.source_path(&o)).unwrap();
    assert!(v.capture(&o, "synthetic.png", &photo(), "base").is_err());
    assert!(!v.done_path(&o).exists());
}
#[test]
fn invalid_image_and_oversized_note_rejected() {
    let f = Fixture::new();
    let v = f.vault();
    assert!(v.capture(&op(), "x.png", b"not an image", "base").is_err());
    assert!(v
        .capture(&op(), "x.png", &photo(), &"a".repeat(MAX_NOTE + 1))
        .is_err());
}
#[test]
fn original_links_have_validated_image_extension() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "camera.unknown", &photo(), "base")
        .unwrap();
    assert_eq!(v.source_path(&m.id).extension().unwrap(), "png");
    assert!(fs::read_to_string(v.note_path(&m.id))
        .unwrap()
        .contains(&format!("../Sources/{}.png", m.id)));
}
#[test]
fn unpublished_history_stage_does_not_break_recovery() {
    let f = Fixture::new();
    let v = f.vault();
    let o = op();
    let m = v.capture(&o, "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.done_path(&o)).unwrap();
    fs::write(
        v.history_path(&m.id, 1)
            .with_extension(format!("stage-{}", Uuid::new_v4())),
        b"partial",
    )
    .unwrap();
    assert!(f.vault().capture_receipt(&o, "base").unwrap().is_some());
}
#[test]
fn malformed_revision_counter_returns_error_instead_of_panicking() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    v.capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    let mut event: Event = decode(&v.journal_path(&operation)).unwrap();
    event.expected_revision = u64::MAX;
    assert!(v.event_valid(&event).is_err());
}

#[test]
fn oversized_neighbor_does_not_disable_healthy_evidence() {
    let f = Fixture::new();
    let v = f.vault();
    let damaged = v
        .capture(&op(), "synthetic.png", &photo(), "damaged")
        .unwrap();
    let healthy = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    fs::write(v.note_path(&damaged.id), vec![b'x'; MAX_JSON as usize + 1]).unwrap();
    assert_eq!(v.list("healthy").unwrap()[0].id, healthy.id);
    assert_eq!(v.source(&healthy.id).unwrap().bytes, photo());
    assert!(v
        .list("")
        .unwrap()
        .iter()
        .find(|m| m.id == damaged.id)
        .unwrap()
        .conflict
        .is_some());
    assert!(v.source(&damaged.id).is_err());
}
fn fill_directory(path: &Path, count: usize) {
    for n in 0..count {
        fs::write(path.join(format!("synthetic-capacity-{n}")), b"").unwrap();
    }
}
#[test]
fn full_journal_refuses_new_capture_before_writing_and_keeps_receipts() {
    let f = Fixture::new();
    let v = f.vault();
    let old = op();
    let m = v
        .capture(&old, "synthetic.png", &photo(), "healthy")
        .unwrap();
    fill_directory(&v.path("_meta/journal"), MAX_RECORDS - 1);
    let new = op();
    assert!(v.capture(&new, "synthetic.png", &photo(), "new").is_err());
    assert!(!v.source_path(&new).exists());
    assert!(!v.journal_path(&new).exists());
    assert_eq!(
        v.capture(&old, "synthetic.png", &photo(), "healthy")
            .unwrap()
            .id,
        m.id
    );
    assert_eq!(v.list("healthy").unwrap()[0].id, m.id);
}
#[test]
fn full_retention_directories_refuse_capture_without_orphaning_source() {
    for directory in ["Sources", "_meta/commits", "Memories", "History"] {
        let f = Fixture::new();
        let v = f.vault();
        fill_directory(&v.path(directory), MAX_RECORDS);
        let operation = op();
        assert!(
            v.capture(&operation, "synthetic.png", &photo(), "new")
                .is_err(),
            "{directory}"
        );
        assert!(!v.source_path(&operation).exists(), "{directory}");
        assert!(!v.journal_path(&operation).exists(), "{directory}");
    }
}
#[test]
fn full_preserved_directory_refuses_correction_before_changing_note() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let before = fs::read(v.note_path(&m.id)).unwrap();
    fill_directory(&v.path("_meta/preserved"), MAX_RECORDS);
    let operation = op();
    assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), before);
    assert!(!v.journal_path(&operation).exists());
    assert_eq!(v.list("base").unwrap()[0].revision, 1);
}
#[test]
fn external_reconciliation_at_capacity_retains_disk_and_prior_history() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fill_directory(&v.path("_meta/journal"), MAX_RECORDS - 1);
    let edited = fs::read_to_string(v.note_path(&m.id))
        .unwrap()
        .replace("base", "external");
    fs::write(v.note_path(&m.id), &edited).unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert_eq!(fs::read_to_string(v.note_path(&m.id)).unwrap(), edited);
    assert_eq!(v.history(&m.id).unwrap().len(), 1);
}

#[test]
fn oversized_duplicate_header_still_blocks_ambiguous_evidence() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let mut duplicate = fs::read(v.note_path(&m.id)).unwrap();
    duplicate.resize(MAX_JSON as usize + 1, b'x');
    fs::write(v.path("Memories/duplicate.md"), duplicate).unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert!(v.source(&m.id).is_err());
}
#[test]
fn history_crash_stages_count_against_future_correction_capacity() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let history_dir = v.history_path(&m.id, 1).parent().unwrap().to_path_buf();
    for _ in 0..MAX_RECORDS - 1 {
        fs::write(
            history_dir.join(format!("synthetic.stage-{}", Uuid::new_v4())),
            b"",
        )
        .unwrap();
    }
    let operation = op();
    assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
    assert!(!v.journal_path(&operation).exists());
    assert_eq!(v.history(&m.id).unwrap().len(), 1);
    assert_eq!(v.list("base").unwrap()[0].revision, 1);
}
#[test]
fn capacity_reserves_staging_headroom_at_last_writable_slot() {
    let f = Fixture::new();
    let v = f.vault();
    fill_directory(&v.path("_meta/commits"), MAX_RECORDS - 2);
    let operation = op();
    let m = v
        .capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    assert_eq!(
        entries(&v.path("_meta/commits")).unwrap().len(),
        MAX_RECORDS - 1
    );
    let refused = op();
    assert!(v
        .capture(&refused, "synthetic.png", &photo(), "new")
        .is_err());
    assert!(!v.source_path(&refused).exists());
    assert_eq!(
        v.capture_receipt(&operation, "base").unwrap().unwrap().id,
        m.id
    );
    assert_eq!(v.list("base").unwrap()[0].id, m.id);
}
#[test]
fn recovery_at_capacity_keeps_pending_draft_and_does_not_publish_partial_note() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let operation = op();
    v.correct(&m.id, 1, &operation, "draft").unwrap();
    fs::remove_file(v.done_path(&operation)).unwrap();
    fs::remove_file(v.history_path(&m.id, 2)).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    fill_directory(&v.path("Memories"), MAX_RECORDS);
    assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
    assert!(!v.note_path(&m.id).exists());
    assert!(v.backup_path(&operation).exists());
    assert!(v.journal_path(&operation).exists());
}
#[test]
fn serialized_metadata_size_is_checked_before_original_is_written() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    assert!(v
        .capture(
            &operation,
            "synthetic.png",
            &photo(),
            &"\u{1}".repeat(MAX_NOTE)
        )
        .is_err());
    assert!(!v.source_path(&operation).exists());
    assert!(!v.journal_path(&operation).exists());
    assert!(v.list("").unwrap().is_empty());
}

#[test]
fn status_exposes_stable_identity_separate_from_selection_permission() {
    let f = Fixture::new();
    let settings = f.0.join("selected-settings.json");
    let state = LocalVaultState::new(settings.clone());
    let selected = state.select_path(&f.0).unwrap();
    let json = serde_json::to_value(&selected).unwrap();
    assert_eq!(json["vault_identity"], f.vault().id);
    assert_ne!(json["vault_identity"], json["vault_id"]);
    let restarted = LocalVaultState::new(settings);
    let after = serde_json::to_value(restarted.status().unwrap()).unwrap();
    assert_eq!(json["vault_identity"], after["vault_identity"]);
    assert_ne!(json["vault_id"], after["vault_id"]);
    assert!(restarted
        .with(json["vault_identity"].as_str().unwrap(), |_| Ok(()))
        .is_err());
}

#[test]
fn filename_only_search_finds_capture_without_note() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "SYNTHETIC-workshop.png", &photo(), "")
        .unwrap();
    assert_eq!(
        v.list("workshop").unwrap().first().map(|m| &m.id),
        Some(&m.id)
    );
}
#[test]
fn filename_search_is_case_insensitive() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "SYNTHETIC-Workshop.PNG", &photo(), "")
        .unwrap();
    assert_eq!(
        v.list("wOrKsHoP").unwrap().first().map(|m| &m.id),
        Some(&m.id)
    );
}
#[test]
fn all_search_terms_may_match_across_note_and_filename_fields() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(
            &op(),
            "SYNTHETIC-workshop.png",
            &photo(),
            "Garden plans uncertain?",
        )
        .unwrap();
    assert_eq!(
        v.list("  WORKSHOP  garden  ")
            .unwrap()
            .first()
            .map(|m| &m.id),
        Some(&m.id)
    );
    assert!(v.list("workshop absent").unwrap().is_empty());
    assert!(v.list("garden absent").unwrap().is_empty());
}
#[test]
fn filename_queries_cannot_promote_corrupt_or_conflicted_memories() {
    let f = Fixture::new();
    let v = f.vault();
    let corrupt = v
        .capture(&op(), "SYNTHETIC-corrupt.png", &photo(), "")
        .unwrap();
    let missing = v
        .capture(&op(), "SYNTHETIC-missing.png", &photo(), "")
        .unwrap();
    fs::write(v.source_path(&corrupt.id), b"corrupt original").unwrap();
    fs::remove_file(v.note_path(&missing.id)).unwrap();
    assert!(v.list("corrupt").unwrap().is_empty());
    assert!(v.list("missing").unwrap().is_empty());
    assert!(v.list("").unwrap().iter().all(|m| m.conflict.is_some()));
}

#[test]
fn lifecycle_unique_rename_reconciles_edit_and_keeps_basename() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let renamed = v.path("Memories/Synthetic renamed.md");
    fs::rename(v.note_path(&m.id), &renamed).unwrap();
    let found = v.list("").unwrap().remove(0);
    assert!(
        found.conflict.is_none(),
        "unique stable identity rename must remain eligible"
    );
    assert_eq!(
        serde_json::to_value(&found).unwrap()["note_path"],
        "Synthetic renamed.md"
    );
    fs::write(
        &renamed,
        fs::read_to_string(&renamed)
            .unwrap()
            .replace("base", "external?"),
    )
    .unwrap();
    assert_eq!(v.list("").unwrap()[0].revision, 2);
    v.correct(&m.id, 2, &op(), "corrected?").unwrap();
    assert!(!v.note_path(&m.id).exists());
    assert!(fs::read_to_string(&renamed)
        .unwrap()
        .ends_with("corrected?"));
    assert_eq!(f.vault().list("").unwrap()[0].revision, 3);
}

#[test]
fn lifecycle_old_capture_retry_returns_current_authoritative_revision() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let m = v
        .capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    v.correct(&m.id, 1, &op(), "current").unwrap();
    assert_eq!(
        v.capture_receipt(&operation, "base")
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    assert_eq!(
        v.capture(&operation, "synthetic.png", &photo(), "base")
            .unwrap()
            .note,
        "current"
    );
}

#[test]
fn lifecycle_parent_hash_uses_exact_stored_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let m = v
        .capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    let value: serde_json::Value = decode(&v.history_path(&m.id, 1)).unwrap();
    let bytes = serde_json::to_vec_pretty(&value).unwrap();
    fs::write(v.history_path(&m.id, 1), &bytes).unwrap();
    fs::write(v.journal_path(&operation), &bytes).unwrap();
    fs::write(v.done_path(&operation), hash(&bytes)).unwrap();
    v.correct(&m.id, 1, &op(), "current").unwrap();
    let child: Event = decode(&v.history_path(&m.id, 2)).unwrap();
    assert_eq!(child.parent_sha256, Some(hash(&bytes)));
    assert_eq!(f.vault().history(&m.id).unwrap().len(), 2);
}

#[test]
fn lifecycle_missing_old_receipt_never_replays_over_later_head() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let m = v
        .capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    v.correct(&m.id, 1, &op(), "later").unwrap();
    let bytes = fs::read(v.note_path(&m.id)).unwrap();
    fs::remove_file(v.done_path(&operation)).unwrap();
    assert_eq!(
        v.capture_receipt(&operation, "base")
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), bytes);
}

#[test]
fn lifecycle_pending_revision_forks_publish_neither_variant() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let before = fs::read(v.note_path(&m.id)).unwrap();
    let operation = op();
    v.correct(&m.id, 1, &operation, "first fork").unwrap();
    let mut competing: Event = decode(&v.journal_path(&operation)).unwrap();
    fs::remove_file(v.done_path(&operation)).unwrap();
    fs::remove_file(v.history_path(&m.id, 2)).unwrap();
    fs::write(v.note_path(&m.id), &before).unwrap();
    fs::remove_file(v.backup_path(&operation)).unwrap();
    competing.operation_id = op();
    competing.memory.note = "second fork".into();
    competing.markdown = markdown(&competing.memory);
    competing.payload_sha256 = payload(
        "correct",
        &m.id,
        1,
        "second fork",
        &m.source_sha256,
        &m.source_name,
    )
    .unwrap();
    fs::write(
        v.journal_path(&competing.operation_id),
        json(&competing).unwrap(),
    )
    .unwrap();
    assert!(v.list("").unwrap()[0].conflict.is_some());
    assert_eq!(
        fs::read(v.note_path(&m.id)).unwrap(),
        before,
        "UUID ordering cannot select a fork winner"
    );
    assert!(!v.history_path(&m.id, 2).exists());
}

#[test]
fn lifecycle_explicit_restore_is_revisioned_and_stale_confirmation_preserves_editor() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let before = fs::read(v.note_path(&m.id)).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "missing");
    assert!(v.restore_note(&m.id, 2, &op()).is_err());
    let restore = op();
    let restored = v.restore_note(&m.id, 1, &restore).unwrap();
    assert_eq!(restored.state, "active");
    assert_eq!(restored.revision, 2);
    assert_eq!(v.restore_note(&m.id, 1, &restore).unwrap().revision, 2);
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), before);
    assert_eq!(v.history(&m.id).unwrap()[1].kind, "restore");
    fs::remove_file(v.note_path(&m.id)).unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "missing");
    fs::write(v.note_path(&m.id), &before).unwrap();
    assert!(v.restore_note(&m.id, 2, &op()).is_err());
    assert!(v.remove(&m.id, 2, &op(), "missing").is_err());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), before);
}

#[test]
fn lifecycle_removal_retains_bytes_and_dominates_old_receipts() {
    let f = Fixture::new();
    let v = f.vault();
    let capture = op();
    let m = v
        .capture(&capture, "synthetic.png", &photo(), "base")
        .unwrap();
    let correction = op();
    v.correct(&m.id, 1, &correction, "current").unwrap();
    let note = fs::read(v.note_path(&m.id)).unwrap();
    let original = fs::read(v.source_path(&m.id)).unwrap();
    let removal = op();
    let removed = v.remove(&m.id, 2, &removal, "active").unwrap();
    assert_eq!(removed.state, "deleted");
    assert_eq!(removed.revision, 3);
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), note);
    assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), original);
    assert!(v.list("").unwrap().is_empty());
    assert!(v.list("current").unwrap().is_empty());
    assert!(v.source(&m.id).is_err());
    assert_eq!(v.history(&m.id).unwrap()[2].kind, "remove");
    assert_eq!(
        v.remove(&m.id, 2, &removal, "active").unwrap().state,
        "deleted"
    );
    assert!(v.remove(&m.id, 2, &removal, "missing").is_err());
    assert!(v.restore_note(&m.id, 3, &op()).is_err());
    assert!(v.correct(&m.id, 3, &op(), "resurrect").is_err());
    assert_eq!(
        v.capture(&capture, "synthetic.png", &photo(), "base")
            .unwrap()
            .state,
        "deleted"
    );
    assert_eq!(
        v.correct(&m.id, 1, &correction, "current").unwrap().state,
        "deleted"
    );
    fs::remove_file(v.done_path(&capture)).unwrap();
    fs::remove_file(v.done_path(&correction)).unwrap();
    fs::write(v.note_path(&m.id), b"EXTERNAL EDIT AFTER TOMBSTONE").unwrap();
    assert_eq!(
        f.vault()
            .capture_receipt(&capture, "base")
            .unwrap()
            .unwrap()
            .state,
        "deleted"
    );
    assert_eq!(
        fs::read(v.note_path(&m.id)).unwrap(),
        b"EXTERNAL EDIT AFTER TOMBSTONE"
    );
}

// Test-only, thread-scoped hooks observe real disk operations. No environment
// variable or production mode can enable these faults.
type FaultHook = Box<dyn FnMut(&str, &Path) -> Result<()>>;
thread_local! { static FAULT: std::cell::RefCell<Option<FaultHook>> = const { std::cell::RefCell::new(None) }; }
pub(super) fn boundary(point: &str, path: &Path) -> Result<()> {
    FAULT.with(|slot| match slot.borrow_mut().as_mut() {
        Some(hook) => hook(point, path),
        None => Ok(()),
    })
}
struct FaultGuard;
impl FaultGuard {
    fn set(hook: impl FnMut(&str, &Path) -> Result<()> + 'static) -> Self {
        FAULT.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
        Self
    }
}
impl Drop for FaultGuard {
    fn drop(&mut self) {
        FAULT.with(|slot| *slot.borrow_mut() = None);
    }
}

#[test]
fn lifecycle_injected_disk_errors_never_acknowledge_partial_operations() {
    for kind in ["capture", "correct", "restore", "remove"] {
        for directory in [
            "Sources",
            "_meta/journal",
            "Memories",
            "History",
            "_meta/commits",
        ] {
            if directory == "Sources" && kind != "capture"
                || directory == "Memories" && kind == "remove"
            {
                continue;
            }
            for point in [
                "create_before",
                "write_after",
                "sync_before",
                "sync_after",
                "publish_before",
                "publish_after",
                "cleanup_before",
            ] {
                let f = Fixture::new();
                let v = f.vault();
                let neighbor = v
                    .capture(&op(), "synthetic.png", &photo(), "healthy neighbor")
                    .unwrap();
                let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
                if kind == "restore" {
                    fs::remove_file(v.note_path(&m.id)).unwrap();
                }
                let original = fs::read(v.source_path(&m.id)).unwrap();
                let first_history = fs::read(v.history_path(&m.id, 1)).unwrap();
                let operation = op();
                let target = v.path(directory);
                let hit = std::rc::Rc::new(std::cell::Cell::new(false));
                let observed = hit.clone();
                let fault = FaultGuard::set(move |at, path| {
                    if at == point && path.starts_with(&target) && !observed.replace(true) {
                        return Err(format!(
                            "INJECTED {}",
                            std::io::Error::from_raw_os_error(if at == "create_before" {
                                30
                            } else {
                                28
                            })
                        ));
                    }
                    Ok(())
                });
                let attempt = || match kind {
                    "capture" => v.capture(&operation, "synthetic.png", &photo(), "captured"),
                    "correct" => v.correct(&m.id, 1, &operation, "corrected"),
                    "restore" => v.restore_note(&m.id, 1, &operation),
                    _ => v.remove(&m.id, 1, &operation, "active"),
                };
                assert!(
                    attempt().is_err(),
                    "{kind}/{directory}/{point} acknowledged injected failure"
                );
                assert!(
                    hit.get(),
                    "fault boundary did not execute: {kind}/{directory}/{point}"
                );
                drop(fault);
                let reopened = f.vault();
                assert_eq!(
                    reopened.list("healthy neighbor").unwrap()[0].id,
                    neighbor.id
                );
                assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), original);
                assert_eq!(fs::read(v.history_path(&m.id, 1)).unwrap(), first_history);
                // A restore interrupted after note publication deliberately stays
                // diagnostic: an identical external return cannot be distinguished.
                match attempt() {
                    Ok(current) => assert_eq!(
                        current.state,
                        if kind == "remove" {
                            "deleted"
                        } else {
                            "active"
                        }
                    ),
                    Err(_) => {
                        assert!(v.journal_path(&operation).exists());
                        let all = reopened.list_with_deleted("", true).unwrap();
                        assert!(
                            all.iter().any(|row| row.conflict.is_some()),
                            "missing recovery diagnostic {kind}/{directory}/{point}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn lifecycle_restore_returned_note_after_journal_is_not_adopted() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let bytes = fs::read(v.note_path(&m.id)).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    let note = v.note_path(&m.id);
    let copied = bytes.clone();
    let _fault = FaultGuard::set(move |point, _| {
        if point == "before_note" {
            fs::write(&note, &copied).unwrap();
        }
        Ok(())
    });
    assert!(v.restore_note(&m.id, 1, &op()).is_err());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), bytes);
    assert!(!v.history_path(&m.id, 2).exists());
}

// Independent v1 wire fixture: no current Event/VaultMemory serialization builds
// these bytes. Whitespace and key ordering intentionally differ by revision.
fn legacy_fixture(v: &Vault) -> (String, String, Vec<Vec<u8>>) {
    let memory = op();
    let correction = op();
    let stamp = "2026-10-07T12:00:00Z";
    fs::write(v.source_path(&memory), photo()).unwrap();
    fs::create_dir(v.path(&format!("History/{memory}"))).unwrap();
    let mut bytes: Vec<Vec<u8>> = Vec::new();
    let mut previous: Option<String> = None;
    for (revision, kind, operation, note) in [
        (1, "capture", &memory, "v1 base"),
        (2, "correct", &correction, "v1 latest?"),
    ] {
        let markdown = format!("<!-- Recall memory {memory} | human annotation, not OCR -->\n[Original photo](../Sources/{memory}.png)\n\n{note}");
        let value = serde_json::json!({
            "format": "recall-local-vault-v1", "vault_id": v.id, "operation_id": operation,
            "kind": kind, "expected_revision": revision - 1,
            "payload_sha256": hash(&serde_json::to_vec(&(kind, &memory, revision - 1, note, hash(&photo()), "synthetic.png")).unwrap()),
            "parent_sha256": bytes.last().map(|b| hash(b)), "origin": "human:recall",
            "memory": { "id": memory, "revision": revision, "note": note,
                "source_sha256": hash(&photo()), "source_name": "synthetic.png", "captured_at": stamp, "updated_at": stamp, "conflict": null },
            "previous_markdown": previous, "markdown": markdown,
        });
        let raw = if revision == 1 {
            serde_json::to_vec_pretty(&value).unwrap()
        } else {
            serde_json::to_vec(&value).unwrap()
        };
        fs::write(v.history_path(&memory, revision), &raw).unwrap();
        fs::write(v.journal_path(operation), &raw).unwrap();
        fs::write(v.done_path(operation), hash(&raw)).unwrap();
        if let Some(prior) = previous {
            fs::write(v.backup_path(operation), prior).unwrap();
        }
        previous = Some(markdown);
        bytes.push(raw);
    }
    fs::write(v.note_path(&memory), previous.unwrap()).unwrap();
    (memory, correction, bytes)
}

#[test]
fn lifecycle_v1_multirevision_bytes_receipts_backups_survive_v2_transition() {
    let f = Fixture::new();
    let v = f.vault();
    let manifest = fs::read(v.path("_meta/manifest.json")).unwrap();
    let (memory, correction, bytes) = legacy_fixture(&v);
    assert_eq!(f.vault().list("").unwrap()[0].revision, 2);
    assert_eq!(fs::read(v.path("_meta/manifest.json")).unwrap(), manifest);
    assert_eq!(
        v.capture_receipt(&memory, "v1 base").unwrap().unwrap().note,
        "v1 latest?"
    );
    let backup = fs::read(v.backup_path(&correction)).unwrap();
    for (index, raw) in bytes.iter().enumerate() {
        let decoded: Event = serde_json::from_slice(raw).unwrap();
        let normalized = serde_json::to_value(&decoded).unwrap();
        assert_eq!(
            normalized,
            serde_json::from_slice::<serde_json::Value>(raw).unwrap()
        );
        assert!(normalized.get("note_path").is_none());
        assert!(normalized["memory"].get("state").is_none());
        assert_eq!(
            fs::read(v.history_path(&memory, index as u64 + 1)).unwrap(),
            *raw
        );
    }
    v.correct(&memory, 2, &op(), "v2 correction").unwrap();
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V2
    );
    // This is the exact old binary's writer-version rejection predicate.
    assert_ne!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT
    );
    assert_eq!(
        fs::read(v.path("_meta/manifest-v1.json")).unwrap(),
        manifest
    );
    assert_eq!(fs::read(v.backup_path(&correction)).unwrap(), backup);
    assert_eq!(v.history(&memory).unwrap().len(), 3);
    for (index, raw) in bytes.iter().enumerate() {
        assert_eq!(
            fs::read(v.history_path(&memory, index as u64 + 1)).unwrap(),
            *raw
        );
    }
}

#[test]
fn lifecycle_pending_v1_recovers_exact_bytes_without_fencing_a_read() {
    let f = Fixture::new();
    let v = f.vault();
    let (memory, correction, bytes) = legacy_fixture(&v);
    fs::remove_file(v.done_path(&correction)).unwrap();
    fs::remove_file(v.history_path(&memory, 2)).unwrap();
    fs::remove_file(v.note_path(&memory)).unwrap();
    assert_eq!(f.vault().list("").unwrap()[0].note, "v1 latest?");
    assert_eq!(fs::read(v.history_path(&memory, 2)).unwrap(), bytes[1]);
    assert_eq!(
        fs::read(v.done_path(&correction)).unwrap(),
        hash(&bytes[1]).as_bytes()
    );
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT
    );
}

#[test]
fn lifecycle_interrupted_version_fence_remains_reopenable_with_original_v1_bytes() {
    for point in ["fence_before", "fence_after"] {
        let f = Fixture::new();
        let v = f.vault();
        let (memory, _, bytes) = legacy_fixture(&v);
        let operation = op();
        let fault = FaultGuard::set(move |at, _| {
            if at == point {
                return Err("INJECTED manifest transition interruption".into());
            }
            Ok(())
        });
        assert!(v.correct(&memory, 2, &operation, "v2").is_err());
        drop(fault);
        assert!(!v.journal_path(&operation).exists());
        assert_eq!(f.vault().list("").unwrap()[0].note, "v1 latest?");
        assert_eq!(
            decode::<Manifest>(&v.path("_meta/manifest.json"))
                .unwrap()
                .format,
            if point == "fence_before" {
                FORMAT
            } else {
                FORMAT_V2
            }
        );
        v.correct(&memory, 2, &operation, "v2").unwrap();
        for (index, raw) in bytes.iter().enumerate() {
            assert_eq!(
                fs::read(v.history_path(&memory, index as u64 + 1)).unwrap(),
                *raw
            );
        }
    }
}

#[test]
fn lifecycle_journaled_correction_rename_or_duplicate_never_publishes() {
    for duplicate in [false, true] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let original = v.note_path(&m.id);
        let renamed = v.path("Memories/Editor renamed.md");
        let saved = fs::read(&original).unwrap();
        let new_path = renamed.clone();
        let _fault = FaultGuard::set(move |point, _| {
            if point == "before_note" {
                if duplicate {
                    fs::copy(&original, &new_path).unwrap();
                } else {
                    fs::rename(&original, &new_path).unwrap();
                }
            }
            Ok(())
        });
        let operation = op();
        assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
        assert_eq!(fs::read(renamed).unwrap(), saved);
        assert!(!v.history_path(&m.id, 2).exists());
        assert!(v.journal_path(&operation).exists());
    }
}

#[test]
fn lifecycle_journaled_missing_removal_rechecks_reappearance() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let note = v.note_path(&m.id);
    let bytes = fs::read(&note).unwrap();
    fs::remove_file(&note).unwrap();
    let external = bytes.clone();
    let fault = FaultGuard::set(move |point, _| {
        if point == "before_history" {
            fs::write(&note, &external).unwrap();
        }
        Ok(())
    });
    let operation = op();
    assert!(v.remove(&m.id, 1, &operation, "missing").is_err());
    drop(fault);
    assert!(!v.history_path(&m.id, 2).exists());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), bytes);
    assert!(v.remove(&m.id, 1, &operation, "missing").is_err());
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
}

#[test]
fn lifecycle_missing_removal_restore_receipt_and_damaged_original_history() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    let restore = op();
    v.restore_note(&m.id, 1, &restore).unwrap();
    fs::remove_file(v.note_path(&m.id)).unwrap();
    v.remove(&m.id, 2, &op(), "missing").unwrap();
    assert!(!v.note_path(&m.id).exists());
    assert_eq!(v.restore_note(&m.id, 1, &restore).unwrap().state, "deleted");
    fs::write(v.source_path(&m.id), b"DAMAGED SYNTHETIC ORIGINAL").unwrap();
    assert_eq!(v.history(&m.id).unwrap().len(), 3);
    assert_eq!(v.list_with_deleted("", true).unwrap()[0].state, "deleted");
    assert!(v.source(&m.id).is_err());
}

#[test]
fn lifecycle_renamed_basename_participates_in_keyword_search() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "synthetic.png", &photo(), "Garden uncertain?")
        .unwrap();
    fs::rename(v.note_path(&m.id), v.path("Memories/Workshop Sketch.md")).unwrap();
    assert_eq!(v.list("wOrKsHoP garden").unwrap()[0].id, m.id);
    assert!(v.list("workshop absent").unwrap().is_empty());
    fs::copy(
        v.path("Memories/Workshop Sketch.md"),
        v.path("Memories/duplicate.md"),
    )
    .unwrap();
    assert!(v.list("workshop").unwrap().is_empty());
}

#[test]
fn lifecycle_nested_move_stays_conflict_and_cannot_be_restored() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    fs::create_dir(v.path("Memories/Nested")).unwrap();
    fs::rename(v.note_path(&m.id), v.path("Memories/Nested/renamed.md")).unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
    assert!(v.restore_note(&m.id, 1, &op()).is_err());
    assert!(v.remove(&m.id, 1, &op(), "missing").is_err());
    assert!(!v.note_path(&m.id).exists());
}

#[test]
fn lifecycle_receipt_rejects_journal_payload_changed_after_commit() {
    let f = Fixture::new();
    let v = f.vault();
    let operation = op();
    let m = v
        .capture(&operation, "synthetic.png", &photo(), "base")
        .unwrap();
    let mut event: Event = decode(&v.journal_path(&operation)).unwrap();
    event.memory.note = "forged historical payload".into();
    event.markdown = markdown(&event.memory);
    event.payload_sha256 = payload(
        "capture",
        &m.id,
        0,
        &event.memory.note,
        &m.source_sha256,
        &m.source_name,
    )
    .unwrap();
    fs::write(v.journal_path(&operation), json(&event).unwrap()).unwrap();
    assert!(v
        .capture_receipt(&operation, "forged historical payload")
        .is_err());
    assert!(v.list("base").unwrap().is_empty());
}

#[test]
fn lifecycle_old_receipt_cannot_bypass_pending_correction_conflict() {
    let f = Fixture::new();
    let v = f.vault();
    let capture = op();
    let m = v
        .capture(&capture, "synthetic.png", &photo(), "base")
        .unwrap();
    let correction = op();
    v.correct(&m.id, 1, &correction, "draft").unwrap();
    fs::remove_file(v.history_path(&m.id, 2)).unwrap();
    fs::remove_file(v.done_path(&correction)).unwrap();
    fs::write(v.note_path(&m.id), "EXTERNAL EDITOR BYTES").unwrap();
    assert!(v.capture_receipt(&capture, "base").is_err());
    assert_eq!(
        fs::read(v.note_path(&m.id)).unwrap(),
        b"EXTERNAL EDITOR BYTES"
    );
}

#[test]
fn lifecycle_backup_rename_faults_preserve_base_and_retry() {
    for point in ["rename_before", "rename_after"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let original = fs::read(v.note_path(&m.id)).unwrap();
        let fault = FaultGuard::set(move |at, _| {
            if at == point {
                return Err("INJECTED backup rename interruption".into());
            }
            Ok(())
        });
        let operation = op();
        assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
        drop(fault);
        let retained = if point == "rename_before" {
            v.note_path(&m.id)
        } else {
            v.backup_path(&operation)
        };
        assert_eq!(fs::read(retained).unwrap(), original);
        assert_eq!(
            f.vault()
                .correct(&m.id, 1, &operation, "draft")
                .unwrap()
                .note,
            "draft"
        );
        assert_eq!(fs::read(v.backup_path(&operation)).unwrap(), original);
    }
}

#[test]
fn lifecycle_tombstone_receipt_and_cleanup_interruptions_resolve_authoritatively() {
    for point in [
        "before_history",
        "before_receipt",
        "after_receipt",
        "cleanup_after",
    ] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let bytes = fs::read(v.note_path(&m.id)).unwrap();
        let commits = v.path("_meta/commits");
        let fault = FaultGuard::set(move |at, path| {
            if at == point && (point != "cleanup_after" || path.starts_with(&commits)) {
                return Err("INJECTED tombstone interruption".into());
            }
            Ok(())
        });
        let operation = op();
        assert!(v.remove(&m.id, 1, &operation, "active").is_err());
        drop(fault);
        assert_eq!(
            f.vault()
                .remove(&m.id, 1, &operation, "active")
                .unwrap()
                .state,
            "deleted"
        );
        assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), bytes);
        assert!(v.list("").unwrap().is_empty());
    }
}

#[test]
fn lifecycle_partial_staged_metadata_and_malformed_neighbor_remain_diagnostic() {
    let f = Fixture::new();
    let v = f.vault();
    let good = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    let journals = v.path("_meta/journal");
    let fault = FaultGuard::set(move |point, path| {
        if point == "write_after" && path.starts_with(&journals) {
            fs::write(path, b"{").unwrap();
            return Err("INJECTED partial metadata write".into());
        }
        Ok(())
    });
    let capture = op();
    assert!(v
        .capture(&capture, "synthetic.png", &photo(), "pending")
        .is_err());
    drop(fault);
    assert!(!v.journal_path(&capture).exists());
    assert!(entries(&v.path("_meta/journal")).unwrap().iter().any(|p| p
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .starts_with("stage-")
        && fs::read(p).unwrap() == b"{"));
    v.capture(&capture, "synthetic.png", &photo(), "pending")
        .unwrap();
    fs::write(v.journal_path(&capture), b"{").unwrap();
    assert_eq!(f.vault().list("healthy").unwrap()[0].id, good.id);
    assert!(v.list("pending").unwrap().is_empty());
    assert!(v
        .list("")
        .unwrap()
        .iter()
        .any(|m| m.id == capture && m.state == "conflict"));
}

#[test]
fn lifecycle_strict_v1_unknown_fields_and_unsafe_v2_paths_are_rejected() {
    let f = Fixture::new();
    let v = f.vault();
    let (memory, _, bytes) = legacy_fixture(&v);
    let old: serde_json::Value = serde_json::from_slice(&bytes[0]).unwrap();
    for (key, value) in [
        ("note_path", serde_json::Value::Null),
        ("note_path", serde_json::json!("note.md")),
        ("expected_state", serde_json::Value::Null),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut changed = old.clone();
        changed[key] = value;
        assert!(serde_json::from_value::<Event>(changed)
            .and_then(|e| v.event_valid(&e).map_err(serde::de::Error::custom))
            .is_err());
    }
    let mut e: Event = serde_json::from_slice(&bytes[0]).unwrap();
    e.format = FORMAT_V2.into();
    for path in [
        "../escape.md",
        "Nested/note.md",
        "C:\\escape.md",
        "bad.txt",
        "/absolute.md",
    ] {
        e.note_path = Some(path.into());
        assert!(v.event_valid(&e).is_err());
    }
    assert_eq!(v.history(&memory).unwrap().len(), 2);
}

fn copy_synthetic_tree(source: &Path, destination: &Path) {
    fs::create_dir(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_synthetic_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn lifecycle_copied_complete_vault_rebuilds_deterministically() {
    let f = Fixture::new();
    let v = f.vault();
    let active = v
        .capture(&op(), "synthetic.png", &photo(), "active")
        .unwrap();
    fs::rename(v.note_path(&active.id), v.path("Memories/Renamed.md")).unwrap();
    let missing = v
        .capture(&op(), "synthetic.png", &photo(), "missing")
        .unwrap();
    fs::remove_file(v.note_path(&missing.id)).unwrap();
    let deleted = v
        .capture(&op(), "synthetic.png", &photo(), "deleted")
        .unwrap();
    v.remove(&deleted.id, 1, &op(), "active").unwrap();
    let corrupt = v
        .capture(&op(), "synthetic.png", &photo(), "corrupt")
        .unwrap();
    fs::write(v.source_path(&corrupt.id), b"SYNTHETIC DAMAGE").unwrap();
    let pending = op();
    let fault = FaultGuard::set(|point, _| {
        if point == "before_note" {
            Err("INJECTED pending capture".into())
        } else {
            Ok(())
        }
    });
    assert!(v
        .capture(&pending, "synthetic.png", &photo(), "pending")
        .is_err());
    drop(fault);
    fs::write(v.note_path(&pending), b"USER CREATED FILE").unwrap();
    let first = serde_json::to_value(v.list_with_deleted("", true).unwrap()).unwrap();
    let copy = Fixture::new();
    copy_synthetic_tree(&v.path(""), &copy.0.join("Recall"));
    for _ in 0..3 {
        assert_eq!(
            serde_json::to_value(f.vault().list_with_deleted("", true).unwrap()).unwrap(),
            first
        );
        assert_eq!(
            serde_json::to_value(copy.vault().list_with_deleted("", true).unwrap()).unwrap(),
            first
        );
        assert_eq!(copy.vault().list("active").unwrap()[0].id, active.id);
        assert_eq!(copy.vault().history(&active.id).unwrap().len(), 1);
        assert_eq!(copy.vault().history(&deleted.id).unwrap().len(), 2);
    }
    assert_eq!(first.as_array().unwrap().len(), 5);
    assert!(first
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["state"] == "missing"));
    assert!(first
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["state"] == "deleted"));
    assert_eq!(
        fs::read(copy.vault().note_path(&pending)).unwrap(),
        b"USER CREATED FILE"
    );
}

#[test]
fn lifecycle_changed_header_occupied_canonical_and_unsafe_neighbor_never_overwrite() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let canonical = v.note_path(&m.id);
    let renamed = v.path("Memories/Renamed.md");
    fs::rename(&canonical, &renamed).unwrap();
    fs::write(&canonical, b"UNRELATED USER NOTE").unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
    assert!(v.correct(&m.id, 1, &op(), "draft").is_err());
    assert_eq!(fs::read(&canonical).unwrap(), b"UNRELATED USER NOTE");
    fs::remove_file(&canonical).unwrap();
    let changed = fs::read_to_string(&renamed)
        .unwrap()
        .replace("../Sources/", "../Elsewhere/");
    fs::write(&renamed, &changed).unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
    assert!(v.source(&m.id).is_err());
    assert_eq!(fs::read_to_string(&renamed).unwrap(), changed);
}

#[test]
fn lifecycle_backup_created_during_publication_is_never_replaced() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let operation = op();
    let backup = v.backup_path(&operation);
    let inserted = backup.clone();
    let original = fs::read(v.note_path(&m.id)).unwrap();
    let _fault = FaultGuard::set(move |point, _| {
        if point == "rename_before" {
            fs::write(&inserted, b"EXTERNAL USER BACKUP").unwrap();
        }
        Ok(())
    });
    assert!(v.correct(&m.id, 1, &operation, "draft").is_err());
    assert_eq!(fs::read(backup).unwrap(), b"EXTERNAL USER BACKUP");
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), original);
}

#[test]
fn lifecycle_correction_without_disk_precondition_is_invalid() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let operation = op();
    v.correct(&m.id, 1, &operation, "draft").unwrap();
    let mut event: Event = decode(&v.journal_path(&operation)).unwrap();
    event.previous_markdown = None;
    assert!(v.event_valid(&event).is_err());
}

#[test]
fn lifecycle_stale_pending_operation_after_tombstone_remains_deleted() {
    let f = Fixture::new();
    let v = f.vault();
    let capture = op();
    let m = v
        .capture(&capture, "synthetic.png", &photo(), "base")
        .unwrap();
    let removal = op();
    v.remove(&m.id, 1, &removal, "active").unwrap();
    let mut stale: Event = decode(&v.journal_path(&removal)).unwrap();
    stale.operation_id = op();
    stale.kind = "correct".into();
    stale.expected_state = None;
    stale.expected_revision = 2;
    stale.memory.revision = 3;
    stale.memory.note = "must not resurrect".into();
    stale.parent_sha256 = Some(hash(&fs::read(v.history_path(&m.id, 2)).unwrap()));
    stale.markdown = markdown(&stale.memory);
    stale.payload_sha256 = payload(
        "correct",
        &m.id,
        2,
        &stale.memory.note,
        &m.source_sha256,
        &m.source_name,
    )
    .unwrap();
    fs::write(v.journal_path(&stale.operation_id), json(&stale).unwrap()).unwrap();
    let before = fs::read(v.note_path(&m.id)).unwrap();
    assert!(v.list("").unwrap().is_empty());
    let removed = v.list_with_deleted("", true).unwrap().remove(0);
    assert_eq!(removed.state, "deleted");
    assert!(removed.conflict.is_some());
    assert_eq!(
        v.capture_receipt(&capture, "base").unwrap().unwrap().state,
        "deleted"
    );
    assert_eq!(v.history(&m.id).unwrap().len(), 2);
    assert!(!v.history_path(&m.id, 3).exists());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), before);
}

#[test]
fn lifecycle_v1_serializer_matches_original_field_order_byte_for_byte() {
    let f = Fixture::new();
    let v = f.vault();
    let (_, _, records) = legacy_fixture(&v);
    // Frozen field order from v1's Event and VaultMemory declarations. This is
    // independent of the current structs and catches accidental added fields.
    let event_fields = [
        "format",
        "vault_id",
        "operation_id",
        "kind",
        "expected_revision",
        "payload_sha256",
        "parent_sha256",
        "origin",
        "memory",
        "previous_markdown",
        "markdown",
    ];
    let memory_fields = [
        "id",
        "revision",
        "note",
        "source_sha256",
        "source_name",
        "captured_at",
        "updated_at",
        "conflict",
    ];
    for bytes in records {
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let memory = format!(
            "{{{}}}",
            memory_fields
                .iter()
                .map(|key| format!(
                    "{}:{}",
                    serde_json::to_string(key).unwrap(),
                    serde_json::to_string(&value["memory"][key]).unwrap()
                ))
                .collect::<Vec<_>>()
                .join(",")
        );
        let golden = format!(
            "{{{}}}",
            event_fields
                .iter()
                .map(|key| format!(
                    "{}:{}",
                    serde_json::to_string(key).unwrap(),
                    if *key == "memory" {
                        memory.clone()
                    } else {
                        serde_json::to_string(&value[key]).unwrap()
                    }
                ))
                .collect::<Vec<_>>()
                .join(",")
        );
        let decoded: Event = serde_json::from_slice(golden.as_bytes()).unwrap();
        assert_eq!(json(&decoded).unwrap(), golden.as_bytes());
        v.event_valid(&decoded).unwrap();
    }
}

#[test]
fn lifecycle_malformed_correction_journal_cannot_leave_its_memory_eligible() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let good = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    let correction = op();
    v.correct(&m.id, 1, &correction, "changed").unwrap();
    fs::write(v.journal_path(&correction), b"{").unwrap();
    assert!(v.list("changed").unwrap().is_empty());
    assert!(v.source(&m.id).is_err());
    assert_eq!(v.list("healthy").unwrap()[0].id, good.id);
}

#[test]
fn lifecycle_unattributable_journal_refuses_rebuild_without_mutating_files() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "synthetic.png", &photo(), "healthy")
        .unwrap();
    let original = fs::read(v.note_path(&m.id)).unwrap();
    fs::write(v.path("_meta/journal/unattributable.json"), b"{").unwrap();
    assert!(v.list_with_deleted("", true).is_err());
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), original);
}

#[test]
fn review_fork_and_missing_old_marker_preserve_terminal_tombstone() {
    let f = Fixture::new();
    let v = f.vault();
    let capture = op();
    let m = v
        .capture(&capture, "synthetic.png", &photo(), "base")
        .unwrap();
    let removal = op();
    v.remove(&m.id, 1, &removal, "active").unwrap();
    let mut fork: Event = decode(&v.journal_path(&removal)).unwrap();
    fork.operation_id = op();
    fork.kind = "correct".into();
    fork.expected_state = None;
    fork.memory.note = "stale competing draft".into();
    fork.markdown = markdown(&fork.memory);
    fork.payload_sha256 = payload(
        "correct",
        &m.id,
        1,
        &fork.memory.note,
        &m.source_sha256,
        &m.source_name,
    )
    .unwrap();
    v.event_valid(&fork).unwrap();
    let fork_bytes = json(&fork).unwrap();
    fs::write(v.journal_path(&fork.operation_id), &fork_bytes).unwrap();
    fs::remove_file(v.done_path(&capture)).unwrap();
    let note = fs::read(v.note_path(&m.id)).unwrap();
    let original = fs::read(v.source_path(&m.id)).unwrap();
    let histories: Vec<_> = (1..=2)
        .map(|revision| fs::read(v.history_path(&m.id, revision)).unwrap())
        .collect();
    assert_eq!(
        v.records_inner(&m.id, false).unwrap().last().unwrap().kind,
        "remove"
    );
    for _ in 0..2 {
        let all = f.vault().list_with_deleted("", true).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].state, "deleted");
        assert_eq!(all[0].revision, 2);
        assert!(all[0]
            .conflict
            .as_deref()
            .unwrap()
            .contains("Competing journal"));
        assert!(v.list("").unwrap().is_empty());
        assert!(v.list("base").unwrap().is_empty());
        assert!(v.source(&m.id).is_err());
        assert_eq!(v.history(&m.id).unwrap().last().unwrap().kind, "remove");
        assert_eq!(
            v.capture_receipt(&capture, "base").unwrap().unwrap().state,
            "deleted"
        );
        assert_eq!(
            v.capture(&capture, "synthetic.png", &photo(), "base")
                .unwrap()
                .state,
            "deleted"
        );
        assert_eq!(
            v.remove(&m.id, 1, &removal, "active").unwrap().state,
            "deleted"
        );
        assert!(v
            .correct(&m.id, 1, &fork.operation_id, "stale competing draft")
            .is_err());
    }
    assert_eq!(
        fs::read(v.done_path(&capture)).unwrap(),
        hash(&histories[0]).as_bytes()
    );
    assert!(!v.done_path(&fork.operation_id).exists());
    assert_eq!(
        fs::read(v.journal_path(&fork.operation_id)).unwrap(),
        fork_bytes
    );
    assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), note);
    assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), original);
    for (index, bytes) in histories.iter().enumerate() {
        assert_eq!(
            fs::read(v.history_path(&m.id, index as u64 + 1)).unwrap(),
            *bytes
        );
    }
}

#[test]
fn review_missing_removal_rejects_reappeared_bound_renamed_path() {
    for returned in ["matching", "changed header", "unrelated occupant"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let renamed = v.path("Memories/Known renamed note.md");
        fs::rename(v.note_path(&m.id), &renamed).unwrap();
        v.correct(&m.id, 1, &op(), "corrected").unwrap();
        let body = fs::read_to_string(&renamed).unwrap();
        assert_eq!(
            v.records(&m.id)
                .unwrap()
                .last()
                .unwrap()
                .note_path
                .as_deref(),
            Some("Known renamed note.md")
        );
        fs::remove_file(&renamed).unwrap();
        assert_eq!(v.list("").unwrap()[0].state, "missing");
        let changed = match returned {
            "matching" => body,
            "changed header" => body.replace(
                &format!("<!-- Recall memory {}", m.id),
                "<!-- Edited Recall memory",
            ),
            _ => "UNRELATED USER-CREATED NOTE".into(),
        };
        fs::write(&renamed, &changed).unwrap();
        let operation = op();
        assert!(
            v.remove(&m.id, 2, &operation, "missing").is_err(),
            "{returned} must invalidate missing confirmation"
        );
        assert_eq!(
            v.list("").unwrap()[0].state,
            if returned == "matching" {
                "active"
            } else {
                "conflict"
            }
        );
        assert!(v.restore_note(&m.id, 2, &op()).is_err());
        assert!(!v.journal_path(&operation).exists());
        assert!(!v.history_path(&m.id, 3).exists());
        assert_eq!(fs::read_to_string(&renamed).unwrap(), changed);
        assert!(!v.note_path(&m.id).exists());
    }
}

#[test]
fn review_journaled_missing_removal_rechecks_occupied_bound_renamed_path() {
    for returned in ["matching", "changed header", "unrelated occupant"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let renamed = v.path("Memories/Known renamed note.md");
        fs::rename(v.note_path(&m.id), &renamed).unwrap();
        v.correct(&m.id, 1, &op(), "corrected").unwrap();
        let body = fs::read_to_string(&renamed).unwrap();
        fs::remove_file(&renamed).unwrap();
        let changed = match returned {
            "matching" => body,
            "changed header" => body.replace(
                &format!("<!-- Recall memory {}", m.id),
                "<!-- Edited Recall memory",
            ),
            _ => "UNRELATED USER-CREATED NOTE".into(),
        };
        let target = renamed.clone();
        let editor_bytes = changed.clone();
        let fault = FaultGuard::set(move |point, _| {
            if point == "before_history" {
                fs::write(&target, &editor_bytes).unwrap();
            }
            Ok(())
        });
        let operation = op();
        assert!(
            v.remove(&m.id, 2, &operation, "missing").is_err(),
            "journaled {returned} must invalidate missing confirmation"
        );
        drop(fault);
        assert!(v.journal_path(&operation).exists());
        assert!(!v.done_path(&operation).exists());
        assert!(!v.history_path(&m.id, 3).exists());
        assert!(f.vault().remove(&m.id, 2, &operation, "missing").is_err());
        assert_eq!(fs::read_to_string(&renamed).unwrap(), changed);
        assert!(!v.note_path(&m.id).exists());
    }
}

#[test]
fn review_second_unique_rename_remains_eligible_and_correctable() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let first = v.path("Memories/First bound name.md");
    let second = v.path("Memories/Second unique name.md");
    fs::rename(v.note_path(&m.id), &first).unwrap();
    v.correct(&m.id, 1, &op(), "first correction").unwrap();
    fs::rename(&first, &second).unwrap();
    let current = f.vault().list("").unwrap().remove(0);
    assert_eq!(current.state, "active");
    assert_eq!(current.revision, 2);
    assert_eq!(current.note_path.as_deref(), Some("Second unique name.md"));
    assert_eq!(
        v.correct(&m.id, 2, &op(), "second correction")
            .unwrap()
            .revision,
        3
    );
    assert!(fs::read_to_string(&second)
        .unwrap()
        .ends_with("second correction"));
    assert!(!first.exists());
    assert!(!v.note_path(&m.id).exists());
}

#[test]
fn review_fork_receipt_repair_does_not_relax_chain_or_existing_hash_checks() {
    for corrupted in ["completion hash", "journal bytes"] {
        let f = Fixture::new();
        let v = f.vault();
        let capture = op();
        let m = v
            .capture(&capture, "synthetic.png", &photo(), "base")
            .unwrap();
        let removal = op();
        v.remove(&m.id, 1, &removal, "active").unwrap();
        let mut fork: Event = decode(&v.journal_path(&removal)).unwrap();
        fork.operation_id = op();
        fork.kind = "correct".into();
        fork.expected_state = None;
        fork.memory.note = "competing draft".into();
        fork.markdown = markdown(&fork.memory);
        fork.payload_sha256 = payload(
            "correct",
            &m.id,
            1,
            &fork.memory.note,
            &m.source_sha256,
            &m.source_name,
        )
        .unwrap();
        fs::write(v.journal_path(&fork.operation_id), json(&fork).unwrap()).unwrap();
        fs::remove_file(v.done_path(&capture)).unwrap();
        let damaged = if corrupted == "completion hash" {
            v.done_path(&removal)
        } else {
            v.journal_path(&capture)
        };
        fs::write(&damaged, b"CORRUPTED SYNTHETIC METADATA").unwrap();
        let note = fs::read(v.note_path(&m.id)).unwrap();
        assert!(v.records_inner(&m.id, false).is_err());
        assert_eq!(
            f.vault().list_with_deleted("", true).unwrap()[0].state,
            "conflict"
        );
        assert!(!v.done_path(&capture).exists());
        assert!(!v.done_path(&fork.operation_id).exists());
        assert!(v.capture_receipt(&capture, "base").is_err());
        assert!(v.source(&m.id).is_err());
        assert_eq!(fs::read(v.note_path(&m.id)).unwrap(), note);
        assert_eq!(fs::read(damaged).unwrap(), b"CORRUPTED SYNTHETIC METADATA");
    }
}

#[test]
fn review_unique_rename_with_unrelated_old_bound_occupant_preserves_both_files() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let old_bound = v.path("Memories/Previous bound name.md");
    let resolved = v.path("Memories/Valid unique rename.md");
    fs::rename(v.note_path(&m.id), &old_bound).unwrap();
    v.correct(&m.id, 1, &op(), "first correction").unwrap();
    fs::rename(&old_bound, &resolved).unwrap();
    fs::write(&old_bound, b"UNRELATED USER-CREATED NOTE").unwrap();
    let current = f.vault().list("").unwrap().remove(0);
    assert_eq!(current.state, "active");
    assert_eq!(current.revision, 2);
    assert_eq!(current.note_path.as_deref(), Some("Valid unique rename.md"));
    assert!(v.remove(&m.id, 2, &op(), "missing").is_err());
    assert_eq!(
        v.correct(&m.id, 2, &op(), "next correction")
            .unwrap()
            .revision,
        3
    );
    assert!(fs::read_to_string(&resolved)
        .unwrap()
        .ends_with("next correction"));
    assert_eq!(
        fs::read(&old_bound).unwrap(),
        b"UNRELATED USER-CREATED NOTE"
    );
    assert!(!v.note_path(&m.id).exists());
}

// Claude reading regression fixtures are synthetic, never live provider traffic.
fn reading_response(work: &crate::reading::ReadingRequest) -> crate::reading::ReadingReceipt {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
    ))
    .unwrap();
    let mut response = fixture["response"].clone();
    response["binding"] = serde_json::to_value(&work.binding).unwrap();
    response["result"]["input_manifest_sha256"] = work.digest().unwrap().into();
    response["result"]["extraction"]["input_manifest_sha256"] = work.digest().unwrap().into();
    response["result"]["extraction"]["capture_id"] = work.binding.memory_id.clone().into();
    let old = "33333333-3333-4333-8333-333333333333";
    let encoded = serde_json::to_string(&response)
        .unwrap()
        .replace(old, &work.binding.source_id);
    serde_json::from_str(&encoded).unwrap()
}
#[test]
fn reading_machine_and_human_are_separate_durable_searchable_and_original_is_immutable() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "synthetic.png", &photo(), "annotation")
        .unwrap();
    let original = v.source(&m.id).unwrap().bytes;
    let work = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let receipt = reading_response(&work);
    let read = v.accept_reading(&work, &receipt).unwrap();
    assert_eq!(read.revision, 2);
    assert_eq!(read.note, "annotation");
    assert_eq!(
        read.reading.as_ref().unwrap().effective_text(),
        "Synthetic note: 12?"
    );
    assert_eq!(v.accept_reading(&work, &receipt).unwrap().revision, 2);
    let corrected = v
        .correct_reading(&m.id, 2, &op(), "Human uncertainty 13?")
        .unwrap();
    assert_eq!(
        corrected.reading.as_ref().unwrap().effective_text(),
        "Human uncertainty 13?"
    );
    let next = v.prepare_reading(&m.id, 3, &op()).unwrap();
    v.accept_reading(&next, &reading_response(&next)).unwrap();
    let reopened = f.vault();
    assert_eq!(reopened.list("Human uncertainty").unwrap().len(), 1);
    assert!(reopened.list("Synthetic note").unwrap().is_empty());
    assert_eq!(
        reopened.history(&m.id).unwrap()[1]
            .reading
            .as_ref()
            .unwrap()
            .machine
            .transcription(),
        "Synthetic note: 12?"
    );
    assert_eq!(reopened.source(&m.id).unwrap().bytes, original);
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V4
    );
}

#[test]
fn reading_v4_renders_safe_observable_obisidian_properties_and_suppresses_corrected_projection() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "synthetic.png", &photo(), "human annotation")
        .unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let mut response = reading_response(&req);
    let ex = &mut response.result.as_mut().unwrap().extraction;
    let hostile = "Paul said Monday: Synthetic <script>[attack](javascript:alert(1)) = 12?; Call Sam Friday.\n2. injected";
    ex["summary"] = hostile.into();
    ex["pages"][0]["transcription"] = hostile.into();
    ex["summary_evidence"][0]["quote"] =
        "Synthetic <script>[attack](javascript:alert(1)) = 12?".into();
    ex["statements"][0]["text"] = "Synthetic <script>[attack](javascript:alert(1)) = 12?".into();
    ex["statements"][0]["value_text"] = "12?".into();
    ex["statements"][0]["attribution_text"] = "Paul said".into();
    ex["statements"][0]["temporal_text"] = "Monday".into();
    ex["statements"][0]["evidence"][0]["quote"] =
        "Synthetic <script>[attack](javascript:alert(1)) = 12?".into();
    ex["mentions"] = serde_json::json!([{
        "local_id": "m1", "kind": "person", "raw_text": "Sam",
        "evidence": [{"page_id": req.binding.source_id, "quote": "Sam"}]
    }]);
    ex["action_suggestions"] = serde_json::json!([{
        "local_id": "a1", "kind": "action", "text": "Call Sam",
        "assignee_mention_id": "m1", "due_text": "Friday",
        "evidence": [{"page_id": req.binding.source_id, "quote": "Call Sam Friday"}]
    }]);
    ex["uncertainties"][0]["description"] = "The number remains uncertain: 12?".into();
    ex["uncertainties"][0]["evidence"][0]["quote"] = "12?".into();
    v.accept_reading(&req, &response).unwrap();
    let note = fs::read_to_string(v.note_path(&m.id)).unwrap();
    assert!(note.starts_with("---\nid: \""));
    assert!(note.contains("status: \"saved\""));
    assert!(note.contains(&format!("source: \"[[Recall/Sources/{}.png]]\"", m.id)));
    assert!(note.contains("review: \"unreviewed\""));
    assert!(note.contains("> Machine interpretation is unreviewed and source-bound."));
    assert!(note.contains("## Source transcription"));
    assert!(
        note.contains("Synthetic &lt;script&gt;\\[attack\\]\\(javascript:alert\\(1\\)\\) \\= 12?")
    );
    assert!(!note.contains("<script>"));
    assert!(!note.contains("[attack](javascript:"));
    assert!(!note.contains("\n2. injected"));
    assert!(note.contains("Attribution: Paul said"));
    assert!(note.contains("When: Monday"));
    assert!(note.contains("Assigned to mentioned person: Sam"));
    assert!(note.contains("Due: Friday"));
    assert!(note.contains("[“Call Sam Friday”](../Sources/"));
    assert!(note.contains("Summary evidence:"));
    assert!(note.contains("Uncertainty evidence, not fact support:"));
    assert!(v.list("javascript:alert").unwrap().len() == 1);
    assert_eq!(v.list("Friday").unwrap().len(), 1);
    assert_eq!(v.list("Paul said").unwrap().len(), 1);

    let corrected = v
        .correct_reading(&m.id, 2, &op(), "Human corrected wording")
        .unwrap();
    let current = fs::read_to_string(v.note_path(&m.id)).unwrap();
    assert!(current.contains("Human corrected wording"));
    assert!(current.contains(
        "> Human reading correction is current; stale machine organization is suppressed."
    ));
    assert!(!current.contains("## Statements"));
    assert!(!current.contains("## Mentions"));
    assert!(!current.contains("## Suggested actions"));
    assert!(!current.contains("## Uncertainties"));
    assert!(!current.contains("## Source transcription"));
    assert_eq!(v.list("Human corrected").unwrap()[0].id, m.id);
    assert!(v.list("javascript:alert").unwrap().is_empty());
    assert!(v.list("Friday").unwrap().is_empty());
    assert!(v.list("Paul said").unwrap().is_empty());
    assert_eq!(corrected.revision, 3);
    let corrected_event: Event = decode(&v.history_path(&m.id, 3)).unwrap();
    assert_eq!(corrected_event.format, FORMAT_V4);
}

#[test]
fn v4_manifest_fences_legacy_writer_before_new_event_and_keeps_previous_manifest_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let before_v4 = fs::read(v.path("_meta/manifest.json")).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();
    let manifest: Manifest = decode(&v.path("_meta/manifest.json")).unwrap();
    assert_eq!(manifest.format, FORMAT_V4);
    assert_eq!(
        fs::read(v.path("_meta/manifest-v3.json")).unwrap(),
        before_v4
    );
    let event: Event = decode(&v.history_path(&m.id, 2)).unwrap();
    assert_eq!(event.format, FORMAT_V4);
    assert!(v.event_valid(&event).is_ok());
    let unread = v
        .capture(&op(), "synthetic.png", &photo(), "unread annotation")
        .unwrap();
    let unread_note = fs::read_to_string(v.note_path(&unread.id)).unwrap();
    assert!(unread_note.contains("review: \"not_read\""));
    assert!(unread_note.contains("> No machine reading has been run."));
}

#[test]
fn v4_human_annotation_suffix_reconciles_raw_markdown_without_double_escaping() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();
    let path = v.note_path(&m.id);
    let disk = fs::read_to_string(&path)
        .unwrap()
        .replace("base", "*Obsidian annotation*");
    fs::write(&path, &disk).unwrap();
    let current = v.list("Obsidian").unwrap().pop().unwrap();
    assert_eq!(current.revision, 3);
    assert_eq!(current.note, "*Obsidian annotation*");
    assert!(fs::read_to_string(path)
        .unwrap()
        .ends_with("*Obsidian annotation*"));
}

#[test]
fn v4_renames_and_duplicate_identity_remain_conflict_safe() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();
    let renamed = v.path("Memories/organized note.md");
    fs::rename(v.note_path(&m.id), &renamed).unwrap();
    let row = v.list("").unwrap().remove(0);
    assert_eq!(row.state, "active");
    assert_eq!(row.note_path.as_deref(), Some("organized note.md"));
    v.correct(&m.id, row.revision, &op(), "human kept this note")
        .unwrap();
    assert!(!v.note_path(&m.id).exists());
    assert!(fs::read_to_string(&renamed)
        .unwrap()
        .contains("human kept this note"));
    let reread = v.prepare_reading(&m.id, 3, &op()).unwrap();
    assert_eq!(
        v.accept_reading(&reread, &reading_response(&reread))
            .unwrap()
            .revision,
        4
    );

    fs::copy(&renamed, v.path("Memories/duplicate.md")).unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
    assert!(v.list("synthetic").unwrap().is_empty());
}

#[test]
fn v4_repair_of_legacy_receipt_does_not_lower_manifest_fence() {
    let f = Fixture::new();
    let v = f.vault();
    let capture = op();
    let m = v
        .capture(&capture, "synthetic.png", &photo(), "base")
        .unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();
    fs::remove_file(v.done_path(&capture)).unwrap();
    assert_eq!(
        v.capture_receipt(&capture, "base")
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V4
    );
}

#[test]
fn historical_v3_reading_event_reopens_without_rewriting_bytes() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();

    let mut event: Event = decode(&v.history_path(&m.id, 2)).unwrap();
    event.format = FORMAT_V3.into();
    event.markdown = markdown_v1_v3(&event.memory);
    let base = payload(
        &event.kind,
        &event.memory.id,
        event.expected_revision,
        &event.memory.note,
        &event.memory.source_sha256,
        &event.memory.source_name,
    )
    .unwrap();
    event.payload_sha256 = hash(&json(&(base, &event.memory.reading)).unwrap());
    let bytes = json(&event).unwrap();
    fs::write(v.history_path(&m.id, 2), &bytes).unwrap();
    fs::write(v.journal_path(&event.operation_id), &bytes).unwrap();
    fs::write(v.done_path(&event.operation_id), hash(&bytes)).unwrap();
    fs::write(v.note_path(&m.id), &event.markdown).unwrap();
    fs::write(
        v.path("_meta/manifest.json"),
        json(&Manifest {
            format: FORMAT_V3.into(),
            vault_id: v.id.clone(),
        })
        .unwrap(),
    )
    .unwrap();

    let reopened = f.vault();
    assert_eq!(reopened.history(&m.id).unwrap().len(), 2);
    assert!(reopened.list("Synthetic note").unwrap()[0]
        .reading
        .is_some());
    assert_eq!(fs::read(v.history_path(&m.id, 2)).unwrap(), bytes);
    assert_eq!(
        decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format,
        FORMAT_V3
    );
}

#[test]
fn v4_projection_suppresses_unsupported_historical_summary_without_rewriting_history() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();

    // Model a v3 reading accepted before summaries required transcript evidence.
    let mut event: Event = decode(&v.history_path(&m.id, 2)).unwrap();
    event.format = FORMAT_V3.into();
    let extraction = &mut event
        .memory
        .reading
        .as_mut()
        .unwrap()
        .machine
        .result
        .extraction;
    extraction["summary"] = "Unsupported historical summary".into();
    extraction["summary_evidence"] = serde_json::json!([]);
    event.markdown = markdown_v1_v3(&event.memory);
    let base = payload(
        &event.kind,
        &event.memory.id,
        event.expected_revision,
        &event.memory.note,
        &event.memory.source_sha256,
        &event.memory.source_name,
    )
    .unwrap();
    event.payload_sha256 = hash(&json(&(base, &event.memory.reading)).unwrap());
    let history_bytes = json(&event).unwrap();
    fs::write(v.history_path(&m.id, 2), &history_bytes).unwrap();
    fs::write(v.journal_path(&event.operation_id), &history_bytes).unwrap();
    fs::write(v.done_path(&event.operation_id), hash(&history_bytes)).unwrap();
    fs::write(v.note_path(&m.id), &event.markdown).unwrap();
    let old_manifest = v.path("_meta/manifest-v3.json");
    if old_manifest.exists() {
        fs::remove_file(old_manifest).unwrap();
    }
    fs::write(
        v.path("_meta/manifest.json"),
        json(&Manifest {
            format: FORMAT_V3.into(),
            vault_id: v.id.clone(),
        })
        .unwrap(),
    )
    .unwrap();

    let legacy = f.vault();
    assert_eq!(
        legacy.list("Unsupported historical summary").unwrap().len(),
        1
    );
    let before = fs::read(v.history_path(&m.id, 2)).unwrap();
    legacy.fence_manifest_v4().unwrap();
    legacy
        .capture_text(&op(), "independent text source")
        .unwrap();
    assert!(legacy
        .list("Unsupported historical summary")
        .unwrap()
        .is_empty());
    legacy.correct(&m.id, 2, &op(), "new annotation").unwrap();

    let reopened = f.vault();
    let note = fs::read_to_string(v.note_path(&m.id)).unwrap();
    assert!(!note.contains("Unsupported historical summary"));
    assert!(note.contains("Synthetic note: 12?"));
    assert!(reopened
        .list("Unsupported historical summary")
        .unwrap()
        .is_empty());
    assert_eq!(reopened.list("Synthetic note").unwrap().len(), 1);
    assert_eq!(fs::read(v.history_path(&m.id, 2)).unwrap(), before);
}
#[test]
fn reading_cancellation_restart_and_stale_completion_never_promote() {
    for reason in [
        "cancel",
        "annotation",
        "delete",
        "external",
        "source",
        "rename",
    ] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v
            .capture(&op(), "synthetic.png", &photo(), "annotation")
            .unwrap();
        let work = v.prepare_reading(&m.id, 1, &op()).unwrap();
        match reason {
            "cancel" => {
                v.cancel_reading(&work.binding.operation_id).unwrap();
            }
            "annotation" => {
                v.correct(&m.id, 1, &op(), "changed").unwrap();
            }
            "delete" => {
                v.remove(&m.id, 1, &op(), "active").unwrap();
            }
            "external" => {
                fs::write(
                    v.note_path(&m.id),
                    markdown(&m).replace("annotation", "external"),
                )
                .unwrap();
            }
            "rename" => {
                fs::rename(v.note_path(&m.id), v.path("Memories/renamed.md")).unwrap();
            }
            "source" => {
                fs::write(v.path(&format!("Sources/{}.png", m.id)), photo().repeat(2)).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            f.vault()
                .accept_reading(&work, &reading_response(&work))
                .is_err(),
            "{reason}"
        );
        assert!(v
            .history(&m.id)
            .unwrap()
            .iter()
            .all(|h| h.reading.is_none()));
    }
}
#[test]
fn reading_generated_blocks_cannot_be_relabelled_by_external_edit() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v
        .capture(&op(), "synthetic.png", &photo(), "annotation")
        .unwrap();
    let work = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&work, &reading_response(&work)).unwrap();
    let path = v.note_path(&m.id);
    let disk = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        disk.replace("Notes beginning:", "Human verified reading:"),
    )
    .unwrap();
    assert_eq!(v.list("").unwrap()[0].state, "conflict");
    assert!(v.list("Synthetic").unwrap().is_empty());
}
#[test]
fn reading_pending_journal_requires_explicit_recovery_and_cancel_survives_restart() {
    for cancel in [false, true] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let work = v.prepare_reading(&m.id, 1, &op()).unwrap();
        let response = reading_response(&work);
        let fault = FaultGuard::set(|point, _| {
            if point == "before_note" {
                Err("INJECTED reading publication interruption".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&work, &response).is_err());
        drop(fault);
        if cancel {
            v.cancel_reading(&work.binding.operation_id).unwrap();
        }
        let rows = f.vault().list("base").unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].reading.is_none());
        assert_eq!(v.history(&m.id).unwrap().len(), 1);
        if cancel {
            assert!(v.accept_reading(&work, &response).is_err());
        } else {
            assert_eq!(v.accept_reading(&work, &response).unwrap().revision, 2);
        }
    }
}
#[test]
fn reading_vault_switch_cancels_old_intent_and_old_session_cancel_never_touches_new_vault() {
    let first = Fixture::new();
    let second = Fixture::new();
    let settings = Fixture::new();
    let state = LocalVaultState::new(settings.0.join("settings.json"));
    let token = state.select_path(&first.0).unwrap().vault_id.unwrap();
    let m = state
        .with(&token, |v| {
            v.capture(&op(), "synthetic.png", &photo(), "base")
        })
        .unwrap();
    let (old, req) = state.begin_reading(&token, &m.id, 1, &op()).unwrap();
    state.select_path(&second.0).unwrap();
    assert_eq!(
        state
            .cancel_session_reading(&token, &req.binding.operation_id)
            .unwrap()
            .state,
        "cancelled"
    );
    assert!(old.accept_reading(&req, &reading_response(&req)).is_err());
    assert!(second.vault().list("").unwrap().is_empty());
    assert!(state
        .with(&token, |v| v.accept_reading(&req, &reading_response(&req)))
        .is_err());
}
#[test]
fn reading_retry_dispatch_is_get_only_and_empty_correction_still_overrides() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    assert_eq!(v.reading_dispatch(&req).unwrap().unwrap(), photo());
    assert!(f.vault().reading_dispatch(&req).unwrap().is_none());
    assert!(v
        .prepare_reading(&m.id, 2, &req.binding.operation_id)
        .is_err());
    v.accept_reading(&req, &reading_response(&req)).unwrap();
    let corrected = v.correct_reading(&m.id, 2, &op(), "").unwrap();
    assert_eq!(corrected.reading.unwrap().effective_text(), "");
    assert!(v.list("12?").unwrap().is_empty());
    assert!(v.reading_operations(&m.id).unwrap()[0].may_have_been_sent);
}
#[test]
fn reading_v4_fence_preserves_v1_v2_v3_raw_history_and_human_annotation_edits() {
    let f = Fixture::new();
    let v = f.vault();
    let (memory, _, v1) = legacy_fixture(&v);
    v.correct(&memory, 2, &op(), "v2 annotation").unwrap();
    let v2 = fs::read(v.history_path(&memory, 3)).unwrap();
    let manifest = fs::read(v.path("_meta/manifest.json")).unwrap();
    let request = v.prepare_reading(&memory, 3, &op()).unwrap();
    let manifest_v3 = fs::read(v.path("_meta/manifest.json")).unwrap();
    v.accept_reading(&request, &reading_response(&request))
        .unwrap();
    for (i, raw) in v1.iter().chain(std::iter::once(&v2)).enumerate() {
        assert_eq!(
            fs::read(v.history_path(&memory, i as u64 + 1)).unwrap(),
            *raw
        );
    }
    assert_eq!(
        fs::read(v.path("_meta/manifest-v2.json")).unwrap(),
        manifest
    );
    assert_eq!(
        fs::read(v.path("_meta/manifest-v3.json")).unwrap(),
        manifest_v3
    );
    let path = v.note_path(&memory);
    let disk = fs::read_to_string(&path)
        .unwrap()
        .replace("v2 annotation", "Obsidian annotation");
    fs::write(&path, disk).unwrap();
    let current = f.vault().list("Obsidian").unwrap().pop().unwrap();
    assert_eq!(current.revision, 5);
    assert!(current.reading.is_some());
    let old_writer_formats = [FORMAT, FORMAT_V2, FORMAT_V3];
    assert!(!old_writer_formats.contains(
        &decode::<Manifest>(&v.path("_meta/manifest.json"))
            .unwrap()
            .format
            .as_str()
    ));
    let mut injected: Event = decode(&v.history_path(&memory, 4)).unwrap();
    injected.format = FORMAT_V2.into();
    assert!(v.event_valid(&injected).is_err());
}
#[test]
fn reading_partial_markdown_publication_stays_diagnostic_until_explicit_recovery() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let request = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let response = reading_response(&request);
    let fault = FaultGuard::set(|point, _| {
        if point == "before_history" {
            Err("INJECTED partial reading".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&request, &response).is_err());
    drop(fault);
    let rows = f.vault().list("").unwrap();
    assert_eq!(rows[0].state, "conflict");
    assert!(rows[0].reading.is_none());
    assert_eq!(v.accept_reading(&request, &response).unwrap().revision, 2);
}
#[test]
fn reading_machine_proposal_cannot_change_annotation_or_human_correction_in_history() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let first = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.accept_reading(&first, &reading_response(&first)).unwrap();
    v.correct_reading(&m.id, 2, &op(), "human correction")
        .unwrap();
    let next = v.prepare_reading(&m.id, 3, &op()).unwrap();
    v.accept_reading(&next, &reading_response(&next)).unwrap();
    let prior: Event = decode(&v.history_path(&m.id, 3)).unwrap();
    let mut next: Event = decode(&v.history_path(&m.id, 4)).unwrap();
    next.memory.reading.as_mut().unwrap().human_correction = None;
    assert!(v.reading_transition(&prior, &next).is_err());
    next.memory.reading = prior.memory.reading.clone();
    next.memory.note = "fake human annotation".into();
    assert!(v.reading_transition(&prior, &next).is_err());
}
#[test]
fn reading_cancel_can_arrive_before_prepare_and_is_durable() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let operation = op();
    assert_eq!(v.cancel_reading(&operation).unwrap().state, "cancelled");
    assert!(f.vault().prepare_reading(&m.id, 1, &operation).is_err());
    assert!(v.reading_operations(&m.id).unwrap().is_empty());
    assert_eq!(v.list("base").unwrap().len(), 1);
}
#[test]
fn reading_explicit_null_field_cannot_smuggle_extensions_into_legacy_history() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let mut raw: serde_json::Value = decode(&v.history_path(&m.id, 1)).unwrap();
    raw["memory"]["reading"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<Event>(raw).is_err());
}
#[test]
fn reading_abandoned_machine_draft_does_not_poison_later_human_revision() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let response = reading_response(&req);
    let fault = FaultGuard::set(|point, _| {
        if point == "before_note" {
            Err("INJECTED pending reading".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &response).is_err());
    drop(fault);
    v.correct(&m.id, 1, &op(), "fresh human annotation")
        .unwrap();
    assert_eq!(v.list("fresh human").unwrap().len(), 1);
    assert!(v.accept_reading(&req, &response).is_err());
    assert_eq!(v.list("fresh human").unwrap().len(), 1);
}

#[test]
fn independent_review_partial_prepare_does_not_block_other_memory_operations() {
    let f = Fixture::new();
    let v = f.vault();
    let a = v
        .capture(&op(), "synthetic.png", &photo(), "first")
        .unwrap();
    let b = v
        .capture(&op(), "synthetic.png", &photo(), "second")
        .unwrap();
    let operation = op();
    let fault = FaultGuard::set(|point, path| {
        if point == "create_before" && path.to_string_lossy().contains("request.stage-") {
            Err("INJECTED interruption writing request".into())
        } else {
            Ok(())
        }
    });
    let prepared = v.prepare_reading(&a.id, 1, &operation);
    drop(fault);
    assert!(prepared.is_err(), "must reach partial prepare boundary");
    let req = v.prepare_reading(&b.id, 1, &op()).unwrap();
    v.accept_reading(&req, &reading_response(&req)).unwrap();
    assert!(
        f.vault().reading_operations(&b.id).is_ok(),
        "one interrupted prepare must not break unrelated completed operation listing"
    );
}

#[test]
fn independent_review_cancel_after_partial_publication_preserves_search() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|point, _| {
        if point == "before_history" {
            Err("INJECTED pre-history crash".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    assert_eq!(
        v.cancel_reading(&req.binding.operation_id).unwrap().state,
        "cancelled"
    );
    let reopened = f.vault();
    assert!(reopened
        .accept_reading(&req, &reading_response(&req))
        .is_err());
    assert!(reopened.list("").unwrap()[0].reading.is_none());
    assert_eq!(
        reopened.list("base").unwrap().len(),
        1,
        "safe cancelled generated publication should leave original local search usable"
    );
}

#[test]
fn independent_review_cancel_after_history_before_receipt_reports_committed() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|point, _| {
        if point == "before_receipt" {
            Err("INJECTED post-history crash".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    assert_eq!(
        f.vault()
            .cancel_reading(&req.binding.operation_id)
            .unwrap()
            .state,
        "committed"
    );
}

#[test]
fn independent_review_pending_journal_rejects_external_edit_rename_delete() {
    for change in ["edit", "rename", "delete"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
        let fault = FaultGuard::set(|point, _| {
            if point == "before_note" {
                Err("INJECTED pre-note crash".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
        drop(fault);
        match change {
            "edit" => fs::write(
                v.note_path(&m.id),
                markdown(&m).replace("base", "new human draft"),
            )
            .unwrap(),
            "rename" => fs::rename(v.note_path(&m.id), v.path("Memories/moved.md")).unwrap(),
            _ => fs::remove_file(v.note_path(&m.id)).unwrap(),
        }
        assert!(
            f.vault()
                .accept_reading(&req, &reading_response(&req))
                .is_err(),
            "{change}"
        );
        assert!(!v.history_path(&m.id, 2).exists());
    }
}
#[test]
fn reading_not_found_retry_keeps_operation_and_connection_scope() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let scope = "a".repeat(64);
    v.bind_reading_connection(&req, &scope).unwrap();
    v.reading_dispatch(&req).unwrap();
    assert_eq!(
        f.vault().retry_reading_not_found(&req, &scope).unwrap(),
        photo()
    );
    assert!(v.retry_reading_not_found(&req, &"b".repeat(64)).is_err());
    let mut admitted = reading_response(&req);
    admitted.state = "unknown".into();
    admitted.result = None;
    admitted.error_code = Some("PROVIDER_OUTCOME_UNKNOWN".into());
    v.retain_reading_response(&req, &admitted).unwrap();
    assert!(v.retry_reading_not_found(&req, &scope).is_err());
    let another = v.prepare_reading(&m.id, 1, &op()).unwrap();
    v.reading_dispatch(&another).unwrap();
    assert!(
        v.bind_reading_connection(&another, &scope).is_err(),
        "old uncertain intent lacking connection proof must fail closed"
    );
}
#[test]
fn reading_cancel_rollback_restarts_without_losing_original_search() {
    for point in [
        "rollback_before_move",
        "rollback_before_restore",
        "rollback_after_restore",
    ] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
        let fault = FaultGuard::set(|p, _| {
            if p == "before_history" {
                Err("INJECTED pre-history".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
        drop(fault);
        let fault = FaultGuard::set(move |p, _| {
            if p == point {
                Err("INJECTED rollback crash".into())
            } else {
                Ok(())
            }
        });
        assert!(v.cancel_reading(&req.binding.operation_id).is_err());
        drop(fault);
        let reopened = f.vault();
        assert_eq!(reopened.list("base").unwrap().len(), 1, "{point}");
        assert_eq!(reopened.history(&m.id).unwrap().len(), 1);
        assert_eq!(reopened.source(&m.id).unwrap().bytes, photo());
        assert_eq!(
            reopened
                .cancel_reading(&req.binding.operation_id)
                .unwrap()
                .state,
            "cancelled"
        );
    }
}
#[test]
fn reading_cancellation_preserves_human_edit_racing_with_rollback() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|p, _| {
        if p == "before_history" {
            Err("INJECTED pre-history".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    let draft = markdown(&m).replace("base", "real human draft");
    let retained = draft.clone();
    let fault = FaultGuard::set(move |p, path| {
        if p == "rollback_before_restore" {
            fs::write(path, &draft).unwrap();
        }
        Ok(())
    });
    assert!(v.cancel_reading(&req.binding.operation_id).is_err());
    drop(fault);
    assert_eq!(fs::read_to_string(v.note_path(&m.id)).unwrap(), retained);
    assert_eq!(f.vault().list("").unwrap()[0].state, "conflict");
    assert_eq!(fs::read_to_string(v.note_path(&m.id)).unwrap(), retained);
}
#[test]
fn reading_incomplete_prepare_boundaries_are_isolated_and_same_id_retry_safe() {
    for (needle, point) in [
        ("note-path.stage-", "create_before"),
        ("note-path.stage-", "write_after"),
        ("request.stage-", "create_before"),
        ("request.stage-", "write_after"),
        ("request.json", "publish_after"),
    ] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let operation = op();
        let fault = FaultGuard::set(move |p, path| {
            if p == point && path.to_string_lossy().contains(needle) {
                Err("INJECTED intent interruption".into())
            } else {
                Ok(())
            }
        });
        let attempt = v.prepare_reading(&m.id, 1, &operation);
        drop(fault);
        assert!(attempt.is_err());
        assert!(f.vault().reading_operations(&m.id).is_ok());
        let retry = v.prepare_reading(&m.id, 1, &operation).unwrap();
        assert_eq!(retry.binding.operation_id, operation);
        v.cancel_reading(&operation).unwrap();
        assert!(v.prepare_reading(&m.id, 1, &operation).is_err());
    }
}
#[test]
fn reading_status_and_switch_repair_history_commit_without_prior_list() {
    for action in ["status", "switch"] {
        let f = Fixture::new();
        let other = Fixture::new();
        let settings = Fixture::new();
        let state = LocalVaultState::new(settings.0.join("selected.json"));
        let token = state.select_path(&f.0).unwrap().vault_id.unwrap();
        let m = state
            .with(&token, |v| {
                v.capture(&op(), "synthetic.png", &photo(), "base")
            })
            .unwrap();
        let (v, req) = state.begin_reading(&token, &m.id, 1, &op()).unwrap();
        let fault = FaultGuard::set(|p, _| {
            if p == "before_receipt" {
                Err("INJECTED post-history".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
        drop(fault);
        if action == "status" {
            assert_eq!(
                f.vault().reading_operations(&m.id).unwrap()[0].state,
                "committed"
            );
        } else {
            state.select_path(&other.0).unwrap();
            assert_eq!(
                f.vault().reading_operations(&m.id).unwrap()[0].state,
                "committed"
            );
        }
    }
}
#[test]
fn reading_cancel_resolves_before_and_after_note_backup_move() {
    for boundary in ["before_note", "rename_after", "before_history"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
        let backup = v.backup_path(&req.binding.operation_id);
        let fault = FaultGuard::set(move |point, path| {
            if point == boundary && (boundary != "rename_after" || path == backup) {
                Err("INJECTED publication interruption".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
        drop(fault);
        assert_eq!(
            v.cancel_reading(&req.binding.operation_id).unwrap().state,
            "cancelled"
        );
        let reopened = f.vault();
        assert_eq!(reopened.list("base").unwrap().len(), 1, "{boundary}");
        assert_eq!(reopened.history(&m.id).unwrap().len(), 1);
        assert_eq!(reopened.source(&m.id).unwrap().bytes, photo());
    }
}

#[test]
fn rereview_cancelled_rollback_stays_inert_after_later_obsidian_annotation() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|point, _| {
        if point == "before_history" {
            Err("INJECTED partial publication".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    assert_eq!(
        v.cancel_reading(&req.binding.operation_id).unwrap().state,
        "cancelled"
    );
    assert_eq!(f.vault().list("base").unwrap().len(), 1);
    fs::write(
        v.note_path(&m.id),
        markdown(&m).replace("base", "later human annotation"),
    )
    .unwrap();
    let rows = f.vault().list("later human annotation").unwrap();
    assert_eq!(
        rows.len(),
        1,
        "completed cancellation must not block later normal human reconciliation"
    );
    assert_eq!(rows[0].note, "later human annotation");
    assert!(rows[0].reading.is_none());
}
#[test]
fn rereview_unpublished_cancelled_draft_does_not_poison_unique_rename() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|point, _| {
        if point == "before_note" {
            Err("INJECTED before publication".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    assert_eq!(
        v.cancel_reading(&req.binding.operation_id).unwrap().state,
        "cancelled"
    );
    fs::rename(v.note_path(&m.id), v.path("Memories/later-rename.md")).unwrap();
    let rows = f.vault().list("base").unwrap();
    assert_eq!(
        rows.len(),
        1,
        "an unpublished cancelled draft must not poison a later unique rename"
    );
    assert_eq!(rows[0].state, "active");
}
#[test]
fn reading_cancel_resolution_marker_survives_crash_and_subsequent_normal_lifecycle() {
    for point in ["rollback_before_resolution", "rollback_after_resolution"] {
        let f = Fixture::new();
        let v = f.vault();
        let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
        let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
        let fault = FaultGuard::set(|p, _| {
            if p == "before_history" {
                Err("INJECTED generated publication".into())
            } else {
                Ok(())
            }
        });
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
        drop(fault);
        let journal = fs::read(v.journal_path(&req.binding.operation_id)).unwrap();
        let fault = FaultGuard::set(move |p, _| {
            if p == point {
                Err("INJECTED resolution marker interruption".into())
            } else {
                Ok(())
            }
        });
        assert!(v.cancel_reading(&req.binding.operation_id).is_err());
        drop(fault);
        // Before the commit point, recovery finishes the validated rollback. After
        // it, a later edit must work without any preliminary list/rebuild.
        if point == "rollback_before_resolution" {
            assert_eq!(f.vault().list("base").unwrap().len(), 1);
        }
        fs::write(
            v.note_path(&m.id),
            markdown(&m).replace("base", "later human annotation"),
        )
        .unwrap();
        let rows = f.vault().list("later human annotation").unwrap();
        assert!(!rows.is_empty(), "query returned no rows: {rows:?}");
        let current = rows.into_iter().next().unwrap();
        assert_eq!(current.revision, 2);
        assert!(current.reading.is_none());
        fs::rename(v.note_path(&m.id), v.path("Memories/later-rename.md")).unwrap();
        assert_eq!(
            f.vault().list("later human").unwrap()[0]
                .note_path
                .as_deref(),
            Some("later-rename.md")
        );
        let corrected = v.correct(&m.id, 2, &op(), "normal correction").unwrap();
        assert_eq!(corrected.revision, 3);
        let next = v.prepare_reading(&m.id, 3, &op()).unwrap();
        let read = v.accept_reading(&next, &reading_response(&next)).unwrap();
        assert_eq!(read.revision, 4);
        assert_eq!(
            v.remove(&m.id, 4, &op(), "active").unwrap().state,
            "deleted"
        );
        let neighbor = v
            .capture(&op(), "synthetic.png", &photo(), "fresh neighbor")
            .unwrap();
        assert_eq!(f.vault().list("fresh neighbor").unwrap()[0].id, neighbor.id);
        assert_eq!(fs::read(v.source_path(&m.id)).unwrap(), photo());
        assert_eq!(
            fs::read(v.journal_path(&req.binding.operation_id)).unwrap(),
            journal
        );
        assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    }
}
#[test]
fn reading_human_edit_before_resolution_marker_remains_a_preserved_conflict() {
    let f = Fixture::new();
    let v = f.vault();
    let m = v.capture(&op(), "synthetic.png", &photo(), "base").unwrap();
    let req = v.prepare_reading(&m.id, 1, &op()).unwrap();
    let fault = FaultGuard::set(|p, _| {
        if p == "before_history" {
            Err("INJECTED generated publication".into())
        } else {
            Ok(())
        }
    });
    assert!(v.accept_reading(&req, &reading_response(&req)).is_err());
    drop(fault);
    let note = v.note_path(&m.id);
    let draft = markdown(&m).replace("base", "concurrent human");
    let expected = draft.clone();
    let fault = FaultGuard::set(move |p, _| {
        if p == "rollback_before_resolution" {
            fs::write(&note, &draft).unwrap();
        }
        Ok(())
    });
    assert!(v.cancel_reading(&req.binding.operation_id).is_err());
    drop(fault);
    assert_eq!(f.vault().list("").unwrap()[0].state, "conflict");
    assert_eq!(fs::read_to_string(v.note_path(&m.id)).unwrap(), expected);
}

/// Related-memory links must work under every manifest that carries the context
/// projection (v7, v8 after a text-file import, v9 after an audio capture).
#[test]
fn related_links_work_and_are_suppressed_under_v7_v8_and_v9_manifests() {
    for (label, target_removed) in [("v8", false), ("v8", true), ("v9", false), ("v9", true)] {
        let f = Fixture::new();
        let v = f.vault();
        match label {
            "v8" => v.fence_manifest_v8().unwrap(),
            _ => v.fence_manifest_v9().unwrap(),
        }
        let (source, target) = publish_synthetic_related_pair(&v);
        let expected_format = if label == "v8" { FORMAT_V8 } else { FORMAT_V9 };
        let view = |v: &Vault| {
            v.list("")
                .unwrap()
                .into_iter()
                .find(|m| m.id == source.id)
                .unwrap()
        };
        let linked = view(&v);
        assert_eq!(linked.related_context.len(), 1, "{label}: UI link visible");
        assert_eq!(linked.related_context[0].target_memory_id, target.id);
        let last = v.records(&source.id).unwrap().pop().unwrap();
        assert_eq!(last.format, expected_format);
        assert_eq!(last.context_link_projection.as_ref().unwrap().len(), 1);
        let published = fs::read_to_string(v.note_path(&source.id)).unwrap();
        assert!(
            published.contains("Possibly related (unreviewed)"),
            "{label}: note link"
        );
        assert_eq!(
            v.related_memory(&source.id, &target.id)
                .unwrap()
                .original
                .sha256,
            target.source_sha256
        );
        if target_removed {
            v.remove(&target.id, target.revision, &op(), "active")
                .unwrap();
        } else {
            v.correct(
                &target.id,
                target.revision,
                &op(),
                "Human corrected target.",
            )
            .unwrap();
        }
        assert!(v.related_memory(&source.id, &target.id).is_err(), "{label}");
        assert!(view(&v).related_context.is_empty(), "{label}: UI link gone");
        let after = v.records(&source.id).unwrap().pop().unwrap();
        assert_eq!(after.kind, "context_suppress", "{label}");
        assert_eq!(
            after.format, expected_format,
            "{label}: suppression keeps the envelope"
        );
        assert!(after
            .context_link_projection
            .as_ref()
            .unwrap()
            .iter()
            .all(|e| e.suppressed));
        assert!(
            !fs::read_to_string(v.note_path(&source.id))
                .unwrap()
                .contains("Possibly related (unreviewed)"),
            "{label}: note link gone"
        );
        // History replays from a fresh open.
        assert!(f
            .vault()
            .list_with_deleted("", true)
            .unwrap()
            .iter()
            .all(|m| m.conflict.is_none()));
    }
}
