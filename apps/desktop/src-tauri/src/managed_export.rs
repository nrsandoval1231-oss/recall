use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MARKDOWN_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MARKDOWN_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ORIGINAL_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_CANONICAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FILES: usize = 10_000;
const MANIFEST_NAME: &str = ".recall-export-manifest.json";
const JOURNAL_NAME: &str = ".recall-export-journal.json";

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("filesystem: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("invalid or unsupported Recall export archive")]
    InvalidArchive,
    #[error("export archive exceeds the local size limit")]
    ArchiveTooLarge,
    #[error("export archive hash mismatch")]
    HashMismatch,
    #[error("unsafe export path")]
    UnsafePath,
    #[error("selected destination already exists")]
    DestinationExists,
    #[error("select a managed Markdown destination first")]
    RootNotSelected,
    #[error("selected destination belongs to a different Recall workspace")]
    WorkspaceMismatch,
    #[error("managed export recovery requires resolving local file conflicts")]
    RecoveryConflict,
}

#[derive(Default)]
pub struct ManagedExportState {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveSaveResult {
    pub path: String,
    pub sha256: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExportConflict {
    pub record_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedExportResult {
    pub root: String,
    pub written: Vec<String>,
    pub removed: Vec<String>,
    pub conflicts: Vec<ExportConflict>,
}

#[derive(Debug, Clone)]
struct Projection {
    workspace_id: String,
    files: BTreeMap<String, ProjectedFile>,
}

#[derive(Debug, Clone)]
struct ProjectedFile {
    revision: i64,
    bytes: Vec<u8>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct PortableDocument {
    format: String,
    workspace_id: String,
    memories: Vec<PortableMemory>,
}

#[derive(Debug, Deserialize)]
struct PortableMemory {
    id: String,
    current_revision: i64,
}

#[derive(Debug, Deserialize)]
struct PortableManifest {
    format: String,
    canonical_sha256: String,
    originals: Vec<PortableOriginal>,
}

#[derive(Debug, Deserialize)]
struct PortableOriginal {
    source_id: String,
    path: String,
    sha256: String,
    byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalManifest {
    format: String,
    workspace_id: String,
    files: BTreeMap<String, LocalManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalManifestFile {
    revision: i64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportJournal {
    format: String,
    workspace_id: String,
    operations: Vec<JournalOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalOperation {
    record_id: String,
    before_sha256: Option<String>,
    after: Option<LocalManifestFile>,
}

fn canonical_uuid(value: &str) -> Result<(), ExportError> {
    let parsed = Uuid::parse_str(value).map_err(|_| ExportError::InvalidArchive)?;
    if parsed.hyphenated().to_string() != value {
        return Err(ExportError::InvalidArchive);
    }
    Ok(())
}

fn canonical_hash(value: &str) -> Result<(), ExportError> {
    if value.len() != 64
        || !value.bytes().all(|value| value.is_ascii_hexdigit())
        || value != value.to_ascii_lowercase()
    {
        return Err(ExportError::InvalidArchive);
    }
    Ok(())
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    false
}

fn validate_directory(path: &Path) -> Result<(), ExportError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(ExportError::UnsafePath);
    }
    Ok(())
}

fn validate_regular_file(path: &Path) -> Result<(), ExportError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || is_reparse(&metadata) {
        return Err(ExportError::UnsafePath);
    }
    Ok(())
}

fn ensure_child_directory(parent: &Path, name: &str) -> Result<PathBuf, ExportError> {
    let child = parent.join(name);
    if !child.exists() {
        fs::create_dir(&child)?;
    }
    validate_directory(&child)?;
    if fs::canonicalize(&child)? != child {
        return Err(ExportError::UnsafePath);
    }
    Ok(child)
}

fn selected_managed_root(selected: &Path) -> Result<PathBuf, ExportError> {
    validate_directory(selected)?;
    let selected = fs::canonicalize(selected)?;
    validate_directory(&selected)?;
    let managed = ensure_child_directory(&selected, "Recall")?;
    ensure_child_directory(&managed, "Memories")?;
    Ok(managed)
}

fn checked_root(root: &Path) -> Result<PathBuf, ExportError> {
    validate_directory(root)?;
    let canonical = fs::canonicalize(root)?;
    if canonical != root {
        return Err(ExportError::UnsafePath);
    }
    ensure_child_directory(&canonical, "Memories")?;
    Ok(canonical)
}

fn file_hash(path: &Path) -> Result<Option<String>, ExportError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || is_reparse(&metadata) || metadata.len() > MAX_MARKDOWN_BYTES {
        return Err(ExportError::UnsafePath);
    }
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(Some(hex::encode(digest.finalize())))
}

fn atomic_replace(source: &Path, destination: &Path) -> Result<(), ExportError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)?;
        Ok(())
    }
}

fn atomic_publish_new(source: &Path, destination: &Path) -> Result<(), ExportError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // Hard-link publication is atomic and cannot replace a file created by a race.
        fs::hard_link(source, destination)?;
        fs::remove_file(source)?;
        Ok(())
    }
}

