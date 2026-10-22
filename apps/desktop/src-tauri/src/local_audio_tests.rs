//! Recorder, staging, recovery and orchestration tests. No real microphone and no
//! real or private audio: a fake device feeds deterministic synthetic samples.
use super::*;
use crate::audio_asr::{AsrEngine, AsrJob, AsrOutcome};
use crate::audio_wav::fixtures::{synthetic_pcm, synthetic_wav};
use crate::local_vault::AsrIdentity;
use std::sync::atomic::AtomicUsize;

fn op() -> String {
    Uuid::new_v4().to_string()
}
fn samples(pcm: &[u8]) -> Vec<i16> {
    pcm.chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect()
}

// ----- fake device -------------------------------------------------------

type Script = Box<dyn FnOnce(SampleSink, Arc<AtomicBool>) + Send>;
struct FakeBackend {
    config: CaptureConfig,
    script: Mutex<Option<Script>>,
    fail_open: Option<AudioFailure>,
    opens: AtomicUsize,
}
struct FakeHandle {
    stopped: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}
impl CaptureHandle for FakeHandle {}
impl Drop for FakeHandle {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}
impl InputBackend for FakeBackend {
    fn open(
        &self,
        sink: SampleSink,
    ) -> std::result::Result<(CaptureConfig, Box<dyn CaptureHandle>), AudioFailure> {
        self.opens.fetch_add(1, Ordering::SeqCst);
        if let Some(failure) = self.fail_open.clone() {
            return Err(failure);
        }
        let stopped = Arc::new(AtomicBool::new(false));
        let script = self.script.lock().unwrap().take();
        let flag = stopped.clone();
        let join = thread::spawn(move || {
            if let Some(script) = script {
                script(sink.clone(), flag.clone());
            }
            // Like a live stream, keep the sink alive until the handle drops.
            while !flag.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
            drop(sink);
        });
        Ok((
            self.config,
            Box::new(FakeHandle {
                stopped,
                join: Some(join),
            }),
        ))
    }
}
fn backend(
    config: CaptureConfig,
    script: impl FnOnce(SampleSink, Arc<AtomicBool>) + Send + 'static,
) -> Arc<FakeBackend> {
    Arc::new(FakeBackend {
        config,
        script: Mutex::new(Some(Box::new(script))),
        fail_open: None,
        opens: AtomicUsize::new(0),
    })
}
const MONO_16K: CaptureConfig = CaptureConfig {
    sample_rate_hz: 16_000,
    channels: 1,
};

/// Throttled like a real device: 3200-frame chunks with a short pause so the
/// bounded queue is never overrun by the test harness itself.
fn feed(sink: &SampleSink, stopped: &AtomicBool, pcm: &[u8], channels: usize, chunk_frames: usize) {
    for chunk in samples(pcm).chunks(chunk_frames * channels) {
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        sink.push(chunk.to_vec());
        thread::sleep(Duration::from_micros(300));
    }
}

// ----- fake recognizer ----------------------------------------------------

#[derive(Clone)]
enum Mode {
    Text(String),
    Fail(&'static str),
    Panic,
    PreflightFail(&'static str),
}
struct FakeEngine {
    mode: Mode,
    calls: AtomicUsize,
    saved_first: Box<dyn Fn() -> bool + Send + Sync>,
    saw_saved: AtomicBool,
}
impl FakeEngine {
    fn new(mode: Mode, saved_first: impl Fn() -> bool + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            mode,
            calls: AtomicUsize::new(0),
            saved_first: Box::new(saved_first),
            saw_saved: AtomicBool::new(false),
        })
    }
}
impl AsrEngine for FakeEngine {
    fn identity(&self) -> AsrIdentity {
        AsrIdentity {
            runtime_source_commit: "d".repeat(40),
            runtime_binary_sha256: "a".repeat(64),
            model_sha256: "b".repeat(64),
        }
    }
    fn preflight(&self) -> std::result::Result<(), String> {
        match &self.mode {
            Mode::PreflightFail(code) => Err((*code).into()),
            _ => Ok(()),
        }
    }
    fn transcribe(&self, job: &AsrJob<'_>) -> AsrOutcome {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if (self.saved_first)() {
            self.saw_saved.store(true, Ordering::SeqCst);
        }
        // The recognizer only ever receives the verified derivative in private staging.
        assert_eq!(
            audio_wav::sha256_hex(job.derivative_wav),
            job.derivative_sha256
        );
        assert!(job.work_dir.is_dir());
        match &self.mode {
            Mode::Text(text) => AsrOutcome {
                completed: true,
                text: Some(text.clone()),
                output_sha256: Some(audio_wav::sha256_hex(text.as_bytes())),
                exit_code: Some(0),
                elapsed_ms: 7,
                ..AsrOutcome::default()
            },
            Mode::Fail(code) => AsrOutcome::failed(code, Some(1), 3),
            Mode::Panic => panic!("simulated lost reply"),
            Mode::PreflightFail(_) => unreachable!(),
        }
    }
}

// ----- environment ---------------------------------------------------------

