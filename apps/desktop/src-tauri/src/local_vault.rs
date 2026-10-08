//! Vault-authoritative annotations, separate readings, and immutable evidence.
//! Transport is outside this locked filesystem boundary.
//! Journals and revision records are retained; Markdown publication backups are
//! retained too, so an editor holding the old inode cannot lose its draft.
use crate::reading::Reading;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const FORMAT: &str = "recall-local-vault-v1";
const FORMAT_V2: &str = "recall-local-vault-v2";
const FORMAT_V3: &str = "recall-local-vault-v3";
const MAX_PHOTO: u64 = 25 * 1024 * 1024;
const MAX_NOTE: usize = 256 * 1024;
const MAX_JSON: u64 = 2 * 1024 * 1024;
const MAX_RECORDS: usize = 10_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultStatus {
    pub root: Option<String>,
    pub vault_id: Option<String>,
    #[serde(default)]
    pub vault_identity: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultMemory {
    pub id: String,
    pub revision: u64,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<Reading>,
    pub source_sha256: String,
    pub source_name: String,
    pub captured_at: String,
    pub updated_at: String,
    pub conflict: Option<String>,
    pub state: String,
    pub note_path: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct VaultSource {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct VaultRevision {
    pub revision: u64,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<Reading>,
    pub recorded_at: String,
    pub origin: String,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    vault_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Event {
    format: String,
    vault_id: String,
    operation_id: String,
    kind: String,
    expected_revision: u64,
    payload_sha256: String,
    parent_sha256: Option<String>,
    origin: String,
    #[serde(with = "event_memory")]
    memory: VaultMemory,
    #[serde(
        default,
        deserialize_with = "present_string",
        skip_serializing_if = "Option::is_none"
    )]
    note_path: Option<String>,
    #[serde(
        default,
        deserialize_with = "present_string",
        skip_serializing_if = "Option::is_none"
    )]
    expected_state: Option<String>,
    previous_markdown: Option<String>,
    markdown: String,
}
// Preserve the exact v1 persisted shape; response-only lifecycle fields never
// enter history. Optional v2 event fields are forbidden on v1 by event_valid.
mod event_memory {
    use super::*;
    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Stored {
        id: String,
        revision: u64,
        note: String,
        #[serde(
            default,
            deserialize_with = "present_reading",
            skip_serializing_if = "Option::is_none"
        )]
        reading: Option<Reading>,
        source_sha256: String,
        source_name: String,
        captured_at: String,
        updated_at: String,
        conflict: Option<String>,
    }
    fn present_reading<'de, D: serde::Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<Option<Reading>, D::Error> {
        Reading::deserialize(d).map(Some)
    }
    pub fn serialize<S: serde::Serializer>(
        m: &VaultMemory,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        Stored {
            id: m.id.clone(),
            revision: m.revision,
            note: m.note.clone(),
            reading: m.reading.clone(),
            source_sha256: m.source_sha256.clone(),
            source_name: m.source_name.clone(),
            captured_at: m.captured_at.clone(),
            updated_at: m.updated_at.clone(),
            conflict: m.conflict.clone(),
        }
        .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<VaultMemory, D::Error> {
        let m = Stored::deserialize(deserializer)?;
        Ok(VaultMemory {
            id: m.id,
            revision: m.revision,
            note: m.note,
            reading: m.reading,
            source_sha256: m.source_sha256,
            source_name: m.source_name,
            captured_at: m.captured_at,
            updated_at: m.updated_at,
            conflict: m.conflict,
            state: "active".into(),
            note_path: None,
        })
    }
}
fn basename(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 255
        || value.contains(['/', '\\', '\0'])
        || !value.ends_with(".md")
        || Path::new(value).components().count() != 1
    {
        return Err("Unsafe note basename".into());
    }
    Ok(())
}
#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
    pub id: String,
}

