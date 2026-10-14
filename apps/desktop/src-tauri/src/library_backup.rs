//! Portable, hash-verified native-library backups. Never merges into an existing library.
use crate::local_vault::{self, Vault};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
const MANIFEST: &str = "recall-library-backup.json";
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
type Result<T> = std::result::Result<T, String>;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    library_id: String,
    entries: Vec<Entry>,
    directories: Vec<String>,
}
#[derive(Serialize)]
pub struct BackupResult {
    pub path: String,
    pub sha256: String,
    pub files: usize,
    pub bytes: u64,
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn valid_path(path: &str) -> Result<()> {
    if !path.starts_with("Recall/") || path.len() > 1024 || path.contains(['\\', ':', '\0']) {
        return Err("Unsafe backup path".into());
    }
    for component in path.split('/') {
        let stem = component
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.ends_with(['.', ' '])
            || component.chars().any(char::is_control)
            || component.contains(['<', '>', '"', '|', '?', '*'])
            || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit())
        {
            return Err("Backup contains a nonportable path".into());
        }
    }
    Ok(())
}
fn walk(
    root: &Path,
    relative: &str,
    files: &mut Vec<String>,
    directories: &mut Vec<String>,
    depth: usize,
) -> Result<()> {
    if depth > 32 || files.len() + directories.len() + 1 > MAX_ENTRIES {
        return Err("Library exceeds backup entry limit".into());
    }
    let path = root.join(relative);
    local_vault::safe(&path)?;
    let mut children = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    children.sort_by_key(|e| e.file_name());
    for child in children {
        if files.len() + directories.len() + 1 >= MAX_ENTRIES {
            return Err("Library exceeds backup entry limit".into());
        }
        let name = child
            .file_name()
            .into_string()
            .map_err(|_| "Library filename is not portable UTF-8")?;
        let next = format!("{relative}/{name}");
        valid_path(&next)?;
        local_vault::safe(&child.path())?;
        let kind = child.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            directories.push(next.clone());
            walk(root, &next, files, directories, depth + 1)?;
        } else if kind.is_file() {
            if next != "Recall/_meta/writer.lock" {
                files.push(next);
            }
        } else {
            return Err(
                "Library contains a link or unsupported file; originals were not changed".into(),
            );
        }
    }
    Ok(())
}
pub fn export(vault: &Vault, destination: &Path) -> Result<BackupResult> {
    export_snapshot(vault, destination, || Ok(()))
}
fn export_snapshot(
    vault: &Vault,
    destination: &Path,
    before_copy: impl FnOnce() -> Result<()>,
) -> Result<BackupResult> {
    local_vault::safe(destination)?;
    if destination.exists() {
        return Err("Choose a new backup filename; existing files are preserved".into());
    }
    if destination.starts_with(vault.root().join("Recall")) {
        return Err("Save the backup outside the Recall data folder".into());
    }
    vault.list_with_deleted("", true)?;
    vault.validate_backup_integrity()?;
    crate::attachments::validate_all(vault)?;
    let _lock = vault.lock()?;
    let parent = destination
        .parent()
        .ok_or("Backup destination has no parent")?;
    local_vault::safe(parent)?;
    let staging = parent.join(format!(".recall-backup-{}.tmp", Uuid::new_v4()));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        before_copy()?;
        let mut files = Vec::new();
        let mut directories = vec!["Recall".into()];
        walk(vault.root(), "Recall", &mut files, &mut directories, 0)?;
        let mut names = BTreeSet::new();
        for name in files.iter().chain(directories.iter()) {
            if !names.insert(name.to_lowercase()) {
                return Err("Library contains case-colliding paths".into());
            }
        }
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        let mut zip = ZipWriter::new(file);
        let mut entries = Vec::new();
        let mut total = 0u64;
        for directory in &directories {
            zip.add_directory(format!("{directory}/"), options)
                .map_err(|e| e.to_string())?;
        }
        for path in &files {
            let bytes = local_vault::read(&vault.root().join(path), MAX_FILE)?;
            total = total
                .checked_add(bytes.len() as u64)
                .ok_or("Backup size overflow")?;
            if total > MAX_TOTAL {
                return Err("Library exceeds 2 GiB portable backup limit".into());
            }
            zip.start_file(path, options).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            entries.push(Entry {
                path: path.clone(),
                size: bytes.len() as u64,
                sha256: digest(&bytes),
            });
        }
        let manifest = Manifest {
            format: "recall-native-library-backup-v1".into(),
            library_id: vault.identity().into(),
            entries,
            directories,
        };
        let manifest_bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
        if manifest.entries.len() + manifest.directories.len() + 1 > MAX_ENTRIES
            || manifest_bytes.len() > 16 * 1024 * 1024
        {
            return Err("Library exceeds portable manifest limit".into());
        }
        zip.start_file(MANIFEST, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&manifest_bytes).map_err(|e| e.to_string())?;
        zip.finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        // External tools do not share Recall's writer lock. Refuse publication if any snapshotted file changed.
        let mut latest = Vec::new();
        let mut dirs = vec!["Recall".into()];
        walk(vault.root(), "Recall", &mut latest, &mut dirs, 0)?;
        if latest != files || dirs != manifest.directories {
            return Err("Library changed during backup. Retry after external edits finish".into());
        }
        for entry in &manifest.entries {
            if digest(&local_vault::read(
                &vault.root().join(&entry.path),
                MAX_FILE,
            )?) != entry.sha256
            {
                return Err("Library changed during backup; originals were not changed".into());
            }
        }
        // Validate the actual archived bytes through the same restore path before publishing a backup.
        let verification_destination =
            parent.join(format!(".recall-backup-verification-{}", Uuid::new_v4()));
        validate_archive(&staging, &verification_destination, false)?;
        let mut file = File::open(&staging).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        local_vault::rename(&staging, destination)?;
        Ok(BackupResult {
            path: destination.to_string_lossy().into(),
            sha256: hex::encode(hash.finalize()),
            files: files.len(),
            bytes: total,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}
pub fn restore(archive: &Path, destination: &Path) -> Result<()> {
    validate_archive(archive, destination, true)
}
fn validate_archive(archive: &Path, destination: &Path, publish: bool) -> Result<()> {
    local_vault::safe(archive)?;
    local_vault::safe(destination)?;
    if !destination.is_absolute() || destination.exists() {
        return Err(
            "Restore requires a new folder; existing libraries are never merged or overwritten"
                .into(),
        );
    }
    let parent = destination
        .parent()
        .ok_or("Restore destination has no parent")?;
    local_vault::safe(parent)?;
    let file = File::open(archive).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_TOTAL {
        return Err("Backup exceeds 2 GiB archive limit".into());
    }
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("Too many backup entries".into());
    }
    let manifest: Manifest = {
        let mut entry = zip
            .by_name(MANIFEST)
            .map_err(|_| "Not a Recall native-library backup")?;
        if entry.size() > 16 * 1024 * 1024 {
            return Err("Backup manifest too large".into());
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "Invalid backup manifest")?
    };
    if manifest.format != "recall-native-library-backup-v1"
        || Uuid::parse_str(&manifest.library_id).is_err()
        || manifest.entries.len() + manifest.directories.len() + 1 != zip.len()
    {
        return Err("Incomplete or unsupported backup".into());
    }
    let mut expected = BTreeSet::new();
    expected.insert(MANIFEST.to_string());
    let mut folded = BTreeSet::new();
    let mut total = 0u64;
    for directory in &manifest.directories {
        if directory != "Recall" {
            valid_path(directory)?;
        }
        if !folded.insert(directory.to_lowercase()) || !expected.insert(format!("{directory}/")) {
            return Err("Duplicate backup directory".into());
        }
    }
    for entry in &manifest.entries {
        valid_path(&entry.path)?;
        total = total
            .checked_add(entry.size)
            .ok_or("Backup size overflow")?;
        if entry.size > MAX_FILE
            || total > MAX_TOTAL
            || entry.sha256.len() != 64
            || !folded.insert(entry.path.to_lowercase())
            || !expected.insert(entry.path.clone())
        {
            return Err("Invalid backup file or size".into());
        }
    }
    let mut found = BTreeSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if !expected.contains(entry.name())
            || !found.insert(entry.name().to_string())
            || entry.is_symlink()
        {
            return Err("Unexpected, duplicate or linked backup entry".into());
        }
    }
    let staging = parent.join(format!(".recall-restore-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    // Failed restore staging is retained for inspection; never publish a partially validated library.
    let result = (|| {
        let mut directories = manifest.directories.clone();
        directories.sort_by_key(|p| p.split('/').count());
        for directory in directories {
            fs::create_dir(staging.join(directory)).map_err(|e| e.to_string())?;
        }
        for entry in &manifest.entries {
            let mut source = zip.by_name(&entry.path).map_err(|e| e.to_string())?;
            if source.size() != entry.size || source.is_dir() {
                return Err("Backup file size mismatch".into());
            }
            let mut bytes = Vec::new();
            source
                .by_ref()
                .take(entry.size + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 != entry.size || digest(&bytes) != entry.sha256 {
                return Err("Backup file hash mismatch; restore was not published".into());
            }
            local_vault::immutable(&staging.join(&entry.path), &bytes)?;
        }
        let vault = Vault::open(&staging)?;
        if vault.identity() != manifest.library_id {
            return Err("Library identity differs from backup".into());
        }
        vault.list_with_deleted("", true)?;
        vault.validate_backup_integrity()?;
        crate::attachments::validate_all(&vault)?;
        // Preserve exact archived originals/history; native recovery must not silently alter a snapshot during validation.
        for entry in &manifest.entries {
            if digest(&local_vault::read(&staging.join(&entry.path), MAX_FILE)?) != entry.sha256 {
                return Err("Backup needed recovery; restore remains staged for inspection".into());
            }
        }
        for directory in &manifest.directories {
            local_vault::sync_dir(&staging.join(directory))?;
        }
        local_vault::sync_dir(&staging)?;
        if publish {
            local_vault::rename(&staging, destination)
        } else {
            fs::remove_dir_all(&staging).map_err(|e| e.to_string())
        }
    })();
    result.map_err(|e| format!("{e}. Staged restore retained at {}", staging.display()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_roundtrip_preserves_ids_originals_history_and_refuses_overwrite() {
        let root = std::env::temp_dir().join(format!("recall-backup-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let library = root.join("library");
        fs::create_dir(&library).unwrap();
        let vault = Vault::open(&library).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Original uncertain evidence?")
            .unwrap();
        vault.source(&memory.id).unwrap();
        vault
            .correct(
                &memory.id,
                1,
                &Uuid::new_v4().to_string(),
                "Human correction, still uncertain?",
            )
            .unwrap();
        let backup = root.join("library.zip");
        export(&vault, &backup).unwrap();
        assert!(export(&vault, &backup).is_err());
        let restored = root.join("restored");
        restore(&backup, &restored).unwrap();
        let reopened = Vault::open(&restored).unwrap();
        assert_eq!(reopened.identity(), vault.identity());
        let memories = reopened.list("").unwrap();
        assert_eq!(memories[0].id, memory.id);
        assert_eq!(memories[0].revision, 2);
        assert_eq!(
            reopened.source(&memory.id).unwrap().bytes,
            b"Original uncertain evidence?"
        );
        assert_eq!(reopened.history(&memory.id).unwrap().len(), 2);
        assert!(restore(&backup, &restored).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn deleted_memories_and_attachments_restore_without_changing_lifecycle() {
        let root = std::env::temp_dir().join(format!("recall-backup-deleted-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let library = root.join("library");
        fs::create_dir(&library).unwrap();
        let vault = Vault::open(&library).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Captured original")
            .unwrap();
        let attachment = root.join("document.txt");
        fs::write(&attachment, "Attachment original").unwrap();
        let operation = Uuid::new_v4().to_string();
        let updated =
            crate::attachments::add_from_path(&vault, &memory.id, 1, &operation, &attachment)
                .unwrap();
        vault
            .remove(
                &memory.id,
                updated.revision,
                &Uuid::new_v4().to_string(),
                "active",
            )
            .unwrap();
        let backup = root.join("backup.zip");
        export(&vault, &backup).unwrap();
        let restored = root.join("restored");
        restore(&backup, &restored).unwrap();
        let reopened = Vault::open(&restored).unwrap();
        assert!(reopened.list("").unwrap().is_empty());
        let deleted = reopened.list_with_deleted("", true).unwrap();
        assert_eq!(deleted[0].state, "deleted");
        assert_eq!(deleted[0].revision, 3);
        assert_eq!(
            fs::read(restored.join(format!("Recall/Sources/{operation}.txt"))).unwrap(),
            b"Attachment original"
        );
        assert_eq!(reopened.history(&memory.id).unwrap().len(), 3);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn tampered_archive_is_never_published_and_existing_library_survives() {
        let root = std::env::temp_dir().join(format!("recall-backup-corrupt-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let library = root.join("library");
        fs::create_dir(&library).unwrap();
        let vault = Vault::open(&library).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Safe original")
            .unwrap();
        vault.source(&memory.id).unwrap();
        let backup = root.join("backup.zip");
        export(&vault, &backup).unwrap();
        let bad = root.join("bad.zip");
        let mut archive = ZipArchive::new(File::open(&backup).unwrap()).unwrap();
        let mut output = ZipWriter::new(File::create(&bad).unwrap());
        let options = SimpleFileOptions::default();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let name = entry.name().to_string();
            if entry.is_dir() {
                output.add_directory(&name, options).unwrap();
            } else {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                if name == format!("Recall/Sources/{}.txt", memory.id) {
                    bytes[0] = b'X';
                }
                output.start_file(name, options).unwrap();
                output.write_all(&bytes).unwrap();
            }
        }
        output.finish().unwrap();
        let destination = root.join("failed-restore");
        assert!(restore(&bad, &destination)
            .unwrap_err()
            .contains("hash mismatch"));
        assert!(!destination.exists());
        assert_eq!(vault.source(&memory.id).unwrap().bytes, b"Safe original");
        assert!(backup.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupted_original_is_not_exported_as_verified_evidence() {
        let root = std::env::temp_dir().join(format!("recall-backup-source-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Original source")
            .unwrap();
        vault.source(&memory.id).unwrap();
        fs::write(
            root.join(format!("Recall/Sources/{}.txt", memory.id)),
            "Changed source",
        )
        .unwrap();
        let backup = root.join("backup.zip");
        assert!(export(&vault, &backup).is_err());
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn external_original_change_after_preflight_cannot_publish_invalid_snapshot() {
        let root = std::env::temp_dir().join(format!("recall-backup-race-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Original source")
            .unwrap();
        vault.source(&memory.id).unwrap();
        let backup = root.join("backup.zip");
        let result = export_snapshot(&vault, &backup, || {
            fs::write(
                root.join(format!("Recall/Sources/{}.txt", memory.id)),
                "External change after preflight",
            )
            .map_err(|e| e.to_string())
        });
        assert!(result.is_err());
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn traversal_windows_devices_and_case_aliases_are_not_portable() {
        for name in [
            "../escape",
            "Recall/../escape",
            "Recall/C:/bad",
            "Recall/A\\bad",
            "Recall/CON.txt",
            "Recall/a.",
            "Recall/AUX",
            "Recall/a\0b",
        ] {
            assert!(valid_path(name).is_err(), "{name}");
        }
        assert!(valid_path("Recall/Memories/ordinary note.md").is_ok());
    }
}