struct Env {
    dir: PathBuf,
    root: PathBuf,
    state: LocalVaultState,
    token: String,
}
impl Env {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("recall-synthetic-rec-{}", Uuid::new_v4()));
        let root = dir.join("vault");
        fs::create_dir_all(&root).unwrap();
        let state = LocalVaultState::new(dir.join("selected-vault.json"));
        let token = state.select_path(&root).unwrap().vault_id.unwrap();
        Self {
            dir,
            root,
            state,
            token,
        }
    }
    fn guard(&self) -> SelectionGuard {
        self.state.session(&self.token).unwrap()
    }
    fn stage_root(&self) -> PathBuf {
        self.dir.join("audio-stage")
    }
    fn audio(&self, backend: Arc<FakeBackend>, engine: Arc<FakeEngine>) -> AudioState {
        AudioState::new(self.stage_root(), backend, engine)
    }
    fn engine(&self, mode: Mode) -> Arc<FakeEngine> {
        let root = self.root.clone();
        FakeEngine::new(mode, move || {
            let sources = root.join("Recall/Sources");
            fs::read_dir(&sources).is_ok_and(|entries| {
                entries.flatten().any(|e| {
                    let path = e.path();
                    path.extension().and_then(|x| x.to_str()) == Some("wav")
                        && root
                            .join("Recall/_meta/commits")
                            .join(format!(
                                "{}.json",
                                path.file_stem().unwrap().to_string_lossy()
                            ))
                            .exists()
                })
            })
        })
    }
    fn idle_audio(&self, mode: Mode) -> (AudioState, Arc<FakeEngine>) {
        let engine = self.engine(mode);
        (
            self.audio(backend(MONO_16K, |_, _| {}), engine.clone()),
            engine,
        )
    }
}
impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}
fn wait_for(
    audio: &AudioState,
    guard: &SelectionGuard,
    op: &str,
    ok: impl Fn(&AudioOperationStatus) -> bool,
) -> AudioOperationStatus {
    let started = Instant::now();
    loop {
        let status = audio.status_of(guard, op).unwrap();
        if ok(&status) {
            return status;
        }
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "timed out; last status: {status:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}
fn source_bytes(env: &Env, id: &str) -> Vec<u8> {
    fs::read(env.root.join(format!("Recall/Sources/{id}.wav"))).unwrap()
}
fn recorded_pcm(frames: usize) -> Vec<u8> {
    synthetic_pcm(frames, 1)
}

// ----- tests ---------------------------------------------------------------

#[test]
fn pure_helpers_normalize_and_select_configs_deterministically() {
    assert_eq!(f32_to_i16(0.0), 0);
    assert_eq!(f32_to_i16(1.0), 32767);
    assert_eq!(f32_to_i16(-1.0), -32768);
    assert_eq!(f32_to_i16(5.0), 32767);
    assert_eq!(f32_to_i16(f32::NAN), 0);
    assert_eq!(f32_to_i16(0.5), 16384);
    assert_eq!(f32_to_i16(-0.5), -16384);
    assert_eq!(u16_to_i16(32768), 0);
    assert_eq!(u16_to_i16(0), -32768);
    assert_eq!(u16_to_i16(65535), 32767);
    let offers = [
        ConfigOffer {
            channels: 6,
            min_rate: 8000,
            max_rate: 96000,
            kind: SampleKind::F32,
        },
        ConfigOffer {
            channels: 2,
            min_rate: 8000,
            max_rate: 96000,
            kind: SampleKind::Other,
        },
        ConfigOffer {
            channels: 2,
            min_rate: 44_100,
            max_rate: 48_000,
            kind: SampleKind::I16,
        },
    ];
    // Default wins when acceptable; otherwise the first acceptable advertised format.
    assert_eq!(
        choose_config(Some((2, 48_000, SampleKind::F32)), &offers),
        Some((2, 48_000, SampleKind::F32))
    );
    assert_eq!(
        choose_config(Some((2, 96_000, SampleKind::F32)), &offers),
        Some((2, 48_000, SampleKind::I16))
    );
    assert_eq!(
        choose_config(None, &offers[..2]),
        None,
        "unsupported before opening a stream"
    );
    assert_eq!(choose_config(Some((8, 48_000, SampleKind::F32)), &[]), None);
}

#[test]
fn a_full_bounded_queue_is_an_explicit_failure_never_a_silent_drop() {
    let (tx, _rx) = mpsc::sync_channel(1);
    let failure = Arc::new(Mutex::new(None));
    let sink = SampleSink {
        tx,
        failure: failure.clone(),
    };
    sink.push(vec![1; 8]);
    assert!(failure.lock().unwrap().is_none());
    sink.push(vec![2; 8]);
    assert_eq!(
        failure.lock().unwrap().clone(),
        Some(AudioFailure::QueueOverflow)
    );
    sink.fail(AudioFailure::DeviceLost);
    assert_eq!(
        failure.lock().unwrap().clone(),
        Some(AudioFailure::QueueOverflow),
        "first failure wins"
    );
}

#[test]
fn record_stop_publishes_identical_wav_before_any_recognition() {
    let env = Env::new();
    let pcm = recorded_pcm(16_000);
    let feed_pcm = pcm.clone();
    let fed = Arc::new(AtomicBool::new(false));
    let fed_flag = fed.clone();
    let dev = backend(MONO_16K, move |sink, stopped| {
        feed(&sink, &stopped, &feed_pcm, 1, 1600);
        fed_flag.store(true, Ordering::SeqCst);
    });
    let engine = env.engine(Mode::Text(
        "Remember to call the dentist tomorrow at three in the afternoon.".into(),
    ));
    let audio = env.audio(dev.clone(), engine.clone());
    let guard = env.guard();
    let id_ = op();
    let started = audio.start(&guard, &id_).unwrap();
    assert_eq!(started.state, "recording");
    assert_eq!(
        (started.source_sample_rate_hz, started.source_channels),
        (Some(16_000), Some(1))
    );
    assert_eq!(started.vault_id, guard.vault.id);
    assert!(audio.is_busy());
    while !fed.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(5));
    }
    let stopped = audio.stop(&guard, &id_).unwrap();
    assert_eq!(
        stopped.state, "saved_local",
        "Stop returns the saved-local receipt before ASR"
    );
    assert!(!audio.is_busy());
    let memory = stopped.memory.clone().unwrap();
    let expected = audio_wav::build_wav(16_000, 1, &pcm);
    assert_eq!(
        source_bytes(&env, &id_),
        expected,
        "byte identity of the saved original"
    );
    assert_eq!(memory.source_sha256, audio_wav::sha256_hex(&expected));
    assert_eq!(
        memory.audio_source.as_ref().unwrap().capture_origin,
        "recorded"
    );
    let done = wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    assert!(
        engine.saw_saved.load(Ordering::SeqCst),
        "source and receipt precede recognition"
    );
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    let transcript = done.memory.unwrap().audio_transcript.unwrap();
    assert_eq!(transcript.machine.eligibility, "eligible");
    assert_eq!(transcript.machine.quality_state, "machine_unreviewed");
    assert_eq!(transcript.machine.source_sha256, memory.source_sha256);
    assert!(transcript.machine.input_rms_pcm16 > 5.0);
    // The staged WAV is removed after the commit; the vault copy is authoritative.
    assert!(!env.stage_root().join(&id_).join("capture.wav").exists());
    // Reopening replays the whole chain.
    assert_eq!(guard.with(|v| v.list("")).unwrap().len(), 1);
}

#[test]
fn duplicate_start_and_stop_ids_never_record_twice() {
    let env = Env::new();
    let pcm = recorded_pcm(8_000);
    let fed = Arc::new(AtomicBool::new(false));
    let (f, p) = (fed.clone(), pcm.clone());
    let dev = backend(MONO_16K, move |sink, stopped| {
        feed(&sink, &stopped, &p, 1, 800);
        f.store(true, Ordering::SeqCst);
    });
    let engine = env.engine(Mode::Text("hello world".into()));
    let audio = env.audio(dev.clone(), engine);
    let guard = env.guard();
    let id_ = op();
    assert_eq!(audio.start(&guard, &id_).unwrap().state, "recording");
    assert_eq!(
        audio.start(&guard, &id_).unwrap().state,
        "recording",
        "same ID returns the same receipt"
    );
    assert_eq!(dev.opens.load(Ordering::SeqCst), 1);
    assert!(audio
        .start(&guard, &op())
        .unwrap_err()
        .contains("already in progress"));
    assert_eq!(dev.opens.load(Ordering::SeqCst), 1);
    while !fed.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(5));
    }
    let first = audio.stop(&guard, &id_).unwrap();
    let second = audio.stop(&guard, &id_).unwrap();
    assert_eq!(
        first.memory.as_ref().unwrap().id,
        second.memory.as_ref().unwrap().id
    );
    assert!(second.memory.as_ref().unwrap().revision >= 1);
    // A start after the clip was saved returns it; no new capture happens.
    let again = audio.start(&guard, &id_).unwrap();
    assert!(again.memory.is_some());
    assert_eq!(dev.opens.load(Ordering::SeqCst), 1);
    assert_eq!(
        guard
            .with(|v| v.history(&id_))
            .unwrap()
            .first()
            .unwrap()
            .kind,
        "capture"
    );
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    assert_eq!(
        source_bytes(&env, &id_),
        audio_wav::build_wav(16_000, 1, &pcm)
    );
}

