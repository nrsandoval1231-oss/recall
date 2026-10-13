use super::*;
struct Fixture(PathBuf);
#[test]
fn reviewed_organization_audit_survives_interrupted_reservation_and_rejects_tampering() {
    use crate::librarian::{self,CallError,OrganizationTransport};
    struct Rejected;
    impl OrganizationTransport for Rejected {
        fn organize(&self,_:&str,_:&str,_:&serde_json::Value)->std::result::Result<crate::meeting::Layout,CallError>{Err(CallError::HttpStatus(400))}
    }
    struct Count(std::cell::Cell<u32>);
    impl OrganizationTransport for Count {
        fn organize(&self,model:&str,key:&str,evidence:&serde_json::Value)->std::result::Result<crate::meeting::Layout,CallError>{
            self.0.set(self.0.get()+1);librarian::organization_tests::claude().organize(model,key,evidence)
        }
    }
    for tamper in [false,true] {
        let (_t,v,parser,_)=librarian::organization_tests::setup();let cfg=librarian::organization_tests::config();let prior=op();let next=op();
        assert!(librarian::organize_selected(&v,&cfg,&parser,&prior,true,&Rejected).is_err());
        let budget=v.root().join("Recall/_meta/librarian-budget.json");let before=fs::read(&budget).unwrap();
        let audit=v.root().join(format!("Recall/_meta/organization-reviews/{next}.json"));
        let hit=std::rc::Rc::new(std::cell::Cell::new(false));let seen=hit.clone();
        let fault=FaultGuard::set(move |point,path| {
            if point=="create_before" && path.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.starts_with("librarian-budget.stage-")) {
                seen.set(true);return Err("SYNTHETIC interruption before reservation write".into());
            } Ok(())
        });
        let provider=Count(std::cell::Cell::new(0));
        assert!(librarian::organize_selected_reviewed(&v,&cfg,&parser,&prior,&next,true,true,&provider).is_err());
        assert!(hit.get());assert!(audit.exists());assert_eq!(fs::read(&budget).unwrap(),before);assert_eq!(provider.0.get(),0);drop(fault);
        let reopened=Vault::open(v.root()).unwrap();
        assert!(librarian::organize_selected(&reopened,&cfg,&parser,&next,true,&provider).is_err());assert_eq!(provider.0.get(),0);
        if tamper {
            let mut review:serde_json::Value=serde_json::from_slice(&fs::read(&audit).unwrap()).unwrap();review["acknowledged_uncertainty"]=false.into();fs::write(&audit,serde_json::to_vec(&review).unwrap()).unwrap();
            assert!(librarian::organize_selected_reviewed(&reopened,&cfg,&parser,&prior,&next,true,true,&provider).is_err());assert_eq!(provider.0.get(),0);assert_eq!(fs::read(&budget).unwrap(),before);
        } else {
            librarian::organize_selected_reviewed(&reopened,&cfg,&parser,&prior,&next,true,false,&provider).unwrap();assert_eq!(provider.0.get(),1);
            let ledger:serde_json::Value=serde_json::from_slice(&fs::read(&budget).unwrap()).unwrap();let old:serde_json::Value=serde_json::from_slice(&before).unwrap();assert_eq!(ledger["entries"][0],old["entries"][0]);
        }
    }
}
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
fn photo() -> Vec<u8> {
    b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY".to_vec()
}
#[test]
fn text_note_preserves_a_readable_original_without_ai_or_an_external_editor() {
    let f = Fixture::new();
    let v = f.vault();
    let id = op();
    let saved = v
        .capture_note(&id, "pump house valve, uncertain?")
        .unwrap();
    assert_eq!(saved.id, id);
    assert!(saved.source_name.is_empty());
    assert_eq!(saved.source_sha256, hash(b""));
    let original=v.source(&id).unwrap();
    assert_eq!(original.mime_type, "text/plain");
    assert_eq!(original.bytes, b"pump house valve, uncertain?");
    assert_eq!(
        fs::read_dir(f.0.join("Recall/Sources")).unwrap().count(),
        1
    );
    let path = v.note_path(&id);
    let markdown = fs::read_to_string(&path).unwrap();
    assert!(markdown.contains("No original photo."));
    assert!(!markdown.contains("../Sources/"));
    assert!(markdown.contains("pump house valve, uncertain?"));
    assert_eq!(
        v.capture_note(&id, "pump house valve, uncertain?")
            .unwrap()
            .id,
        id
    );
    assert!(v.capture_note(&id, "changed").is_err());
    assert!(v.capture_note(&op(), "   ").is_err());
    assert_eq!(
        fs::read_dir(f.0.join("Recall/Sources")).unwrap().count(),
        1
    );
    let edited = markdown.replace("uncertain?", "Obsidian kept this?");
    fs::write(&path, &edited).unwrap();
    let listed = v.list("Obsidian").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].note, "pump house valve, Obsidian kept this?");
    assert_eq!(listed[0].state, "active");
    assert!(listed[0].conflict.is_none());
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
    assert_eq!(v.source(&id).unwrap().bytes, b"pump house valve, uncertain?");
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

