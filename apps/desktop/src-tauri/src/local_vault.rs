//! Local human annotations and immutable evidence. No network or model calls.
//! Journals and revision records are retained; Markdown publication backups are
//! retained too, so an editor holding the old inode cannot lose its draft.
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
const MAX_PHOTO: u64 = 25 * 1024 * 1024;
const MAX_NOTE: usize = 256 * 1024;
const MAX_JSON: u64 = 2 * 1024 * 1024;
const MAX_RECORDS: usize = 10_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultStatus {
    pub root: Option<String>,
    pub vault_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultMemory {
    pub id: String,
    pub revision: u64,
    pub note: String,
    pub source_sha256: String,
    pub source_name: String,
    pub captured_at: String,
    pub updated_at: String,
    pub conflict: Option<String>,
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
    pub recorded_at: String,
    pub origin: String,
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
    memory: VaultMemory,
    previous_markdown: Option<String>,
    markdown: String,
}
#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
    pub id: String,
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
    safe(path)?;
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(fail)?;
    f.write_all(bytes).map_err(fail)?;
    f.sync_all().map_err(fail)?;
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
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(fail)?;
    sync_dir(from.parent().ok_or("No parent")?)?;
    sync_dir(to.parent().ok_or("No parent")?)
}
/// Stage + hard-link publishes an entire immutable file without replacing a destination.
fn atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("stage-{}", Uuid::new_v4()));
    create(&tmp, bytes)?;
    safe(path)?;
    fs::hard_link(&tmp, path).map_err(fail)?;
    sync_dir(path.parent().ok_or("No parent")?)?;
    fs::remove_file(&tmp).map_err(fail)?;
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
    format!("<!-- Recall memory {} | human annotation, not OCR -->\n[Original photo](../Sources/{}.{})\n\n{}",m.id,m.id,m.source_name.rsplit('.').next().unwrap_or("png"),m.note)
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
        if manifest.format != FORMAT {
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
        if m.format != FORMAT || m.vault_id != self.id {
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
    fn event_valid(&self, e: &Event) -> Result<()> {
        id(&e.memory.id)?;
        id(&e.operation_id)?;
        note_valid(&e.memory.note)?;
        if e.format != FORMAT
            || e.vault_id != self.id
            || e.memory.revision == 0
            || e.memory.revision > MAX_RECORDS as u64
            || e.expected_revision.checked_add(1) != Some(e.memory.revision)
            || e.memory.conflict.is_some()
            || !["capture", "correct", "external"].contains(&e.kind.as_str())
            || e.origin
                != if e.kind == "external" {
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
        let expected = payload(
            &e.kind,
            &e.memory.id,
            e.expected_revision,
            &e.memory.note,
            &e.memory.source_sha256,
            &e.memory.source_name,
        )?;
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
            if read(&self.done_path(&e.operation_id), 128)? != hash(&bytes).as_bytes() {
                return Err("Uncommitted or corrupted history".into());
            }
            if let Some(prev) = out.last() {
                if e.parent_sha256 != Some(hash(&json(prev)?))
                    || e.memory.source_sha256 != prev.memory.source_sha256
                    || e.memory.source_name != prev.memory.source_name
                    || e.memory.captured_at != prev.memory.captured_at
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
        self.verify_source(&out.last().ok_or("Missing history")?.memory)?;
        Ok(out)
    }
    fn recover(&self) -> Result<BTreeMap<String, String>> {
        let mut conflicts = BTreeMap::new();
        for p in entries(&self.path("_meta/journal"))? {
            // A crashed staging file was never published and is not a journal.
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let e: Event = decode(&p)?;
            self.event_valid(&e)?;
            if p != self.journal_path(&e.operation_id) {
                return Err("Journal identity mismatch".into());
            }
            if !self.done_path(&e.operation_id).exists() {
                if let Err(error) = self.finish(&e) {
                    conflicts.insert(e.memory.id.clone(), error);
                }
            }
        }
        Ok(conflicts)
    }
    fn finish(&self, e: &Event) -> Result<()> {
        self.event_valid(e)?;
        self.verify_source(&e.memory)?;
        let hp = self.history_path(&e.memory.id, e.memory.revision);
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
        let np = self.note_path(&e.memory.id);
        let backup = self.backup_path(&e.operation_id);
        let current = match read(&np, MAX_JSON) {
            Ok(b) => Some(String::from_utf8(b).map_err(fail)?),
            Err(_) if !np.exists() => None,
            Err(err) => return Err(err),
        };
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
        immutable(&hp, &json(e)?)?;
        immutable(&self.done_path(&e.operation_id), hash(&json(e)?).as_bytes())?;
        self.records(&e.memory.id)?;
        Ok(())
    }
    fn commit(&self, e: &Event) -> Result<VaultMemory> {
        immutable(&self.journal_path(&e.operation_id), &json(e)?)?;
        self.finish(e)?;
        Ok(e.memory.clone())
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
        if !self
            .records(&e.memory.id)?
            .iter()
            .any(|r| r.operation_id == e.operation_id)
        {
            return Err("Operation is still pending; journal retained".into());
        }
        Ok(Some(e))
    }
    pub fn capture_receipt(&self, operation_id: &str, note: &str) -> Result<Option<VaultMemory>> {
        let _lock = self.lock()?;
        self.recover()?;
        note_valid(note)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "capture" || e.memory.note != note {
                return Err("Operation ID reused with different payload".into());
            }
            return Ok(Some(e.memory));
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
        if let Some(error) = self.recover()?.get(operation_id) {
            return Err(error.clone());
        }
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
            return Ok(e.memory);
        }
        immutable(
            &self.path(&format!("Sources/{operation_id}.{extension}")),
            bytes,
        )?;
        let now = timestamp();
        let memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: note.into(),
            source_sha256: source_hash,
            source_name: name.into(),
            captured_at: now.clone(),
            updated_at: now,
            conflict: None,
        };
        let e = Event {
            format: FORMAT.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            expected_revision: 0,
            payload_sha256,
            parent_sha256: None,
            origin: "human:recall".into(),
            markdown: markdown(&memory),
            previous_markdown: None,
            memory,
        };
        self.commit(&e)
    }
    fn reconciled(&self, memory_id: &str) -> Result<VaultMemory> {
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut m = last.memory.clone();
        let np = self.note_path(memory_id);
        // Renames are diagnosed rather than silently recreated. Duplicate identity
        // headers anywhere in the bounded managed note directory block eligibility.
        let marker = format!("<!-- Recall memory {memory_id} | ");
        for candidate in entries(&self.path("Memories"))? {
            if candidate != np && candidate.extension().and_then(|s| s.to_str()) == Some("md") {
                let bytes = read(&candidate, MAX_JSON)?;
                if bytes.starts_with(marker.as_bytes()) {
                    m.conflict=Some("Renamed or duplicate memory note; restore one original filename before reconciling".into());
                    return Ok(m);
                }
            }
        }
        if !np.exists() {
            m.conflict =
                Some("Markdown note missing; restore it or resolve deletion in the vault".into());
            return Ok(m);
        }
        let disk = String::from_utf8(read(&np, MAX_JSON)?).map_err(fail)?;
        if disk == last.markdown {
            return Ok(m);
        }
        let prefix = markdown(&VaultMemory {
            note: String::new(),
            ..m.clone()
        });
        let Some(note) = disk.strip_prefix(&prefix) else {
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
            format: FORMAT.into(),
            vault_id: self.id.clone(),
            operation_id,
            kind: "external".into(),
            expected_revision: last.memory.revision,
            payload_sha256: payload(
                "external",
                &m.id,
                last.memory.revision,
                &m.note,
                &m.source_sha256,
                &m.source_name,
            )?,
            parent_sha256: Some(hash(&json(last)?)),
            origin: "human:obsidian".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: disk,
            memory: m,
        };
        self.commit(&e)
    }
    pub fn list(&self, query: &str) -> Result<Vec<VaultMemory>> {
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
            let m = match pending
                .get(memory_id)
                .map_or_else(|| self.reconciled(memory_id), |error| Err(error.clone()))
            {
                Ok(m) => m,
                Err(err) => VaultMemory {
                    id: memory_id.into(),
                    revision: 0,
                    note: String::new(),
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Memory unavailable: {err}")),
                },
            };
            if terms.is_empty()
                || (m.conflict.is_none() && terms.iter().all(|t| m.note.to_lowercase().contains(t)))
            {
                out.push(m);
            }
        }
        for (memory_id, error) in pending {
            if terms.is_empty() && !out.iter().any(|m| m.id == memory_id) {
                out.push(VaultMemory {
                    id: memory_id,
                    revision: 0,
                    note: String::new(),
                    source_sha256: String::new(),
                    source_name: String::new(),
                    captured_at: String::new(),
                    updated_at: String::new(),
                    conflict: Some(format!("Pending capture preserved: {error}")),
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
        if let Some(error) = self.recover()?.get(memory_id) {
            return Err(error.clone());
        }
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
            return Ok(e.memory);
        }
        let m = self.reconciled(memory_id)?;
        if m.conflict.is_some() || m.revision != expected_revision {
            return Err("Conflict: vault note changed. Refresh, review the latest note, then explicitly retry your draft".into());
        }
        let records = self.records(memory_id)?;
        let last = records.last().ok_or("Missing history")?;
        let mut memory = m;
        memory.revision += 1;
        memory.note = note.into();
        memory.updated_at = timestamp();
        let e = Event {
            format: FORMAT.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "correct".into(),
            expected_revision,
            payload_sha256: payload(
                "correct",
                memory_id,
                expected_revision,
                note,
                &memory.source_sha256,
                &memory.source_name,
            )?,
            parent_sha256: Some(hash(&json(last)?)),
            origin: "human:recall".into(),
            previous_markdown: Some(last.markdown.clone()),
            markdown: markdown(&memory),
            memory,
        };
        self.commit(&e)
    }
    pub fn source(&self, memory_id: &str) -> Result<VaultSource> {
        let _lock = self.lock()?;
        if let Some(error) = self.recover()?.get(memory_id) {
            return Err(error.clone());
        }
        let m = self.reconciled(memory_id)?;
        if m.conflict.is_some() {
            return Err("Resolve this memory's conflict before using its evidence".into());
        }
        self.verify_source(&m)
    }
    pub fn history(&self, memory_id: &str) -> Result<Vec<VaultRevision>> {
        let _lock = self.lock()?;
        if let Some(error) = self.recover()?.get(memory_id) {
            return Err(error.clone());
        }
        Ok(self
            .records(memory_id)?
            .into_iter()
            .map(|e| VaultRevision {
                revision: e.memory.revision,
                note: e.memory.note,
                recorded_at: e.memory.updated_at,
                origin: e.origin,
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
                })
            }
            None => Ok(VaultStatus {
                root: None,
                vault_id: None,
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
        };
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
        rename(&temp, &self.settings)?;
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

#[cfg(test)]
#[path = "local_vault_tests.rs"]
mod tests;
