//! Local recognizer orchestration. The saved-local receipt always exists first;
//! the recognizer is an optional derived step with no authority over vault
//! paths, identity, consent or citations. Its output is untrusted text.
use crate::audio_wav;
use crate::local_vault::{
    AsrIdentity, AsrPhase, AsrResult, AudioSegment, SelectionGuard, RMS_GATE,
};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;

/// One bounded recognizer attempt over a verified derivative.
pub struct AsrJob<'a> {
    pub derivative_wav: &'a [u8],
    pub derivative_sha256: &'a str,
    pub duration_ms: u64,
    pub work_dir: &'a Path,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AsrOutcome {
    pub completed: bool,
    pub error_code: Option<String>,
    pub text: Option<String>,
    pub output_sha256: Option<String>,
    pub segments: Option<Vec<AudioSegment>>,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u64,
    /// Measurement only (never persisted): child peak working set when observable.
    pub peak_working_set_bytes: Option<u64>,
}
impl AsrOutcome {
    pub fn failed(code: &str, exit_code: Option<i32>, elapsed_ms: u64) -> Self {
        Self {
            completed: false,
            error_code: Some(code.into()),
            exit_code,
            elapsed_ms,
            ..Self::default()
        }
    }
}
pub trait AsrEngine: Send + Sync {
    /// Pinned recognizer identity recorded with the request (manifest, not output).
    fn identity(&self) -> AsrIdentity;
    /// Nothing may launch when this fails (unsupported CPU, missing or altered
    /// pinned assets). Failures here are non-durable so a repaired install retries.
    fn preflight(&self) -> std::result::Result<(), String>;
    fn transcribe(&self, job: &AsrJob<'_>) -> AsrOutcome;
}

/// What an attempt ended as, for in-memory status of non-durable outcomes.
#[derive(Clone, Debug, PartialEq)]
pub enum AttemptEnd {
    Finished,
    /// Terminal for this process only; the next start retries (nothing launched).
    Unavailable(String),
}

fn utc_now() -> String {
    crate::local_vault::utc_now()
}

/// Run (or resume) the single recognizer attempt for a saved recording. Every
/// vault effect goes through the live selection guard, so a late result cannot
/// cross a vault switch; a launch with no recorded result stays `Unknown`.
pub fn run_asr_attempt(
    guard: &SelectionGuard,
    engine: &dyn AsrEngine,
    work_root: &Path,
    memory_id: &str,
) -> Result<AttemptEnd> {
    let identity = engine.identity();
    let begin = guard.with(|vault| vault.audio_asr_begin(memory_id, &identity))?;
    let request = begin.request;
    match begin.phase {
        AsrPhase::Committed | AsrPhase::Unknown | AsrPhase::Failed(_) => {
            return Ok(AttemptEnd::Finished)
        }
        AsrPhase::ResultReady => {
            guard.with(|vault| vault.audio_asr_commit(&request))?;
            return Ok(AttemptEnd::Finished);
        }
        AsrPhase::Fresh => {}
    }
    let derivative = begin
        .derivative
        .ok_or("Recognizer derivative is unavailable")?;
    if audio_wav::sha256_hex(&derivative) != request.derivative_sha256 {
        return Err("Recognizer derivative failed verification".into());
    }
    let now = utc_now();
    let result = if request.input_rms_pcm16 <= RMS_GATE {
        // F0: exact silence produced the hallucinated word "you". The zero gate
        // therefore never launches the recognizer; the original stays openable.
        AsrResult {
            schema_version: "1.0".into(),
            asr_operation_id: request.asr_operation_id.clone(),
            memory_id: memory_id.into(),
            source_sha256: request.source_sha256.clone(),
            derivative_sha256: request.derivative_sha256.clone(),
            state: "completed".into(),
            error_code: None,
            output_sha256: Some(audio_wav::sha256_hex(b"")),
            text: Some(String::new()),
            segments: None,
            gated_before_launch: true,
            exit_code: None,
            elapsed_ms: 0,
            completed_at: now,
        }
    } else {
        if let Err(code) = engine.preflight() {
            return Ok(AttemptEnd::Unavailable(code));
        }
        guard.active()?;
        // The private work directory exists before the dispatch marker is written, so a
        // staging failure can never leave a recording stuck as UNKNOWN.
        std::fs::create_dir_all(work_root).map_err(|e| e.to_string())?;
        let work_dir = work_root.join(&request.asr_operation_id);
        std::fs::create_dir(&work_dir).map_err(|e| e.to_string())?;
        if let Err(error) = guard.with(|vault| vault.audio_asr_mark_dispatched(&request)) {
            let _ = std::fs::remove_dir_all(&work_dir);
            return Err(error);
        }
        let outcome = engine.transcribe(&AsrJob {
            derivative_wav: &derivative,
            derivative_sha256: &request.derivative_sha256,
            duration_ms: request.duration_ms,
            work_dir: &work_dir,
        });
        let _ = std::fs::remove_dir_all(&work_dir);
        AsrResult {
            schema_version: "1.0".into(),
            asr_operation_id: request.asr_operation_id.clone(),
            memory_id: memory_id.into(),
            source_sha256: request.source_sha256.clone(),
            derivative_sha256: request.derivative_sha256.clone(),
            state: if outcome.completed {
                "completed"
            } else {
                "failed"
            }
            .into(),
            error_code: if outcome.completed {
                None
            } else {
                Some(
                    outcome
                        .error_code
                        .clone()
                        .unwrap_or_else(|| "asr_failed".into()),
                )
            },
            output_sha256: outcome.output_sha256.clone(),
            text: outcome.text.clone(),
            segments: outcome.segments.clone(),
            gated_before_launch: false,
            exit_code: outcome.exit_code,
            elapsed_ms: outcome.elapsed_ms,
            completed_at: utc_now(),
        }
    };
    guard.with(|vault| vault.audio_asr_record_result(&request, &result))?;
    if result.state == "completed" {
        guard.with(|vault| vault.audio_asr_commit(&request))?;
    }
    Ok(AttemptEnd::Finished)
}

#[cfg(test)]
#[path = "audio_asr_tests.rs"]
mod tests;

// ---------------------------------------------------------------------------
// Pinned runtime: manifest, asset verification, bounded no-shell launch
// ---------------------------------------------------------------------------

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File},
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MANIFEST_JSON: &str = include_str!("../voice-assets-manifest.json");
const MAX_STDOUT: usize = 64 * 1024;
const MAX_TRANSCRIPT_BYTES: usize = 32 * 1024;