#[test]
fn automatic_stop_at_120_seconds_saves_the_clip_without_a_stop_command() {
    let env = Env::new();
    // 125 s of synthetic mono: the writer must cap at exactly 120 s.
    let pcm = recorded_pcm(125 * 16_000);
    let dev = backend(MONO_16K, move |sink, stopped| {
        feed(&sink, &stopped, &pcm, 1, 3200)
    });
    let engine = env.engine(Mode::Text("limit reached text".into()));
    let audio = env.audio(dev, engine);
    let guard = env.guard();
    let id_ = op();
    audio.start(&guard, &id_).unwrap();
    let saved = wait_for(&audio, &guard, &id_, |s| s.memory.is_some());
    assert_eq!(saved.limit_reason.as_deref(), Some("duration_limit"));
    let source = saved.memory.as_ref().unwrap().audio_source.clone().unwrap();
    assert_eq!(source.duration_ms, 120_000);
    assert_eq!(source.source_bytes, 44 + 3_840_000);
    let bytes = source_bytes(&env, &id_);
    assert_eq!(parse_wav(&bytes).unwrap().data_len, 3_840_000);
    assert!(!audio.is_busy(), "the session ended without Stop");
    // A late Stop is an idempotent read of the durable result.
    let late = audio.stop(&guard, &id_).unwrap();
    assert_eq!(late.memory.unwrap().id, id_);
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
}

#[test]
fn byte_cap_is_the_lower_of_120_seconds_and_24_mib() {
    assert_eq!(pcm_cap_bytes(48_000, 2), 23_040_000);
    assert_eq!(pcm_cap_bytes(44_100, 2), 21_168_000);
    assert_eq!(pcm_cap_bytes(32_000, 1), 7_680_000);
    for rate in audio_wav::SUPPORTED_RATES {
        for channels in [1u16, 2] {
            assert!(pcm_cap_bytes(rate, channels) <= audio_wav::MAX_PCM_BYTES);
        }
    }
}

#[test]
fn stereo_48k_recordings_keep_the_device_rate_and_channels() {
    let env = Env::new();
    let config = CaptureConfig {
        sample_rate_hz: 48_000,
        channels: 2,
    };
    let pcm = synthetic_pcm(24_000, 2);
    let (p, fed) = (pcm.clone(), Arc::new(AtomicBool::new(false)));
    let f = fed.clone();
    let dev = backend(config, move |sink, stopped| {
        feed(&sink, &stopped, &p, 2, 2400);
        f.store(true, Ordering::SeqCst);
    });
    let audio = env.audio(dev, env.engine(Mode::Text("stereo words".into())));
    let guard = env.guard();
    let id_ = op();
    audio.start(&guard, &id_).unwrap();
    while !fed.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(5));
    }
    let saved = audio.stop(&guard, &id_).unwrap();
    assert_eq!(
        (saved.source_sample_rate_hz, saved.source_channels),
        (Some(48_000), Some(2))
    );
    assert_eq!(
        source_bytes(&env, &id_),
        audio_wav::build_wav(48_000, 2, &pcm)
    );
    let done = wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    let t = done.memory.unwrap().audio_transcript.unwrap();
    assert_eq!(t.machine.transform_version, audio_wav::TRANSFORM_VERSION);
    assert_ne!(
        t.machine.derivative_sha256, t.machine.source_sha256,
        "derivative is not the evidence"
    );
}

#[test]
fn unsupported_device_and_denied_permission_fail_truthfully_without_a_draft() {
    for failure in [
        AudioFailure::UnsupportedDevice,
        AudioFailure::PermissionDenied,
        AudioFailure::DeviceBusy,
    ] {
        let env = Env::new();
        let dev = Arc::new(FakeBackend {
            config: MONO_16K,
            script: Mutex::new(None),
            fail_open: Some(failure.clone()),
            opens: AtomicUsize::new(0),
        });
        let audio = env.audio(dev, env.engine(Mode::Text("x".into())));
        let guard = env.guard();
        let id_ = op();
        let status = audio.start(&guard, &id_).unwrap();
        assert_eq!(status.state, "failed");
        assert_eq!(status.error_code.as_deref(), Some(failure.code()));
        assert!(!audio.is_busy());
        assert!(!env.stage_root().join(&id_).exists(), "no phantom draft");
        assert_eq!(
            audio.status_of(&guard, &id_).unwrap().error_code.as_deref(),
            Some(failure.code())
        );
    }
}

#[test]
fn stopping_an_empty_recording_reports_failure_and_saves_nothing() {
    let env = Env::new();
    let audio = env.audio(
        backend(MONO_16K, |_, _| {}),
        env.engine(Mode::Text("x".into())),
    );
    let guard = env.guard();
    let id_ = op();
    audio.start(&guard, &id_).unwrap();
    let status = audio.stop(&guard, &id_).unwrap();
    assert_eq!(status.state, "failed");
    assert_eq!(status.error_code.as_deref(), Some("empty_recording"));
    assert!(guard.with(|v| v.list("")).unwrap().is_empty());
    assert!(!audio.is_busy());
}

#[test]
fn device_loss_preserves_a_prefix_as_recovery_required_and_save_commits_it() {
    let env = Env::new();
    let pcm = recorded_pcm(8_000);
    let p = pcm.clone();
    let dev = backend(MONO_16K, move |sink, stopped| {
        feed(&sink, &stopped, &p, 1, 800);
        sink.fail(AudioFailure::DeviceLost);
    });
    let engine = env.engine(Mode::Text("recovered words".into()));
    let audio = env.audio(dev, engine.clone());
    let guard = env.guard();
    let id_ = op();
    audio.start(&guard, &id_).unwrap();
    let status = wait_for(&audio, &guard, &id_, |s| s.state == "recovery_required");
    assert_eq!(status.error_code.as_deref(), Some("device_lost"));
    assert!(status.memory.is_none());
    assert!(!audio.is_busy(), "the failed session released the recorder");
    assert_eq!(
        engine.calls.load(Ordering::SeqCst),
        0,
        "no ASR before an explicit save"
    );
    assert!(guard
        .with(|v| v.audio_capture_receipt(&id_))
        .unwrap()
        .is_none());
    let saved = audio.recover(&guard, &id_, "save").unwrap();
    assert!(
        ["saved_local", "transcription_processing", "transcribed"].contains(&saved.state.as_str())
    );
    let bytes = source_bytes(&env, &id_);
    let info = parse_wav(&bytes).unwrap();
    assert!(info.data_len > 0 && info.data_len <= pcm.len());
    assert_eq!(
        &bytes[44..],
        &pcm[..info.data_len],
        "an exact prefix; nothing invented or reordered"
    );
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    // Saving again is idempotent and never records a second memory.
    assert_eq!(
        audio
            .recover(&guard, &id_, "save")
            .unwrap()
            .memory
            .unwrap()
            .id,
        id_
    );
    assert!(
        audio.recover(&guard, &id_, "discard").is_err(),
        "committed sources are never discarded"
    );
}

