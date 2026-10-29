//! Recognizer-runtime tests. Everything except the one `#[ignore]` real-sidecar
//! test uses tiny synthetic stand-ins and never starts the pinned runtime.
use super::*;
use crate::audio_wav::{self, fixtures::synthetic_wav};
use crate::local_audio::{
    AudioOperationStatus, AudioState, CaptureConfig, CaptureHandle, InputBackend, SampleSink,
};
use crate::local_vault::LocalVaultState;
use std::sync::Arc;
use uuid::Uuid;

fn tmp() -> PathBuf {
    let p = std::env::temp_dir().join(format!("monolith-synthetic-asr-{}", Uuid::new_v4()));
    fs::create_dir_all(&p).unwrap();
    p
}
fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[test]
fn pinned_manifest_matches_the_f0_evidence() {
    let m = pinned_manifest();
    assert_eq!(
        m.runtime.source_commit,
        "d1be6fde11ac6e0407606b4e42fe72d34add8037"
    );
    assert_eq!(m.runtime.binary.name, "whisper-cli.exe");
    assert_eq!(
        m.runtime.binary.sha256,
        "329c713c8b36eb8c367137d624b75ec57e17f8b3061fd823c59433abd5f76951"
    );
    assert_eq!(m.model.name, "ggml-base.bin");
    assert_eq!(m.model.bytes, Some(147_951_465));
    assert_eq!(
        m.model.sha256,
        "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
    );
    let dlls: Vec<_> = m.runtime.dlls.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(
        dlls,
        ["whisper.dll", "ggml.dll", "ggml-cpu.dll", "ggml-base.dll"]
    );
    assert!(m.runtime.dlls.iter().all(|d| d.sha256.len() == 64));
}

#[test]
fn nothing_machine_specific_is_hardcoded_or_downloaded() {
    for (name, text) in [
        ("audio_asr.rs", include_str!("audio_asr.rs")),
        ("local_audio.rs", include_str!("local_audio.rs")),
        ("local_vault_audio.rs", include_str!("local_vault_audio.rs")),
        ("manifest", include_str!("../voice-assets-manifest.json")),
        ("tauri.conf.json", include_str!("../tauri.conf.json")),
        (
            "prepare script",
            include_str!("../scripts/prepare-voice-assets.ps1"),
        ),
    ] {
        for needle in ["RecallBuildTools", "AppData\\Local", "C:\\Users", "nrsan"] {
            assert!(!text.contains(needle), "{name} contains {needle}");
        }
    }
    // No runtime download or shell path exists in the recognizer or recorder.
    for text in [include_str!("audio_asr.rs"), include_str!("local_audio.rs")] {
        for needle in [
            "reqwest",
            "http://",
            "https://huggingface",
            "cmd.exe",
            "powershell",
        ] {
            assert!(!text.contains(needle), "{needle}");
        }
    }
}