#[test]
fn processing_snapshot_preserves_text_original_before_model_and_after_restart() {
    let f = Fixture::new();
    let v = f.vault();
    let id = op();
    let text = "Brad says maybe 5–10 MW? Crossed out: 8 MW confirmed.";
    v.capture_note(&id,text).unwrap();
    let snap = v.processing_snapshot(&id,1).unwrap();
    assert_eq!(snap.source.bytes,text.as_bytes());
    assert_eq!(snap.source.sha256,hash(text.as_bytes()));
    assert_eq!(snap.source.mime_type,"text/plain");
    assert!(!snap.human_corrected);
    assert_eq!(fs::read(f.0.join(format!("Recall/Sources/{id}.txt"))).unwrap(),text.as_bytes());
    assert_eq!(f.vault().processing_snapshot(&id,1).unwrap().source.bytes,text.as_bytes());
}
#[test]
fn processing_snapshot_rejects_stale_revision_and_protects_human_correction() {
    let f = Fixture::new(); let v=f.vault(); let id=op();
    v.capture_note(&id,"Utility late.").unwrap();
    v.correct(&id,1,&op(),"User correction: utility is on time.").unwrap();
    assert!(v.processing_snapshot(&id,1).is_err());
    let snap=v.processing_snapshot(&id,2).unwrap();
    assert!(snap.human_corrected);
    assert_eq!(snap.source.bytes,b"Utility late.");
    assert!(snap.memory.note.contains("on time"));
}
#[test]
fn processing_snapshot_rejects_tampered_text_and_photo_sources() {
    let f=Fixture::new(); let v=f.vault(); let id=op();
    v.capture_note(&id,"Utility late.").unwrap();
    v.processing_snapshot(&id,1).unwrap();
    fs::write(f.0.join(format!("Recall/Sources/{id}.txt")),b"8 MW confirmed").unwrap();
    assert!(v.processing_snapshot(&id,1).is_err());
    let p=v.capture(&op(),"synthetic.png",&photo(),"").unwrap();
    fs::write(f.0.join(format!("Recall/Sources/{}.png",p.id)),b"different").unwrap();
    assert!(v.processing_snapshot(&p.id,1).is_err());
}
#[test]
fn processing_snapshot_reconciles_external_edits_before_provider_context() {
    let f=Fixture::new(); let v=f.vault(); let id=op();
    v.capture_note(&id,"Utility late.").unwrap();
    let p=v.note_path(&id);
    let body=fs::read_to_string(&p).unwrap().replace("Utility late.","Utility on time.");
    fs::write(&p,body).unwrap();
    assert!(v.processing_snapshot(&id,1).is_err());
    assert!(v.processing_snapshot(&id,2).unwrap().human_corrected);
}