fn write_stage(
    env: &Env,
    guard: &SelectionGuard,
    id_: &str,
    config: CaptureConfig,
    pcm: &[u8],
) -> Stage {
    let (stage, mut file) = Stage::create(&env.stage_root(), &guard.vault.id, id_, config).unwrap();
    file.write_all(pcm).unwrap();
    file.sync_all().unwrap();
    stage
}

#[test]
fn crashed_stage_is_recovery_required_and_nothing_resumes_or_transcribes_silently() {
    let env = Env::new();
    let guard = env.guard();
    let id_ = op();
    let pcm = recorded_pcm(4_000);
    // A previous process died mid-recording: stage and provisional header only.
    let mut torn = pcm.clone();
    torn.push(0x7f); // a torn half-frame at the tail
    write_stage(&env, &guard, &id_, MONO_16K, &torn);
    let (audio, engine) = env.idle_audio(Mode::Text("never".into()));
    let status = audio.status_of(&guard, &id_).unwrap();
    assert_eq!(status.state, "recovery_required");
    assert_eq!(status.error_code.as_deref(), Some("unfinished_recording"));
    assert!(status.memory.is_none());
    audio.resume_pending(&guard);
    thread::sleep(Duration::from_millis(100));
    assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    assert!(guard
        .with(|v| v.audio_capture_receipt(&id_))
        .unwrap()
        .is_none());
    assert!(!audio.is_busy());
    // Explicit save finalizes only whole frames of verified bytes.
    let saved = audio.recover(&guard, &id_, "save").unwrap();
    assert!(saved.memory.is_some());
    assert_eq!(
        source_bytes(&env, &id_),
        audio_wav::build_wav(16_000, 1, &pcm)
    );
    let _ = wait_for(&audio, &guard, &id_, |s| {
        s.state == "transcription_unavailable" || s.state == "transcribed"
    });
}

#[test]
fn corrupt_or_foreign_stages_fail_closed_and_preserve_evidence() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("x".into()));
    // Header that does not match the intent.
    let id_ = op();
    let stage = write_stage(&env, &guard, &id_, MONO_16K, &recorded_pcm(1_000));
    let mut part = fs::read(stage.part()).unwrap();
    part[0] = b'X';
    fs::write(stage.part(), &part).unwrap();
    assert!(audio.recover(&guard, &id_, "save").is_err());
    assert!(
        audio.recover(&guard, &id_, "discard").is_err(),
        "ambiguous stage cannot be discarded"
    );
    assert_eq!(
        fs::read(stage.part()).unwrap(),
        part,
        "evidence preserved byte-for-byte"
    );
    assert_eq!(
        audio.status_of(&guard, &id_).unwrap().state,
        "recovery_required"
    );
    // Intent bound to another vault.
    let foreign = op();
    let (_s, _f) = Stage::create(
        &env.stage_root(),
        &Uuid::new_v4().to_string(),
        &foreign,
        MONO_16K,
    )
    .unwrap();
    assert!(audio
        .status_of(&guard, &foreign)
        .unwrap_err()
        .contains("different vault"));
    assert!(audio.recover(&guard, &foreign, "save").is_err());
    // Truncated below a header.
    let tiny = op();
    let stage = write_stage(&env, &guard, &tiny, MONO_16K, &[]);
    fs::write(stage.part(), b"RIFF").unwrap();
    assert!(audio.recover(&guard, &tiny, "save").is_err());
    // Malformed recovery action.
    assert!(audio.recover(&guard, &id_, "delete").is_err());
    assert!(audio.recover(&guard, "not-a-uuid", "save").is_err());
}

#[test]
fn discard_removes_only_a_verified_uncommitted_stage_and_is_idempotent() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, engine) = env.idle_audio(Mode::Text("x".into()));
    let id_ = op();
    let stage = write_stage(&env, &guard, &id_, MONO_16K, &recorded_pcm(2_000));
    let discarded = audio.recover(&guard, &id_, "discard").unwrap();
    assert_eq!(discarded.state, "discarded");
    assert!(!stage.part().exists() && stage.discarded_path().exists());
    assert_eq!(
        audio.recover(&guard, &id_, "discard").unwrap().state,
        "discarded"
    );
    assert!(
        audio.recover(&guard, &id_, "save").is_err(),
        "a discarded draft cannot be saved"
    );
    assert_eq!(audio.status_of(&guard, &id_).unwrap().state, "discarded");
    assert!(guard
        .with(|v| v.audio_capture_receipt(&id_))
        .unwrap()
        .is_none());
    assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    // A published source without a receipt is ambiguous: discard is refused.
    let ambiguous = op();
    let stage = write_stage(&env, &guard, &ambiguous, MONO_16K, &recorded_pcm(2_000));
    fs::write(
        env.root.join(format!("Recall/Sources/{ambiguous}.wav")),
        synthetic_wav(16_000, 1, 100),
    )
    .unwrap();
    assert!(audio.recover(&guard, &ambiguous, "discard").is_err());
    assert!(stage.part().exists());
    assert!(!stage.discarded_path().exists());
}

#[test]
fn vault_selection_is_validated_before_any_audio_state_is_read() {
    let env = Env::new();
    let (audio, _e) = env.idle_audio(Mode::Text("x".into()));
    // Every command resolves its token through `session` first.
    assert!(env.state.session("not-the-selected-vault").is_err());
    assert!(env.state.session(&Uuid::new_v4().to_string()).is_err());
    let id_ = op();
    let guard = env.guard();
    audio.start(&guard, &id_).unwrap();
    // A different vault is selected afterwards: the old token no longer resolves,
    // and the new vault cannot see or finish the old vault's draft.
    let other = env.dir.join("other-vault");
    fs::create_dir_all(&other).unwrap();
    let new_token = env.state.select_path(&other).unwrap().vault_id.unwrap();
    assert!(env.state.session(&env.token).is_err());
    let new_guard = env.state.session(&new_token).unwrap();
    assert!(audio
        .status_of(&new_guard, &id_)
        .unwrap_err()
        .contains("different vault"));
    assert!(audio.stop(&new_guard, &id_).is_err());
    assert!(audio.recover(&new_guard, &id_, "save").is_err());
    // The recorder reports busy so `vault_select` refuses the switch while live.
    assert!(audio.is_busy());
    // The stale-token guard from before the switch cannot commit into either vault.
    assert!(guard.with(|v| v.audio_capture_receipt(&id_)).is_err());
    assert!(guard.active().is_err());
    assert!(guard.with(|v| v.list("")).is_err());
}

