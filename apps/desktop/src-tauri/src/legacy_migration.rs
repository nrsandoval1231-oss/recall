//! One-time moves of data that older (pre-rename) builds stored under Recall names: the per-app
//! data directories (`com.example.recall.desktop`) and the native SQLite cache (`recall.sqlite3`
//! plus sidecars).
//!
//! Everything here is a plain rename, never a copy and never a delete. A live SQLite database or
//! WebView2 profile cannot be copied safely while the old app may still be running, and a partial
//! copy followed by a delete could split or destroy live data. If a rename fails (typically because
//! the old Recall app still has the files open) the launch is refused and nothing is changed, so the
//! next launch simply retries.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
/// Filesystem rename, injectable so tests can force the failure paths.
pub(crate) type RenameFn<'a> = &'a dyn Fn(&Path, &Path) -> io::Result<()>;

/// Tauri identifier used by builds before the rename; names the legacy app data directories.
pub(crate) const LEGACY_IDENTIFIER: &str = "com.example.recall.desktop";
pub(crate) const SQLITE_NAME: &str = "monolith.sqlite3";
pub(crate) const LEGACY_SQLITE_NAME: &str = "recall.sqlite3";
const SQLITE_SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}
fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
}
pub(crate) fn fs_rename(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DirOutcome {
    /// No legacy directory (or not a plain directory): nothing to do.
    NothingToMigrate,
    /// The new directory already holds data; the legacy one is left untouched.
    NewHasData,
    Renamed,
}

/// Rename `old` to `new` unless `new` already holds data. An empty, pre-created `new` directory is
/// replaced (and restored if the rename then fails); a non-empty one is never merged into.
pub(crate) fn migrate_dir(old: &Path, new: &Path, rename: RenameFn) -> Result<DirOutcome> {
    if !is_real_dir(old) {
        return Ok(DirOutcome::NothingToMigrate);
    }
    let empty_new = match fs::symlink_metadata(new) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
        Ok(_) if is_real_dir(new) => {
            if fs::read_dir(new)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
            {
                return Ok(DirOutcome::NewHasData);
            }
            true
        }
        Ok(_) => return Ok(DirOutcome::NewHasData),
    };
    if empty_new {
        // Renaming onto an existing directory fails on Windows even when it is empty.
        fs::remove_dir(new).map_err(|e| e.to_string())?;
    }
    match rename(old, new) {
        Ok(()) => Ok(DirOutcome::Renamed),
        Err(error) => {
            if empty_new {
                let _ = fs::create_dir(new);
            }
            Err(format!(
                "could not move {} (is the previous app still running?): {error}",
                old.display()
            ))
        }
    }
}

/// Migrate `<parent>/<legacy_identifier>` to `<parent>/<identifier>` for every distinct parent as
/// ONE all-or-nothing unit. If any parent fails, the ones already moved are moved back, and the
/// error is returned; no new directory is created by a failed attempt.
pub(crate) fn migrate_app_dirs(
    parents: &[PathBuf],
    identifier: &str,
    legacy_identifier: &str,
    rename: RenameFn,
) -> Result<Vec<(PathBuf, DirOutcome)>> {
    if identifier == legacy_identifier {
        return Ok(Vec::new());
    }
    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut results: Vec<(PathBuf, DirOutcome)> = Vec::new();
    let mut seen = Vec::<&PathBuf>::new();
    for parent in parents {
        if seen.contains(&parent) {
            continue;
        }
        seen.push(parent);
        let (old, new) = (parent.join(legacy_identifier), parent.join(identifier));
        match migrate_dir(&old, &new, rename) {
            Ok(outcome) => {
                if outcome == DirOutcome::Renamed {
                    done.push((old, new.clone()));
                }
                results.push((new, outcome));
            }
            Err(error) => {
                let mut stranded = Vec::new();
                for (old, new) in done.iter().rev() {
                    if rename(new, old).is_err() {
                        stranded.push(new.display().to_string());
                    }
                }
                return Err(if stranded.is_empty() {
                    error
                } else {
                    format!(
                        "{error}; could not move back: {} (rename it to {LEGACY_IDENTIFIER} manually)",
                        stranded.join(", ")
                    )
                });
            }
        }
    }
    Ok(results)
}