fn atomic_write(path: &Path, bytes: &[u8], replace: bool) -> Result<(), ExportError> {
    let parent = path.parent().ok_or(ExportError::UnsafePath)?;
    validate_directory(parent)?;
    let parent = fs::canonicalize(parent)?;
    let file_name = path.file_name().ok_or(ExportError::UnsafePath)?;
    let path = parent.join(file_name);
    if fs::symlink_metadata(&path).is_ok() {
        if !replace {
            return Err(ExportError::DestinationExists);
        }
        validate_regular_file(&path)?;
    }
    let temp = parent.join(format!(".recall-atomic-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if fs::symlink_metadata(&path).is_ok() {
            if !replace {
                return Err(ExportError::DestinationExists);
            }
            validate_regular_file(&path)?;
            atomic_replace(&temp, &path)?;
        } else {
            atomic_publish_new(&temp, &path)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, ExportError> {
    validate_regular_file(path)?;
    if fs::metadata(path)?.len() > limit {
        return Err(ExportError::UnsafePath);
    }
    Ok(fs::read(path)?)
}

fn load_manifest(root: &Path, workspace_id: &str) -> Result<LocalManifest, ExportError> {
    let path = root.join(MANIFEST_NAME);
    if !path.exists() {
        return Ok(LocalManifest {
            format: "recall.markdown-export.v1".into(),
            workspace_id: workspace_id.into(),
            files: BTreeMap::new(),
        });
    }
    let manifest: LocalManifest =
        serde_json::from_slice(&read_bounded(&path, MAX_MANIFEST_BYTES)?)?;
    if manifest.format != "recall.markdown-export.v1" || manifest.workspace_id != workspace_id {
        return Err(ExportError::WorkspaceMismatch);
    }
    canonical_uuid(&manifest.workspace_id)?;
    if manifest.files.len() > MAX_FILES {
        return Err(ExportError::InvalidArchive);
    }
    for (record_id, entry) in &manifest.files {
        canonical_uuid(record_id)?;
        canonical_hash(&entry.sha256)?;
        if entry.revision < 1 {
            return Err(ExportError::InvalidArchive);
        }
    }
    Ok(manifest)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), ExportError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    let replace = fs::symlink_metadata(path).is_ok();
    atomic_write(path, &bytes, replace)
}

fn recover_journal(root: &Path, manifest: &mut LocalManifest) -> Result<(), ExportError> {
    let path = root.join(JOURNAL_NAME);
    if !path.exists() {
        return Ok(());
    }
    let journal: ExportJournal = serde_json::from_slice(&read_bounded(&path, MAX_MANIFEST_BYTES)?)?;
    if journal.format != "recall.markdown-export-journal.v1"
        || journal.workspace_id != manifest.workspace_id
        || journal.operations.len() > MAX_FILES
    {
        return Err(ExportError::RecoveryConflict);
    }
    let memories = checked_root(root)?.join("Memories");
    let mut seen = BTreeSet::new();
    for operation in &journal.operations {
        canonical_uuid(&operation.record_id).map_err(|_| ExportError::RecoveryConflict)?;
        if !seen.insert(operation.record_id.clone())
            || operation
                .before_sha256
                .as_deref()
                .is_some_and(|value| canonical_hash(value).is_err())
            || operation
                .after
                .as_ref()
                .is_some_and(|after| after.revision < 1 || canonical_hash(&after.sha256).is_err())
        {
            return Err(ExportError::RecoveryConflict);
        }
        let current = file_hash(&memories.join(format!("{}.md", operation.record_id)))?;
        match &operation.after {
            Some(after) if current.as_deref() == Some(after.sha256.as_str()) => {
                manifest
                    .files
                    .insert(operation.record_id.clone(), after.clone());
            }
            None if current.is_none() => {
                manifest.files.remove(&operation.record_id);
            }
            _ if current == operation.before_sha256 => {}
            _ => return Err(ExportError::RecoveryConflict),
        }
    }
    write_json(&root.join(MANIFEST_NAME), manifest)?;
    validate_regular_file(&path)?;
    fs::remove_file(path)?;
    Ok(())
}

fn valid_archive_name(name: &str) -> bool {
    if name.is_empty() || name.contains('\\') || name.starts_with('/') {
        return false;
    }
    let path = Path::new(name);
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn read_archive_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, ExportError> {
    let entry = archive.by_name(name)?;
    if entry.is_dir() || entry.size() > limit {
        return Err(ExportError::ArchiveTooLarge);
    }
    let declared_size = entry.size();
    let mut bytes = Vec::with_capacity(declared_size as usize);
    entry.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(ExportError::ArchiveTooLarge);
    }
    if bytes.len() as u64 != declared_size {
        return Err(ExportError::InvalidArchive);
    }
    Ok(bytes)
}

fn validate_hash(bytes: &[u8], expected_sha256: &str) -> Result<String, ExportError> {
    canonical_hash(expected_sha256)?;
    if bytes.is_empty() || bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(ExportError::ArchiveTooLarge);
    }
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != expected_sha256 {
        return Err(ExportError::HashMismatch);
    }
    Ok(actual)
}

fn projection_from_archive(bytes: &[u8], expected_sha256: &str) -> Result<Projection, ExportError> {
    validate_hash(bytes, expected_sha256)?;
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    if archive.len() > MAX_FILES * 3 + 2 {
        return Err(ExportError::ArchiveTooLarge);
    }
    let mut names = BTreeSet::new();
    let mut uncompressed = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name().to_string();
        if entry.is_dir() || !valid_archive_name(&name) || !names.insert(name) {
            return Err(ExportError::InvalidArchive);
        }
        uncompressed = uncompressed
            .checked_add(entry.size())
            .ok_or(ExportError::ArchiveTooLarge)?;
        if uncompressed > MAX_UNCOMPRESSED_BYTES {
            return Err(ExportError::ArchiveTooLarge);
        }
    }
    if !names.contains("manifest.json") || !names.contains("recall.json") {
        return Err(ExportError::InvalidArchive);
    }
    let manifest_bytes = read_archive_entry(&mut archive, "manifest.json", MAX_MANIFEST_BYTES)?;
    let portable_manifest: PortableManifest = serde_json::from_slice(&manifest_bytes)?;
    if portable_manifest.format != "recall.export.manifest.v1" {
        return Err(ExportError::InvalidArchive);
    }
    canonical_hash(&portable_manifest.canonical_sha256)?;
    let canonical = read_archive_entry(&mut archive, "recall.json", MAX_CANONICAL_BYTES)?;
    if hex::encode(Sha256::digest(&canonical)) != portable_manifest.canonical_sha256 {
        return Err(ExportError::HashMismatch);
    }
    let document: PortableDocument = serde_json::from_slice(&canonical)?;
    if document.format != "recall.export.v1" {
        return Err(ExportError::InvalidArchive);
    }
    canonical_uuid(&document.workspace_id)?;
    if document.memories.len() > MAX_FILES {
        return Err(ExportError::ArchiveTooLarge);
    }
    let mut revisions = BTreeMap::new();
    for memory in document.memories {
        canonical_uuid(&memory.id)?;
        if memory.current_revision < 1
            || revisions
                .insert(memory.id, memory.current_revision)
                .is_some()
        {
            return Err(ExportError::InvalidArchive);
        }
    }
    if portable_manifest.originals.len() > MAX_FILES {
        return Err(ExportError::ArchiveTooLarge);
    }
    let mut original_paths = BTreeSet::new();
    for original in portable_manifest.originals {
        canonical_uuid(&original.source_id)?;
        canonical_hash(&original.sha256)?;
        if original.path != format!("originals/{}", original.source_id)
            || original.byte_size > MAX_ORIGINAL_BYTES
            || !original_paths.insert(original.path.clone())
        {
            return Err(ExportError::InvalidArchive);
        }
        let original_bytes = read_archive_entry(&mut archive, &original.path, MAX_ORIGINAL_BYTES)?;
        if original_bytes.len() as u64 != original.byte_size
            || hex::encode(Sha256::digest(&original_bytes)) != original.sha256
        {
            return Err(ExportError::HashMismatch);
        }
    }
    let mut files = BTreeMap::new();
    let mut markdown_total = 0_u64;
    for name in names.iter().filter(|name| name.starts_with("memories/")) {
        let record_id = name
            .strip_prefix("memories/")
            .and_then(|value| value.strip_suffix(".md"))
            .ok_or(ExportError::InvalidArchive)?;
        canonical_uuid(record_id)?;
        let revision = *revisions
            .get(record_id)
            .ok_or(ExportError::InvalidArchive)?;
        let markdown = read_archive_entry(&mut archive, name, MAX_MARKDOWN_BYTES)?;
        markdown_total += markdown.len() as u64;
        if markdown_total > MAX_MARKDOWN_TOTAL_BYTES || std::str::from_utf8(&markdown).is_err() {
            return Err(ExportError::ArchiveTooLarge);
        }
        files.insert(
            record_id.into(),
            ProjectedFile {
                revision,
                sha256: hex::encode(Sha256::digest(&markdown)),
                bytes: markdown,
            },
        );
    }
    if files.len() != revisions.len() {
        return Err(ExportError::InvalidArchive);
    }
    for name in names {
        if name == "manifest.json" || name == "recall.json" || name.starts_with("memories/") {
            continue;
        }
        if !original_paths.contains(&name) {
            return Err(ExportError::InvalidArchive);
        }
    }
    Ok(Projection {
        workspace_id: document.workspace_id,
        files,
    })
}