fn organized_fixture()->(crate::librarian::organization_tests::Temp,Vault,String,String,String){
    use crate::librarian::organization_tests as provider_fixture;
    let (t,v,parser,memory)=provider_fixture::setup();let organization=op();
    crate::librarian::organize_selected(&v,&provider_fixture::config(),&parser,&organization,true,&provider_fixture::claude()).unwrap();
    (t,v,parser,organization,memory)
}
#[test]
fn meeting_publication_has_native_yaml_original_and_durable_idempotent_history(){
    let (t,v,parser,organization,memory)=organized_fixture();let publication=op();
    let saved=v.publish_meeting(&parser,&organization,&publication).unwrap();assert_eq!(saved.revision,2);
    let document=fs::read_to_string(t.0.join(format!("Recall/Memories/{memory}.md"))).unwrap();
    assert!(document.starts_with(&modern_identity(&memory)));assert!(document.contains("librarian_model:"));
    assert!(document.contains("source_sha256:"));assert!(document.contains("Open questions and uncertainty"));
    assert!(!document.split("## Retracted").next().unwrap().contains("8 MW confirmed"));
    let reopened=Vault::open(&t.0).unwrap();assert_eq!(reopened.publish_meeting(&parser,&organization,&publication).unwrap().revision,2);
    assert_eq!(reopened.history(&memory).unwrap()[1].origin,"model:claude");
    assert!(String::from_utf8(reopened.source(&memory).unwrap().bytes).unwrap().contains("Crossed out: 8 MW confirmed"));
    assert_eq!(serde_json::from_slice::<Manifest>(&fs::read(t.0.join("Recall/_meta/manifest.json")).unwrap()).unwrap().format,FORMAT_V3);
    reopened.capture_note(&op(),"Another user capture").unwrap();assert_eq!(Vault::open(&t.0).unwrap().list("").unwrap().len(),2);
}
#[test]
fn modern_notes_preserve_external_edits_rename_correction_restore_and_removal(){
    let (t,v,parser,organization,memory)=organized_fixture();let publication=op();v.publish_meeting(&parser,&organization,&publication).unwrap();
    let old=t.0.join(format!("Recall/Memories/{memory}.md"));let renamed=t.0.join("Recall/Memories/Utility planning.md");fs::rename(old,&renamed).unwrap();
    let edited=format!("{}\nHuman correction: utility now on time.\n",fs::read_to_string(&renamed).unwrap());fs::write(&renamed,&edited).unwrap();
    let reopened=Vault::open(&t.0).unwrap();let latest=reopened.list("").unwrap().pop().unwrap();assert_eq!(latest.revision,3);assert_eq!(latest.note,edited);
    assert_eq!(reopened.publish_meeting(&parser,&organization,&publication).unwrap().note,edited);
    assert!(reopened.publish_meeting(&parser,&organization,&op()).is_err());
    let corrected=reopened.correct(&memory,3,&op(),&format!("{edited}\nReviewed by user.")).unwrap();assert_eq!(corrected.revision,4);
    fs::remove_file(&renamed).unwrap();let restored=reopened.restore_note(&memory,4,&op()).unwrap();assert_eq!(restored.revision,5);
    assert!(fs::read_to_string(&renamed).unwrap().starts_with("---\nrecall_id:"));
    let removed=reopened.remove(&memory,5,&op(),"active").unwrap();assert_eq!(removed.state,"deleted");
}
#[test]
fn publication_refuses_source_and_user_edits_before_commit(){
    let (t,v,parser,organization,memory)=organized_fixture();
    let path=t.0.join(format!("Recall/Memories/{memory}.md"));let edited=format!("{}\nUser changed it.",fs::read_to_string(&path).unwrap());fs::write(&path,&edited).unwrap();
    assert!(v.publish_meeting(&parser,&organization,&op()).is_err());assert_eq!(fs::read_to_string(path).unwrap(),edited);
    let (t,v,parser,organization,memory)=organized_fixture();fs::write(t.0.join(format!("Recall/Sources/{memory}.txt")),"forged original").unwrap();
    assert!(v.publish_meeting(&parser,&organization,&op()).is_err());assert_eq!(v.history(&memory).unwrap().len(),1);
}
#[test]
fn interrupted_meeting_publication_recovers_without_duplicate_revisions(){
    for point in ["fence_before","before_note","publish_before","publish_after","before_history","before_receipt"] {
        let (t,v,parser,organization,memory)=organized_fixture();let publication=op();
        let fault=FaultGuard::set(move |at,_|if at==point {Err("INJECTED publication interruption".into())}else{Ok(())});
        assert!(v.publish_meeting(&parser,&organization,&publication).is_err());drop(fault);
        let reopened=Vault::open(&t.0).unwrap();let saved=reopened.publish_meeting(&parser,&organization,&publication).unwrap();assert_eq!(saved.revision,2);
        assert_eq!(reopened.history(&memory).unwrap().len(),2);
        assert!(fs::read_to_string(t.0.join(format!("Recall/Memories/{memory}.md"))).unwrap().starts_with("---\nrecall_id:"));
    }
}