#[test]
fn imported_wav_uses_the_same_commit_path_and_replays_without_a_picker() {
    let env = Env::new();
    let engine = env.engine(Mode::Text("imported speech".into()));
    let audio = env.audio(backend(MONO_16K, |_, _| {}), engine.clone());
    let guard = env.guard();
    let file = env.dir.join("clip.wav");
    let bytes = synthetic_wav(16_000, 1, 24_000);
    fs::write(&file, &bytes).unwrap();
    let id_ = op();
    let saved = audio
        .import_wav(&guard, &id_, || Some(file.clone()))
        .unwrap()
        .unwrap();
    assert_eq!(
        saved.audio_source.as_ref().unwrap().capture_origin,
        "imported_wav"
    );
    assert_eq!(source_bytes(&env, &id_), bytes);
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    assert!(engine.saw_saved.load(Ordering::SeqCst));
    // Duplicate operation ID: the receipt is returned and the picker never opens.
    let replay = audio
        .import_wav(&guard, &id_, || panic!("picker must not open"))
        .unwrap();
    assert_eq!(replay.unwrap().id, id_);
    // Cancel returns nothing and saves nothing.
    assert!(audio.import_wav(&guard, &op(), || None).unwrap().is_none());
    // A different file under the same ID is a conflict.
    let other = env.dir.join("other.wav");
    fs::write(&other, synthetic_wav(16_000, 1, 8_000)).unwrap();
    assert!(
        audio
            .import_wav(&guard, &id_, || Some(other.clone()))
            .unwrap()
            .is_some(),
        "receipt wins before the picker"
    );
    let corrupt = env.dir.join("corrupt.wav");
    fs::write(&corrupt, b"RIFF0000WAVEfmt junk").unwrap();
    assert!(audio
        .import_wav(&guard, &op(), || Some(corrupt.clone()))
        .is_err());
}

// ----- recognizer orchestration -------------------------------------------

fn import(env: &Env, audio: &AudioState, guard: &SelectionGuard, bytes: &[u8]) -> String {
    let file = env.dir.join(format!("{}.wav", op()));
    fs::write(&file, bytes).unwrap();
    let id_ = op();
    audio
        .import_wav(guard, &id_, || Some(file))
        .unwrap()
        .unwrap();
    id_
}