fn write_layout(root: &Path, files: &[(&str, &[u8])]) {
    for (rel, bytes) in files {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
}
fn fixture_manifest(sidecar: &[u8], dlls: &[(&str, &[u8])], model: &[u8]) -> AssetManifest {
    AssetManifest {
        runtime: RuntimeEntry {
            source_commit: "d".repeat(40),
            binary: AssetFile {
                name: "whisper-cli.exe".into(),
                bytes: Some(sidecar.len() as u64),
                sha256: sha(sidecar),
            },
            dlls: dlls
                .iter()
                .map(|(n, b)| AssetFile {
                    name: (*n).into(),
                    bytes: Some(b.len() as u64),
                    sha256: sha(b),
                })
                .collect(),
        },
        model: AssetFile {
            name: "ggml-base.bin".into(),
            bytes: Some(model.len() as u64),
            sha256: sha(model),
        },
    }
}
const DLLS: [(&str, &[u8]); 4] = [
    ("whisper.dll", b"w"),
    ("ggml.dll", b"g"),
    ("ggml-cpu.dll", b"c"),
    ("ggml-base.dll", b"b"),
];

#[test]
fn assets_resolve_only_from_the_f0_proven_installed_layout() {
    let manifest = fixture_manifest(b"exe", &DLLS, b"model");
    // F0 layout (tauri.conf.json): sidecar and all four DLLs together in the install
    // root; model under resources/models.
    let b = tmp();
    write_layout(
        &b,
        &[
            ("whisper-cli.exe", b"exe"),
            ("resources/models/ggml-base.bin", b"model"),
        ],
    );
    for (n, bytes) in DLLS {
        write_layout(&b, &[(n, bytes)]);
    }
    let found = locate_assets(&manifest, &b, None).unwrap();
    assert_eq!(found.dll_dir, b);
    assert_eq!(found.sidecar.parent(), Some(found.dll_dir.as_path()));
    assert_eq!(found.model, b.join("resources/models/ggml-base.bin"));
    assert_eq!(locate_assets(&manifest, &b, Some(&b)).unwrap(), found);
    // DLLs in a different directory (the old voice/ map) are never accepted: the
    // verified directory must be the one the loader uses.
    let a = tmp();
    write_layout(&a.join("app"), &[("whisper-cli.exe", b"exe")]);
    for (n, bytes) in DLLS {
        write_layout(&a.join("res/voice"), &[(n, bytes)]);
    }
    write_layout(&a.join("res/voice"), &[("ggml-base.bin", b"model")]);
    assert_eq!(
        locate_assets(&manifest, &a.join("app"), Some(&a.join("res"))),
        Err("asr_assets_missing".into())
    );
    // A custom locator that splits sidecar and DLLs fails verification.
    let (m, mut split) = staged(&tmp());
    split.dll_dir = a.join("res/voice");
    assert_eq!(verify_assets(&m, &split), Err("asr_assets_missing".into()));
    // A missing DLL, model or sidecar is a missing runtime; nothing is fetched.
    fs::remove_file(b.join("ggml.dll")).unwrap();
    assert_eq!(
        locate_assets(&manifest, &b, None),
        Err("asr_assets_missing".into())
    );
    let empty = tmp();
    assert_eq!(
        locate_assets(&manifest, &empty, None),
        Err("asr_assets_missing".into())
    );
    for dir in [a, b, empty] {
        let _ = fs::remove_dir_all(dir);
    }
}

fn staged(dir: &Path) -> (AssetManifest, AssetLocations) {
    write_layout(
        dir,
        &[("whisper-cli.exe", b"exe"), ("ggml-base.bin", b"model")],
    );
    for (n, b) in DLLS {
        write_layout(dir, &[(n, b)]);
    }
    (
        fixture_manifest(b"exe", &DLLS, b"model"),
        AssetLocations {
            sidecar: dir.join("whisper-cli.exe"),
            dll_dir: dir.to_path_buf(),
            model: dir.join("ggml-base.bin"),
        },
    )
}

#[test]
fn every_pinned_file_is_hash_verified_and_any_difference_fails() {
    let dir = tmp();
    let (manifest, locations) = staged(&dir);
    verify_assets(&manifest, &locations).unwrap();
    for name in [
        "whisper-cli.exe",
        "ggml-base.bin",
        "whisper.dll",
        "ggml.dll",
        "ggml-cpu.dll",
        "ggml-base.dll",
    ] {
        let path = dir.join(name);
        let original = fs::read(&path).unwrap();
        // Same length, different content: only the hash can catch it.
        let mut altered = original.clone();
        altered[0] ^= 1;
        fs::write(&path, &altered).unwrap();
        assert_eq!(
            verify_assets(&manifest, &locations),
            Err("asr_hash_mismatch".into()),
            "{name}"
        );
        // Different length is also refused.
        fs::write(&path, [original.as_slice(), b"+"].concat()).unwrap();
        assert_eq!(
            verify_assets(&manifest, &locations),
            Err("asr_hash_mismatch".into()),
            "{name} length"
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            verify_assets(&manifest, &locations),
            Err("asr_assets_missing".into()),
            "{name} missing"
        );
        fs::write(&path, &original).unwrap();
        verify_assets(&manifest, &locations).unwrap();
    }
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn unsupported_cpu_blocks_before_any_asset_is_touched() {
    let touched = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = touched.clone();
    let engine = SidecarEngine::new(
        pinned_manifest(),
        Box::new(move || {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
            Err("asr_assets_missing".into())
        }),
        Box::new(|| false),
    );
    assert_eq!(engine.preflight(), Err("unsupported_cpu".into()));
    let work = tmp();
    let outcome = engine.transcribe(&AsrJob {
        derivative_wav: b"x",
        derivative_sha256: &sha(b"x"),
        duration_ms: 1000,
        work_dir: &work,
    });
    assert_eq!(outcome.error_code.as_deref(), Some("unsupported_cpu"));
    assert!(!touched.load(std::sync::atomic::Ordering::SeqCst));
    // The detector itself agrees with the four required features on this host.
    #[cfg(target_arch = "x86_64")]
    assert_eq!(
        cpu_supported(),
        std::is_x86_feature_detected!("avx2")
            && std::is_x86_feature_detected!("fma")
            && std::is_x86_feature_detected!("f16c")
            && std::is_x86_feature_detected!("bmi2")
    );
    let _ = fs::remove_dir_all(work);
}

#[test]
fn recognizer_output_is_parsed_as_untrusted_bounded_text() {
    assert_eq!(
        parse_output(b" Remember to call the dentist.\n").unwrap(),
        "Remember to call the dentist."
    );
    assert_eq!(parse_output(b"\n one\r\n\r\n  two \n").unwrap(), "one two");
    assert_eq!(parse_output(b"").unwrap(), "");
    assert_eq!(parse_output(b" [BLANK_AUDIO]\n").unwrap(), "[BLANK_AUDIO]");
    assert_eq!(
        parse_output("Caf\u{e9} \u{4f60}\u{597d}".as_bytes()).unwrap(),
        "Caf\u{e9} \u{4f60}\u{597d}"
    );
    assert!(parse_output(&[0xff, 0xfe, b'a']).is_err(), "invalid UTF-8");
    assert!(parse_output(b"ab\0cd").is_err(), "NUL");
    assert!(parse_output(b"esc\x1b[31m").is_err(), "control characters");
    assert!(
        parse_output(&vec![b'a'; MAX_TRANSCRIPT_BYTES + 1]).is_err(),
        "bounded"
    );
    // Output can never name a path, permission or status: only text survives.
    assert_eq!(
        parse_output(b"../../evil status=ok").unwrap(),
        "../../evil status=ok"
    );
}

#[cfg(windows)]
mod windows_process {
    use super::*;
    fn system(name: &str) -> PathBuf {
        PathBuf::from(std::env::var("SystemRoot").unwrap())
            .join("System32")
            .join(name)
    }

    #[test]
    fn a_hung_child_is_killed_reaped_and_reported_as_a_timeout() {
        let dir = tmp();
        let run = run_bounded(
            &system("ping.exe"),
            &["-n".into(), "60".into(), "127.0.0.1".into()],
            &dir,
            &dir,
            Duration::from_millis(600),
            4096,
        )
        .unwrap();
        assert!(run.timed_out);
        assert_eq!(run.exit_code, None);
        assert!(run.elapsed < Duration::from_secs(20), "{:?}", run.elapsed);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn output_is_bounded_and_nonzero_exit_is_reported_without_a_shell() {
        let dir = tmp();
        let run = run_bounded(
            &system("ping.exe"),
            &["-n".into(), "1".into(), "127.0.0.1".into()],
            &dir,
            &dir,
            Duration::from_secs(30),
            16,
        )
        .unwrap();
        assert_eq!(run.exit_code, Some(0));
        assert!(run.truncated && run.stdout.len() == 16);
        let failing = run_bounded(
            &system("where.exe"),
            &["definitely-not-a-real-file-xyz".into()],
            &dir,
            &dir,
            Duration::from_secs(30),
            4096,
        )
        .unwrap();
        assert_eq!(failing.exit_code, Some(1));
        assert!(!failing.timed_out);
        // A shell metacharacter argument stays one literal argument.
        let literal = run_bounded(
            &system("where.exe"),
            &["a & echo injected".into()],
            &dir,
            &dir,
            Duration::from_secs(30),
            4096,
        )
        .unwrap();
        assert!(!String::from_utf8_lossy(&literal.stdout).contains("injected"));
        // Missing executable is a launch failure, not a panic.
        assert!(run_bounded(
            &dir.join("nope.exe"),
            &[],
            &dir,
            &dir,
            Duration::from_secs(5),
            16
        )
        .is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn engine_glue_verifies_stages_launches_with_fixed_arguments_and_maps_failures() {
        let dir = tmp();
        // A harmless real executable stands in for the sidecar to exercise the
        // launch glue only; it rejects the arguments and exits nonzero.
        let sidecar = fs::read(system("ping.exe")).unwrap();
        write_layout(
            &dir,
            &[("whisper-cli.exe", &sidecar), ("ggml-base.bin", b"model")],
        );
        for (n, b) in DLLS {
            write_layout(&dir, &[(n, b)]);
        }
        let manifest = fixture_manifest(&sidecar, &DLLS, b"model");
        let locations = AssetLocations {
            sidecar: dir.join("whisper-cli.exe"),
            dll_dir: dir.clone(),
            model: dir.join("ggml-base.bin"),
        };
        let l = locations.clone();
        let engine =
            SidecarEngine::new(manifest, Box::new(move || Ok(l.clone())), Box::new(|| true));
        engine.preflight().unwrap();
        let derivative = audio_wav::derive_16k_mono(&synthetic_wav(16_000, 1, 8_000)).unwrap();
        let work = tmp();
        let outcome = engine.transcribe(&AsrJob {
            derivative_wav: &derivative.wav,
            derivative_sha256: &derivative.sha256,
            duration_ms: 500,
            work_dir: &work,
        });
        assert!(!outcome.completed);
        assert_eq!(outcome.error_code.as_deref(), Some("asr_exit_nonzero"));
        assert_eq!(
            fs::read_dir(&work).unwrap().count(),
            0,
            "staged input is removed"
        );
        // A derivative that does not match its recorded hash never launches.
        let tampered = engine.transcribe(&AsrJob {
            derivative_wav: &derivative.wav,
            derivative_sha256: &"0".repeat(64),
            duration_ms: 500,
            work_dir: &work,
        });
        assert_eq!(tampered.error_code.as_deref(), Some("asr_staging_failed"));
        // An altered runtime file blocks the launch on the very next attempt.
        fs::write(dir.join("whisper.dll"), b"X").unwrap();
        assert_eq!(engine.preflight(), Err("asr_hash_mismatch".into()));
        let blocked = engine.transcribe(&AsrJob {
            derivative_wav: &derivative.wav,
            derivative_sha256: &derivative.sha256,
            duration_ms: 500,
            work_dir: &work,
        });
        assert_eq!(blocked.error_code.as_deref(), Some("asr_hash_mismatch"));
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(work);
    }
}

// ----------------------------------------------------------------------------
// Real pinned sidecar, synthetic speech only. Run explicitly:
//   MONOLITH_SYNTH_SPEECH_16K=<synthetic 16 kHz mono SAPI wav>
//   MONOLITH_SYNTH_SPEECH_48K_STEREO=<synthetic 48 kHz stereo SAPI wav>
//   cargo test --lib real_pinned_sidecar -- --ignored --nocapture
// Needs the staged, git-ignored binaries/ and voice-assets/ (prepare-voice-assets.ps1).
// ----------------------------------------------------------------------------

fn dev_engine() -> SidecarEngine {
    // Mirror the installed layout: sidecar and DLLs together (copied from the staged,
    // git-ignored dev assets); the 148 MB model is used in place.
    static STAGE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dir = STAGE
        .get_or_init(|| {
            let dir = tmp();
            fs::copy(
                root.join("binaries")
                    .join("whisper-cli-x86_64-pc-windows-msvc.exe"),
                dir.join("whisper-cli.exe"),
            )
            .unwrap();
            for dll in &pinned_manifest().runtime.dlls {
                fs::copy(
                    root.join("voice-assets").join(&dll.name),
                    dir.join(&dll.name),
                )
                .unwrap();
            }
            dir
        })
        .clone();
    let locations = AssetLocations {
        sidecar: dir.join("whisper-cli.exe"),
        dll_dir: dir,
        model: root.join("voice-assets").join("ggml-base.bin"),
    };
    SidecarEngine::new(
        pinned_manifest(),
        Box::new(move || Ok(locations.clone())),
        Box::new(cpu_supported),
    )
}
fn synthetic_speech(var: &str) -> Vec<u8> {
    let path = std::env::var(var).unwrap_or_else(|_| panic!("set {var} to a synthetic SAPI WAV"));
    fs::read(path).unwrap()
}
fn run_real(engine: &SidecarEngine, wav: &[u8]) -> AsrOutcome {
    let derived = audio_wav::derive_16k_mono(wav).unwrap();
    let work = tmp();
    let outcome = engine.transcribe(&AsrJob {
        derivative_wav: &derived.wav,
        derivative_sha256: &derived.sha256,
        duration_ms: audio_wav::parse_wav(wav).unwrap().duration_ms,
        work_dir: &work,
    });
    let _ = fs::remove_dir_all(work);
    outcome
}
fn report(label: &str, outcome: &AsrOutcome) {
    eprintln!(
        "REAL-SIDECAR {label}: completed={} exit={:?} elapsed_ms={} peak_ws_bytes={:?} error={:?} transcript={:?}",
        outcome.completed, outcome.exit_code, outcome.elapsed_ms, outcome.peak_working_set_bytes, outcome.error_code, outcome.text
    );
}

#[test]
#[ignore = "runs the real pinned whisper.cpp sidecar on synthetic speech (slow; needs staged assets)"]
fn real_pinned_sidecar_transcribes_synthetic_speech_and_handles_silence() {
    let engine = dev_engine();
    let verify_started = Instant::now();
    engine.preflight().expect("pinned assets must verify");
    eprintln!(
        "REAL-SIDECAR preflight (cpu + 6 hashes, debug build): {:?}",
        verify_started.elapsed()
    );

    // Known speech, 16 kHz mono (bypass transform) and 48 kHz stereo (rubato path).
    let mono = run_real(&engine, &synthetic_speech("MONOLITH_SYNTH_SPEECH_16K"));
    report("speech-16k-mono", &mono);
    assert!(mono.completed, "{mono:?}");
    let text = mono.text.clone().unwrap().to_lowercase();
    assert!(
        text.contains("dentist") && text.contains("tomorrow") && text.contains("afternoon"),
        "{text}"
    );
    let stereo = run_real(
        &engine,
        &synthetic_speech("MONOLITH_SYNTH_SPEECH_48K_STEREO"),
    );
    report("speech-48k-stereo", &stereo);
    assert!(stereo.completed, "{stereo:?}");
    let text = stereo.text.clone().unwrap().to_lowercase();
    assert!(
        text.contains("dentist") && text.contains("tomorrow"),
        "{text}"
    );

    // Gain-reduced speech and a pure tone, measured and reported (F0 saw an omitted
    // time phrase at low gain and a [Music] label for the tone).
    let speech = synthetic_speech("MONOLITH_SYNTH_SPEECH_16K");
    let info = audio_wav::parse_wav(&speech).unwrap();
    let quiet_pcm: Vec<u8> = speech[info.data_offset..info.data_offset + info.data_len]
        .chunks_exact(2)
        .flat_map(|b| {
            (((i16::from_le_bytes([b[0], b[1]]) as f64) * 0.05).round() as i16).to_le_bytes()
        })
        .collect();
    let quiet = audio_wav::build_wav(16_000, 1, &quiet_pcm);
    let quiet_rms = audio_wav::rms_rounded(audio_wav::rms_pcm16(&quiet_pcm));
    let quiet_out = run_real(&engine, &quiet);
    report(
        &format!("speech-gain-5-percent rms={quiet_rms}"),
        &quiet_out,
    );
    assert!(
        quiet_rms > crate::local_vault::RMS_GATE,
        "quiet speech must not be gate-rejected"
    );
    let tone_pcm: Vec<u8> = (0..16_000usize * 5)
        .flat_map(|n| {
            let s = (((n as f64) * 440.0 * std::f64::consts::TAU / 16_000.0).sin() * 1000.0).round()
                as i16;
            s.to_le_bytes()
        })
        .collect();
    let tone_out = run_real(&engine, &audio_wav::build_wav(16_000, 1, &tone_pcm));
    report("tone-440hz", &tone_out);
    let tone_text = tone_out.text.clone().unwrap_or_default();
    let tone_rms = audio_wav::rms_rounded(audio_wav::rms_pcm16(&tone_pcm));
    let tone_class = crate::local_vault::classify_machine_output(&tone_text, tone_rms);
    eprintln!("REAL-SIDECAR tone classification: {tone_class:?}");
    assert!(
        !tone_class.0,
        "a pure tone must be ineligible, got {tone_text:?}"
    );

    // Exact silence, straight through the recognizer: F0 observed a hallucination.
    let silence = audio_wav::build_wav(16_000, 1, &vec![0u8; 16_000 * 2 * 5]);
    let direct = run_real(&engine, &silence);
    report("silence-direct (ungated)", &direct);
    assert!(direct.completed);

    // Corrupt input is a nonzero exit, not a transcript.
    let work = tmp();
    let corrupt = engine.transcribe(&AsrJob {
        derivative_wav: b"RIFF....not a wav",
        derivative_sha256: &sha(b"RIFF....not a wav"),
        duration_ms: 1000,
        work_dir: &work,
    });
    report("corrupt", &corrupt);
    assert!(!corrupt.completed);
    assert_eq!(corrupt.error_code.as_deref(), Some("asr_exit_nonzero"));
    let _ = fs::remove_dir_all(work);

    // Full pipeline: saved original, gated silence, then a real eligible transcript.
    struct NoDevice;
    impl InputBackend for NoDevice {
        fn open(
            &self,
            _: SampleSink,
        ) -> std::result::Result<
            (CaptureConfig, Box<dyn CaptureHandle>),
            crate::local_audio::AudioFailure,
        > {
            Err(crate::local_audio::AudioFailure::UnsupportedDevice)
        }
    }
    let dir = tmp();
    let root = dir.join("vault");
    fs::create_dir_all(&root).unwrap();
    let state = LocalVaultState::new(dir.join("selected.json"));
    let token = state.select_path(&root).unwrap().vault_id.unwrap();
    let guard = state.session(&token).unwrap();
    let audio = AudioState::new(
        dir.join("stage"),
        Arc::new(NoDevice),
        Arc::new(dev_engine()),
    );
    let import = |bytes: &[u8]| -> String {
        let file = dir.join(format!("{}.wav", Uuid::new_v4()));
        fs::write(&file, bytes).unwrap();
        let id = Uuid::new_v4().to_string();
        audio
            .import_wav(&guard, &id, || Some(file))
            .unwrap()
            .unwrap();
        id
    };
    let wait = |id: &str, states: &[&str]| -> AudioOperationStatus {
        let started = Instant::now();
        loop {
            let s = audio.status_of(&guard, id).unwrap();
            if states.contains(&s.state.as_str()) {
                return s;
            }
            assert!(started.elapsed() < Duration::from_secs(120), "{s:?}");
            std::thread::sleep(Duration::from_millis(50));
        }
    };
    let gated_id = import(&silence);
    let gated = wait(&gated_id, &["transcription_unavailable", "transcribed"]);
    eprintln!(
        "REAL-SIDECAR pipeline silence: state={} code={:?} (recognizer launched: no)",
        gated.state, gated.error_code
    );
    assert_eq!(gated.error_code.as_deref(), Some("rms_gate"));
    let speech_id = import(&synthetic_speech("MONOLITH_SYNTH_SPEECH_16K"));
    let started = Instant::now();
    let done = wait(
        &speech_id,
        &["transcribed", "transcription_unavailable", "unknown"],
    );
    eprintln!(
        "REAL-SIDECAR pipeline speech: state={} wait_ms={} machine={:?}",
        done.state,
        started.elapsed().as_millis(),
        done.memory
            .as_ref()
            .and_then(|m| m.audio_transcript.as_ref())
            .map(|t| (
                &t.machine.text,
                &t.machine.eligibility,
                t.machine.input_rms_pcm16
            ))
    );
    assert_eq!(done.state, "transcribed");
    let machine = done.memory.unwrap().audio_transcript.unwrap().machine;
    assert_eq!(
        machine.runtime_binary_sha256,
        pinned_manifest().runtime.binary.sha256
    );
    assert_eq!(machine.model_sha256, pinned_manifest().model.sha256);
    assert_eq!(machine.eligibility, "eligible");
    let _ = fs::remove_dir_all(dir);
}