#[test]
fn recovery_cannot_publish_after_original_tampering(){
    let (t,v,parser,organization,memory)=organized_fixture();let publication=op();
    let fault=FaultGuard::set(|point,_|if point=="before_note"{Err("INJECTED pending organization".into())}else{Ok(())});
    assert!(v.publish_meeting(&parser,&organization,&publication).is_err());drop(fault);
    fs::write(t.0.join(format!("Recall/Sources/{memory}.txt")),"tampered after interruption").unwrap();
    let reopened=Vault::open(&t.0).unwrap();let listed=reopened.list("").unwrap();assert!(listed[0].conflict.is_some());
    assert_eq!(fs::read_dir(t.0.join(format!("Recall/History/{memory}"))).unwrap().count(),1);
    assert!(!fs::read_to_string(t.0.join(format!("Recall/Memories/{memory}.md"))).unwrap().starts_with("---"));
    assert!(reopened.publish_meeting(&parser,&organization,&publication).is_err());
}
#[test]
fn recovery_cannot_publish_after_related_context_edit(){
    use crate::librarian::organization_tests as fixture;
    let (t,v,parser,memory)=fixture::setup();let related=v.capture_note(&op(),"Utility planning context").unwrap();let organization=op();
    crate::librarian::organize_selected(&v,&fixture::config(),&parser,&organization,true,&fixture::claude()).unwrap();
    let publication=op();let fault=FaultGuard::set(|point,_|if point=="before_note"{Err("INJECTED pending organization".into())}else{Ok(())});
    assert!(v.publish_meeting(&parser,&organization,&publication).is_err());drop(fault);
    let path=t.0.join(format!("Recall/Memories/{}.md",related.id));let edited=format!("{}\nExternal correction.",fs::read_to_string(&path).unwrap());fs::write(path,&edited).unwrap();
    let reopened=Vault::open(&t.0).unwrap();let listed=reopened.list("").unwrap();assert!(listed.iter().find(|m|m.id==memory).unwrap().conflict.is_some());
    assert_eq!(fs::read_dir(t.0.join(format!("Recall/History/{memory}"))).unwrap().count(),1);
    assert!(!fs::read_to_string(t.0.join(format!("Recall/Memories/{memory}.md"))).unwrap().starts_with("---"));
}