#[test]
fn unusable_recognizer_output_is_ineligible_with_an_openable_original() {
    for (text, flag) in [
        ("", "empty_output"),
        ("[Music]", "non_speech_annotation"),
        ("[BLANK_AUDIO]", "non_speech_annotation"),
    ] {
        let env = Env::new();
        let (audio, engine) = env.idle_audio(Mode::Text(text.into()));
        let guard = env.guard();
        let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
        let status = wait_for(&audio, &guard, &id_, |s| {
            s.state == "transcription_unavailable"
        });
        assert_eq!(status.error_code.as_deref(), Some(flag));
        let t = status.memory.unwrap().audio_transcript.unwrap();
        assert_eq!(t.machine.eligibility, "ineligible");
        assert_eq!(
            guard.with(|v| v.source(&id_)).unwrap().mime_type,
            "audio/wav"
        );
        assert!(guard.with(|v| v.ask_candidates()).unwrap().is_empty());
        assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn the_zero_gate_never_launches_the_recognizer_for_silence() {
    let env = Env::new();
    let (audio, engine) = env.idle_audio(Mode::Text("you".into()));
    let guard = env.guard();
    let silence = audio_wav::build_wav(16_000, 1, &vec![0u8; 32_000]);
    let id_ = import(&env, &audio, &guard, &silence);
    let status = wait_for(&audio, &guard, &id_, |s| {
        s.state == "transcription_unavailable"
    });
    assert_eq!(status.error_code.as_deref(), Some("rms_gate"));
    assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    let machine = status.memory.unwrap().audio_transcript.unwrap().machine;
    assert_eq!(
        (machine.text.as_str(), machine.eligibility.as_str()),
        ("", "ineligible")
    );
    assert!(guard.with(|v| v.ask_candidates()).unwrap().is_empty());
}

#[test]
fn recognizer_failure_is_durable_and_never_blindly_rerun_after_restart() {
    let env = Env::new();
    let (audio, engine) = env.idle_audio(Mode::Fail("asr_timeout"));
    let guard = env.guard();
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    let status = wait_for(&audio, &guard, &id_, |s| {
        s.state == "transcription_unavailable"
    });
    assert_eq!(status.error_code.as_deref(), Some("asr_timeout"));
    assert!(status.memory.unwrap().audio_transcript.is_none());
    // "Restart": a new state over the same stage and vault.
    let (restarted, engine2) = env.idle_audio(Mode::Text("would succeed".into()));
    restarted.resume_pending(&guard);
    thread::sleep(Duration::from_millis(150));
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        engine2.calls.load(Ordering::SeqCst),
        0,
        "a failed attempt is not retried"
    );
    assert_eq!(
        restarted.status_of(&guard, &id_).unwrap().state,
        "transcription_unavailable"
    );
}

#[test]
fn a_lost_recognizer_reply_becomes_unknown_and_is_never_rerun() {
    let env = Env::new();
    let (audio, engine) = env.idle_audio(Mode::Panic);
    let guard = env.guard();
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    let status = wait_for(&audio, &guard, &id_, |s| s.state == "unknown");
    assert_eq!(status.error_code.as_deref(), Some("asr_outcome_unknown"));
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    let (restarted, engine2) = env.idle_audio(Mode::Text("must not run".into()));
    restarted.resume_pending(&guard);
    restarted.schedule_asr(&guard, &id_);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(
        engine2.calls.load(Ordering::SeqCst),
        0,
        "UNKNOWN stays unresolved"
    );
    assert_eq!(restarted.status_of(&guard, &id_).unwrap().state, "unknown");
    assert_eq!(
        guard.with(|v| v.source(&id_)).unwrap().mime_type,
        "audio/wav"
    );
}

#[test]
fn unsupported_cpu_or_failed_asset_verification_is_unavailable_and_retries_after_repair() {
    for code in ["unsupported_cpu", "asr_hash_mismatch", "asr_assets_missing"] {
        let env = Env::new();
        let (audio, engine) = env.idle_audio(Mode::PreflightFail(code));
        let guard = env.guard();
        let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
        let status = wait_for(&audio, &guard, &id_, |s| {
            s.state == "transcription_unavailable"
        });
        assert_eq!(status.error_code.as_deref(), Some(code));
        assert_eq!(engine.calls.load(Ordering::SeqCst), 0, "nothing launched");
        assert_eq!(
            guard.with(|v| v.source(&id_)).unwrap().mime_type,
            "audio/wav"
        );
        // Nothing was dispatched, so a repaired install resumes safely.
        let (repaired, fixed) = env.idle_audio(Mode::Text("now it works".into()));
        repaired.resume_pending(&guard);
        let done = wait_for(&repaired, &guard, &id_, |s| s.state == "transcribed");
        assert_eq!(fixed.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            done.memory.unwrap().audio_transcript.unwrap().machine.text,
            "now it works"
        );
    }
}

#[test]
fn audio_never_creates_organization_work_and_never_uses_the_text_photo_consent() {
    let env = Env::new();
    let (audio, _engine) = env.idle_audio(Mode::Text("organize me".into()));
    let guard = env.guard();
    // A real text/photo organization consent exists: audio must still not use it.
    guard
        .with(|v| {
            v.set_organization_marker(Some(crate::local_organization::OrganizationMarker {
                schema_version: "1.0".into(),
                vault_id: v.id.clone(),
                policy_version: "organize-v2|anthropic-v1|synthetic-model".into(),
                consent_epoch: 2,
                local_epoch: op(),
                connection_fingerprint: "a".repeat(64),
            }))
        })
        .unwrap();
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    assert!(guard
        .with(|v| v.organization_operations(&id_))
        .unwrap()
        .is_empty());
    assert!(guard.with(|v| v.organization_intents()).unwrap().is_empty());
    // Control: the same consent does queue organization work for a typed note.
    let typed = guard
        .with(|v| v.capture_text(&op(), "A typed note."))
        .unwrap();
    let intents = guard.with(|v| v.organization_intents()).unwrap();
    assert_eq!(intents.len(), 1);
    assert_eq!(intents[0].binding.memory_id, typed.id);
    assert!(guard
        .with(|v| v.organization_operations(&id_))
        .unwrap()
        .is_empty());
    let memory = guard.with(|v| v.list("")).unwrap().remove(0);
    assert!(memory.organization.is_none() && memory.related_context.is_empty());
}

#[test]
fn audio_is_not_sent_as_context_for_other_memories_organization() {
    let env = Env::new();
    let (audio, _engine) = env.idle_audio(Mode::Text("private spoken words about Houston".into()));
    let guard = env.guard();
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    let typed = guard
        .with(|v| v.capture_text(&op(), "A typed note about Houston."))
        .unwrap();
    // Audio is Ask evidence under its own rules but is excluded from text/photo
    // organization context (that consent never covered audio).
    let candidates = guard.with(|v| v.ask_candidates()).unwrap();
    assert_eq!(candidates.len(), 2);
    let context = guard
        .with(|v| v.organization_context_for_test(&typed.id))
        .unwrap();
    assert!(context.iter().all(|c| c.memory_id != id_));
}

#[test]
fn a_recorded_but_unpromoted_result_resumes_after_restart_without_launching() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("unused".into()));
    // Simulate a crash after the recognizer's result was retained, before promotion.
    let memory = guard
        .with(|v| {
            v.audio_commit_capture(&op(), &synthetic_wav(16_000, 1, 16_000), "recorded", None)
        })
        .unwrap();
    let identity = _engine.identity();
    let begin = guard
        .with(|v| v.audio_asr_begin(&memory.id, &identity))
        .unwrap();
    guard
        .with(|v| v.audio_asr_mark_dispatched(&begin.request))
        .unwrap();
    let text = "Words retained before the crash.";
    let result = crate::local_vault::AsrResult {
        schema_version: "1.0".into(),
        asr_operation_id: begin.request.asr_operation_id.clone(),
        memory_id: memory.id.clone(),
        source_sha256: begin.request.source_sha256.clone(),
        derivative_sha256: begin.request.derivative_sha256.clone(),
        state: "completed".into(),
        error_code: None,
        output_sha256: Some(audio_wav::sha256_hex(text.as_bytes())),
        text: Some(text.into()),
        segments: None,
        gated_before_launch: false,
        exit_code: Some(0),
        elapsed_ms: 5,
        completed_at: crate::local_vault::utc_now(),
    };
    guard
        .with(|v| v.audio_asr_record_result(&begin.request, &result))
        .unwrap();
    assert_eq!(
        audio.status_of(&guard, &memory.id).unwrap().state,
        "transcription_processing"
    );
    // New process: a fresh state and a recognizer that must not be launched.
    let (restarted, fresh_engine) = env.idle_audio(Mode::Panic);
    restarted.resume_pending(&guard);
    let done = wait_for(&restarted, &guard, &memory.id, |s| s.state == "transcribed");
    assert_eq!(
        done.memory.unwrap().audio_transcript.unwrap().machine.text,
        text
    );
    assert_eq!(
        fresh_engine.calls.load(Ordering::SeqCst),
        0,
        "promotion launches nothing"
    );
}

#[test]
fn vault_selection_is_refused_while_transcription_or_recording_is_in_flight() {
    let env = Env::new();
    let gate = Arc::new(AtomicBool::new(false));
    let release = gate.clone();
    // A recognizer that blocks until released, so ASR is genuinely in flight.
    struct Blocking(Arc<AtomicBool>, Arc<FakeEngine>);
    impl AsrEngine for Blocking {
        fn identity(&self) -> AsrIdentity {
            self.1.identity()
        }
        fn preflight(&self) -> std::result::Result<(), String> {
            Ok(())
        }
        fn transcribe(&self, job: &AsrJob<'_>) -> AsrOutcome {
            while !self.0.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
            self.1.transcribe(job)
        }
    }
    let inner = env.engine(Mode::Text("late words".into()));
    let audio = AudioState::new(
        env.stage_root(),
        backend(MONO_16K, |_, _| {}),
        Arc::new(Blocking(gate, inner)),
    );
    let guard = env.guard();
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    let other = env.dir.join("other-vault");
    fs::create_dir_all(&other).unwrap();
    // The check runs under the selection mutex; both a different vault and the
    // same vault are refused with the specific message, and nothing changes.
    for root in [other.clone(), env.root.clone()] {
        let err = env
            .state
            .select_path_if(&root, || audio.ensure_idle())
            .expect_err("selection must be refused while transcription is in flight");
        assert!(err.contains("Transcription in progress"), "{err}");
    }
    assert!(
        env.state.session(&env.token).is_ok(),
        "selection token is unchanged"
    );
    release.store(true, Ordering::SeqCst);
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    // Wait for the in-flight marker to clear, then selection works again.
    let started = Instant::now();
    while audio.ensure_idle().is_err() {
        assert!(started.elapsed() < Duration::from_secs(10));
        thread::sleep(Duration::from_millis(10));
    }
    env.state
        .select_path_if(&other, || audio.ensure_idle())
        .unwrap();
    // A live recording is refused with its own message.
    let live = AudioState::new(
        env.stage_root(),
        backend(MONO_16K, |_, _| {}),
        env.engine(Mode::Text("x".into())),
    );
    let new_guard = env
        .state
        .session(&env.state.status().unwrap().vault_id.unwrap())
        .unwrap();
    live.start(&new_guard, &op()).unwrap();
    let err = live.ensure_idle().unwrap_err();
    assert!(err.contains("recording"), "{err}");
}

