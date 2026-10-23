//! Native audio capture: a narrow Windows recorder (cpal behind a trait so tests
//! inject a fake device), private app-data staging with a durable intent, the
//! bounded writer, and the `vault_audio_*` command surface.
//!
//! Safety shape: one session at a time; the callback only queues frames to a
//! bounded writer (overflow or device loss stops capture with an explicit
//! failure, never a silent drop); 120 s / 24 MiB of PCM caps a clip and
//! auto-finalizes it; the immutable WAV and v9 `capture` event are committed
//! before any recognizer work; a crash leaves an unfinished draft that is
//! `recovery_required` and never silently resumed, discarded or transcribed.
use crate::audio_asr::{run_asr_attempt, AsrEngine, AttemptEnd};
use crate::audio_wav::{self, parse_wav, pcm_cap_bytes, wav_header, HEADER_LEN};
use crate::local_vault::{read_wav_import, LocalVaultState, SelectionGuard, VaultMemory};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const QUEUE_CHUNKS: usize = 256;
const SYNC_EVERY_SECONDS: usize = 1;

// ---------------------------------------------------------------------------
// Failure vocabulary
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AudioFailure {
    UnsupportedDevice,
    PermissionDenied,
    DeviceBusy,
    DeviceLost,
    QueueOverflow,
    CaptureGap,
    StageWrite,
    Other,
}
impl AudioFailure {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedDevice => "unsupported_device",
            Self::PermissionDenied => "permission_denied",
            Self::DeviceBusy => "device_busy",
            Self::DeviceLost => "device_lost",
            Self::QueueOverflow => "queue_overflow",
            Self::CaptureGap => "capture_gap",
            Self::StageWrite => "stage_write_failed",
            Self::Other => "capture_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureConfig {
    pub sample_rate_hz: u32,
    pub channels: u16,
}

// ---------------------------------------------------------------------------
// Device abstraction
// ---------------------------------------------------------------------------

/// The capture callback's only capability: queue frames or report a failure.
#[derive(Clone)]
pub struct SampleSink {
    tx: SyncSender<Vec<i16>>,
    failure: Arc<Mutex<Option<AudioFailure>>>,
}
impl SampleSink {
    pub fn push(&self, samples: Vec<i16>) {
        match self.tx.try_send(samples) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => self.fail(AudioFailure::QueueOverflow),
            Err(TrySendError::Disconnected(_)) => {}
        }
    }
    pub fn fail(&self, failure: AudioFailure) {
        if let Ok(mut slot) = self.failure.lock() {
            slot.get_or_insert(failure);
        }
    }
}
/// Dropping the handle stops the device and releases every sink clone.
pub trait CaptureHandle: Send {}
pub trait InputBackend: Send + Sync {
    fn open(
        &self,
        sink: SampleSink,
    ) -> std::result::Result<(CaptureConfig, Box<dyn CaptureHandle>), AudioFailure>;
}