#[test]
fn interrupted_photo_publication_recovers_both_evidence_references(){
    for point in ["before_note","publish_before","publish_after","before_history","before_receipt"]{
        let (t,v,parser,organization,memory)=crate::processing::tests::photo_fixture();let publication=op();
        let fault=FaultGuard::set(move |at,_|if at==point{Err("INJECTED photo publication interruption".into())}else{Ok(())});
        assert!(v.publish_meeting(&parser,&organization,&publication).is_err());drop(fault);
        let reopened=Vault::open(&t.0).unwrap();let saved=reopened.publish_meeting(&parser,&organization,&publication).unwrap();assert_eq!(saved.revision,2);
        assert_eq!(reopened.history(&memory).unwrap().len(),2);assert!(saved.note.contains("visual_status: unreviewed"));assert!(saved.note.contains("Original photo]]"));assert!(saved.note.contains("Unreviewed machine transcription]]"));
        assert_eq!(reopened.source(&memory).unwrap().sha256,reopened.captured_source_while_locked(&memory).unwrap().sha256);
    }
}
#[test]
fn photo_recovery_refuses_tampered_transcription_before_publication(){
    let (t,v,parser,organization,memory)=crate::processing::tests::photo_fixture();let publication=op();
    let fault=FaultGuard::set(|point,_|if point=="before_note"{Err("INJECTED photo pending".into())}else{Ok(())});assert!(v.publish_meeting(&parser,&organization,&publication).is_err());drop(fault);
    fs::write(t.0.join(format!("Recall/Sources/{memory}-{parser}.txt")),"Forged machine transcription").unwrap();
    let reopened=Vault::open(&t.0).unwrap();assert!(reopened.list("").unwrap()[0].conflict.is_some());assert_eq!(fs::read_dir(t.0.join(format!("Recall/History/{memory}"))).unwrap().count(),1);
    assert!(!fs::read_to_string(t.0.join(format!("Recall/Memories/{memory}.md"))).unwrap().starts_with("---"));
}

#[test]
fn previous_native_typed_publication_artifacts_replay_and_recover_unchanged(){
    // Exported by compiling source-identical native modules from pre-photo commit
    //887e1c4, using explicitly synthetic provider fixtures. This is storage
    // compatibility evidence, not model/provider execution evidence.
    let fixture:serde_json::Value=serde_json::from_str(include_str!("fixtures/legacy-v3-organization.json")).unwrap();
    assert_eq!(fixture["generated_from"],"887e1c4df3eab2fab64f795c633b7ef6130edf6d");
    for case in fixture["cases"].as_array().unwrap(){
        let f=Fixture::new();
        for directory in case["directories"].as_array().unwrap(){let relative=Path::new(directory.as_str().unwrap());assert!(relative.components().all(|c|matches!(c,Component::Normal(_))));fs::create_dir_all(f.0.join(relative)).unwrap();}
        for file in case["files"].as_array().unwrap(){
            let relative=Path::new(file["path"].as_str().unwrap());assert!(relative.components().all(|c|matches!(c,Component::Normal(_))));
            let path=f.0.join(relative);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,file["contents"].as_str().unwrap()).unwrap();
        }
        let memory=case["memory_id"].as_str().unwrap();
        let original=case["files"].as_array().unwrap().iter().find(|file|file["path"]==format!("Recall/_meta/journal/{}.json",case["publication_operation_id"].as_str().unwrap())).unwrap();
        let event:serde_json::Value=serde_json::from_str(original["contents"].as_str().unwrap()).unwrap();let previous_document=event["markdown"].as_str().unwrap();
        let v=Vault::open(&f.0).unwrap();
        let saved=v.publish_meeting(case["parser_operation_id"].as_str().unwrap(),case["organization_operation_id"].as_str().unwrap(),case["publication_operation_id"].as_str().unwrap()).unwrap();
        assert_eq!(saved.revision,2);assert_eq!(saved.note,previous_document);
        assert_eq!(fs::read_to_string(f.0.join(format!("Recall/Memories/{memory}.md"))).unwrap(),previous_document);
        assert_eq!(v.history(memory).unwrap().len(),2);
    }
}