fn finalized_stage(env: &Env, guard: &SelectionGuard, id_: &str, pcm: &[u8]) -> Stage {
    let stage = write_stage(env, guard, id_, MONO_16K, pcm);
    stage.finalize(None).unwrap();
    stage
}

#[test]
fn an_existing_receipt_must_be_this_very_recording_before_commit_reports_success() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("x".into()));
    let pcm = recorded_pcm(4_000);
    let bytes = audio_wav::build_wav(16_000, 1, &pcm);
    // Same ID, but the committed memory is an imported WAV: a conflict.
    let imported_id = op();
    guard
        .with(|v| v.audio_commit_capture(&imported_id, &bytes, "imported_wav", Some("x.wav")))
        .unwrap();
    finalized_stage(&env, &guard, &imported_id, &pcm);
    let err = audio.commit_stage(&guard, &imported_id).unwrap_err();
    assert!(err.contains("different saved recording"), "{err}");
    // Same ID, recorded, but different bytes from the staged final: a conflict.
    let other_id = op();
    guard
        .with(|v| {
            v.audio_commit_capture(
                &other_id,
                &audio_wav::build_wav(16_000, 1, &recorded_pcm(2_000)),
                "recorded",
                None,
            )
        })
        .unwrap();
    finalized_stage(&env, &guard, &other_id, &pcm);
    assert!(audio.commit_stage(&guard, &other_id).is_err());
    // Genuinely the same recording: success, idempotent.
    let same_id = op();
    guard
        .with(|v| v.audio_commit_capture(&same_id, &bytes, "recorded", None))
        .unwrap();
    finalized_stage(&env, &guard, &same_id, &pcm);
    assert!(audio
        .commit_stage(&guard, &same_id)
        .unwrap()
        .memory
        .is_some());
}

#[test]
fn losing_a_stop_versus_automatic_stop_race_returns_the_saved_result() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("x".into()));
    let pcm = recorded_pcm(4_000);
    let id_ = op();
    let stage = finalized_stage(&env, &guard, &id_, &pcm);
    guard
        .with(|v| {
            v.audio_commit_capture(
                &id_,
                &audio_wav::build_wav(16_000, 1, &pcm),
                "recorded",
                None,
            )
        })
        .unwrap();
    // The winner already committed and removed the staged copy.
    stage.remove_audio_after_commit();
    assert!(stage.finalized_bytes().is_err());
    let status = audio.commit_stage(&guard, &id_).unwrap();
    assert!(status.memory.is_some(), "{status:?}");
    assert_ne!(status.state, "recovery_required");
    assert!(!stage.failure_path().exists(), "no failure was recorded");
}

#[test]
fn import_refuses_an_operation_id_that_has_a_recording_stage() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("x".into()));
    let id_ = op();
    write_stage(&env, &guard, &id_, MONO_16K, &recorded_pcm(1_000));
    let file = env.dir.join("clip.wav");
    fs::write(&file, synthetic_wav(16_000, 1, 8_000)).unwrap();
    let err = audio
        .import_wav(&guard, &id_, || panic!("picker must not open"))
        .unwrap_err();
    assert!(err.contains("belongs to a recording"), "{err}");
    // Even after the recording committed, the ID still cannot be reused for an import.
    let done = op();
    let pcm = recorded_pcm(2_000);
    finalized_stage(&env, &guard, &done, &pcm);
    audio.commit_stage(&guard, &done).unwrap();
    assert!(audio
        .import_wav(&guard, &done, || Some(file.clone()))
        .is_err());
}

#[test]
fn status_after_a_failed_start_or_an_empty_recording_agrees_with_what_was_returned() {
    let env = Env::new();
    let guard = env.guard();
    let failing = Arc::new(FakeBackend {
        config: MONO_16K,
        script: Mutex::new(None),
        fail_open: Some(AudioFailure::PermissionDenied),
        opens: AtomicUsize::new(0),
    });
    let audio = env.audio(failing, env.engine(Mode::Text("x".into())));
    let id_ = op();
    let started = audio.start(&guard, &id_).unwrap();
    let later = audio.status_of(&guard, &id_).unwrap();
    assert_eq!(
        (later.state.as_str(), later.error_code.as_deref()),
        ("failed", Some("permission_denied"))
    );
    assert_eq!(later.state, started.state);
    // Empty recording: Stop said failed/empty_recording; status says the same.
    let empty = env.audio(
        backend(MONO_16K, |_, _| {}),
        env.engine(Mode::Text("x".into())),
    );
    let empty_id = op();
    empty.start(&guard, &empty_id).unwrap();
    let stopped = empty.stop(&guard, &empty_id).unwrap();
    assert_eq!(stopped.error_code.as_deref(), Some("empty_recording"));
    let status = empty.status_of(&guard, &empty_id).unwrap();
    assert_eq!(
        (status.state.as_str(), status.error_code.as_deref()),
        ("failed", Some("empty_recording"))
    );
    // Stop after the fact keeps agreeing.
    assert_eq!(empty.stop(&guard, &empty_id).unwrap().state, "failed");
}

#[test]
fn a_staging_failure_before_launch_never_leaves_a_dispatch_marker() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, engine) = env.idle_audio(Mode::Text("x".into()));
    let id_ = import(&env, &audio, &guard, &synthetic_wav(16_000, 1, 16_000));
    wait_for(&audio, &guard, &id_, |s| s.state == "transcribed");
    // A second recording whose work root is an existing file cannot be staged.
    let (quiet, _e) = env.idle_audio(Mode::Text("x".into()));
    let memory = guard
        .with(|v| {
            v.audio_commit_capture(&op(), &synthetic_wav(16_000, 1, 15_000), "recorded", None)
        })
        .unwrap();
    let blocker = env.dir.join("not-a-directory");
    fs::write(&blocker, b"file").unwrap();
    let before = engine.calls.load(Ordering::SeqCst);
    let result = run_asr_attempt(&guard, engine.as_ref(), &blocker, &memory.id);
    assert!(result.is_err());
    assert_eq!(
        engine.calls.load(Ordering::SeqCst),
        before,
        "nothing launched"
    );
    let (_, phase) = guard
        .with(|v| v.audio_asr_state(&memory.id))
        .unwrap()
        .unwrap();
    assert_eq!(phase, crate::local_vault::AsrPhase::Fresh, "not UNKNOWN");
    drop(quiet);
}

