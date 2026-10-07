use super::*;
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
fn photo() -> Vec<u8> {
    b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY".to_vec()
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
    assert!(f.vault().capture_receipt(&o, "base").is_err());
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