/// The directories Tauri uses for `app_data_dir` and `app_local_data_dir`, minus the identifier.
fn data_parents() -> Vec<PathBuf> {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let mut parents = Vec::new();
    #[cfg(windows)]
    {
        parents.extend(var("APPDATA"));
        parents.extend(var("LOCALAPPDATA"));
    }
    #[cfg(target_os = "macos")]
    parents.extend(var("HOME").map(|h| h.join("Library/Application Support")));
    #[cfg(not(any(windows, target_os = "macos")))]
    parents.extend(var("XDG_DATA_HOME").or_else(|| var("HOME").map(|h| h.join(".local/share"))));
    parents.retain(|p| p.is_absolute());
    parents
}

/// Run before the database or any webview is opened, so the WebView2 profile and `localStorage`
/// (kept under the local data directory) move together with the app data. An error means the
/// previous app's files could not be moved; the caller must not start on fresh data.
pub(crate) fn migrate_for_launch(identifier: &str) -> Result<()> {
    migrate_app_dirs(&data_parents(), identifier, LEGACY_IDENTIFIER, &fs_rename).map(|moved| {
        for (target, outcome) in moved {
            if outcome == DirOutcome::Renamed {
                eprintln!("Moved legacy app data to {}", target.display());
            }
        }
    })
}