#[test]
fn csp_allows_blob_media_playback_without_widening_anything_else() {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let csp = conf["app"]["security"]["csp"].as_str().unwrap();
    let directives: BTreeMap<&str, Vec<&str>> = csp
        .split(';')
        .filter_map(|d| {
            let mut parts = d.split_whitespace();
            Some((parts.next()?, parts.collect()))
        })
        .collect();
    let media = directives.get("media-src").expect("media-src is present");
    assert!(media.contains(&"blob:"), "{media:?}");
    assert!(media.contains(&"'self'"));
    assert!(media
        .iter()
        .all(|s| !s.contains('*') && *s != "data:" && *s != "https:"));
    assert!(!csp.contains("'unsafe-eval'"));
    assert!(!directives["default-src"].contains(&"*"));
    assert_eq!(directives["default-src"], vec!["'self'"]);
    assert!(
        !directives.contains_key("script-src"),
        "no script source was added"
    );
}

#[test]
fn a_half_made_stage_directory_does_not_break_the_operation_id() {
    let env = Env::new();
    let guard = env.guard();
    let audio = env.audio(
        backend(MONO_16K, |sink, stopped| {
            feed(&sink, &stopped, &recorded_pcm(1_600), 1, 800)
        }),
        env.engine(Mode::Text("x".into())),
    );
    // Crash after create_dir, before intent.json: empty directory.
    let empty = op();
    fs::create_dir_all(env.stage_root().join(&empty)).unwrap();
    assert!(Stage::load(&env.stage_root(), &empty).unwrap().is_none());
    assert!(audio
        .status_of(&guard, &empty)
        .unwrap_err()
        .contains("Unknown"));
    // Crash while intent.json was being written (truncated, no audio).
    let torn = op();
    fs::create_dir_all(env.stage_root().join(&torn)).unwrap();
    fs::write(env.stage_root().join(&torn).join("intent.json"), b"{\"sche").unwrap();
    assert!(Stage::load(&env.stage_root(), &torn).unwrap().is_none());
    // Both IDs can still be used for a fresh recording.
    for id_ in [&empty, &torn] {
        let (stage, file) =
            Stage::create(&env.stage_root(), &guard.vault.id, id_, MONO_16K).unwrap();
        drop(file);
        assert_eq!(stage.intent.operation_id, *id_);
    }
    // A directory that already holds audio is never treated as abandoned.
    let precious = op();
    write_stage(&env, &guard, &precious, MONO_16K, &recorded_pcm(500));
    fs::remove_file(env.stage_root().join(&precious).join("intent.json")).unwrap();
    assert!(Stage::load(&env.stage_root(), &precious).is_err());
    assert!(Stage::create(&env.stage_root(), &guard.vault.id, &precious, MONO_16K).is_err());
    assert!(env
        .stage_root()
        .join(&precious)
        .join("capture.wav.part")
        .exists());
    // A failure inside create() leaves no half-made directory behind.
    let blocked = op();
    let root = env.stage_root();
    fs::create_dir_all(&root).unwrap();
    // Make intent.json creation fail by occupying its path with a directory.
    let dir = root.join(&blocked);
    let result = (|| {
        fs::create_dir(&dir).unwrap();
        fs::create_dir(dir.join("intent.json")).unwrap();
        Stage::populate(&dir, &blocked, &guard.vault.id, MONO_16K)
    })();
    assert!(result.is_err());
    let _ = fs::remove_dir_all(&dir);
    // And a real start() on a crash-damaged ID simply records.
    let damaged = op();
    fs::create_dir_all(env.stage_root().join(&damaged)).unwrap();
    let started = audio.start(&guard, &damaged).unwrap();
    assert_eq!(started.state, "recording");
    assert!(audio.stop(&guard, &damaged).unwrap().memory.is_some());
}

#[test]
fn a_corrupt_stage_directory_cannot_hide_a_committed_memory() {
    let env = Env::new();
    let guard = env.guard();
    let (audio, _engine) = env.idle_audio(Mode::Text("x".into()));
    let pcm = recorded_pcm(4_000);
    let id_ = op();
    finalized_stage(&env, &guard, &id_, &pcm);
    guard
        .with(|v| {
            v.audio_commit_capture(
                &id_,
                &audio_wav::build_wav(16_000, 1, &pcm),
                "recorded",
                None,
            )
        })
        .unwrap();
    let dir = env.stage_root().join(&id_);
    fs::write(dir.join("intent.json"), b"{ corrupt").unwrap();
    assert!(Stage::load(&env.stage_root(), &id_).is_err());
    let status = audio.status_of(&guard, &id_).unwrap();
    assert!(status.memory.is_some(), "{status:?}");
    assert_ne!(status.state, "recovery_required");
    // start() with the same ID also returns the committed state, not a stage error.
    assert!(audio.start(&guard, &id_).unwrap().memory.is_some());
}

#[test]
fn start_creates_its_session_under_the_selection_mutex() {
    let env = Env::new();
    let entered = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    struct Gate {
        entered: Arc<AtomicBool>,
        release: Arc<AtomicBool>,
    }
    impl InputBackend for Gate {
        fn open(
            &self,
            _sink: SampleSink,
        ) -> std::result::Result<(CaptureConfig, Box<dyn CaptureHandle>), AudioFailure> {
            self.entered.store(true, Ordering::SeqCst);
            while !self.release.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
            struct Noop;
            impl CaptureHandle for Noop {}
            Ok((MONO_16K, Box::new(Noop)))
        }
    }
    let audio = AudioState::new(
        env.stage_root(),
        Arc::new(Gate {
            entered: entered.clone(),
            release: release.clone(),
        }),
        env.engine(Mode::Text("x".into())),
    );
    let guard = env.guard();
    let other = env.dir.join("other-vault");
    fs::create_dir_all(&other).unwrap();
    let id_ = op();
    thread::scope(|scope| {
        let starter = scope.spawn(|| audio.start(&guard, &id_));
        while !entered.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
        // The device is opening: a vault switch must wait for the selection mutex,
        // then see the finished session and be refused.
        let selector = scope.spawn(|| env.state.select_path_if(&other, || audio.ensure_idle()));
        thread::sleep(Duration::from_millis(150));
        assert!(!selector.is_finished(), "selection waits behind start()");
        release.store(true, Ordering::SeqCst);
        assert_eq!(starter.join().unwrap().unwrap().state, "recording");
        let err = selector.join().unwrap().unwrap_err();
        assert!(err.contains("recording"), "{err}");
    });
    assert!(
        env.state.session(&env.token).is_ok(),
        "selection never moved"
    );
}