/// Deterministic callback normalization to clipped, rounded PCM16.
pub fn f32_to_i16(x: f32) -> i16 {
    if x.is_nan() {
        0
    } else {
        (x * 32768.0).round().clamp(-32768.0, 32767.0) as i16
    }
}
pub fn u16_to_i16(x: u16) -> i16 {
    (x as i32 - 32768) as i16
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SampleKind {
    F32,
    I16,
    U16,
    Other,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfigOffer {
    pub channels: u16,
    pub min_rate: u32,
    pub max_rate: u32,
    pub kind: SampleKind,
}
const RATE_PREFERENCE: [u32; 4] = [16_000, 48_000, 44_100, 32_000];
fn acceptable(channels: u16, rate: u32, kind: SampleKind) -> bool {
    (1..=2).contains(&channels)
        && audio_wav::SUPPORTED_RATES.contains(&rate)
        && kind != SampleKind::Other
}
/// Prefer the device default (shared-mode mixers usually accept only it), else
/// the first advertised mono/stereo f32/i16/u16 format at a supported rate.
/// Unsupported devices yield `None` before any stream is opened.
pub fn choose_config(
    default: Option<(u16, u32, SampleKind)>,
    offers: &[ConfigOffer],
) -> Option<(u16, u32, SampleKind)> {
    if let Some((channels, rate, kind)) = default {
        if acceptable(channels, rate, kind) {
            return Some((channels, rate, kind));
        }
    }
    for offer in offers {
        for rate in RATE_PREFERENCE {
            if offer.min_rate <= rate
                && rate <= offer.max_rate
                && acceptable(offer.channels, rate, offer.kind)
            {
                return Some((offer.channels, rate, offer.kind));
            }
        }
    }
    None
}

#[cfg(windows)]
pub use windows_backend::CpalBackend;
#[cfg(not(windows))]
pub struct CpalBackend;
#[cfg(not(windows))]
impl InputBackend for CpalBackend {
    fn open(
        &self,
        _sink: SampleSink,
    ) -> std::result::Result<(CaptureConfig, Box<dyn CaptureHandle>), AudioFailure> {
        Err(AudioFailure::UnsupportedDevice)
    }
}

#[cfg(windows)]
mod windows_backend {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    pub struct CpalBackend;
    struct CpalHandle {
        stop: Option<mpsc::Sender<()>>,
        join: Option<JoinHandle<()>>,
    }
    impl CaptureHandle for CpalHandle {}
    impl Drop for CpalHandle {
        fn drop(&mut self) {
            drop(self.stop.take());
            if let Some(join) = self.join.take() {
                let _ = join.join();
            }
        }
    }
    fn open_failure(error: &cpal::Error) -> AudioFailure {
        match error.kind() {
            cpal::ErrorKind::PermissionDenied => AudioFailure::PermissionDenied,
            cpal::ErrorKind::DeviceBusy => AudioFailure::DeviceBusy,
            cpal::ErrorKind::DeviceNotAvailable => AudioFailure::DeviceLost,
            cpal::ErrorKind::UnsupportedConfig | cpal::ErrorKind::UnsupportedOperation => {
                AudioFailure::UnsupportedDevice
            }
            _ => AudioFailure::Other,
        }
    }
    fn kind_of(format: cpal::SampleFormat) -> SampleKind {
        match format {
            cpal::SampleFormat::F32 => SampleKind::F32,
            cpal::SampleFormat::I16 => SampleKind::I16,
            cpal::SampleFormat::U16 => SampleKind::U16,
            _ => SampleKind::Other,
        }
    }
    fn build(sink: SampleSink) -> std::result::Result<(cpal::Stream, CaptureConfig), AudioFailure> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or(AudioFailure::UnsupportedDevice)?;
        let offers: Vec<ConfigOffer> = device
            .supported_input_configs()
            .map_err(|e| open_failure(&e))?
            .map(|range| ConfigOffer {
                channels: range.channels(),
                min_rate: range.min_sample_rate(),
                max_rate: range.max_sample_rate(),
                kind: kind_of(range.sample_format()),
            })
            .collect();
        let default = device
            .default_input_config()
            .ok()
            .map(|c| (c.channels(), c.sample_rate(), kind_of(c.sample_format())));
        let (channels, rate, kind) =
            choose_config(default, &offers).ok_or(AudioFailure::UnsupportedDevice)?;
        let config = cpal::StreamConfig {
            channels,
            sample_rate: rate,
            buffer_size: cpal::BufferSize::Default,
        };
        let err_sink = sink.clone();
        let on_error = move |error: cpal::Error| {
            err_sink.fail(match error.kind() {
                cpal::ErrorKind::PermissionDenied => AudioFailure::PermissionDenied,
                cpal::ErrorKind::Xrun => AudioFailure::CaptureGap,
                _ => AudioFailure::DeviceLost,
            })
        };
        let stream = match kind {
            SampleKind::F32 => device.build_input_stream::<f32, _, _>(
                config,
                move |data, _| sink.push(data.iter().map(|x| f32_to_i16(*x)).collect()),
                on_error,
                None,
            ),
            SampleKind::I16 => device.build_input_stream::<i16, _, _>(
                config,
                move |data, _| sink.push(data.to_vec()),
                on_error,
                None,
            ),
            SampleKind::U16 => device.build_input_stream::<u16, _, _>(
                config,
                move |data, _| sink.push(data.iter().map(|x| u16_to_i16(*x)).collect()),
                on_error,
                None,
            ),
            SampleKind::Other => return Err(AudioFailure::UnsupportedDevice),
        }
        .map_err(|e| open_failure(&e))?;
        stream.play().map_err(|e| open_failure(&e))?;
        Ok((
            stream,
            CaptureConfig {
                sample_rate_hz: rate,
                channels,
            },
        ))
    }
    impl InputBackend for CpalBackend {
        fn open(
            &self,
            sink: SampleSink,
        ) -> std::result::Result<(CaptureConfig, Box<dyn CaptureHandle>), AudioFailure> {
            let (ready_tx, ready_rx) = mpsc::channel();
            let (stop_tx, stop_rx) = mpsc::channel::<()>();
            // The stream is created, kept and dropped on this one thread.
            let join = thread::Builder::new()
                .name("recall-audio-capture".into())
                .spawn(move || match build(sink) {
                    Ok((stream, config)) => {
                        let _ = ready_tx.send(Ok(config));
                        let _ = stop_rx.recv();
                        drop(stream);
                    }
                    Err(failure) => {
                        let _ = ready_tx.send(Err(failure));
                    }
                })
                .map_err(|_| AudioFailure::Other)?;
            let handle = CpalHandle {
                stop: Some(stop_tx),
                join: Some(join),
            };
            match ready_rx.recv_timeout(Duration::from_secs(15)) {
                Ok(Ok(config)) => Ok((config, Box::new(handle))),
                Ok(Err(failure)) => Err(failure),
                Err(_) => {
                    // Detach instead of joining: a stuck device open must not hang the
                    // caller (which holds the recorder mutex). The thread exits when its
                    // stop channel is dropped here.
                    let mut handle = handle;
                    drop(handle.join.take());
                    Err(AudioFailure::Other)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Private app-data stage
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StageIntent {
    schema_version: String,
    operation_id: String,
    vault_id: String,
    created_at: String,
    sample_rate_hz: u32,
    channels: u16,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StageFinal {
    schema_version: String,
    operation_id: String,
    sha256: String,
    bytes: u64,
    duration_ms: u64,
    limit_reason: Option<String>,
    finalized_at: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StageFailure {
    schema_version: String,
    error_code: String,
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}
fn read_small<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 64 * 1024 {
        return Err("Invalid audio stage metadata".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn canonical_uuid(value: &str) -> Result<()> {
    if Uuid::parse_str(value)
        .map_err(|e| e.to_string())?
        .to_string()
        != value
    {
        return Err("Invalid stable ID".into());
    }
    Ok(())
}
fn now() -> String {
    crate::local_vault::utc_now()
}

struct Stage {
    dir: PathBuf,
    intent: StageIntent,
}
impl Stage {
    fn part(&self) -> PathBuf {
        self.dir.join("capture.wav.part")
    }
    fn wav(&self) -> PathBuf {
        self.dir.join("capture.wav")
    }
    fn final_path(&self) -> PathBuf {
        self.dir.join("final.json")
    }
    fn failure_path(&self) -> PathBuf {
        self.dir.join("failure.json")
    }
    fn discarded_path(&self) -> PathBuf {
        self.dir.join("discarded.json")
    }
    fn create(
        root: &Path,
        vault_id: &str,
        operation_id: &str,
        cfg: CaptureConfig,
    ) -> Result<(Stage, File)> {
        canonical_uuid(operation_id)?;
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let dir = root.join(operation_id);
        // A directory left by a crash before any intent or audio became durable holds
        // nothing worth keeping; clear it so the ID is not permanently broken.
        if Stage::abandoned(&dir) {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        // create_dir fails when it exists: a duplicate ID never re-records.
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        Self::populate(&dir, operation_id, vault_id, cfg).inspect_err(|_| {
            // Only this call created the directory and no audio was written yet.
            let _ = fs::remove_dir_all(&dir);
        })
    }
    fn populate(
        dir: &Path,
        operation_id: &str,
        vault_id: &str,
        cfg: CaptureConfig,
    ) -> Result<(Stage, File)> {
        let dir = dir.to_path_buf();
        let intent = StageIntent {
            schema_version: "1.0".into(),
            operation_id: operation_id.into(),
            vault_id: vault_id.into(),
            created_at: now(),
            sample_rate_hz: cfg.sample_rate_hz,
            channels: cfg.channels,
        };
        write_new(
            &dir.join("intent.json"),
            &serde_json::to_vec(&intent).map_err(|e| e.to_string())?,
        )?;
        let stage = Stage { dir, intent };
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(stage.part())
            .map_err(|e| e.to_string())?;
        // Provisional header; the length is rewritten at finalize/recovery.
        file.write_all(&wav_header(cfg.sample_rate_hz, cfg.channels, 0))
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        Ok((stage, file))
    }
    /// A stage directory with at most an intent file and no audio: nothing durable.
    fn abandoned(dir: &Path) -> bool {
        let Ok(entries) = fs::read_dir(dir) else {
            return false;
        };
        let names: Vec<_> = entries.flatten().map(|e| e.file_name()).collect();
        names.iter().all(|n| n == "intent.json")
    }
    fn load(root: &Path, operation_id: &str) -> Result<Option<Stage>> {
        canonical_uuid(operation_id)?;
        let dir = root.join(operation_id);
        let meta = match fs::symlink_metadata(&dir) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Invalid audio stage".into());
        }
        if Stage::abandoned(&dir) {
            return Ok(None);
        }
        let intent: StageIntent = read_small(&dir.join("intent.json"))?;
        if intent.schema_version != "1.0"
            || intent.operation_id != operation_id
            || !audio_wav::SUPPORTED_RATES.contains(&intent.sample_rate_hz)
            || !(1..=2).contains(&intent.channels)
            || canonical_uuid(&intent.vault_id).is_err()
        {
            return Err("Audio stage identity is invalid; evidence preserved".into());
        }
        Ok(Some(Stage { dir, intent }))
    }
    fn record_failure(&self, code: &str) {
        let body = serde_json::to_vec(&StageFailure {
            schema_version: "1.0".into(),
            error_code: code.into(),
        })
        .unwrap_or_default();
        let _ = write_new(&self.failure_path(), &body);
    }
    fn failure_code(&self) -> Option<String> {
        read_small::<StageFailure>(&self.failure_path())
            .ok()
            .map(|f| f.error_code)
    }
    fn discarded(&self) -> bool {
        self.discarded_path().exists()
    }
    fn final_info(&self) -> Option<StageFinal> {
        read_small::<StageFinal>(&self.final_path()).ok()
    }
    fn header_matches(&self, header: &[u8]) -> bool {
        header.len() >= HEADER_LEN
            && header[..HEADER_LEN - 4]
                .iter()
                .zip(wav_header(self.intent.sample_rate_hz, self.intent.channels, 0).iter())
                .enumerate()
                // bytes 4..8 (RIFF length) hold the data length and may differ
                .all(|(i, (a, b))| (4..8).contains(&i) || a == b)
    }
    /// Idempotent: finalize an unfinished stage, or re-verify a finalized one.
    fn finalize(&self, limit_reason: Option<String>) -> Result<StageFinal> {
        if let Some(info) = self.final_info() {
            self.finalized_bytes()?;
            return Ok(info);
        }
        let block = self.intent.channels as usize * 2;
        if !self.part().exists() && !self.wav().exists() {
            return Err("No staged audio to finalize".into());
        }
        if self.part().exists() {
            if self.wav().exists() {
                return Err("Ambiguous audio stage; evidence preserved".into());
            }
            let mut file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(self.part())
                .map_err(|e| e.to_string())?;
            let len = file.metadata().map_err(|e| e.to_string())?.len() as usize;
            if len < HEADER_LEN {
                return Err("Staged audio is too short to verify".into());
            }
            let mut header = [0u8; HEADER_LEN];
            file.read_exact(&mut header).map_err(|e| e.to_string())?;
            if !self.header_matches(&header) {
                return Err("Staged audio format does not match its intent".into());
            }
            let cap = pcm_cap_bytes(self.intent.sample_rate_hz, self.intent.channels);
            let data = ((len - HEADER_LEN).min(cap)) / block * block;
            if data == 0 {
                return Err("empty_recording".into());
            }
            file.set_len((HEADER_LEN + data) as u64)
                .map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            file.write_all(&wav_header(
                self.intent.sample_rate_hz,
                self.intent.channels,
                data,
            ))
            .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(self.part(), self.wav()).map_err(|e| e.to_string())?;
        }
        let bytes = fs::read(self.wav()).map_err(|e| e.to_string())?;
        let info = parse_wav(&bytes)?;
        if info.sample_rate_hz != self.intent.sample_rate_hz
            || info.channels != self.intent.channels
        {
            return Err("Finalized audio does not match its intent".into());
        }
        let fin = StageFinal {
            schema_version: "1.0".into(),
            operation_id: self.intent.operation_id.clone(),
            sha256: audio_wav::sha256_hex(&bytes),
            bytes: bytes.len() as u64,
            duration_ms: info.duration_ms,
            limit_reason,
            finalized_at: now(),
        };
        write_new(
            &self.final_path(),
            &serde_json::to_vec(&fin).map_err(|e| e.to_string())?,
        )?;
        Ok(fin)
    }
    fn finalized_bytes(&self) -> Result<Vec<u8>> {
        let fin = self.final_info().ok_or("Audio stage is not finalized")?;
        let bytes = fs::read(self.wav()).map_err(|e| e.to_string())?;
        if bytes.len() as u64 != fin.bytes || audio_wav::sha256_hex(&bytes) != fin.sha256 {
            return Err("Finalized audio no longer matches its record; evidence preserved".into());
        }
        parse_wav(&bytes)?;
        Ok(bytes)
    }
    /// A stage is discardable only when it is fully verifiable.
    fn verify_for_discard(&self) -> Result<()> {
        if self.final_info().is_some() {
            return self.finalized_bytes().map(|_| ());
        }
        let mut header = [0u8; HEADER_LEN];
        let mut file = File::open(self.part()).map_err(|e| e.to_string())?;
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        if !self.header_matches(&header) {
            return Err("Staged audio could not be verified; it was preserved".into());
        }
        Ok(())
    }
    fn discard(&self) -> Result<()> {
        write_new(&self.discarded_path(), b"{\"schema_version\":\"1.0\"}")?;
        for path in [self.part(), self.wav()] {
            if path.exists() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    fn remove_audio_after_commit(&self) {
        let _ = fs::remove_file(self.wav());
        let _ = fs::remove_file(self.part());
    }
}

// ---------------------------------------------------------------------------
// Recording session (writer thread)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct SessionEnd {
    limit_reason: Option<String>,
    failure: Option<AudioFailure>,
    finalized: Option<StageFinal>,
    finalize_error: Option<String>,
}
struct SessionShared {
    stop: AtomicBool,
    result: Mutex<Option<SessionEnd>>,
}
struct Session {
    operation_id: String,
    vault_identity: String,
    config: CaptureConfig,
    shared: Arc<SessionShared>,
    join: Option<JoinHandle<()>>,
}
enum Reason {
    Stop,
    Limit(&'static str),
    Failure(AudioFailure),
}

fn pcm_bytes(samples: &[i16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

struct Writer {
    file: File,
    written: usize,
    since_sync: usize,
    sync_every: usize,
    cap: usize,
    block: usize,
    limit: &'static str,
}
impl Writer {
    /// Returns Ok(true) when the cap was reached (remaining frames dropped by the
    /// documented limit, not by a queue fault).
    fn append(&mut self, samples: &[i16]) -> std::io::Result<bool> {
        let bytes = pcm_bytes(samples);
        let room = self.cap - self.written;
        let take = bytes.len().min(room) / self.block * self.block;
        if take > 0 {
            self.file.write_all(&bytes[..take])?;
            self.written += take;
            self.since_sync += take;
            if self.since_sync >= self.sync_every {
                self.file.sync_data()?;
                self.since_sync = 0;
            }
        }
        Ok(take < bytes.len() || self.written >= self.cap)
    }
}

#[allow(clippy::too_many_arguments)]
fn run_session(
    rx: Receiver<Vec<i16>>,
    failure: Arc<Mutex<Option<AudioFailure>>>,
    handle: Box<dyn CaptureHandle>,
    file: File,
    stage: Stage,
    config: CaptureConfig,
    shared: Arc<SessionShared>,
    on_finish: Box<dyn FnOnce(SessionEnd) + Send>,
) {
    let block = config.channels as usize * 2;
    let duration_cap = config.sample_rate_hz as usize * audio_wav::MAX_SECONDS as usize * block;
    let mut writer = Writer {
        file,
        written: 0,
        since_sync: 0,
        sync_every: config.sample_rate_hz as usize * block * SYNC_EVERY_SECONDS,
        cap: pcm_cap_bytes(config.sample_rate_hz, config.channels),
        block,
        limit: if duration_cap <= audio_wav::MAX_PCM_BYTES {
            "duration_limit"
        } else {
            "byte_limit"
        },
    };
    let reason = loop {
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => match writer.append(&chunk) {
                Ok(true) => break Reason::Limit(writer.limit),
                Ok(false) => {}
                Err(_) => break Reason::Failure(AudioFailure::StageWrite),
            },
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                // Every sink vanished: the device ended unexpectedly unless Stop was asked.
                break if shared.stop.load(Ordering::SeqCst) {
                    Reason::Stop
                } else {
                    Reason::Failure(AudioFailure::DeviceLost)
                };
            }
        }
        if let Some(f) = failure.lock().ok().and_then(|g| g.clone()) {
            break Reason::Failure(f);
        }
        if shared.stop.load(Ordering::SeqCst) {
            break Reason::Stop;
        }
    };
    // Stop callbacks first so nothing keeps filling the queue behind the writer.
    drop(handle);
    let mut limit_reason = None;
    let mut failure_end = None;
    match reason {
        Reason::Failure(f) => {
            failure_end = Some(f);
        }
        Reason::Limit(r) => limit_reason = Some(r.to_owned()),
        Reason::Stop => {
            // Drain what the device had already queued, within the cap.
            while let Ok(chunk) = rx.try_recv() {
                match writer.append(&chunk) {
                    Ok(true) => {
                        limit_reason = Some(writer.limit.to_owned());
                        break;
                    }
                    Ok(false) => {}
                    Err(_) => {
                        failure_end = Some(AudioFailure::StageWrite);
                        break;
                    }
                }
            }
        }
    }
    let _ = writer.file.sync_all();
    drop(writer);
    let end = if let Some(f) = failure_end {
        stage.record_failure(f.code());
        SessionEnd {
            limit_reason: None,
            failure: Some(f),
            finalized: None,
            finalize_error: None,
        }
    } else {
        match stage.finalize(limit_reason.clone()) {
            Ok(fin) => SessionEnd {
                limit_reason,
                failure: None,
                finalized: Some(fin),
                finalize_error: None,
            },
            Err(e) => {
                stage.record_failure(if e == "empty_recording" {
                    "empty_recording"
                } else {
                    "finalize_failed"
                });
                SessionEnd {
                    limit_reason,
                    failure: None,
                    finalized: None,
                    finalize_error: Some(e),
                }
            }
        }
    };
    if let Ok(mut slot) = shared.result.lock() {
        *slot = Some(end.clone());
    }
    on_finish(end);
}

// ---------------------------------------------------------------------------
// Public state and status
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
pub struct AudioOperationStatus {
    pub schema_version: String,
    pub operation_id: String,
    pub vault_id: String,
    pub state: String,
    pub memory: Option<VaultMemory>,
    pub error_code: Option<String>,
    pub limit_reason: Option<String>,
    pub source_sample_rate_hz: Option<u32>,
    pub source_channels: Option<u16>,
}

#[derive(Default)]
struct Inner {
    session: Option<Session>,
    asr_inflight: BTreeSet<String>,
    asr_unavailable: BTreeMap<String, String>,
    /// Start failures before any stage existed (bounded), so status agrees with start.
    start_failures: BTreeMap<String, String>,
}
struct Core {
    stage_root: PathBuf,
    backend: Arc<dyn InputBackend>,
    engine: Arc<dyn AsrEngine>,
    inner: Mutex<Inner>,
    /// Called after a transcript or correction commits, so audio organization can queue.
    transcript_hook: Mutex<Option<TranscriptHook>>,
}
pub type TranscriptHook = Arc<dyn Fn(SelectionGuard) + Send + Sync>;
#[derive(Clone)]
pub struct AudioState(Arc<Core>);

struct InflightGuard {
    core: Arc<Core>,
    memory_id: String,
}
impl Drop for InflightGuard {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.core.inner.lock() {
            inner.asr_inflight.remove(&self.memory_id);
        }
    }
}

impl AudioState {
    pub fn new(
        stage_root: PathBuf,
        backend: Arc<dyn InputBackend>,
        engine: Arc<dyn AsrEngine>,
    ) -> Self {
        Self(Arc::new(Core {
            stage_root,
            backend,
            engine,
            inner: Mutex::new(Inner::default()),
            transcript_hook: Mutex::new(None),
        }))
    }
    pub fn set_transcript_hook(&self, hook: TranscriptHook) {
        if let Ok(mut slot) = self.0.transcript_hook.lock() {
            *slot = Some(hook);
        }
    }
    fn notify_transcript(core: &Core, guard: &SelectionGuard) {
        let hook = core
            .transcript_hook
            .lock()
            .ok()
            .and_then(|slot| slot.clone());
        if let Some(hook) = hook {
            hook(guard.clone());
        }
    }
    /// True while a clip is being recorded or committed. Vault selection is
    /// refused meanwhile so a recording can never be redirected to another vault.
    #[cfg(test)]
    pub fn is_busy(&self) -> bool {
        self.0
            .inner
            .lock()
            .map(|i| i.session.is_some())
            .unwrap_or(true)
    }
    /// Vault selection (including re-selecting the same vault) is refused while a
    /// recording is live or being saved, or any transcription is in flight, so a
    /// late result can never cross a vault switch.
    pub fn ensure_idle(&self) -> Result<()> {
        let inner = self.0.inner.lock().map_err(|e| e.to_string())?;
        if inner.session.is_some() {
            return Err("Stop or save the current recording before switching vaults".into());
        }
        if !inner.asr_inflight.is_empty() {
            return Err(
                "Transcription in progress: wait for it to finish before switching vaults".into(),
            );
        }
        Ok(())
    }
    fn status(
        &self,
        vault_id: &str,
        op: &str,
        state: &str,
        memory: Option<VaultMemory>,
        error: Option<&str>,
        limit: Option<String>,
        rate_channels: Option<(u32, u16)>,
    ) -> AudioOperationStatus {
        let from_memory = memory
            .as_ref()
            .and_then(|m| m.audio_source.as_ref())
            .map(|s| (s.sample_rate_hz, s.channels));
        let rc = from_memory.or(rate_channels);
        AudioOperationStatus {
            schema_version: "1.0".into(),
            operation_id: op.into(),
            vault_id: vault_id.into(),
            state: state.into(),
            memory,
            error_code: error.map(str::to_owned),
            limit_reason: limit,
            source_sample_rate_hz: rc.map(|v| v.0),
            source_channels: rc.map(|v| v.1),
        }
    }

    /// Never starts or retries work. The caller already validated the selection
    /// token (`LocalVaultState::session`) before any state below is touched.
    pub fn status_of(&self, guard: &SelectionGuard, op: &str) -> Result<AudioOperationStatus> {
        canonical_uuid(op)?;
        let vault_id = guard.vault.id.clone();
        // A committed receipt is authoritative: a damaged stage directory cannot hide it.
        if let Some(memory) = guard.with(|v| v.audio_capture_receipt(op))? {
            let stage = Stage::load(&self.0.stage_root, op).ok().flatten();
            if stage
                .as_ref()
                .is_some_and(|s| s.intent.vault_id != vault_id)
            {
                return Err("This audio operation belongs to a different vault".into());
            }
            let limit = stage
                .as_ref()
                .and_then(|s| s.final_info())
                .and_then(|f| f.limit_reason);
            return self.saved_status(guard, memory, limit);
        }
        let stage = Stage::load(&self.0.stage_root, op)?;
        if let Some(stage) = &stage {
            if stage.intent.vault_id != vault_id {
                return Err("This audio operation belongs to a different vault".into());
            }
        }
        let Some(stage) = stage else {
            let failed = self
                .0
                .inner
                .lock()
                .map_err(|e| e.to_string())?
                .start_failures
                .get(op)
                .cloned();
            return match failed {
                Some(code) => {
                    Ok(self.status(&vault_id, op, "failed", None, Some(&code), None, None))
                }
                None => Err("Unknown audio operation".into()),
            };
        };
        let rc = Some((stage.intent.sample_rate_hz, stage.intent.channels));
        if stage.discarded() {
            // An empty recording was reported as failed by Stop; keep status consistent.
            if stage.failure_code().as_deref() == Some("empty_recording") {
                return Ok(self.status(
                    &vault_id,
                    op,
                    "failed",
                    None,
                    Some("empty_recording"),
                    None,
                    rc,
                ));
            }
            return Ok(self.status(&vault_id, op, "discarded", None, None, None, rc));
        }
        let live = {
            let inner = self.0.inner.lock().map_err(|e| e.to_string())?;
            inner
                .session
                .as_ref()
                .filter(|s| s.operation_id == op && s.vault_identity == vault_id)
                .map(|s| s.shared.clone())
        };
        if let Some(shared) = live {
            let limit = shared
                .result
                .lock()
                .ok()
                .and_then(|r| r.as_ref().and_then(|e| e.limit_reason.clone()));
            return Ok(self.status(&vault_id, op, "recording", None, None, limit, rc));
        }
        Ok(self.status(
            &vault_id,
            op,
            "recovery_required",
            None,
            stage
                .failure_code()
                .as_deref()
                .or(Some("unfinished_recording")),
            stage.final_info().and_then(|f| f.limit_reason),
            rc,
        ))
    }
    fn saved_status(
        &self,
        guard: &SelectionGuard,
        memory: VaultMemory,
        limit: Option<String>,
    ) -> Result<AudioOperationStatus> {
        use crate::local_vault::AsrPhase;
        let vault_id = guard.vault.id.clone();
        let op = memory.id.clone();
        let asr = guard.with(|v| v.audio_asr_state(&memory.id))?;
        let (inflight, unavailable) = {
            let inner = self.0.inner.lock().map_err(|e| e.to_string())?;
            (
                inner.asr_inflight.contains(&memory.id),
                inner.asr_unavailable.get(&memory.id).cloned(),
            )
        };
        if let Some(t) = memory.audio_transcript.as_ref() {
            if t.human_correction.is_some() || t.machine.eligibility == "eligible" {
                return Ok(self.status(
                    &vault_id,
                    &op,
                    "transcribed",
                    Some(memory),
                    None,
                    limit,
                    None,
                ));
            }
            let code = t
                .machine
                .quality_flags
                .first()
                .cloned()
                .unwrap_or_else(|| "no_usable_transcript".into());
            return Ok(self.status(
                &vault_id,
                &op,
                "transcription_unavailable",
                Some(memory),
                Some(&code),
                limit,
                None,
            ));
        }
        let (state, code): (&str, Option<String>) = match asr {
            Some((_, AsrPhase::Failed(code))) => ("transcription_unavailable", Some(code)),
            Some((_, AsrPhase::Unknown)) if !inflight => {
                ("unknown", Some("asr_outcome_unknown".into()))
            }
            Some((_, AsrPhase::Unknown)) | Some((_, AsrPhase::ResultReady)) => {
                ("transcription_processing", None)
            }
            _ if inflight => ("transcription_processing", None),
            _ => match unavailable {
                Some(code) => ("transcription_unavailable", Some(code)),
                None => ("saved_local", None),
            },
        };
        Ok(self.status(
            &vault_id,
            &op,
            state,
            Some(memory),
            code.as_deref(),
            limit,
            None,
        ))
    }

    pub fn start(&self, guard: &SelectionGuard, op: &str) -> Result<AudioOperationStatus> {
        canonical_uuid(op)?;
        // A duplicate ID returns the existing receipt or stage; it never re-records.
        if guard.with(|v| v.audio_capture_receipt(op))?.is_some()
            || Stage::load(&self.0.stage_root, op)?.is_some()
        {
            return self.status_of(guard, op);
        }
        // Create the session while the selection mutex is held (selection -> recorder
        // lock order, as in `select_path_if`), so a vault switch cannot slip in between
        // validation and session creation.
        guard.with(|_| self.start_locked(guard, op))
    }
    fn start_locked(&self, guard: &SelectionGuard, op: &str) -> Result<AudioOperationStatus> {
        let vault_id = guard.vault.id.clone();
        let mut inner = self.0.inner.lock().map_err(|e| e.to_string())?;
        if inner.session.is_some() {
            return Err("A recording is already in progress".into());
        }
        let (tx, rx) = mpsc::sync_channel(QUEUE_CHUNKS);
        let failure = Arc::new(Mutex::new(None));
        let sink = SampleSink {
            tx,
            failure: failure.clone(),
        };
        let (config, handle) = match self.0.backend.open(sink) {
            Ok(opened) => opened,
            Err(f) => {
                if inner.start_failures.len() >= 32 {
                    inner.start_failures.clear();
                }
                inner
                    .start_failures
                    .insert(op.to_owned(), f.code().to_owned());
                return Ok(self.status(&vault_id, op, "failed", None, Some(f.code()), None, None));
            }
        };
        let (stage, file) = match Stage::create(&self.0.stage_root, &vault_id, op, config) {
            Ok(created) => created,
            Err(e) => {
                drop(handle);
                return Err(e);
            }
        };
        let shared = Arc::new(SessionShared {
            stop: AtomicBool::new(false),
            result: Mutex::new(None),
        });
        let auto = {
            let state = self.clone();
            let guard = guard.clone();
            let op = op.to_owned();
            Box::new(move |end: SessionEnd| {
                if end.limit_reason.is_some() && end.finalized.is_some() {
                    // Automatic stop: commit on a detached thread. This thread never
                    // takes the selection mutex, because a Stop command may be
                    // holding it while joining this writer.
                    let _ = thread::Builder::new()
                        .name("recall-audio-commit".into())
                        .spawn(move || {
                            let _ = state.complete_session(&guard, &op, end);
                        });
                } else if end.failure.is_some() || end.finalized.is_none() {
                    // A failed or empty session releases the recorder at once; its
                    // stage stays on disk as an explicit recovery_required draft.
                    state.release_session(&op);
                }
            }) as Box<dyn FnOnce(SessionEnd) + Send>
        };
        let join = thread::Builder::new()
            .name("recall-audio-writer".into())
            .spawn({
                let shared = shared.clone();
                move || run_session(rx, failure, handle, file, stage, config, shared, auto)
            })
            .map_err(|e| e.to_string())?;
        inner.session = Some(Session {
            operation_id: op.to_owned(),
            vault_identity: vault_id.clone(),
            config,
            shared,
            join: Some(join),
        });
        Ok(self.status(
            &vault_id,
            op,
            "recording",
            None,
            None,
            None,
            Some((config.sample_rate_hz, config.channels)),
        ))
    }

    pub fn stop(&self, guard: &SelectionGuard, op: &str) -> Result<AudioOperationStatus> {
        canonical_uuid(op)?;
        let vault_id = guard.vault.id.clone();
        let live = {
            let mut inner = self.0.inner.lock().map_err(|e| e.to_string())?;
            match inner.session.as_mut().filter(|s| s.operation_id == op) {
                Some(s) if s.vault_identity != vault_id => {
                    return Err("The recording belongs to a different vault".into())
                }
                Some(s) => Some((s.shared.clone(), s.join.take())),
                None => None,
            }
        };
        let Some((shared, join)) = live else {
            // Lost acknowledgement or already finished: return the durable state.
            if let Some(memory) = guard.with(|v| v.audio_capture_receipt(op))? {
                self.schedule_asr(guard, &memory.id);
            }
            return self.status_of(guard, op);
        };
        shared.stop.store(true, Ordering::SeqCst);
        if let Some(join) = join {
            let _ = join.join();
        }
        let started = Instant::now();
        let end = loop {
            if let Some(end) = shared.result.lock().map_err(|e| e.to_string())?.clone() {
                break end;
            }
            if started.elapsed() > Duration::from_secs(30) {
                return Err("The recording did not finish in time".into());
            }
            thread::sleep(Duration::from_millis(10));
        };
        self.complete_session(guard, op, end)
    }

    /// Commit (or record the failure of) a finished session. Idempotent: the
    /// vault receipt makes a second call (Stop racing an automatic stop) a no-op.
    fn complete_session(
        &self,
        guard: &SelectionGuard,
        op: &str,
        end: SessionEnd,
    ) -> Result<AudioOperationStatus> {
        let vault_id = guard.vault.id.clone();
        let clear = || {
            if let Ok(mut inner) = self.0.inner.lock() {
                if inner.session.as_ref().is_some_and(|s| s.operation_id == op) {
                    inner.session = None;
                }
            }
        };
        let rc = {
            let inner = self.0.inner.lock().map_err(|e| e.to_string())?;
            inner
                .session
                .as_ref()
                .filter(|s| s.operation_id == op)
                .map(|s| (s.config.sample_rate_hz, s.config.channels))
        };
        if let Some(failure) = end.failure {
            clear();
            return Ok(self.status(
                &vault_id,
                op,
                "recovery_required",
                None,
                Some(failure.code()),
                None,
                rc,
            ));
        }
        if end.finalized.is_none() {
            clear();
            let reason = end
                .finalize_error
                .unwrap_or_else(|| "finalize_failed".into());
            if reason == "empty_recording" {
                if let Ok(Some(stage)) = Stage::load(&self.0.stage_root, op) {
                    let _ = stage.discard();
                }
                return Ok(self.status(
                    &vault_id,
                    op,
                    "failed",
                    None,
                    Some("empty_recording"),
                    None,
                    rc,
                ));
            }
            return Ok(self.status(
                &vault_id,
                op,
                "recovery_required",
                None,
                Some("finalize_failed"),
                None,
                rc,
            ));
        }
        let result = self.commit_stage(guard, op);
        clear();
        result
    }
    fn release_session(&self, op: &str) {
        if let Ok(mut inner) = self.0.inner.lock() {
            if inner.session.as_ref().is_some_and(|s| s.operation_id == op) {
                inner.session = None;
            }
        }
    }
    fn receipt_is_this_recording(memory: &VaultMemory, stage: &Stage) -> bool {
        memory.audio_source.as_ref().is_some_and(|source| {
            source.capture_origin == "recorded"
                && stage
                    .final_info()
                    .is_some_and(|fin| fin.sha256 == source.source_sha256)
        })
    }
    fn commit_stage(&self, guard: &SelectionGuard, op: &str) -> Result<AudioOperationStatus> {
        let vault_id = guard.vault.id.clone();
        let stage = Stage::load(&self.0.stage_root, op)?.ok_or("Unknown audio operation")?;
        // An existing receipt only counts when it is this very recording.
        if let Some(memory) = guard.with(|v| v.audio_capture_receipt(op))? {
            if !Self::receipt_is_this_recording(&memory, &stage) {
                return Err(
                    "Operation ID already belongs to a different saved recording; nothing was changed"
                        .into(),
                );
            }
            self.schedule_asr(guard, &memory.id);
            return self.status_of(guard, op);
        }
        let bytes = stage.finalized_bytes();
        let committed = bytes
            .and_then(|bytes| guard.with(|v| v.audio_commit_capture(op, &bytes, "recorded", None)));
        match committed {
            Ok(memory) => {
                stage.remove_audio_after_commit();
                let limit = stage.final_info().and_then(|f| f.limit_reason);
                // Report the saved-local receipt first; only then launch the one ASR attempt.
                let status = self.saved_status(guard, memory.clone(), limit)?;
                self.schedule_asr(guard, &memory.id);
                Ok(status)
            }
            Err(_) => {
                // A concurrent Stop/automatic stop may already have committed (and removed
                // the staged copy): re-check the receipt before reporting a failure.
                if let Ok(Some(memory)) = guard.with(|v| v.audio_capture_receipt(op)) {
                    if Self::receipt_is_this_recording(&memory, &stage) {
                        self.schedule_asr(guard, &memory.id);
                        return self.status_of(guard, op);
                    }
                }
                stage.record_failure("commit_failed");
                Ok(self.status(
                    &vault_id,
                    op,
                    "recovery_required",
                    None,
                    Some("commit_failed"),
                    stage.final_info().and_then(|f| f.limit_reason),
                    Some((stage.intent.sample_rate_hz, stage.intent.channels)),
                ))
            }
        }
    }

    pub fn recover(
        &self,
        guard: &SelectionGuard,
        op: &str,
        action: &str,
    ) -> Result<AudioOperationStatus> {
        canonical_uuid(op)?;
        if !["save", "discard"].contains(&action) {
            return Err("Recovery action must be save or discard".into());
        }
        let vault_id = guard.vault.id.clone();
        let stage = Stage::load(&self.0.stage_root, op)?;
        if let Some(stage) = &stage {
            if stage.intent.vault_id != vault_id {
                return Err("This audio operation belongs to a different vault".into());
            }
        }
        if self
            .0
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .session
            .as_ref()
            .is_some_and(|s| s.operation_id == op)
        {
            return Err("The recording is still in progress".into());
        }
        if let Some(memory) = guard.with(|v| v.audio_capture_receipt(op))? {
            if action == "discard" {
                return Err("A saved recording cannot be discarded".into());
            }
            self.schedule_asr(guard, &memory.id);
            return self.status_of(guard, op);
        }
        let stage = stage.ok_or("Unknown audio operation")?;
        if stage.discarded() {
            return if action == "discard" {
                self.status_of(guard, op)
            } else {
                Err("This draft was discarded".into())
            };
        }
        if action == "save" {
            stage.finalize(None)?;
            // A recorded failure marker described the interrupted session only.
            return self.commit_stage(guard, op);
        }
        // Discard: only a fully verified, uncommitted stage with no published source.
        if guard.with(|v| v.audio_source_published(op))? {
            return Err("The saved source state is ambiguous; nothing was discarded".into());
        }
        stage.verify_for_discard()?;
        stage.discard()?;
        self.status_of(guard, op)
    }

    pub fn correct(
        &self,
        guard: &SelectionGuard,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        text: &str,
    ) -> Result<VaultMemory> {
        let saved =
            guard.with(|v| v.audio_correct(memory_id, expected_revision, operation_id, text))?;
        Self::notify_transcript(&self.0, guard);
        Ok(saved)
    }

    /// Optional WAV import through the same commit path as a recording.
    pub fn import_wav(
        &self,
        guard: &SelectionGuard,
        op: &str,
        pick: impl FnOnce() -> Option<PathBuf>,
    ) -> Result<Option<VaultMemory>> {
        canonical_uuid(op)?;
        // An ID that has a recording stage belongs to the recorder, never to an import.
        if Stage::load(&self.0.stage_root, op)?.is_some() {
            return Err("Operation ID belongs to a recording; use a new ID to import".into());
        }
        if let Some(saved) = guard.with(|v| v.audio_capture_receipt(op))? {
            self.schedule_asr(guard, &saved.id);
            return Ok(Some(saved));
        }
        guard.active()?;
        let Some(path) = pick() else {
            return Ok(None);
        };
        let (name, bytes) = read_wav_import(&path)?;
        let saved =
            guard.with(|v| v.audio_commit_capture(op, &bytes, "imported_wav", Some(&name)))?;
        self.schedule_asr(guard, &saved.id);
        Ok(Some(saved))
    }

    /// Start the single recognizer attempt for a saved recording (idempotent).
    pub fn schedule_asr(&self, guard: &SelectionGuard, memory_id: &str) {
        {
            let Ok(mut inner) = self.0.inner.lock() else {
                return;
            };
            if !inner.asr_inflight.insert(memory_id.to_owned()) {
                return;
            }
            inner.asr_unavailable.remove(memory_id);
        }
        let core = self.0.clone();
        let guard = guard.clone();
        let memory_id = memory_id.to_owned();
        let spawned = thread::Builder::new().name("recall-asr".into()).spawn({
            let core = core.clone();
            let memory_id = memory_id.clone();
            move || {
                let _clear = InflightGuard {
                    core: core.clone(),
                    memory_id: memory_id.clone(),
                };
                let end = run_asr_attempt(
                    &guard,
                    core.engine.as_ref(),
                    &core.stage_root.join("asr"),
                    &memory_id,
                );
                if matches!(end, Ok(AttemptEnd::Finished)) {
                    AudioState::notify_transcript(&core, &guard);
                }
                let unavailable = match end {
                    Ok(AttemptEnd::Unavailable(code)) => Some(code),
                    Ok(AttemptEnd::Finished) => None,
                    Err(_) => Some("asr_error".to_owned()),
                };
                if let Some(code) = unavailable {
                    let slot = core.inner.lock();
                    if let Ok(mut inner) = slot {
                        inner.asr_unavailable.insert(memory_id.clone(), code);
                    }
                }
                // Dropped last and explicitly: it re-locks `inner`, so no guard may
                // outlive this point (a tail-expression temporary would deadlock).
                drop(_clear);
            }
        });
        if spawned.is_err() {
            if let Ok(mut inner) = core.inner.lock() {
                inner.asr_inflight.remove(&memory_id);
            }
        }
    }
    /// Resume recordings saved earlier whose recognizer never launched. A launch
    /// without a recorded result is excluded: it stays UNKNOWN, never rerun.
    pub fn resume_pending(&self, guard: &SelectionGuard) {
        if let Ok(pending) = guard.with(|v| v.audio_pending_asr()) {
            for memory_id in pending {
                self.schedule_asr(guard, &memory_id);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn vault_audio_start(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<AudioOperationStatus> {
    let guard = state.session(&expected_vault_id)?;
    audio.start(&guard, &operation_id)
}
#[tauri::command(async)]
pub fn vault_audio_stop(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<AudioOperationStatus> {
    let guard = state.session(&expected_vault_id)?;
    audio.stop(&guard, &operation_id)
}
#[tauri::command]
pub fn vault_audio_status(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<AudioOperationStatus> {
    let guard = state.session(&expected_vault_id)?;
    audio.status_of(&guard, &operation_id)
}
#[tauri::command(async)]
pub fn vault_audio_recover(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    operation_id: String,
    action: String,
) -> Result<AudioOperationStatus> {
    let guard = state.session(&expected_vault_id)?;
    audio.recover(&guard, &operation_id, &action)
}
#[tauri::command]
pub fn vault_audio_correct(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
    text: String,
) -> Result<VaultMemory> {
    let guard = state.session(&expected_vault_id)?;
    audio.correct(&guard, &memory_id, expected_revision, &operation_id, &text)
}
#[tauri::command(async)]
pub fn vault_import_wav(
    state: tauri::State<'_, LocalVaultState>,
    audio: tauri::State<'_, AudioState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<Option<VaultMemory>> {
    let guard = state.session(&expected_vault_id)?;
    audio.import_wav(&guard, &operation_id, || {
        rfd::FileDialog::new()
            .set_title("Import one WAV recording")
            .add_filter("WAV audio", &["wav"])
            .pick_file()
    })
}

#[cfg(test)]
#[path = "local_audio_tests.rs"]
mod tests;