#[derive(Clone, Debug, Deserialize)]
pub struct AssetFile {
    pub name: String,
    pub bytes: Option<u64>,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct RuntimeEntry {
    pub source_commit: String,
    pub binary: AssetFile,
    pub dlls: Vec<AssetFile>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct AssetManifest {
    pub runtime: RuntimeEntry,
    pub model: AssetFile,
}
/// The checked-in manifest is compiled in: pinned hashes cannot be swapped by
/// editing a file next to the installed binary, and nothing is downloaded.
pub fn pinned_manifest() -> AssetManifest {
    serde_json::from_str(MANIFEST_JSON).expect("voice-assets-manifest.json is valid")
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetLocations {
    pub sidecar: PathBuf,
    /// Directory holding the four runtime DLLs; also the sidecar's cwd and PATH.
    pub dll_dir: PathBuf,
    pub model: PathBuf,
}
fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
}
/// Resolve bundled assets relative to the installed app only, in the F0-proven
/// NSIS layout: the sidecar and its four DLLs together in the install root, and
/// the model under `resources/models` (see tauri.conf.json). The loader finds the
/// DLLs beside the sidecar, so the directory that is hash-verified is the
/// directory that is loaded from. No user-selected path ever reaches here.
pub fn locate_assets(
    manifest: &AssetManifest,
    exe_dir: &Path,
    resource_dir: Option<&Path>,
) -> std::result::Result<AssetLocations, String> {
    let sidecar = exe_dir.join("whisper-cli.exe");
    let mut models = vec![exe_dir
        .join("resources")
        .join("models")
        .join(&manifest.model.name)];
    if let Some(resources) = resource_dir {
        models.push(
            resources
                .join("resources")
                .join("models")
                .join(&manifest.model.name),
        );
    }
    let dlls_present = manifest
        .runtime
        .dlls
        .iter()
        .all(|dll| regular(&exe_dir.join(&dll.name)));
    let model = models.into_iter().find(|path| regular(path));
    match (regular(&sidecar), dlls_present, model) {
        (true, true, Some(model)) => Ok(AssetLocations {
            sidecar,
            dll_dir: exe_dir.to_path_buf(),
            model,
        }),
        _ => Err("asr_assets_missing".into()),
    }
}

fn hash_file(path: &Path, expected_bytes: Option<u64>) -> std::result::Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "asr_assets_missing".to_owned())?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("asr_assets_missing".into());
    }
    if expected_bytes.is_some_and(|bytes| bytes != meta.len()) {
        return Err("asr_hash_mismatch".into());
    }
    let mut file = File::open(path).map_err(|_| "asr_assets_missing".to_owned())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "asr_assets_missing".to_owned())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