// Compiled out entirely outside unit tests; no production fault controls.
macro_rules! boundary {
    ($point:expr, $path:expr) => {{
        #[cfg(test)]
        tests::boundary($point, $path)?;
    }};
}
fn present_string<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
fn fail(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn id(value: &str) -> Result<()> {
    if Uuid::parse_str(value).map_err(fail)?.to_string() != value {
        return Err("Invalid stable ID".into());
    }
    Ok(())
}
fn note_valid(note: &str) -> Result<()> {
    if note.len() > MAX_NOTE || note.contains('\0') {
        return Err("Note is too large or contains NUL".into());
    }
    Ok(())
}
fn timestamp() -> String {
    // ISO-8601 UTC, using civil-from-days (Gregorian); clocks never choose winners.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let z = (secs / 86400) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    y += i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600 % 24,
        secs / 60 % 60,
        secs % 60
    )
}
fn reparse(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
/// Refuse links in every component, including the selected root's ancestors.
fn safe(path: &Path) -> Result<()> {
    let mut checked = PathBuf::new();
    for c in path.components() {
        if matches!(c, Component::ParentDir | Component::CurDir) {
            return Err("Unsafe path".into());
        }
        checked.push(c);
        match fs::symlink_metadata(&checked) {
            Ok(m) if reparse(&m) => return Err("Symlink or reparse point is not allowed".into()),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(fail(e)),
        }
    }
    Ok(())
}
fn read(path: &Path, max: u64) -> Result<Vec<u8>> {
    safe(path)?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(0x20000);
    }
    let f = opts.open(path).map_err(fail)?;
    let m = f.metadata().map_err(fail)?;
    if !m.is_file() || m.len() > max {
        return Err("Invalid file or size limit exceeded".into());
    }
    let mut bytes = Vec::new();
    f.take(max + 1).read_to_end(&mut bytes).map_err(fail)?;
    if bytes.len() as u64 > max {
        return Err("File exceeds size limit".into());
    }
    Ok(bytes)
}
/// Inspect only the stable identity header of neighbors. Their size/content is
/// validated independently when reading that memory, never charged to this one.
fn identity_prefix(path: &Path, len: usize) -> Result<Vec<u8>> {
    safe(path)?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(0x20000);
    }
    let file = opts.open(path).map_err(fail)?;
    if !file.metadata().map_err(fail)?.is_file() {
        return Err("Invalid note file".into());
    }
    let mut bytes = Vec::with_capacity(len);
    file.take(len as u64)
        .read_to_end(&mut bytes)
        .map_err(fail)?;
    Ok(bytes)
}
fn sync_dir(path: &Path) -> Result<()> {
    safe(path)?;
    #[cfg(unix)]
    {
        File::open(path).map_err(fail)?.sync_all().map_err(fail)?;
    }
    // Windows publication uses write-through MoveFileEx; file data is flushed first.
    Ok(())
}
fn create(path: &Path, bytes: &[u8]) -> Result<()> {
    boundary!("create_before", path);
    safe(path)?;
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(fail)?;
    f.write_all(bytes).map_err(fail)?;
    boundary!("write_after", path);
    boundary!("sync_before", path);
    f.sync_all().map_err(fail)?;
    boundary!("sync_after", path);
    sync_dir(path.parent().ok_or("No parent")?)
}
fn immutable(path: &Path, bytes: &[u8]) -> Result<()> {
    if path.try_exists().map_err(fail)? {
        if read(path, bytes.len() as u64)? != bytes {
            return Err("Immutable file mismatch; recovery required".into());
        }
        Ok(())
    } else {
        atomic_new(path, bytes)
    }
}
fn rename(from: &Path, to: &Path) -> Result<()> {
    boundary!("rename_before", from);
    safe(from)?;
    safe(to)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Plain Unix rename replaces an intervening editor-created backup.
        // RENAME_NOREPLACE makes that precondition atomic with publication.
        use std::os::unix::ffi::OsStrExt;
        unsafe extern "C" {
            fn renameat2(
                old_dir: i32,
                old: *const std::ffi::c_char,
                new_dir: i32,
                new: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        let a = std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(fail)?;
        let b = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(fail)?;
        if unsafe { renameat2(-100, a.as_ptr(), -100, b.as_ptr(), 1) } != 0 {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(all(not(windows), not(target_os = "linux")))]
    return Err("Atomic no-replace rename is unsupported on this platform".into());
    boundary!("rename_after", to);
    sync_dir(from.parent().ok_or("No parent")?)?;
    sync_dir(to.parent().ok_or("No parent")?)
}
fn replace(from: &Path, to: &Path) -> Result<()> {
    safe(from)?;
    safe(to)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                a.as_ptr(),
                b.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(fail(std::io::Error::last_os_error()));
        }
    }
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(fail)?;
    sync_dir(to.parent().ok_or("No parent")?)
}
/// Stage + hard-link publishes an entire immutable file without replacing a destination.
fn atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("stage-{}", Uuid::new_v4()));
    create(&tmp, bytes)?;
    safe(path)?;
    boundary!("publish_before", path);
    fs::hard_link(&tmp, path).map_err(fail)?;
    boundary!("publish_after", path);
    sync_dir(path.parent().ok_or("No parent")?)?;
    boundary!("cleanup_before", path);
    fs::remove_file(&tmp).map_err(fail)?;
    boundary!("cleanup_after", path);
    sync_dir(path.parent().ok_or("No parent")?)
}
fn json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(fail)
}
fn decode<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T> {
    serde_json::from_slice(&read(path, MAX_JSON)?).map_err(fail)
}
fn entries(path: &Path) -> Result<Vec<PathBuf>> {
    safe(path)?;
    let mut out = Vec::new();
    for e in fs::read_dir(path).map_err(fail)? {
        out.push(e.map_err(fail)?.path());
        if out.len() > MAX_RECORDS {
            return Err("Vault exceeds record limit".into());
        }
    }
    out.sort();
    Ok(out)
}
fn image_type(bytes: &[u8]) -> Result<&'static str> {
    if bytes.len() as u64 > MAX_PHOTO {
        return Err("Photo exceeds 25 MiB limit".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9") {
        Ok("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("image/webp")
    } else {
        Err("Choose a PNG, JPEG or WebP photo with a valid signature".into())
    }
}
fn markdown(m: &VaultMemory) -> String {
    let base = format!("<!-- Recall memory {} | human annotation, not OCR -->\n[Original photo](../Sources/{}.{})\n\n",m.id,m.id,m.source_name.rsplit('.').next().unwrap_or("png"));
    let Some(reading) = &m.reading else {
        return format!("{base}{}", m.note);
    };
    fn literal(s: &str) -> String {
        s.lines().map(|line| format!("    {line}\n")).collect()
    }
    let machine = &reading.machine;
    let mut out = format!("{base}## Unreviewed machine reading\n\n{}\nProvider and model:\n\n{}\nOriginal SHA-256:\n\n{}\n", literal(machine.transcription()), literal(&format!("{} / {}",machine.result.provider,machine.result.model_id)),literal(&machine.request.binding.source_sha256));
    out.push_str("### Reading uncertainty\n\n");
    if let Some(uncertainties) = machine.result.extraction["uncertainties"].as_array() {
        for u in uncertainties {
            out.push_str(&literal(u["description"].as_str().unwrap_or("")));
        }
    }
    if let Some(human) = &reading.human_correction {
        out.push_str(&format!(
            "\n## Human reading correction\n\n{}",
            literal(human)
        ));
    }
    out.push_str(&format!("\n## Human annotation\n\n{}", m.note));
    out
}
fn payload(
    kind: &str,
    memory: &str,
    rev: u64,
    note: &str,
    source: &str,
    name: &str,
) -> Result<String> {
    Ok(hash(&json(&(kind, memory, rev, note, source, name))?))
}
impl Vault {
    pub fn open(root: &Path) -> Result<Self> {
        safe(root)?;
        if !root.is_dir() || !root.is_absolute() {
            return Err("Select an existing absolute vault folder".into());
        }
        let recall = root.join("Recall");
        safe(&recall)?;
        if !recall.exists() {
            // Build the whole empty subtree privately, then publish without merging.
            let staging = root.join(format!(".recall-init-{}", Uuid::new_v4()));
            fs::create_dir(&staging).map_err(fail)?;
            for d in [
                "Memories",
                "Sources",
                "History",
                "_meta",
                "_meta/journal",
                "_meta/commits",
                "_meta/preserved",
            ] {
                fs::create_dir(staging.join(d)).map_err(fail)?;
            }
            let manifest = Manifest {
                format: FORMAT.into(),
                vault_id: Uuid::new_v4().to_string(),
            };
            create(&staging.join("_meta/manifest.json"), &json(&manifest)?)?;
            for d in [
                "Memories",
                "Sources",
                "History",
                "_meta/journal",
                "_meta/commits",
                "_meta/preserved",
                "_meta",
                "",
            ] {
                sync_dir(&staging.join(d))?;
            }
            if recall.exists() {
                return Err("Recall subtree appeared during initialization".into());
            }
            rename(&staging, &recall)?;
        }
        let manifest: Manifest = decode(&recall.join("_meta/manifest.json"))?;
        if ![FORMAT, FORMAT_V2, FORMAT_V3].contains(&manifest.format.as_str()) {
            return Err("Unsupported or legacy Recall subtree".into());
        }
        id(&manifest.vault_id)?;
        let v = Self {
            root: root.to_path_buf(),
            id: manifest.vault_id,
        };
        v.validate()?;
        Ok(v)
    }
    fn path(&self, p: &str) -> PathBuf {
        self.root.join("Recall").join(p)
    }
    fn note_path(&self, id: &str) -> PathBuf {
        self.path(&format!("Memories/{id}.md"))
    }
    #[cfg(test)]
    fn source_path(&self, id: &str) -> PathBuf {
        for ext in ["png", "jpg", "webp"] {
            let p = self.path(&format!("Sources/{id}.{ext}"));
            if p.exists() {
                return p;
            }
        }
        self.path(&format!("Sources/{id}.png"))
    }
    fn history_path(&self, id: &str, rev: u64) -> PathBuf {
        self.path(&format!("History/{id}/{rev:020}.json"))
    }
    fn done_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/commits/{op}.json"))
    }
    fn journal_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/journal/{op}.json"))
    }
    fn backup_path(&self, op: &str) -> PathBuf {
        self.path(&format!("_meta/preserved/{op}.md"))
    }
    fn validate(&self) -> Result<()> {
        safe(&self.root)?;
        let m: Manifest = decode(&self.path("_meta/manifest.json"))?;
        if ![FORMAT, FORMAT_V2, FORMAT_V3].contains(&m.format.as_str()) || m.vault_id != self.id {
            return Err("Selected vault identity changed".into());
        }
        for d in [
            "Memories",
            "Sources",
            "History",
            "_meta",
            "_meta/journal",
            "_meta/commits",
            "_meta/preserved",
        ] {
            let p = self.path(d);
            safe(&p)?;
            if !p.is_dir() {
                return Err("Managed vault directory missing".into());
            }
        }
        Ok(())
    }
    fn lock(&self) -> Result<File> {
        self.validate()?;
        let p = self.path("_meta/writer.lock");
        safe(&p)?;
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(p)
            .map_err(fail)?;
        f.try_lock()
            .map_err(|_| "Vault is busy in another Recall process".to_string())?;
        self.validate()?;
        Ok(f)
    }
    fn fence_v2(&self) -> Result<()> {
        let path = self.path("_meta/manifest.json");
        let bytes = read(&path, MAX_JSON)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(fail)?;
        if [FORMAT_V2, FORMAT_V3].contains(&manifest.format.as_str()) {
            return Ok(());
        }
        immutable(&self.path("_meta/manifest-v1.json"), &bytes)?;
        let stage = path.with_extension(format!("stage-{}", Uuid::new_v4()));
        create(
            &stage,
            &json(&Manifest {
                format: FORMAT_V2.into(),
                vault_id: self.id.clone(),
            })?,
        )?;
        boundary!("fence_before", &path);
        replace(&stage, &path)?;
        boundary!("fence_after", &path);
        Ok(())
    }
    fn event_note_path(&self, e: &Event) -> Result<PathBuf> {
        match &e.note_path {
            Some(name) => {
                basename(name)?;
                Ok(self.path("Memories").join(name))
            }
            None => Ok(self.note_path(&e.memory.id)),
        }
    }
    // Only flat Markdown children participate. Prefix discovery still catches
    // oversized duplicates; full content and safe-path validation follow.
    fn inventory(&self, memory_id: &str, bound_name: Option<&str>) -> Result<Option<PathBuf>> {
        let canonical = self.note_path(memory_id);
        // Stable identity discovery takes precedence over the old bound name.
        // If no identity resolves, an occupied bound path is a conflict rather
        // than absence, even when an editor changed its identity header.
        let bound = bound_name
            .map(|name| -> Result<PathBuf> {
                basename(name)?;
                Ok(self.path("Memories").join(name))
            })
            .transpose()?;
        let marker = format!("<!-- Recall memory {memory_id} | ");
        let mut candidates = Vec::new();
        let mut nested = false;
        for p in entries(&self.path("Memories"))? {
            let metadata = fs::symlink_metadata(&p).map_err(fail)?;
            if metadata.is_dir() {
                nested = true;
            }
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            safe(&p)?;
            if p == canonical
                || identity_prefix(&p, marker.len()).is_ok_and(|b| b == marker.as_bytes())
            {
                basename(
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .ok_or("Invalid note basename")?,
                )?;
                candidates.push(p);
            }
        }
        if candidates.len() > 1 {
            return Err(
                "Duplicate or occupied memory identity; preserve both files and resolve explicitly"
                    .into(),
            );
        }
        if candidates.is_empty() {
            if let Some(bound) = bound {
                safe(&bound)?;
                if bound.try_exists().map_err(fail)? {
                    return Err("Known note pathname is occupied with changed identity; resolve the conflict before confirming absence".into());
                }
            }
            if nested {
                return Err("Missing note with nested folders in Memories; nested moves require explicit resolution".into());
            }
        }
        Ok(candidates.pop())
    }
    fn parent_hash(&self, memory_id: &str, revision: u64) -> Result<String> {
        Ok(hash(&read(
            &self.history_path(memory_id, revision),
            MAX_JSON,
        )?))
    }
    fn event_valid(&self, e: &Event) -> Result<()> {
        id(&e.memory.id)?;
        id(&e.operation_id)?;
        note_valid(&e.memory.note)?;
        if ![FORMAT, FORMAT_V2, FORMAT_V3].contains(&e.format.as_str())
            || (e.format == FORMAT
                && (e.note_path.is_some()
                    || e.expected_state.is_some()
                    || !["capture", "correct", "external"].contains(&e.kind.as_str())))
            || (e.format != FORMAT_V3
                && (e.memory.reading.is_some()
                    || ["machine_reading", "reading_correction"].contains(&e.kind.as_str())))
            || e.vault_id != self.id
            || e.memory.revision == 0
            || e.memory.revision > MAX_RECORDS as u64
            || e.expected_revision.checked_add(1) != Some(e.memory.revision)
            || e.memory.conflict.is_some()
            || ![
                "capture",
                "correct",
                "external",
                "restore",
                "remove",
                "machine_reading",
                "reading_correction",
            ]
            .contains(&e.kind.as_str())
            || e.origin
                != if e.kind == "machine_reading" {
                    "machine:anthropic"
                } else if e.kind == "external" {
                    "human:obsidian"
                } else {
                    "human:recall"
                }
            || e.memory.source_sha256.len() != 64
            || e.memory.source_name.len() > 260
            || !["png", "jpg", "webp"]
                .contains(&e.memory.source_name.rsplit('.').next().unwrap_or(""))
            || e.memory.source_name.contains(['/', '\\', '\0'])
            || e.memory.captured_at.len() != 20
            || e.memory.updated_at.len() != 20
            || e.markdown != markdown(&e.memory)
            || (e.memory.revision == 1) != (e.parent_sha256.is_none())
            || (e.kind == "capture") != (e.memory.revision == 1)
        {
            return Err("Malformed revision metadata".into());
        }
        if let Some(name) = &e.note_path {
            basename(name)?;
        }
        if e.format != FORMAT && e.note_path.is_none() {
            return Err("Missing bound note basename".into());
        }
        if (e.kind == "remove") != e.expected_state.is_some()
            || e.expected_state
                .as_deref()
                .is_some_and(|state| !["active", "missing"].contains(&state))
            || (["capture", "restore"].contains(&e.kind.as_str()) && e.previous_markdown.is_some())
            || ([
                "correct",
                "external",
                "machine_reading",
                "reading_correction",
            ]
            .contains(&e.kind.as_str())
                && e.previous_markdown.is_none())
            || (e.kind == "capture" && e.operation_id != e.memory.id)
            || (e.kind == "remove"
                && (e.expected_state.as_deref() == Some("active")) != e.previous_markdown.is_some())
        {
            return Err("Malformed lifecycle precondition".into());
        }
        let mut expected = payload(
            &e.kind,
            &e.memory.id,
            e.expected_revision,
            &e.memory.note,
            &e.memory.source_sha256,
            &e.memory.source_name,
        )?;
        if e.kind == "remove" {
            expected = hash(&json(&(expected, &e.expected_state))?);
        }
        if e.format == FORMAT_V3 {
            expected = hash(&json(&(expected, &e.memory.reading))?);
        }
        self.reading_event_valid(e)?;
        if expected != e.payload_sha256 {
            return Err("Revision payload hash mismatch".into());
        }
        Ok(())
    }
    fn verify_source(&self, m: &VaultMemory) -> Result<VaultSource> {
        let extension = m
            .source_name
            .rsplit('.')
            .next()
            .ok_or("Missing source extension")?;
        let expected = self.path(&format!("Sources/{}.{extension}", m.id));
        for other in ["png", "jpg", "webp"] {
            let p = self.path(&format!("Sources/{}.{other}", m.id));
            if p != expected && p.exists() {
                return Err("Duplicate source identity".into());
            }
        }
        let bytes = read(&expected, MAX_PHOTO)?;
        let mime = image_type(&bytes)?.into();
        if hash(&bytes) != m.source_sha256 {
            return Err(
                "Original photo hash mismatch; restore original or import as new evidence".into(),
            );
        }
        Ok(VaultSource {
            bytes,
            mime_type: mime,
            sha256: m.source_sha256.clone(),
        })
    }
    fn records(&self, memory_id: &str) -> Result<Vec<Event>> {
        self.records_inner(memory_id, true)
    }
    fn records_inner(&self, memory_id: &str, require_receipts: bool) -> Result<Vec<Event>> {
        id(memory_id)?;
        let paths: Vec<PathBuf> = entries(&self.path(&format!("History/{memory_id}")))?
            .into_iter()
            .filter(|p| {
                !p.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                    s.strip_prefix("stage-")
                        .is_some_and(|v| Uuid::parse_str(v).is_ok())
                })
            })
            .collect();
        if paths.is_empty() {
            return Err("Missing revision history".into());
        }
        let mut out: Vec<Event> = Vec::new();
        for (index, p) in paths.iter().enumerate() {
            if p != &self.history_path(memory_id, index as u64 + 1) {
                return Err("History gap or unexpected file".into());
            }
            let bytes = read(p, MAX_JSON)?;
            let e: Event = serde_json::from_slice(&bytes).map_err(fail)?;
            self.event_valid(&e)?;
            if e.memory.id != memory_id || e.memory.revision != index as u64 + 1 {
                return Err("History identity mismatch".into());
            }
            if (require_receipts || self.done_path(&e.operation_id).exists())
                && read(&self.done_path(&e.operation_id), 128)? != hash(&bytes).as_bytes()
            {
                return Err("Uncommitted or corrupted history".into());
            }
            if read(&self.journal_path(&e.operation_id), MAX_JSON)? != bytes {
                return Err("Retained journal and history bytes differ".into());
            }
            if let Some(prev) = out.last() {
                self.reading_transition(prev, &e)?;
                if e.parent_sha256 != Some(self.parent_hash(memory_id, index as u64)?)
                    || e.memory.source_sha256 != prev.memory.source_sha256
                    || e.memory.source_name != prev.memory.source_name
                    || e.memory.captured_at != prev.memory.captured_at
                    || prev.kind == "remove"
                    || (prev.format == FORMAT_V2 && e.format == FORMAT)
                    || (["restore", "remove"].contains(&e.kind.as_str())
                        && e.memory.note != prev.memory.note)
                    || (e.previous_markdown.is_some()
                        && e.previous_markdown.as_ref() != Some(&prev.markdown))
                {
                    return Err("Broken revision chain".into());
                }
            }
            let backup = self.backup_path(&e.operation_id);
            if backup.exists()
                && Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                    != e.previous_markdown
            {
                return Err("Concurrent editor draft retained in Recall/_meta/preserved; manual resolution required".into());
            }
            out.push(e);
        }
        Ok(out)
    }
    fn recover(&self) -> Result<BTreeMap<String, String>> {
        let mut conflicts = BTreeMap::new();
        let mut groups: BTreeMap<String, Vec<Event>> = BTreeMap::new();
        for p in entries(&self.path("_meta/journal"))? {
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let decoded = decode::<Event>(&p).and_then(|e| {
                self.event_valid(&e)?;
                if p != self.journal_path(&e.operation_id) {
                    return Err("Journal identity mismatch".into());
                }
                Ok(e)
            });
            match decoded {
                Ok(e) => {
                    // A machine draft needs fresh explicit session authorization after interruption.
                    // Never turn selection/restart or cancellation into automatic result promotion.
                    let history = self.history_path(&e.memory.id, e.memory.revision);
                    if e.kind == "machine_reading"
                        && read(&history, MAX_JSON).ok() != Some(read(&p, MAX_JSON)?)
                    {
                        if let Err(error) = self.rollback_cancelled_reading(&e) {
                            conflicts.insert(e.memory.id.clone(), error);
                            continue;
                        }
                        // A newer authoritative event may occupy this revision; an abandoned
                        // machine proposal must not poison that human revision as a fork.
                        if !history.exists() {
                            let current = read(&self.event_note_path(&e)?, MAX_JSON).ok();
                            let previous = e.previous_markdown.as_ref().map(|s| s.as_bytes());
                            if current.as_deref() != previous
                                && (current.as_deref() == Some(e.markdown.as_bytes())
                                    || self.backup_path(&e.operation_id).exists())
                            {
                                conflicts.insert(e.memory.id.clone(),"Interrupted reading publication; explicitly recover or resolve preserved files".into());
                            }
                        }
                        continue;
                    }
                    groups.entry(e.memory.id.clone()).or_default().push(e)
                }
                Err(error) => {
                    // Damaged metadata stays visible without disabling healthy identities.
                    let memory_id = decode::<serde_json::Value>(&p)
                        .ok()
                        .and_then(|v| v.get("memory")?.get("id")?.as_str().map(str::to_owned))
                        .filter(|v| id(v).is_ok())
                        .or_else(|| p.file_stem().and_then(|v| v.to_str()).map(str::to_owned))
                        .filter(|value| id(value).is_ok())
                        .ok_or("Unattributable malformed journal; rebuild stopped with all files retained")?;
                    conflicts.insert(memory_id, format!("Retained journal is invalid: {error}"));
                }
            }
        }
        for (memory_id, mut events) in groups {
            // Repair only events already represented by the fully validated
            // immutable chain. Pending forks must not prevent receipt repair,
            // and this pass must never select or publish a competing draft.
            if events.iter().any(|e| {
                !self.done_path(&e.operation_id).exists()
                    && self.history_path(&memory_id, e.memory.revision).exists()
            }) {
                let repaired = self.records_inner(&memory_id, false).and_then(|records| {
                    for committed in records {
                        if !self.done_path(&committed.operation_id).exists() {
                            self.preflight_capacity(&committed)?;
                            let bytes =
                                read(&self.journal_path(&committed.operation_id), MAX_JSON)?;
                            self.repair_receipt(&committed, &bytes)?;
                        }
                    }
                    Ok(())
                });
                if let Err(error) = repaired {
                    conflicts.insert(memory_id.clone(), error);
                    continue;
                }
            }
            if conflicts.contains_key(&memory_id) {
                continue;
            }
            events.sort_by_key(|e| e.memory.revision);
            if events
                .windows(2)
                .any(|w| w[0].memory.revision == w[1].memory.revision)
            {
                conflicts.insert(
                    memory_id,
                    "Competing journal revisions; neither draft was selected".into(),
                );
                continue;
            }
            for e in events {
                if self.done_path(&e.operation_id).exists() {
                    let history = self.history_path(&e.memory.id, e.memory.revision);
                    let validation = (|| {
                        let bytes = read(&history, MAX_JSON)?;
                        if read(&self.journal_path(&e.operation_id), MAX_JSON)? != bytes
                            || read(&self.done_path(&e.operation_id), 128)?
                                != hash(&bytes).as_bytes()
                        {
                            return Err("Journal, history or completion marker changed".to_string());
                        }
                        Ok(())
                    })();
                    if let Err(error) = validation {
                        conflicts.insert(memory_id.clone(), error);
                        break;
                    }
                } else {
                    if let Err(error) = self.finish(&e) {
                        conflicts.insert(memory_id.clone(), error);
                        break;
                    }
                }
            }
        }
        Ok(conflicts)
    }
    /// Reserve every directory's worst-case publication footprint before any
    /// part of a new operation is written. Immutable publication briefly needs
    /// both stage and destination entries; retained crash stages count too.
    fn preflight_capacity(&self, e: &Event) -> Result<()> {
        self.event_valid(e)?;
        if json(e)?.len() as u64 > MAX_JSON {
            return Err("Revision metadata exceeds size limit".into());
        }
        let extension = e
            .memory
            .source_name
            .rsplit('.')
            .next()
            .ok_or("Missing source extension")?;
        let source = self.path(&format!("Sources/{}.{extension}", e.memory.id));
        let history = self.history_path(&e.memory.id, e.memory.revision);
        let history_dir = history.parent().ok_or("Missing history directory")?;
        let mut additions: BTreeMap<PathBuf, usize> = BTreeMap::new();
        for path in [
            source,
            self.journal_path(&e.operation_id),
            self.done_path(&e.operation_id),
            history.clone(),
        ] {
            safe(&path)?;
            let count = if path.try_exists().map_err(fail)? {
                0
            } else {
                2
            };
            *additions
                .entry(path.parent().ok_or("Missing parent")?.to_path_buf())
                .or_default() += count;
        }
        additions.insert(
            self.path("History"),
            usize::from(!history_dir.try_exists().map_err(fail)?),
        );
        let note = self.event_note_path(e)?;
        let backup = self.backup_path(&e.operation_id);
        safe(&note)?;
        safe(&backup)?;
        let note_exists = note.try_exists().map_err(fail)?;
        let publish_note = !["external", "remove"].contains(&e.kind.as_str())
            && read(&note, MAX_JSON).ok().as_deref() != Some(e.markdown.as_bytes());
        additions.insert(
            self.path("Memories"),
            if publish_note {
                if note_exists {
                    1
                } else {
                    2
                }
            } else {
                0
            },
        );
        additions.insert(
            self.path("_meta/preserved"),
            usize::from(publish_note && note_exists && !backup.try_exists().map_err(fail)?),
        );
        for (directory, additional) in additions {
            safe(&directory)?;
            let current = if directory.try_exists().map_err(fail)? {
                entries(&directory)?.len()
            } else {
                0
            };
            if current
                .checked_add(additional)
                .is_none_or(|total| total > MAX_RECORDS)
            {
                return Err(
                    "Vault retention capacity reached; no new operation was written".into(),
                );
            }
        }
        Ok(())
    }
    fn repair_receipt(&self, e: &Event, bytes: &[u8]) -> Result<()> {
        if read(
            &self.history_path(&e.memory.id, e.memory.revision),
            MAX_JSON,
        )? != bytes
        {
            return Err("Competing committed revision".into());
        }
        self.records_inner(&e.memory.id, false)?;
        if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        boundary!("before_receipt", &self.done_path(&e.operation_id));
        immutable(&self.done_path(&e.operation_id), hash(bytes).as_bytes())?;
        boundary!("after_receipt", &self.done_path(&e.operation_id));
        Ok(())
    }
    fn finish(&self, e: &Event) -> Result<()> {
        self.preflight_capacity(e)?;
        let hp = self.history_path(&e.memory.id, e.memory.revision);
        let bytes = read(&self.journal_path(&e.operation_id), MAX_JSON)?;
        let journal: Event = serde_json::from_slice(&bytes).map_err(fail)?;
        if json(&journal)? != json(e)? {
            return Err("Journal changed during publication".into());
        }
        if hp.exists() {
            // An immutable historical event can only repair its own receipt.
            // Never replay its Markdown over a later head (especially a tombstone).
            return self.repair_receipt(e, &bytes);
        }
        self.verify_source(&e.memory)?;
        self.reading_publish_allowed(e)?;
        if e.expected_revision > 0 {
            let records = self.records(&e.memory.id)?;
            let last = records.last().ok_or("Missing parent")?;
            self.reading_transition(last, e)?;
            if last.kind == "remove"
                || last.memory.revision != e.expected_revision
                || e.parent_sha256 != Some(self.parent_hash(&e.memory.id, e.expected_revision)?)
                || last.memory.source_sha256 != e.memory.source_sha256
                || last.memory.source_name != e.memory.source_name
                || last.memory.captured_at != e.memory.captured_at
                || (last.format == FORMAT_V2 && e.format == FORMAT)
                || (["remove", "restore"].contains(&e.kind.as_str())
                    && last.memory.note != e.memory.note)
                || (e.previous_markdown.is_some()
                    && e.previous_markdown.as_ref() != Some(&last.markdown))
            {
                return Err("Stale or invalid journal parent; retained without publication".into());
            }
        } else if hp.parent().is_some_and(|p| p.exists())
            && !entries(hp.parent().ok_or("Missing parent")?)?.is_empty()
        {
            return Err("Capture history already exists".into());
        }
        if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        let dir = hp.parent().ok_or("Missing parent")?;
        safe(dir)?;
        if !dir.exists() {
            fs::create_dir(dir).map_err(fail)?;
            sync_dir(dir.parent().ok_or("Missing parent")?)?;
        }
        if e.expected_revision > 0 {
            let prev = read(
                &self.history_path(&e.memory.id, e.expected_revision),
                MAX_JSON,
            )?;
            if Some(hash(&prev)) != e.parent_sha256 {
                return Err("Parent changed during recovery".into());
            }
        }
        let np = self.event_note_path(e)?;
        boundary!("before_note", &np);
        if self
            .inventory(&e.memory.id, e.note_path.as_deref())?
            .is_some_and(|p| p != np)
        {
            return Err("Memory moved during publication; journal and files retained".into());
        }
        if e.kind == "remove" {
            boundary!("before_history", &hp);
            self.removal_precondition(e)?;
            immutable(&hp, &bytes)?;
            boundary!("before_receipt", &self.done_path(&e.operation_id));
            immutable(&self.done_path(&e.operation_id), hash(&bytes).as_bytes())?;
            boundary!("after_receipt", &self.done_path(&e.operation_id));
            self.records(&e.memory.id)?;
            return Ok(());
        }
        let backup = self.backup_path(&e.operation_id);
        let current = match read(&np, MAX_JSON) {
            Ok(b) => Some(String::from_utf8(b).map_err(fail)?),
            Err(_) if !np.exists() => None,
            Err(err) => return Err(err),
        };
        if e.kind == "restore" && current.is_some() {
            return Err(
                "Restore target reappeared; retained journal needs explicit resolution".into(),
            );
        }
        if current.as_deref() != Some(&e.markdown) {
            if e.kind == "external" {
                return Err(
                    "External note changed during reconciliation; journal and disk preserved"
                        .into(),
                );
            }
            if current != e.previous_markdown {
                // Crash after moving the base but before publishing the new note.
                if current.is_some()
                    || !backup.exists()
                    || Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                        != e.previous_markdown
                {
                    return Err("Concurrent Markdown edit; journal draft and disk preserved".into());
                }
            } else if current.is_some() {
                if backup.exists() {
                    return Err("Publication backup already exists; resolve conflict".into());
                }
                rename(&np, &backup)?;
                if Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                    != e.previous_markdown
                {
                    return Err(
                        "Concurrent editor draft preserved in Recall/_meta/preserved".into(),
                    );
                }
            }
            atomic_new(&np, e.markdown.as_bytes())?;
        }
        boundary!("before_history", &hp);
        if self.inventory(&e.memory.id, e.note_path.as_deref())? != Some(np.clone()) {
            return Err("Memory moved or duplicated during publication".into());
        }
        // Check again immediately before committing. A concurrent edit remains intact.
        if read(&np, MAX_JSON)? != e.markdown.as_bytes() {
            return Err("Concurrent Markdown edit; retry refresh".into());
        }
        if backup.exists()
            && Some(String::from_utf8(read(&backup, MAX_JSON)?).map_err(fail)?)
                != e.previous_markdown
        {
            return Err("Concurrent editor draft preserved in Recall/_meta/preserved".into());
        }
        immutable(&hp, &bytes)?;
        boundary!("before_receipt", &self.done_path(&e.operation_id));
        immutable(&self.done_path(&e.operation_id), hash(&bytes).as_bytes())?;
        boundary!("after_receipt", &self.done_path(&e.operation_id));
        self.records(&e.memory.id)?;
        Ok(())
    }
    fn commit(&self, e: &Event) -> Result<VaultMemory> {
        let mut normalized = e.clone();
        if e.memory.reading.is_some() && e.format != FORMAT_V3 {
            normalized.format = FORMAT_V3.into();
            normalized.payload_sha256 = hash(&json(&(&e.payload_sha256, &e.memory.reading))?);
        }
        let e = &normalized;
        self.preflight_capacity(e)?;
        if e.format == FORMAT_V3 {
            self.fence_v3()?;
        } else if e.format == FORMAT_V2 {
            self.fence_v2()?;
        }
        immutable(&self.journal_path(&e.operation_id), &json(e)?)?;
        self.finish(e)?;
        let mut m = e.memory.clone();
        m.note_path = self
            .event_note_path(e)?
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned);
        if e.kind == "remove" {
            m.state = "deleted".into();
        }
        Ok(m)
    }
    fn receipt(&self, operation_id: &str) -> Result<Option<Event>> {
        id(operation_id)?;
        let p = self.journal_path(operation_id);
        if !p.exists() {
            return Ok(None);
        }
        let e: Event = decode(&p)?;
        self.event_valid(&e)?;
        if e.operation_id != operation_id {
            return Err("Operation identity mismatch".into());
        }
        if read(
            &self.history_path(&e.memory.id, e.memory.revision),
            MAX_JSON,
        )? != read(&p, MAX_JSON)?
        {
            return Err("Historical receipt payload changed".into());
        }
        if !self
            .records(&e.memory.id)?
            .iter()
            .any(|r| r.operation_id == e.operation_id)
        {
            return Err("Operation is still pending; journal retained".into());
        }
        Ok(Some(e))
    }
    fn current(&self, memory_id: &str, pending: &BTreeMap<String, String>) -> Result<VaultMemory> {
        if let Some(error) = pending.get(memory_id) {
            // A validated terminal tombstone remains authoritative even when a
            // stale draft is retained. It can be inspected, never used as evidence.
            let records = self.records(memory_id)?;
            let last = records.last().ok_or("Missing history")?;
            if last.kind != "remove" {
                return Err(error.clone());
            }
            let mut m = last.memory.clone();
            m.state = "deleted".into();
            m.note_path = last.note_path.clone();
            m.conflict = Some(error.clone());
            return Ok(m);
        }
        self.reconciled(memory_id)
    }
    pub fn capture_receipt(&self, operation_id: &str, note: &str) -> Result<Option<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        note_valid(note)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "capture" || e.memory.note != note {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending).map(Some);
        }
        Ok(None)
    }
    pub fn capture_path(&self, operation_id: &str, note: &str, path: &Path) -> Result<VaultMemory> {
        let bytes = read(path, MAX_PHOTO)?;
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid photo name")?;
        self.capture(operation_id, name, &bytes, note)
    }
    pub fn capture(
        &self,
        operation_id: &str,
        name: &str,
        bytes: &[u8],
        note: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        note_valid(note)?;
        image_type(bytes)?;
        if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', '\0']) {
            return Err("Invalid source name".into());
        }
        let extension = match image_type(bytes)? {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            _ => "webp",
        };
        let normalized_name = if name.ends_with(&format!(".{extension}")) {
            name.to_string()
        } else {
            format!("{name}.{extension}")
        };
        let name = normalized_name.as_str();
        let source_hash = hash(bytes);
        let payload_sha256 = payload("capture", operation_id, 0, note, &source_hash, name)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.payload_sha256 != payload_sha256 {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        let now = timestamp();
        let memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: note.into(),
            reading: None,
            source_sha256: source_hash,
            source_name: name.into(),
            captured_at: now.clone(),
            updated_at: now,
            conflict: None,
            state: "active".into(),
            note_path: None,
        };
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            note_path: Some(format!("{operation_id}.md")),
            expected_state: None,
            expected_revision: 0,
            payload_sha256,
            parent_sha256: None,
            origin: "human:recall".into(),
            markdown: markdown(&memory),
            previous_markdown: None,
            memory,
        };
        self.preflight_capacity(&e)?;
        immutable(
            &self.path(&format!("Sources/{operation_id}.{extension}")),
            bytes,
        )?;
        self.commit(&e)
    }
    fn reconciled(&self, memory_id: &str) -> Result<VaultMemory> {
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut m = last.memory.clone();
        if last.kind == "remove" {
            m.state = "deleted".into();
            m.note_path = last.note_path.clone();
            return Ok(m);
        }
        self.verify_source(&m)?;
        let np = match self.inventory(memory_id, last.note_path.as_deref()) {
            Ok(Some(p)) => p,
            Ok(None) => {
                m.state = "missing".into();
                m.conflict =
                    Some("Markdown note missing; explicitly restore or remove this memory".into());
                return Ok(m);
            }
            Err(error) => {
                m.state = "conflict".into();
                m.conflict = Some(error);
                return Ok(m);
            }
        };
        m.note_path = np.file_name().and_then(|s| s.to_str()).map(str::to_owned);
        let disk = String::from_utf8(read(&np, MAX_JSON)?).map_err(fail)?;
        if disk == last.markdown {
            return Ok(m);
        }
        let prefix = markdown(&VaultMemory {
            note: String::new(),
            ..m.clone()
        });
        let Some(note) = disk.strip_prefix(&prefix) else {
            m.state = "conflict".into();
            m.conflict = Some(
                "Markdown identity or evidence link changed; restore the header to reconcile"
                    .into(),
            );
            return Ok(m);
        };
        note_valid(note)?;
        m.revision += 1;
        m.note = note.into();
        m.updated_at = timestamp();
        let operation_id = Uuid::new_v4().to_string();
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id,
            kind: "external".into(),
            note_path: m.note_path.clone(),
            expected_state: None,
            expected_revision: last.memory.revision,
            payload_sha256: payload(
                "external",
                &m.id,
                last.memory.revision,
                &m.note,
                &m.source_sha256,
                &m.source_name,
            )?,
            parent_sha256: Some(self.parent_hash(&last.memory.id, last.memory.revision)?),
            origin: "human:obsidian".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: disk,
            memory: m,
        };
        self.commit(&e)
    }
    #[cfg(test)]
    pub fn list(&self, query: &str) -> Result<Vec<VaultMemory>> {
        self.list_with_deleted(query, false)
    }
    pub fn list_with_deleted(
        &self,
        query: &str,
        include_deleted: bool,
    ) -> Result<Vec<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        if query.len() > 4096 {
            return Err("Query too long".into());
        }
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let mut out = Vec::new();
        for p in entries(&self.path("History"))? {
            let memory_id = p
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid history filename")?;
            id(memory_id)?;
            let m = match self.current(memory_id, &pending) {
                Ok(m) => m,
                Err(err) => VaultMemory {
                    id: memory_id.into(),
                    revision: 0,
                    note: String::new(),
                    reading: None,
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Memory unavailable: {err}")),
                    state: "conflict".into(),
                    note_path: None,
                },
            };
            if m.state == "deleted" && !include_deleted {
                continue;
            }
            let note = m.note.to_lowercase();
            let reading = m
                .reading
                .as_ref()
                .map(|r| r.effective_text())
                .unwrap_or("")
                .to_lowercase();
            let filename = m.source_name.to_lowercase();
            let note_filename = m.note_path.as_deref().unwrap_or("").to_lowercase();
            if terms.is_empty()
                || (m.state == "active"
                    && m.conflict.is_none()
                    && terms.iter().all(|term| {
                        note.contains(term)
                            || reading.contains(term)
                            || filename.contains(term)
                            || note_filename.contains(term)
                    }))
            {
                out.push(m);
            }
        }
        for (memory_id, error) in pending {
            if terms.is_empty()
                && !self.path(&format!("History/{memory_id}")).exists()
                && !out.iter().any(|m| m.id == memory_id)
            {
                out.push(VaultMemory {
                    id: memory_id,
                    revision: 0,
                    note: String::new(),
                    reading: None,
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Pending capture preserved: {error}")),
                    state: "conflict".into(),
                    note_path: None,
                });
            }
        }
        out.sort_by(|a, b| b.captured_at.cmp(&a.captured_at).then(a.id.cmp(&b.id)));
        Ok(out)
    }
    pub fn correct(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        note: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(memory_id)?;
        id(operation_id)?;
        note_valid(note)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "correct"
                || e.memory.id != memory_id
                || e.expected_revision != expected_revision
                || e.memory.note != note
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let m = self.reconciled(memory_id)?;
        if m.state != "active" || m.conflict.is_some() || m.revision != expected_revision {
            return Err("Conflict: vault note changed. Refresh, review the latest note, then explicitly retry your draft".into());
        }
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut memory = m;
        memory.revision += 1;
        memory.note = note.into();
        memory.updated_at = timestamp();
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "correct".into(),
            note_path: memory.note_path.clone(),
            expected_state: None,
            expected_revision,
            payload_sha256: payload(
                "correct",
                memory_id,
                expected_revision,
                note,
                &memory.source_sha256,
                &memory.source_name,
            )?,
            parent_sha256: Some(self.parent_hash(&last.memory.id, last.memory.revision)?),
            origin: "human:recall".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: markdown(&memory),
            memory,
        };
        self.commit(&e)
    }
    fn removal_precondition(&self, e: &Event) -> Result<()> {
        let candidate = self.inventory(&e.memory.id, e.note_path.as_deref())?;
        match e.expected_state.as_deref() {
            Some("missing") if candidate.is_none() => Ok(()),
            Some("active") if candidate.as_ref() == Some(&self.event_note_path(e)?) => {
                if read(candidate.as_ref().ok_or("Missing note")?, MAX_JSON)?
                    == e.markdown.as_bytes()
                {
                    Ok(())
                } else {
                    Err("Note changed during removal; confirmation is stale".into())
                }
            }
            _ => Err("Note presence changed during removal; confirmation is stale".into()),
        }
    }
    pub fn restore_note(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
    ) -> Result<VaultMemory> {
        self.lifecycle(memory_id, expected_revision, operation_id, "restore", None)
    }
    pub fn remove(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        expected_state: &str,
    ) -> Result<VaultMemory> {
        if !["active", "missing"].contains(&expected_state) {
            return Err("Removal requires active or missing expectedState".into());
        }
        self.lifecycle(
            memory_id,
            expected_revision,
            operation_id,
            "remove",
            Some(expected_state),
        )
    }
    fn lifecycle(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        kind: &str,
        expected_state: Option<&str>,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        id(memory_id)?;
        id(operation_id)?;
        let pending = self.recover()?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != kind
                || e.memory.id != memory_id
                || e.expected_revision != expected_revision
                || e.expected_state.as_deref() != expected_state
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(memory_id, &pending);
        }
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let mut m = self.reconciled(memory_id)?;
        let required_state = expected_state.unwrap_or("missing");
        if m.revision != expected_revision || m.state != required_state {
            return Err("Memory revision or state changed; refresh and confirm again".into());
        }
        let last = self.records(memory_id)?.pop().ok_or("Missing history")?;
        m.revision += 1;
        m.updated_at = timestamp();
        m.conflict = None;
        let mut payload_sha256 = payload(
            kind,
            memory_id,
            expected_revision,
            &m.note,
            &m.source_sha256,
            &m.source_name,
        )?;
        let expected_state = expected_state.map(str::to_owned);
        if kind == "remove" {
            payload_sha256 = hash(&json(&(payload_sha256, &expected_state))?);
        }
        let e = Event {
            format: FORMAT_V2.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: kind.into(),
            expected_revision,
            payload_sha256,
            parent_sha256: Some(self.parent_hash(memory_id, expected_revision)?),
            origin: "human:recall".into(),
            note_path: m
                .note_path
                .clone()
                .or(last.note_path)
                .or_else(|| Some(format!("{memory_id}.md"))),
            expected_state,
            previous_markdown: if m.state == "active" {
                Some(last.markdown)
            } else {
                None
            },
            markdown: markdown(&m),
            memory: VaultMemory {
                state: "active".into(),
                ..m
            },
        };
        self.commit(&e)
    }
    pub fn source(&self, memory_id: &str) -> Result<VaultSource> {
        let _lock = self.lock()?;
        if let Some(error) = self.recover()?.get(memory_id) {
            return Err(error.clone());
        }
        let m = self.reconciled(memory_id)?;
        if m.state != "active" || m.conflict.is_some() {
            return Err("Resolve this memory's conflict before using its evidence".into());
        }
        self.verify_source(&m)
    }
    pub fn history(&self, memory_id: &str) -> Result<Vec<VaultRevision>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let records = self.records(memory_id)?;
        if let Some(error) = pending.get(memory_id) {
            if !records.last().is_some_and(|e| e.kind == "remove") {
                return Err(error.clone());
            }
        }
        Ok(records
            .into_iter()
            .map(|e| VaultRevision {
                revision: e.memory.revision,
                note: e.memory.note,
                reading: e.memory.reading,
                recorded_at: e.memory.updated_at,
                origin: e.origin,
                kind: e.kind,
            })
            .collect())
    }
}