fn apply_projection(
    root: &Path,
    projection: Projection,
) -> Result<ManagedExportResult, ExportError> {
    let root = checked_root(root)?;
    let memories = root.join("Memories");
    let mut manifest = load_manifest(&root, &projection.workspace_id)?;
    recover_journal(&root, &mut manifest)?;

    let mut conflicts = Vec::new();
    let mut operations = Vec::new();
    for (record_id, desired) in &projection.files {
        let path = memories.join(format!("{record_id}.md"));
        let current = match file_hash(&path) {
            Ok(value) => value,
            Err(_) => {
                conflicts.push(ExportConflict {
                    record_id: record_id.clone(),
                    reason: "unsafe_or_oversized_local_file".into(),
                });
                continue;
            }
        };
        match manifest.files.get(record_id) {
            Some(previous)
                if current.as_deref() != Some(previous.sha256.as_str()) && current.is_some() =>
            {
                conflicts.push(ExportConflict {
                    record_id: record_id.clone(),
                    reason: "locally_modified".into(),
                });
            }
            None if current.is_some() => conflicts.push(ExportConflict {
                record_id: record_id.clone(),
                reason: "unmanaged_path_collision".into(),
            }),
            Some(previous)
                if current.as_deref() == Some(desired.sha256.as_str())
                    && previous.revision == desired.revision => {}
            _ => operations.push(JournalOperation {
                record_id: record_id.clone(),
                before_sha256: current,
                after: Some(LocalManifestFile {
                    revision: desired.revision,
                    sha256: desired.sha256.clone(),
                }),
            }),
        }
    }
    for (record_id, previous) in &manifest.files {
        if projection.files.contains_key(record_id) {
            continue;
        }
        let path = memories.join(format!("{record_id}.md"));
        match file_hash(&path) {
            Ok(current)
                if current.is_none() || current.as_deref() == Some(previous.sha256.as_str()) =>
            {
                operations.push(JournalOperation {
                    record_id: record_id.clone(),
                    before_sha256: current,
                    after: None,
                });
            }
            _ => conflicts.push(ExportConflict {
                record_id: record_id.clone(),
                reason: "locally_modified_deleted_record".into(),
            }),
        }
    }
    if !conflicts.is_empty() {
        return Ok(ManagedExportResult {
            root: root.to_string_lossy().into(),
            written: Vec::new(),
            removed: Vec::new(),
            conflicts,
        });
    }

    let journal = ExportJournal {
        format: "recall.markdown-export-journal.v1".into(),
        workspace_id: projection.workspace_id.clone(),
        operations: operations.clone(),
    };
    write_json(&root.join(JOURNAL_NAME), &journal)?;
    let mut written = Vec::new();
    let mut removed = Vec::new();
    for operation in &operations {
        let path = memories.join(format!("{}.md", operation.record_id));
        if operation.after.is_some() {
            let desired = projection
                .files
                .get(&operation.record_id)
                .ok_or(ExportError::InvalidArchive)?;
            atomic_write(&path, &desired.bytes, operation.before_sha256.is_some())?;
            written.push(operation.record_id.clone());
        } else {
            if operation.before_sha256.is_some() {
                validate_regular_file(&path)?;
                fs::remove_file(&path)?;
            }
            removed.push(operation.record_id.clone());
        }
    }
    manifest.files = projection
        .files
        .iter()
        .map(|(record_id, file)| {
            (
                record_id.clone(),
                LocalManifestFile {
                    revision: file.revision,
                    sha256: file.sha256.clone(),
                },
            )
        })
        .collect();
    write_json(&root.join(MANIFEST_NAME), &manifest)?;
    let journal_path = root.join(JOURNAL_NAME);
    validate_regular_file(&journal_path)?;
    fs::remove_file(journal_path)?;
    Ok(ManagedExportResult {
        root: root.to_string_lossy().into(),
        written,
        removed,
        conflicts: Vec::new(),
    })
}