#[test]
fn native_library_creation_is_non_destructive_and_recovers_selection_after_restart() {
    let fixture=Fixture::new();let root=fixture.0.join("My Recall Library");
    let state=LocalVaultState::new(fixture.0.join("selection.json"));
    let status=state.create_path(&root).unwrap();let token=status.vault_id.unwrap();let identity=status.vault_identity.unwrap();
    let memory=state.with(&token,|vault|vault.capture_note(&op(),"Synthetic native authored note")).unwrap();
    assert!(state.create_path(&root).is_err());
    let restarted=LocalVaultState::new(fixture.0.join("selection.json"));let restored=restarted.status().unwrap();
    assert_eq!(restored.vault_identity.as_deref(),Some(identity.as_str()));
    assert_ne!(restored.vault_id.as_deref(),Some(token.as_str()));
    assert_eq!(restarted.with(restored.vault_id.as_ref().unwrap(),|vault|vault.list("")).unwrap()[0].id,memory.id);
}

#[test]
fn markdown_import_preserves_original_content_and_never_modifies_the_input_file() {
    let fixture=Fixture::new();let vault=fixture.vault();let source=fixture.0.join("existing.md");
    let text="---\ntags: [private]\n---\n# Synthetic imported note\n\nAn uncertain number: **42?**\n[[another-note]]\n";
    fs::write(&source,text).unwrap();let operation=op();
    let memory=vault.import_markdown_path(&operation,&source).unwrap();
    assert_eq!(memory.note,text);assert_eq!(fs::read(&source).unwrap(),text.as_bytes());
    assert_eq!(vault.source(&memory.id).unwrap().bytes,text.as_bytes());
    assert_eq!(vault.import_markdown_path(&operation,&source).unwrap().id,memory.id);
    let corrected=vault.correct(&memory.id,1,&op(),"# Human correction\n42 is unknown.").unwrap();
    assert_eq!(vault.source(&corrected.id).unwrap().bytes,text.as_bytes());
    let reopened=Vault::open(vault.root()).unwrap();assert_eq!(reopened.history(&memory.id).unwrap().len(),2);
    assert_eq!(fs::read(source).unwrap(),text.as_bytes());
}

#[test]
fn explicitly_restoring_removed_memory_retains_id_original_and_history_without_replaying_old_writes() {
    let fixture=Fixture::new();let vault=fixture.vault();let capture=op();
    let memory=vault.capture_note(&capture,"Synthetic recoverable memory?").unwrap();
    let removed=vault.remove(&memory.id,1,&op(),"active").unwrap();
    assert!(vault.restore_note(&memory.id,removed.revision,&op()).is_err());
    assert!(vault.restore_deleted(&memory.id,1,&op()).is_err());
    let restore=op();let restored=vault.restore_deleted(&memory.id,removed.revision,&restore).unwrap();
    assert_eq!(restored.id,memory.id);assert_eq!(restored.note,memory.note);assert_eq!(restored.revision,3);
    assert_eq!(vault.restore_deleted(&memory.id,removed.revision,&restore).unwrap().revision,3);
    assert_eq!(Vault::open(vault.root()).unwrap().source(&memory.id).unwrap().bytes,memory.note.as_bytes());
    assert_eq!(vault.history(&memory.id).unwrap().iter().map(|r|r.kind.as_str()).collect::<Vec<_>>(),vec!["capture","remove","restore_deleted"]);
}

#[test]
fn restoring_removed_note_never_overwrites_an_external_edit() {
    let fixture=Fixture::new();let vault=fixture.vault();let m=vault.capture_note(&op(),"Synthetic original").unwrap();
    let removed=vault.remove(&m.id,1,&op(),"active").unwrap();let path=vault.root().join("Recall/Memories").join(m.note_path.unwrap());
    fs::write(&path,"External editor content must survive").unwrap();
    assert!(vault.restore_deleted(&m.id,removed.revision,&op()).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(),"External editor content must survive");
}