/// Tell the user why Monolith did not start, then exit non-zero. Used before the app is built so no
/// new data directory is created and the next launch retries the migration.
pub(crate) fn refuse_launch(error: &str) -> ! {
    eprintln!("Monolith could not move the previous app's data: {error}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Monolith could not start")
        .set_description(format!(
            "Monolith could not move the data from the previous Recall app. \
             Close Recall (check the system tray and Task Manager), then open Monolith again. \
             Nothing was changed or lost.\n\nDetails: {error}"
        ))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
    std::process::exit(1)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SqliteOutcome {
    /// `monolith.sqlite3` already exists; legacy files are untouched.
    NewExists,
    /// No legacy database; the new path will be created fresh.
    NothingToMigrate,
    Migrated,
}

/// Move `recall.sqlite3` to `monolith.sqlite3`. "New exists" is decided only by the main file. The
/// `-wal`/`-shm`/`-journal` sidecars move first and the main file last, so an interruption always
/// leaves the legacy main file in place and the next attempt resumes with whatever sidecars remain.
/// Sidecars with no main file anywhere are left alone. If a rename fails, the files already moved
/// in this attempt are moved back.
pub(crate) fn migrate_sqlite(dir: &Path, rename: RenameFn) -> Result<SqliteOutcome> {
    let new_main = dir.join(SQLITE_NAME);
    let legacy_main = dir.join(LEGACY_SQLITE_NAME);
    if exists(&new_main) {
        return Ok(SqliteOutcome::NewExists);
    }
    if !exists(&legacy_main) {
        return Ok(SqliteOutcome::NothingToMigrate);
    }
    let mut steps: Vec<(PathBuf, PathBuf)> = SQLITE_SIDECARS
        .iter()
        .map(|s| {
            (
                dir.join(format!("{LEGACY_SQLITE_NAME}{s}")),
                dir.join(format!("{SQLITE_NAME}{s}")),
            )
        })
        .filter(|(from, _)| exists(from))
        .collect();
    steps.push((legacy_main, new_main));
    let mut moved: Vec<&(PathBuf, PathBuf)> = Vec::new();
    for step in &steps {
        if let Err(error) = rename(&step.0, &step.1) {
            let mut stuck = false;
            for (from, to) in moved.iter().rev().map(|s| (&s.0, &s.1)) {
                stuck |= rename(to, from).is_err();
            }
            return Err(format!(
                "could not rename the legacy database: {error}{}",
                if stuck {
                    " (and could not undo every step)"
                } else {
                    ""
                }
            ));
        }
        moved.push(step);
    }
    Ok(SqliteOutcome::Migrated)
}

/// The database file to open: the Monolith name after a successful (or unnecessary) migration;
/// after a failed one, whichever main file actually exists, so existing data is never abandoned.
pub(crate) fn sqlite_path_to_open(dir: &Path, rename: RenameFn) -> PathBuf {
    match migrate_sqlite(dir, rename) {
        Ok(_) => dir.join(SQLITE_NAME),
        Err(error) => {
            eprintln!("{error}; opening whichever database file exists");
            if exists(&dir.join(SQLITE_NAME)) || !exists(&dir.join(LEGACY_SQLITE_NAME)) {
                dir.join(SQLITE_NAME)
            } else {
                dir.join(LEGACY_SQLITE_NAME)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use uuid::Uuid;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p =
                std::env::temp_dir().join(format!("monolith-synthetic-migrate-{}", Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(fs::canonicalize(p).unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn legacy_tree(root: &Path) {
        write(&root.join("selected-vault.json"), b"{\"synthetic\":true}");
        write(&root.join("sources/a.bin"), b"original bytes");
        write(
            &root.join("EBWebView/Default/Local Storage/leveldb/000003.log"),
            b"ls",
        );
        fs::create_dir_all(root.join("empty-dir")).unwrap();
    }
    fn never(_: &Path, _: &Path) -> io::Result<()> {
        Err(io::Error::other("synthetic rename failure"))
    }
    const NEW_ID: &str = "com.example.monolith.desktop";

    #[test]
    fn renames_the_legacy_directory_when_the_new_one_is_absent() {
        let t = Temp::new();
        legacy_tree(&t.0.join(LEGACY_IDENTIFIER));
        let outcome =
            migrate_dir(&t.0.join(LEGACY_IDENTIFIER), &t.0.join(NEW_ID), &fs_rename).unwrap();
        assert_eq!(outcome, DirOutcome::Renamed);
        let new = t.0.join(NEW_ID);
        assert_eq!(
            fs::read(new.join("sources/a.bin")).unwrap(),
            b"original bytes"
        );
        assert!(new
            .join("EBWebView/Default/Local Storage/leveldb/000003.log")
            .is_file());
        assert!(new.join("empty-dir").is_dir());
        assert!(!t.0.join(LEGACY_IDENTIFIER).exists());
    }

    #[test]
    fn replaces_an_empty_precreated_new_directory() {
        let t = Temp::new();
        legacy_tree(&t.0.join(LEGACY_IDENTIFIER));
        fs::create_dir(t.0.join("new")).unwrap();
        let outcome =
            migrate_dir(&t.0.join(LEGACY_IDENTIFIER), &t.0.join("new"), &fs_rename).unwrap();
        assert_eq!(outcome, DirOutcome::Renamed);
        assert!(t.0.join("new/selected-vault.json").is_file());
    }

    #[test]
    fn a_new_directory_with_data_is_never_merged_and_legacy_is_untouched() {
        let t = Temp::new();
        legacy_tree(&t.0.join(LEGACY_IDENTIFIER));
        write(&t.0.join("new/monolith.sqlite3"), b"new data");
        let outcome =
            migrate_dir(&t.0.join(LEGACY_IDENTIFIER), &t.0.join("new"), &fs_rename).unwrap();
        assert_eq!(outcome, DirOutcome::NewHasData);
        assert_eq!(
            fs::read(t.0.join("new/monolith.sqlite3")).unwrap(),
            b"new data"
        );
        assert!(!t.0.join("new/selected-vault.json").exists());
        assert!(t.0.join(LEGACY_IDENTIFIER).join("sources/a.bin").is_file());
    }

    #[test]
    fn nothing_happens_without_a_legacy_directory() {
        let t = Temp::new();
        let outcome =
            migrate_dir(&t.0.join(LEGACY_IDENTIFIER), &t.0.join("new"), &fs_rename).unwrap();
        assert_eq!(outcome, DirOutcome::NothingToMigrate);
        assert!(!t.0.join("new").exists());
    }

    #[test]
    fn a_failed_rename_never_copies_or_deletes_and_restores_an_empty_target() {
        let t = Temp::new();
        let old = t.0.join(LEGACY_IDENTIFIER);
        legacy_tree(&old);
        fs::create_dir(t.0.join("new")).unwrap();
        assert!(migrate_dir(&old, &t.0.join("new"), &never).is_err());
        // The legacy tree is exactly as it was, and no copy or staging directory appeared.
        assert_eq!(
            fs::read(old.join("sources/a.bin")).unwrap(),
            b"original bytes"
        );
        assert!(old.join("empty-dir").is_dir());
        assert!(old
            .join("EBWebView/Default/Local Storage/leveldb/000003.log")
            .is_file());
        assert!(fs::read_dir(t.0.join("new")).unwrap().next().is_none());
        let mut names: Vec<_> = fs::read_dir(&t.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec![LEGACY_IDENTIFIER.to_owned(), "new".to_owned()]);
    }

    fn two_parents(t: &Temp) -> (PathBuf, PathBuf) {
        let (roaming, local) = (t.0.join("Roaming"), t.0.join("Local"));
        legacy_tree(&roaming.join(LEGACY_IDENTIFIER));
        write(
            &local
                .join(LEGACY_IDENTIFIER)
                .join("EBWebView/Default/Preferences"),
            b"profile",
        );
        (roaming, local)
    }

    #[test]
    fn app_dirs_migrate_per_parent_and_dedupe_repeated_parents() {
        let t = Temp::new();
        let (roaming, local) = two_parents(&t);
        let calls = RefCell::new(0);
        let counting = |from: &Path, to: &Path| {
            *calls.borrow_mut() += 1;
            fs::rename(from, to)
        };
        let results = migrate_app_dirs(
            &[roaming.clone(), local.clone(), roaming.clone()],
            NEW_ID,
            LEGACY_IDENTIFIER,
            &counting,
        )
        .unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|(_, r)| *r == DirOutcome::Renamed));
        assert_eq!(*calls.borrow(), 2);
        assert!(roaming.join(NEW_ID).join("selected-vault.json").is_file());
        assert!(local
            .join(NEW_ID)
            .join("EBWebView/Default/Preferences")
            .is_file());
        // A second launch finds nothing to do.
        let again =
            migrate_app_dirs(&[roaming, local], NEW_ID, LEGACY_IDENTIFIER, &fs_rename).unwrap();
        assert!(again
            .iter()
            .all(|(_, r)| *r == DirOutcome::NothingToMigrate));
        assert!(migrate_app_dirs(
            std::slice::from_ref(&t.0),
            LEGACY_IDENTIFIER,
            LEGACY_IDENTIFIER,
            &fs_rename
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn second_parent_failure_rolls_the_first_back_and_creates_no_new_directory() {
        let t = Temp::new();
        let (roaming, local) = two_parents(&t);
        let fail_local_forward = |from: &Path, to: &Path| {
            if from.starts_with(&local) {
                Err(io::Error::other(
                    "synthetic: old app still has the profile open",
                ))
            } else {
                fs::rename(from, to)
            }
        };
        let error = migrate_app_dirs(
            &[roaming.clone(), local.clone()],
            NEW_ID,
            LEGACY_IDENTIFIER,
            &fail_local_forward,
        )
        .unwrap_err();
        assert!(error.contains("previous app"), "{error}");
        // Both legacy directories are exactly where they were; neither new directory exists.
        assert_eq!(
            fs::read(roaming.join(LEGACY_IDENTIFIER).join("sources/a.bin")).unwrap(),
            b"original bytes"
        );
        assert!(local
            .join(LEGACY_IDENTIFIER)
            .join("EBWebView/Default/Preferences")
            .is_file());
        assert!(!roaming.join(NEW_ID).exists());
        assert!(!local.join(NEW_ID).exists());
    }

    #[test]
    fn a_failed_launch_creates_no_directories_and_a_retry_succeeds() {
        let t = Temp::new();
        let (roaming, local) = two_parents(&t);
        let before = |dir: &Path| {
            let mut names: Vec<_> = fs::read_dir(dir)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect();
            names.sort();
            names
        };
        let (b_roaming, b_local) = (before(&roaming), before(&local));
        let parents = [roaming.clone(), local.clone()];
        assert!(migrate_app_dirs(&parents, NEW_ID, LEGACY_IDENTIFIER, &never).is_err());
        assert_eq!((before(&roaming), before(&local)), (b_roaming, b_local));
        // Closing the old app and launching again retries from the untouched legacy state.
        let moved = migrate_app_dirs(&parents, NEW_ID, LEGACY_IDENTIFIER, &fs_rename).unwrap();
        assert!(moved.iter().all(|(_, r)| *r == DirOutcome::Renamed));
        assert!(roaming.join(NEW_ID).join("sources/a.bin").is_file());
        assert!(local
            .join(NEW_ID)
            .join("EBWebView/Default/Preferences")
            .is_file());
        assert!(!roaming.join(LEGACY_IDENTIFIER).exists());
    }

    #[test]
    fn a_rollback_that_also_fails_reports_the_stranded_directory() {
        let t = Temp::new();
        let (roaming, local) = two_parents(&t);
        let flaky = |from: &Path, to: &Path| {
            if from.starts_with(&local) || from.starts_with(roaming.join(NEW_ID)) {
                Err(io::Error::other("synthetic"))
            } else {
                fs::rename(from, to)
            }
        };
        let error = migrate_app_dirs(
            &[roaming.clone(), local.clone()],
            NEW_ID,
            LEGACY_IDENTIFIER,
            &flaky,
        )
        .unwrap_err();
        assert!(error.contains("could not move back"), "{error}");
        assert!(roaming.join(NEW_ID).join("sources/a.bin").is_file());
    }

    fn files(dir: &Path, base: &str, suffixes: &[&str]) {
        for suffix in suffixes {
            write(
                &dir.join(format!("{base}{suffix}")),
                format!("{base}{suffix}").as_bytes(),
            );
        }
    }
    fn content(dir: &Path, name: &str) -> Option<String> {
        fs::read_to_string(dir.join(name)).ok()
    }

    #[test]
    fn sqlite_sidecars_move_first_and_the_main_file_last() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-wal", "-shm", "-journal"]);
        let order = RefCell::new(Vec::<String>::new());
        let recording = |from: &Path, to: &Path| {
            order
                .borrow_mut()
                .push(from.file_name().unwrap().to_string_lossy().into_owned());
            fs::rename(from, to)
        };
        assert_eq!(sqlite_path_to_open(&t.0, &recording), t.0.join(SQLITE_NAME));
        assert_eq!(order.borrow().last().unwrap(), LEGACY_SQLITE_NAME);
        assert_eq!(order.borrow().len(), 4);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            assert_eq!(
                content(&t.0, &format!("{SQLITE_NAME}{suffix}")).unwrap(),
                format!("{LEGACY_SQLITE_NAME}{suffix}")
            );
            assert!(!t.0.join(format!("{LEGACY_SQLITE_NAME}{suffix}")).exists());
        }
    }

    #[test]
    fn sqlite_without_sidecars_and_without_any_database() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &[""]);
        assert_eq!(
            migrate_sqlite(&t.0, &fs_rename).unwrap(),
            SqliteOutcome::Migrated
        );
        assert!(t.0.join(SQLITE_NAME).is_file());
        let empty = Temp::new();
        assert_eq!(
            migrate_sqlite(&empty.0, &fs_rename).unwrap(),
            SqliteOutcome::NothingToMigrate
        );
        assert_eq!(
            sqlite_path_to_open(&empty.0, &fs_rename),
            empty.0.join(SQLITE_NAME)
        );
    }

    #[test]
    fn sqlite_new_main_file_wins_and_all_legacy_files_are_untouched() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-wal"]);
        files(&t.0, SQLITE_NAME, &[""]);
        assert_eq!(
            migrate_sqlite(&t.0, &fs_rename).unwrap(),
            SqliteOutcome::NewExists
        );
        assert_eq!(sqlite_path_to_open(&t.0, &fs_rename), t.0.join(SQLITE_NAME));
        assert_eq!(content(&t.0, SQLITE_NAME).unwrap(), SQLITE_NAME);
        assert_eq!(
            content(&t.0, LEGACY_SQLITE_NAME).unwrap(),
            LEGACY_SQLITE_NAME
        );
        assert!(t.0.join(format!("{LEGACY_SQLITE_NAME}-wal")).is_file());
    }

    #[test]
    fn sqlite_a_stray_new_sidecar_alone_does_not_count_as_a_new_database() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &[""]);
        // Not a rename target of ours, so it stays; only the main file decides "new exists".
        files(&t.0, SQLITE_NAME, &["-shm"]);
        assert_eq!(
            migrate_sqlite(&t.0, &fs_rename).unwrap(),
            SqliteOutcome::Migrated
        );
        assert_eq!(content(&t.0, SQLITE_NAME).unwrap(), LEGACY_SQLITE_NAME);
    }

    #[test]
    fn sqlite_interrupted_after_some_sidecars_resumes_with_what_remains() {
        let t = Temp::new();
        // State left by a crash: -wal already moved, -shm and the main file still legacy.
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-shm"]);
        files(&t.0, SQLITE_NAME, &["-wal"]);
        assert_eq!(
            migrate_sqlite(&t.0, &fs_rename).unwrap(),
            SqliteOutcome::Migrated
        );
        for suffix in ["", "-wal", "-shm"] {
            assert!(
                t.0.join(format!("{SQLITE_NAME}{suffix}")).is_file(),
                "{suffix}"
            );
            assert!(
                !t.0.join(format!("{LEGACY_SQLITE_NAME}{suffix}")).exists(),
                "{suffix}"
            );
        }
        assert_eq!(
            content(&t.0, &format!("{SQLITE_NAME}-wal")).unwrap(),
            format!("{SQLITE_NAME}-wal")
        );
    }

    #[test]
    fn sqlite_legacy_sidecars_with_no_main_file_anywhere_are_left_alone() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["-wal", "-shm"]);
        assert_eq!(
            migrate_sqlite(&t.0, &fs_rename).unwrap(),
            SqliteOutcome::NothingToMigrate
        );
        assert!(t.0.join(format!("{LEGACY_SQLITE_NAME}-wal")).is_file());
        assert!(t.0.join(format!("{LEGACY_SQLITE_NAME}-shm")).is_file());
        assert!(!t.0.join(SQLITE_NAME).exists());
    }

    #[test]
    fn sqlite_failure_on_the_main_file_rolls_the_sidecars_back_and_keeps_legacy() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-wal", "-shm"]);
        let fail_main = |from: &Path, to: &Path| {
            if from.file_name().unwrap() == LEGACY_SQLITE_NAME {
                Err(io::Error::other("synthetic rename failure"))
            } else {
                fs::rename(from, to)
            }
        };
        assert!(migrate_sqlite(&t.0, &fail_main).is_err());
        assert_eq!(
            sqlite_path_to_open(&t.0, &fail_main),
            t.0.join(LEGACY_SQLITE_NAME)
        );
        for suffix in ["", "-wal", "-shm"] {
            assert_eq!(
                content(&t.0, &format!("{LEGACY_SQLITE_NAME}{suffix}")).unwrap(),
                format!("{LEGACY_SQLITE_NAME}{suffix}")
            );
            assert!(!t.0.join(format!("{SQLITE_NAME}{suffix}")).exists());
        }
    }

    #[test]
    fn sqlite_failure_midway_through_the_sidecars_rolls_back() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-wal", "-shm"]);
        let fail_shm = |from: &Path, to: &Path| {
            if from.to_string_lossy().ends_with("-shm") {
                Err(io::Error::other("synthetic rename failure"))
            } else {
                fs::rename(from, to)
            }
        };
        assert!(migrate_sqlite(&t.0, &fail_shm).is_err());
        for suffix in ["", "-wal", "-shm"] {
            assert!(
                t.0.join(format!("{LEGACY_SQLITE_NAME}{suffix}")).is_file(),
                "{suffix}"
            );
            assert!(
                !t.0.join(format!("{SQLITE_NAME}{suffix}")).exists(),
                "{suffix}"
            );
        }
    }

    #[test]
    fn sqlite_when_rollback_also_fails_the_main_file_that_exists_is_opened() {
        let t = Temp::new();
        files(&t.0, LEGACY_SQLITE_NAME, &["", "-wal"]);
        // The main-file rename fails and so does moving -wal back: the legacy main is what exists.
        let stuck = |from: &Path, to: &Path| {
            if from.file_name().unwrap() == LEGACY_SQLITE_NAME
                || from.to_string_lossy().contains(SQLITE_NAME)
            {
                Err(io::Error::other("synthetic rename failure"))
            } else {
                fs::rename(from, to)
            }
        };
        let error = migrate_sqlite(&t.0, &stuck).unwrap_err();
        assert!(error.contains("could not undo"), "{error}");
        assert_eq!(
            sqlite_path_to_open(&t.0, &stuck),
            t.0.join(LEGACY_SQLITE_NAME)
        );
        assert!(t.0.join(LEGACY_SQLITE_NAME).is_file());
    }

    #[test]
    fn sqlite_when_only_the_new_main_file_exists_after_a_failed_attempt_it_is_opened() {
        let t = Temp::new();
        files(&t.0, SQLITE_NAME, &[""]);
        assert_eq!(sqlite_path_to_open(&t.0, &never), t.0.join(SQLITE_NAME));
    }
}