impl ManagedExportState {
    pub fn select_markdown_root(&self) -> Result<Option<String>, ExportError> {
        let Some(selected) = rfd::FileDialog::new()
            .set_title("Choose a folder for Recall Markdown")
            .pick_folder()
        else {
            return Ok(None);
        };
        let root = selected_managed_root(&selected)?;
        *self.root.lock().unwrap() = Some(root.clone());
        Ok(Some(root.to_string_lossy().into()))
    }

    pub fn apply_markdown_archive(
        &self,
        bytes: &[u8],
        expected_sha256: &str,
    ) -> Result<ManagedExportResult, ExportError> {
        let root = self
            .root
            .lock()
            .unwrap()
            .clone()
            .ok_or(ExportError::RootNotSelected)?;
        let projection = projection_from_archive(bytes, expected_sha256)?;
        apply_projection(&root, projection)
    }

    pub fn save_archive(
        &self,
        bytes: &[u8],
        expected_sha256: &str,
    ) -> Result<Option<ArchiveSaveResult>, ExportError> {
        // Parse and validate the bounded Recall inventory before publishing any file.
        projection_from_archive(bytes, expected_sha256)?;
        let sha256 = expected_sha256.to_string();
        let Some(mut destination) = rfd::FileDialog::new()
            .set_title("Save Recall export")
            .add_filter("ZIP archive", &["zip"])
            .set_file_name("recall-export.zip")
            .save_file()
        else {
            return Ok(None);
        };
        if destination.extension().is_none() {
            destination.set_extension("zip");
        }
        if !destination
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
        {
            return Err(ExportError::UnsafePath);
        }
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(ExportError::DestinationExists);
        }
        atomic_write(&destination, bytes, false)?;
        Ok(Some(ArchiveSaveResult {
            path: destination.to_string_lossy().into(),
            sha256,
            byte_size: bytes.len() as u64,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const WORKSPACE_ID: &str = "11111111-1111-4111-8111-111111111111";
    const MEMORY_ID: &str = "22222222-2222-4222-8222-222222222222";

    fn root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let selected = std::env::temp_dir().join(format!(
            "recall-export-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&selected).unwrap();
        selected_managed_root(&selected).unwrap()
    }

    fn projection(content: &str, revision: i64) -> Projection {
        let bytes = content.as_bytes().to_vec();
        Projection {
            workspace_id: WORKSPACE_ID.into(),
            files: BTreeMap::from([(
                MEMORY_ID.into(),
                ProjectedFile {
                    revision,
                    sha256: hex::encode(Sha256::digest(&bytes)),
                    bytes,
                },
            )]),
        }
    }

    fn portable_archive(markdown_name: &str) -> (Vec<u8>, String) {
        let canonical = serde_json::to_vec(&serde_json::json!({
            "format": "recall.export.v1",
            "workspace_id": WORKSPACE_ID,
            "memories": [{"id": MEMORY_ID, "current_revision": 2}]
        }))
        .unwrap();
        let manifest = serde_json::to_vec(&serde_json::json!({
            "format": "recall.export.manifest.v1",
            "canonical_sha256": hex::encode(Sha256::digest(&canonical)),
            "originals": []
        }))
        .unwrap();
        let cursor = Cursor::new(Vec::new());
        let mut archive = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).unwrap();
        archive.write_all(&manifest).unwrap();
        archive.start_file("recall.json", options).unwrap();
        archive.write_all(&canonical).unwrap();
        archive.start_file(markdown_name, options).unwrap();
        archive.write_all(b"# Portable\n").unwrap();
        let bytes = archive.finish().unwrap().into_inner();
        let digest = hex::encode(Sha256::digest(&bytes));
        (bytes, digest)
    }

    #[test]
    fn archive_projection_accepts_only_fixed_uuid_markdown_paths() {
        let valid_name = format!("memories/{MEMORY_ID}.md");
        let (bytes, digest) = portable_archive(&valid_name);
        let parsed = projection_from_archive(&bytes, &digest).unwrap();
        assert_eq!(parsed.workspace_id, WORKSPACE_ID);
        assert_eq!(parsed.files[MEMORY_ID].revision, 2);

        let (unsafe_bytes, unsafe_digest) = portable_archive("memories/../escape.md");
        assert!(matches!(
            projection_from_archive(&unsafe_bytes, &unsafe_digest),
            Err(ExportError::InvalidArchive)
        ));
    }

    #[test]
    fn writes_only_uuid_markdown_and_deterministic_manifest() {
        let root = root("write");
        let selected = root.parent().unwrap().to_path_buf();
        let result = apply_projection(&root, projection("# One\n", 1)).unwrap();
        assert_eq!(result.written, vec![MEMORY_ID]);
        assert!(root
            .join("Memories")
            .join(format!("{MEMORY_ID}.md"))
            .exists());
        let first = fs::read(root.join(MANIFEST_NAME)).unwrap();
        apply_projection(&root, projection("# One\n", 1)).unwrap();
        assert_eq!(fs::read(root.join(MANIFEST_NAME)).unwrap(), first);
        fs::remove_dir_all(selected).unwrap();
    }

    #[test]
    fn local_edit_is_a_conflict_and_is_never_overwritten() {
        let root = root("conflict");
        let selected = root.parent().unwrap().to_path_buf();
        apply_projection(&root, projection("# One\n", 1)).unwrap();
        let note = root.join("Memories").join(format!("{MEMORY_ID}.md"));
        fs::write(&note, b"my edit\n").unwrap();
        let result = apply_projection(&root, projection("# Two\n", 2)).unwrap();
        assert_eq!(result.conflicts[0].reason, "locally_modified");
        assert_eq!(fs::read(note).unwrap(), b"my edit\n");
        fs::remove_dir_all(selected).unwrap();
    }

    #[test]
    fn unmanaged_uuid_collision_is_preserved() {
        let root = root("unmanaged");
        let selected = root.parent().unwrap().to_path_buf();
        let note = root.join("Memories").join(format!("{MEMORY_ID}.md"));
        fs::write(&note, b"personal\n").unwrap();
        let result = apply_projection(&root, projection("# Generated\n", 1)).unwrap();
        assert_eq!(result.conflicts[0].reason, "unmanaged_path_collision");
        assert_eq!(fs::read(note).unwrap(), b"personal\n");
        fs::remove_dir_all(selected).unwrap();
    }

    #[test]
    fn deletion_removes_unchanged_managed_file_but_preserves_local_edit() {
        let root = root("delete");
        let selected = root.parent().unwrap().to_path_buf();
        apply_projection(&root, projection("# One\n", 1)).unwrap();
        let empty = Projection {
            workspace_id: WORKSPACE_ID.into(),
            files: BTreeMap::new(),
        };
        let result = apply_projection(&root, empty.clone()).unwrap();
        assert_eq!(result.removed, vec![MEMORY_ID]);
        apply_projection(&root, projection("# One\n", 1)).unwrap();
        let note = root.join("Memories").join(format!("{MEMORY_ID}.md"));
        fs::write(&note, b"my edit\n").unwrap();
        let result = apply_projection(&root, empty).unwrap();
        assert_eq!(
            result.conflicts[0].reason,
            "locally_modified_deleted_record"
        );
        assert_eq!(fs::read(note).unwrap(), b"my edit\n");
        fs::remove_dir_all(selected).unwrap();
    }

    #[test]
    fn interrupted_write_reconciles_from_journal_without_overwriting() {
        let root = root("journal");
        let selected = root.parent().unwrap().to_path_buf();
        apply_projection(&root, projection("# One\n", 1)).unwrap();
        let note = root.join("Memories").join(format!("{MEMORY_ID}.md"));
        let before = file_hash(&note).unwrap();
        let after_bytes = b"# Two\n";
        let after = LocalManifestFile {
            revision: 2,
            sha256: hex::encode(Sha256::digest(after_bytes)),
        };
        write_json(
            &root.join(JOURNAL_NAME),
            &ExportJournal {
                format: "recall.markdown-export-journal.v1".into(),
                workspace_id: WORKSPACE_ID.into(),
                operations: vec![JournalOperation {
                    record_id: MEMORY_ID.into(),
                    before_sha256: before,
                    after: Some(after),
                }],
            },
        )
        .unwrap();
        atomic_write(&note, after_bytes, true).unwrap();
        let result = apply_projection(&root, projection("# Two\n", 2)).unwrap();
        assert!(result.conflicts.is_empty());
        assert!(!root.join(JOURNAL_NAME).exists());
        assert_eq!(fs::read(note).unwrap(), after_bytes);
        fs::remove_dir_all(selected).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_memories_directory_is_rejected_without_touching_target() {
        use std::os::unix::fs::symlink;
        let root = root("symlink");
        let selected = root.parent().unwrap().to_path_buf();
        let outside = std::env::temp_dir().join(format!("recall-outside-{}", Uuid::new_v4()));
        fs::create_dir(&outside).unwrap();
        fs::remove_dir(root.join("Memories")).unwrap();
        symlink(&outside, root.join("Memories")).unwrap();
        assert!(matches!(
            apply_projection(&root, projection("# One\n", 1)),
            Err(ExportError::UnsafePath)
        ));
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        fs::remove_dir_all(selected).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