/// Verify the sidecar, all four DLLs and the model against the pinned manifest.
/// Called before every launch; any difference is a failure, never "close enough".
pub fn verify_assets(
    manifest: &AssetManifest,
    locations: &AssetLocations,
) -> std::result::Result<(), String> {
    // The DLLs that get hashed must be the ones the loader picks up: beside the sidecar.
    if locations.sidecar.parent() != Some(locations.dll_dir.as_path()) {
        return Err("asr_assets_missing".into());
    }
    let mut checks: Vec<(PathBuf, &AssetFile)> = vec![
        (locations.sidecar.clone(), &manifest.runtime.binary),
        (locations.model.clone(), &manifest.model),
    ];
    for dll in &manifest.runtime.dlls {
        checks.push((locations.dll_dir.join(&dll.name), dll));
    }
    for (path, expected) in checks {
        if hash_file(&path, expected.bytes)? != expected.sha256 {
            return Err("asr_hash_mismatch".into());
        }
    }
    Ok(())
}

/// AVX2, FMA, F16C and BMI2: the CPU variant the pinned runtime was proven on.
pub fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::is_x86_feature_detected!("avx2")
            && std::is_x86_feature_detected!("fma")
            && std::is_x86_feature_detected!("f16c")
            && std::is_x86_feature_detected!("bmi2")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

#[derive(Debug)]
pub struct BoundedRun {
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub truncated: bool,
    pub timed_out: bool,
    pub elapsed: Duration,
    pub peak_working_set_bytes: Option<u64>,
}
#[cfg(windows)]
fn peak_working_set(child: &std::process::Child) -> Option<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    // SAFETY: the handle is the live child's; `counters` is a correctly sized out-parameter.
    let ok = unsafe { GetProcessMemoryInfo(child.as_raw_handle(), &mut counters, counters.cb) };
    (ok != 0).then_some(counters.PeakWorkingSetSize as u64)
}
#[cfg(not(windows))]
fn peak_working_set(_child: &std::process::Child) -> Option<u64> {
    None
}
/// Fixed program and argument vector (never a shell string), a scrubbed
/// environment, no stdin/stderr, a bounded stdout, a hard timeout, and a
/// kill-and-reap on expiry.
pub fn run_bounded(
    exe: &Path,
    args: &[OsString],
    cwd: &Path,
    path_dir: &Path,
    timeout: Duration,
    max_stdout: usize,
) -> std::io::Result<BoundedRun> {
    let mut command = Command::new(exe);
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .env("PATH", path_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in ["SystemRoot", "windir"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let started = Instant::now();
    let mut child = command.spawn()?;
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let reader = std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut truncated = false;
        let mut buffer = [0u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let room = max_stdout.saturating_sub(kept.len());
                    kept.extend_from_slice(&buffer[..n.min(room)]);
                    truncated |= n > room;
                }
            }
        }
        (kept, truncated)
    });
    let mut peak = None::<u64>;
    let mut timed_out = false;
    let exit_code = loop {
        if let Some(p) = peak_working_set(&child) {
            peak = Some(peak.map_or(p, |q| q.max(p)));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(error) => {
                // Never leave a live child behind on a wait error.
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(error);
            }
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait(); // reap
            break None;
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let (stdout, truncated) = reader.join().unwrap_or_default();
    Ok(BoundedRun {
        exit_code,
        stdout,
        truncated,
        timed_out,
        elapsed: started.elapsed(),
        peak_working_set_bytes: peak,
    })
}

/// Parse the F0-verified `-nt -np` stdout shape: plain transcript lines. Output
/// is untrusted text: UTF-8, no control characters, bounded, whitespace folded.
pub fn parse_output(stdout: &[u8]) -> std::result::Result<String, &'static str> {
    let text = std::str::from_utf8(stdout).map_err(|_| "asr_bad_output")?;
    if text.len() > MAX_TRANSCRIPT_BYTES
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("asr_bad_output");
    }
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" "))
}