/// Native-selected scope only. Commands hold this mutex throughout each operation,
/// including pickers, so switching cannot redirect an in-flight capture.
struct Selected {
    vault: Vault,
    token: String,
}
pub struct LocalVaultState {
    selected: Mutex<Option<Selected>>,
    settings: PathBuf,
    reading_sessions: Mutex<BTreeMap<(String, String), Vault>>,
}
impl LocalVaultState {
    pub fn new(settings: PathBuf) -> Self {
        // Unavailable roots remain unselected and are never silently initialized.
        let selected = decode::<VaultStatus>(&settings)
            .ok()
            .and_then(|s| {
                let root = PathBuf::from(s.root?);
                let expected = s.vault_id?;
                if !root.join("Recall/_meta/manifest.json").exists() {
                    return None;
                }
                Vault::open(&root).ok().filter(|v| v.id == expected)
            })
            .map(|vault| Selected {
                vault,
                token: Uuid::new_v4().to_string(),
            });
        Self {
            selected: Mutex::new(selected),
            settings,
            reading_sessions: Mutex::new(BTreeMap::new()),
        }
    }
    pub fn status(&self) -> Result<VaultStatus> {
        let selected = self.selected.lock().map_err(fail)?;
        match selected.as_ref() {
            Some(s) => {
                s.vault.validate()?;
                Ok(VaultStatus {
                    root: Some(s.vault.root.to_string_lossy().into()),
                    vault_id: Some(s.token.clone()),
                    vault_identity: Some(s.vault.id.clone()),
                })
            }
            None => Ok(VaultStatus {
                root: None,
                vault_id: None,
                vault_identity: None,
            }),
        }
    }
    pub fn with<T>(&self, expected: &str, action: impl FnOnce(&Vault) -> Result<T>) -> Result<T> {
        let selected = self.selected.lock().map_err(fail)?;
        let s = selected.as_ref().ok_or("Select a vault first")?;
        if s.token != expected {
            return Err("Vault selection changed; refresh before retrying".into());
        }
        s.vault.validate()?;
        action(&s.vault)
    }
    pub fn select_path(&self, root: &Path) -> Result<VaultStatus> {
        let mut selected = self.selected.lock().map_err(fail)?;
        let v = Vault::open(root)?;
        {
            let _lock = v.lock()?;
            v.recover()?;
        }
        let status = VaultStatus {
            root: Some(v.root.to_string_lossy().into()),
            vault_id: Some(v.id.clone()),
            vault_identity: Some(v.id.clone()),
        };
        // Cancel registered requests in their original vault before replacing the session.
        // Network work holds neither this mutex nor a vault lock.
        if let Some(old) = selected.as_ref() {
            for ((session, operation), vault) in self.reading_sessions.lock().map_err(fail)?.iter()
            {
                if session == &old.token {
                    vault.cancel_reading(operation)?;
                }
            }
        }
        // Preserve the previous settings until a fully flushed replacement exists.
        let temp = self
            .settings
            .with_extension(format!("stage-{}", Uuid::new_v4()));
        create(&temp, &json(&status)?)?;
        #[cfg(windows)]
        {
            // Windows rename cannot replace an existing file; use write-through replacement.
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            safe(&self.settings)?;
            let a: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let b: Vec<u16> = self
                .settings
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            if unsafe {
                MoveFileExW(
                    a.as_ptr(),
                    b.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(fail(std::io::Error::last_os_error()));
            }
        }
        #[cfg(not(windows))]
        replace(&temp, &self.settings)?;
        let token = Uuid::new_v4().to_string();
        *selected = Some(Selected {
            vault: v,
            token: token.clone(),
        });
        Ok(VaultStatus {
            vault_id: Some(token),
            ..status
        })
    }
}

#[path = "reading_storage.rs"]
mod reading_storage;
pub use reading_storage::ReadingOperation;

#[cfg(test)]
#[path = "local_vault_tests.rs"]
mod tests;
