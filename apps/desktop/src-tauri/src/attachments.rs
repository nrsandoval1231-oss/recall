//! User-selected attachments. Native-assigned paths and immutable receipts; no model/tool paths.
use crate::local_vault::{self, Vault, VaultMemory};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    format: String,
    vault_id: String,
    memory_id: String,
    operation_id: String,
    expected_revision: u64,
    note: String,
    file_name: String,
    name: String,
    mime_type: String,
    sha256: String,
}
#[derive(Serialize)]
pub struct Attachment {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub sha256: String,
    pub name: String,
}
fn id(value: &str) -> Result<(), String> {
    if Uuid::parse_str(value)
        .map_err(|_| "Invalid attachment identity")?
        .to_string()
        != value
    {
        return Err("Invalid attachment identity".into());
    }
    Ok(())
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn receipt_path(vault: &Vault, operation: &str) -> Result<PathBuf, String> {
    id(operation)?;
    let path = vault
        .root()
        .join(format!("Recall/_meta/attachments/{operation}.json"));
    local_vault::safe(&path)?;
    Ok(path)
}
fn mime(bytes: &[u8], extension: &str) -> Result<&'static str, String> {
    match extension {
        "png" | "jpg" | "jpeg" | "webp" => local_vault::image_type(bytes),
        "pdf" if bytes.starts_with(b"%PDF-") => Ok("application/pdf"),
        "md" | "txt" => {
            std::str::from_utf8(bytes).map_err(|_| "Choose a UTF-8 text attachment")?;
            if bytes.contains(&0) {
                return Err("Text attachment contains invalid bytes".into());
            }
            Ok("text/plain")
        }
        _ => Err("Supported attachments: PNG, JPEG, WebP, PDF, Markdown and text".into()),
    }
}
fn load(vault: &Vault, memory: &str, revision: u64, operation: &str) -> Result<Receipt, String> {
    let record: Receipt = serde_json::from_slice(&local_vault::read(
        &receipt_path(vault, operation)?,
        2 * 1024 * 1024,
    )?)
    .map_err(|_| "Invalid attachment receipt")?;
    if record.format != "recall-attachment-v1"
        || record.vault_id != vault.identity()
        || record.memory_id != memory
        || record.operation_id != operation
        || record.expected_revision != revision
        || !record.file_name.starts_with(&format!("{operation}."))
        || record.file_name.contains(['/', '\\'])
        || record.file_name.split('.').count() != 2
        || record.name.len() > 255
        || record.name.chars().any(char::is_control)
        || !record
            .note
            .contains(&format!("../Sources/{}", record.file_name))
    {
        return Err("Attachment receipt does not match this memory".into());
    }
    let bytes = local_vault::read(
        &vault.root().join("Recall/Sources").join(&record.file_name),
        MAX_BYTES,
    )?;
    if digest(&bytes) != record.sha256
        || mime(
            &bytes,
            record
                .file_name
                .rsplit('.')
                .next()
                .ok_or("Missing attachment type")?,
        )? != record.mime_type
    {
        return Err("Attachment integrity check failed".into());
    }
    Ok(record)
}
pub fn resume(
    vault: &Vault,
    memory: &str,
    revision: u64,
    operation: &str,
) -> Result<Option<VaultMemory>, String> {
    if !receipt_path(vault, operation)?.exists() {
        return Ok(None);
    }
    let record = load(vault, memory, revision, operation)?;
    vault
        .correct(memory, revision, operation, &record.note)
        .map(Some)
}
pub fn add_from_path(
    vault: &Vault,
    memory: &str,
    revision: u64,
    operation: &str,
    path: &Path,
) -> Result<VaultMemory, String> {
    id(memory)?;
    id(operation)?;
    if let Some(saved) = resume(vault, memory, revision, operation)? {
        return Ok(saved);
    }
    let current = vault
        .list_with_deleted("", false)?
        .into_iter()
        .find(|m| {
            m.id == memory && m.state == "active" && m.conflict.is_none() && m.revision == revision
        })
        .ok_or("Memory changed; save/review the current note before attaching")?;
    let bytes = local_vault::read(path, MAX_BYTES)?;
    let extension = path
        .extension()
        .and_then(|x| x.to_str())
        .ok_or("Missing attachment type")?
        .to_ascii_lowercase();
    let mime_type = mime(&bytes, &extension)?.to_string();
    let name = path
        .file_name()
        .and_then(|x| x.to_str())
        .ok_or("Invalid attachment name")?;
    if name.len() > 255 || name.chars().any(char::is_control) {
        return Err("Invalid attachment name".into());
    }
    let file_name = format!("{operation}.{extension}");
    let label = name
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]");
    let note = format!("{}\n\n[{label}](../Sources/{file_name})", current.note);
    let record = Receipt {
        format: "recall-attachment-v1".into(),
        vault_id: vault.identity().into(),
        memory_id: memory.into(),
        operation_id: operation.into(),
        expected_revision: revision,
        note,
        file_name: file_name.clone(),
        name: name.into(),
        mime_type,
        sha256: digest(&bytes),
    };
    let record_path = receipt_path(vault, operation)?;
    let directory = record_path.parent().ok_or("Attachment directory missing")?;
    local_vault::safe(directory)?;
    if !directory.exists() {
        fs::create_dir(directory).map_err(|e| e.to_string())?;
        local_vault::sync_dir(directory.parent().ok_or("Attachment parent unavailable")?)?;
    }
    local_vault::immutable(&vault.root().join("Recall/Sources").join(file_name), &bytes)?;
    local_vault::immutable(
        &record_path,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )?;
    vault.correct(memory, revision, operation, &record.note)
}
pub fn inspect(vault: &Vault, memory: &str, file_name: &str) -> Result<Attachment, String> {
    let operation = file_name.split('.').next().ok_or("Invalid attachment")?;
    id(operation)?;
    let current = vault
        .list_with_deleted("", false)?
        .into_iter()
        .find(|m| m.id == memory && m.state == "active" && m.conflict.is_none())
        .ok_or("Memory is not available for attachment access")?;
    let raw: Receipt = serde_json::from_slice(&local_vault::read(
        &receipt_path(vault, operation)?,
        2 * 1024 * 1024,
    )?)
    .map_err(|_| "Invalid attachment receipt")?;
    let record = load(vault, memory, raw.expected_revision, operation)?;
    if record.file_name != file_name {
        return Err("Attachment destination mismatch".into());
    }
    // Receipt ownership is native, not derived from a caller-supplied Markdown link.
    let _ = current;
    let bytes = local_vault::read(
        &vault.root().join("Recall/Sources").join(file_name),
        MAX_BYTES,
    )?;
    if digest(&bytes) != record.sha256 {
        return Err("Attachment changed during inspection".into());
    }
    Ok(Attachment {
        bytes,
        mime_type: record.mime_type,
        sha256: record.sha256,
        name: record.name,
    })
}
pub fn validate_all(vault: &Vault) -> Result<(), String> {
    let directory = vault.root().join("Recall/_meta/attachments");
    local_vault::safe(&directory)?;
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let record: Receipt =
            serde_json::from_slice(&local_vault::read(&entry.path(), 2 * 1024 * 1024)?)
                .map_err(|_| "Invalid attachment receipt")?;
        if entry.path() != receipt_path(vault, &record.operation_id)? {
            return Err("Unexpected attachment receipt filename".into());
        }
        load(
            vault,
            &record.memory_id,
            record.expected_revision,
            &record.operation_id,
        )?;
    }
    Ok(())
}
pub fn save_copy(path: &Path, bytes: &[u8]) -> Result<(), String> {
    local_vault::safe(path)?;
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Choose a new filename; existing files are preserved: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    local_vault::sync_dir(path.parent().ok_or("Attachment destination missing")?)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attaching_is_idempotent_and_sources_survive_correction_and_restart() {
        let root =
            std::env::temp_dir().join(format!("recall-synthetic-attachment-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Synthetic authored original")
            .unwrap();
        let file = root.join("details.txt");
        fs::write(&file, b"Synthetic attachment; amount uncertain?").unwrap();
        let operation = Uuid::new_v4().to_string();
        let saved = add_from_path(&vault, &memory.id, 1, &operation, &file).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(
            resume(&vault, &memory.id, 1, &operation)
                .unwrap()
                .unwrap()
                .revision,
            2
        );
        let reopened = Vault::open(&root).unwrap();
        let attachment = inspect(&reopened, &memory.id, &format!("{operation}.txt")).unwrap();
        assert_eq!(attachment.bytes, b"Synthetic attachment; amount uncertain?");
        assert_eq!(
            reopened.source(&memory.id).unwrap().bytes,
            b"Synthetic authored original"
        );
        let other = vault
            .capture_note(&Uuid::new_v4().to_string(), "Another source")
            .unwrap();
        assert!(inspect(&reopened, &other.id, &format!("{operation}.txt")).is_err());
        fs::write(
            root.join(format!("Recall/Sources/{operation}.txt")),
            "Tampered",
        )
        .unwrap();
        assert!(inspect(&reopened, &memory.id, &format!("{operation}.txt")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pending_attachment_receipt_resumes_after_restart_before_note_publication() {
        let root =
            std::env::temp_dir().join(format!("recall-attachment-boundary-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Original evidence")
            .unwrap();
        let operation = Uuid::new_v4().to_string();
        let file_name = format!("{operation}.txt");
        let bytes = b"Pending document";
        let record = Receipt {
            format: "recall-attachment-v1".into(),
            vault_id: vault.identity().into(),
            memory_id: memory.id.clone(),
            operation_id: operation.clone(),
            expected_revision: 1,
            note: format!("{}\n\n[Document](../Sources/{file_name})", memory.note),
            file_name: file_name.clone(),
            name: "Document.txt".into(),
            mime_type: "text/plain".into(),
            sha256: digest(bytes),
        };
        fs::create_dir(root.join("Recall/_meta/attachments")).unwrap();
        local_vault::immutable(&root.join("Recall/Sources").join(&file_name), bytes).unwrap();
        local_vault::immutable(
            &receipt_path(&vault, &operation).unwrap(),
            &serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        drop(vault);
        let reopened = Vault::open(&root).unwrap();
        let saved = resume(&reopened, &memory.id, 1, &operation)
            .unwrap()
            .unwrap();
        assert_eq!(saved.revision, 2);
        assert!(saved.note.contains(&file_name));
        assert_eq!(
            reopened.source(&memory.id).unwrap().bytes,
            b"Original evidence"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saving_copies_never_overwrites_existing_files() {
        let root = std::env::temp_dir().join(format!("recall-copy-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("copy.txt");
        save_copy(&path, b"original copy").unwrap();
        assert!(save_copy(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original copy");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unsupported_or_executable_attachments_are_rejected() {
        assert!(mime(b"<script>evil</script>", "html").is_err());
        assert!(mime(b"<script>evil</script>", "png").is_err());
        assert!(mime(b"bad PDF", "pdf").is_err());
    }
}