type Locator = Box<dyn Fn() -> std::result::Result<AssetLocations, String> + Send + Sync>;
pub struct SidecarEngine {
    manifest: AssetManifest,
    locate: Locator,
    cpu_ok: Box<dyn Fn() -> bool + Send + Sync>,
}
impl SidecarEngine {
    pub fn new(
        manifest: AssetManifest,
        locate: Locator,
        cpu_ok: Box<dyn Fn() -> bool + Send + Sync>,
    ) -> Self {
        Self {
            manifest,
            locate,
            cpu_ok,
        }
    }
    /// Installed layout only; never a downloaded or user-selected binary.
    pub fn production(exe_dir: PathBuf, resource_dir: Option<PathBuf>) -> Self {
        let manifest = pinned_manifest();
        let for_locate = manifest.clone();
        Self::new(
            manifest,
            Box::new(move || locate_assets(&for_locate, &exe_dir, resource_dir.as_deref())),
            Box::new(cpu_supported),
        )
    }
    fn verified(&self) -> std::result::Result<AssetLocations, String> {
        let locations = (self.locate)()?;
        verify_assets(&self.manifest, &locations)?;
        Ok(locations)
    }
}
impl AsrEngine for SidecarEngine {
    fn identity(&self) -> AsrIdentity {
        AsrIdentity {
            runtime_source_commit: self.manifest.runtime.source_commit.clone(),
            runtime_binary_sha256: self.manifest.runtime.binary.sha256.clone(),
            model_sha256: self.manifest.model.sha256.clone(),
        }
    }
    fn preflight(&self) -> std::result::Result<(), String> {
        if !(self.cpu_ok)() {
            return Err("unsupported_cpu".into());
        }
        self.verified().map(|_| ())
    }
    fn transcribe(&self, job: &AsrJob<'_>) -> AsrOutcome {
        let started = Instant::now();
        let elapsed = || started.elapsed().as_millis() as u64;
        if !(self.cpu_ok)() {
            return AsrOutcome::failed("unsupported_cpu", None, 0);
        }
        // Hashes are verified again immediately before every launch.
        let locations = match self.verified() {
            Ok(l) => l,
            Err(code) => return AsrOutcome::failed(&code, None, elapsed()),
        };
        if hex::encode(Sha256::digest(job.derivative_wav)) != job.derivative_sha256 {
            return AsrOutcome::failed("asr_staging_failed", None, elapsed());
        }
        let input = job.work_dir.join("derivative.wav");
        let written = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&input)
            .and_then(|mut f| std::io::Write::write_all(&mut f, job.derivative_wav));
        if written.is_err() {
            return AsrOutcome::failed("asr_staging_failed", None, elapsed());
        }
        let args: Vec<OsString> = vec![
            "-m".into(),
            locations.model.clone().into(),
            "-f".into(),
            input.clone().into(),
            "-nt".into(),
            "-np".into(),
        ];
        let timeout = Duration::from_millis((job.duration_ms * 3).clamp(60_000, 600_000));
        let run = run_bounded(
            &locations.sidecar,
            &args,
            &locations.dll_dir,
            &locations.dll_dir,
            timeout,
            MAX_STDOUT,
        );
        let _ = fs::remove_file(&input);
        let run = match run {
            Ok(run) => run,
            Err(_) => return AsrOutcome::failed("asr_launch_failed", None, elapsed()),
        };
        let ms = run.elapsed.as_millis() as u64;
        if run.timed_out {
            return AsrOutcome::failed("asr_timeout", None, ms);
        }
        if run.exit_code != Some(0) {
            return AsrOutcome::failed("asr_exit_nonzero", run.exit_code, ms);
        }
        if run.truncated {
            return AsrOutcome::failed("asr_bad_output", run.exit_code, ms);
        }
        match parse_output(&run.stdout) {
            Ok(text) => AsrOutcome {
                completed: true,
                error_code: None,
                output_sha256: Some(hex::encode(Sha256::digest(&run.stdout))),
                text: Some(text),
                segments: None,
                exit_code: run.exit_code,
                elapsed_ms: ms,
                peak_working_set_bytes: run.peak_working_set_bytes,
            },
            Err(code) => AsrOutcome::failed(code, run.exit_code, ms),
        }
    }
}
