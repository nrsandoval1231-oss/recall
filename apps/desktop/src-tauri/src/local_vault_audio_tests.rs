//! Real-file, real-vault tests for the v9 audio source/transcript format. All
//! audio here is clearly synthetic (deterministic integer pseudo-signal).
use super::*;
use crate::audio_wav::fixtures::{synthetic_pcm, synthetic_wav};

struct Fx(PathBuf);
impl Fx {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("recall-synthetic-audio-{}", Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn vault(&self) -> Vault {
        Vault::open(&self.0).unwrap()
    }
}
impl Drop for Fx {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn wav() -> Vec<u8> {
    synthetic_wav(16_000, 1, 16_000)
}
fn identity() -> AsrIdentity {
    AsrIdentity {
        runtime_source_commit: "d".repeat(40),
        runtime_binary_sha256: "a".repeat(64),
        model_sha256: "b".repeat(64),
    }
}
fn machine_for(memory: &VaultMemory, text: &str, rms: f64, op_id: &str) -> AudioMachineTranscript {
    let (eligible, flags) = classify_machine_output(text, rms);
    AudioMachineTranscript {
        operation_id: op_id.into(),
        source_sha256: memory.source_sha256.clone(),
        source_revision: 1,
        runtime_source_commit: "d".repeat(40),
        runtime_binary_sha256: "a".repeat(64),
        model_sha256: "b".repeat(64),
        derivative_sha256: "c".repeat(64),
        transform_version: audio_wav::TRANSFORM_VERSION.into(),
        output_sha256: hash(text.as_bytes()),
        text: text.into(),
        segments: None,
        input_rms_pcm16: rms,
        quality_flags: flags,
        eligibility: if eligible { "eligible" } else { "ineligible" }.into(),
        quality_state: "machine_unreviewed".into(),
    }
}
fn recorded(vault: &Vault) -> VaultMemory {
    vault
        .audio_commit_capture(&op(), &wav(), "recorded", None)
        .unwrap()
}
fn manifest_format(vault: &Vault) -> String {
    decode::<Manifest>(&vault.path("_meta/manifest.json"))
        .unwrap()
        .format
}

#[test]
fn recorded_wav_is_published_byte_identical_with_full_file_hash_and_v9_event() {
    let f = Fx::new();
    let vault = f.vault();
    let bytes = wav();
    let memory = vault
        .audio_commit_capture(&op(), &bytes, "recorded", None)
        .unwrap();
    assert_eq!(manifest_format(&vault), FORMAT_V9);
    let source = memory.audio_source.as_ref().unwrap();
    assert_eq!(source.source_sha256, hash(&bytes));
    assert_eq!(memory.source_sha256, hash(&bytes));
    assert_eq!(source.source_bytes, bytes.len() as u64);
    assert_eq!(source.media_type, "audio/wav");
    assert_eq!(
        (
            source.sample_rate_hz,
            source.channels,
            source.pcm_bits,
            source.duration_ms
        ),
        (16_000, 1, 16, 1000)
    );
    assert_eq!(source.capture_origin, "recorded");
    assert!(source.original_name.is_none() && memory.audio_transcript.is_none());
    assert_eq!(
        fs::read(vault.path(&format!("Sources/{}.wav", memory.id))).unwrap(),
        bytes
    );
    let served = vault.source(&memory.id).unwrap();
    assert_eq!(
        (served.mime_type.as_str(), served.bytes, served.sha256),
        ("audio/wav", bytes.clone(), hash(&bytes))
    );
    let event = &vault.records(&memory.id).unwrap()[0];
    assert_eq!(
        (event.format.as_str(), event.kind.as_str()),
        (FORMAT_V9, "capture")
    );
    assert_eq!(event.origin, "human:recall");
    assert!(event.context_link_projection.as_deref() == Some(&[][..]));
    let note = fs::read_to_string(vault.note_path(&memory.id)).unwrap();
    assert!(note.contains("[Original recording](../Sources/"));
    assert!(note.contains("## Human annotation\n\n"));
    // The renderer-facing DTO carries explicit nulls; the on-disk v9 event
    // carries only the fields that exist.
    let dto = serde_json::to_value(&memory).unwrap();
    assert!(dto["audio_transcript"].is_null());
    assert_eq!(dto["audio_source"]["source_bytes"], bytes.len());
    assert_eq!(vault.list("").unwrap().len(), 1);
}

#[test]
fn duplicate_operation_ids_replay_and_changed_payloads_conflict() {
    let f = Fx::new();
    let vault = f.vault();
    let id_ = op();
    let bytes = wav();
    let first = vault
        .audio_commit_capture(&id_, &bytes, "recorded", None)
        .unwrap();
    let again = vault
        .audio_commit_capture(&id_, &bytes, "recorded", None)
        .unwrap();
    assert_eq!(
        (again.revision, again.id.as_str()),
        (first.revision, id_.as_str())
    );
    assert_eq!(vault.records(&id_).unwrap().len(), 1);
    let other = synthetic_wav(16_000, 1, 8_000);
    assert!(vault
        .audio_commit_capture(&id_, &other, "recorded", None)
        .is_err());
    assert!(vault
        .audio_commit_capture(&id_, &bytes, "imported_wav", Some("a.wav"))
        .is_err());
    // Operation families cannot alias.
    assert!(vault.capture_text(&id_, "text under an audio ID").is_err());
    assert!(vault.audio_capture_receipt(&id_).unwrap().is_some());
    assert_eq!(
        fs::read(vault.path(&format!("Sources/{id_}.wav"))).unwrap(),
        bytes
    );
}

#[test]
fn v9_upgrade_keeps_prior_bytes_old_writers_refuse_and_later_writes_stay_v9() {
    let f = Fx::new();
    let vault = f.vault();
    let text = vault.capture_text(&op(), "prior v5 note").unwrap();
    let (import_path, _keep) = {
        let d = Fx::new();
        let p = d.0.join("source.txt");
        fs::write(&p, b"imported before v9").unwrap();
        (p, d)
    };
    let imported = vault.import_text_path(&op(), &import_path).unwrap();
    assert_eq!(manifest_format(&vault), FORMAT_V8);
    let prior: Vec<(PathBuf, Vec<u8>)> = [&text, &imported]
        .iter()
        .flat_map(|m| {
            [
                vault.history_path(&m.id, 1),
                vault.note_path(&m.id),
                vault.journal_path(&m.id),
                vault.done_path(&m.id),
            ]
        })
        .map(|p| {
            let bytes = fs::read(&p).unwrap();
            (p, bytes)
        })
        .collect();
    let v8_manifest = fs::read(vault.path("_meta/manifest.json")).unwrap();
    let audio = recorded(&vault);
    assert_eq!(manifest_format(&vault), FORMAT_V9);
    // The exact prior manifest is preserved, and nothing prior was rewritten.
    assert_eq!(
        fs::read(vault.path("_meta/manifest-v8.json")).unwrap(),
        v8_manifest
    );
    for (path, bytes) in &prior {
        assert_eq!(&fs::read(path).unwrap(), bytes, "{path:?}");
    }
    // Old writers refuse v9: every earlier fence function fails closed instead of downgrading.
    let manifest_bytes = fs::read(vault.path("_meta/manifest.json")).unwrap();
    assert!(vault.fence_manifest_v8().is_err());
    assert!(
        vault.fence_manifest_v7().is_ok(),
        "v7 fence is satisfied by any later format"
    );
    assert_eq!(
        fs::read(vault.path("_meta/manifest.json")).unwrap(),
        manifest_bytes
    );
    // Every mutation path now keeps the v9 envelope.
    let typed = vault.capture_text(&op(), "typed after v9").unwrap();
    assert_eq!(vault.records(&typed.id).unwrap()[0].format, FORMAT_V9);
    let corrected = vault
        .correct(
            &imported.id,
            imported.revision,
            &op(),
            "human correction after v9",
        )
        .unwrap();
    let records = vault.records(&imported.id).unwrap();
    assert_eq!(records[0].format, FORMAT_V8);
    assert_eq!(records[1].format, FORMAT_V9);
    assert_eq!(corrected.revision, 2);
    let note = vault
        .correct(&audio.id, audio.revision, &op(), "my annotation")
        .unwrap();
    assert_eq!(note.note, "my annotation");
    assert_eq!(vault.records(&audio.id).unwrap()[1].format, FORMAT_V9);
    let removed = vault
        .remove(&typed.id, typed.revision, &op(), "active")
        .unwrap();
    assert_eq!(removed.state, "deleted");
    assert_eq!(vault.records(&typed.id).unwrap()[1].format, FORMAT_V9);
    // Reopening replays every history (v5, v8, v9) cleanly.
    let reopened = f.vault();
    assert_eq!(reopened.list_with_deleted("", true).unwrap().len(), 4);
    assert!(reopened
        .list_with_deleted("", true)
        .unwrap()
        .iter()
        .all(|m| m.conflict.is_none()));
}

#[test]
fn v1_to_v8_events_never_serialize_audio_fields() {
    let f = Fx::new();
    let vault = f.vault();
    let m = vault.capture_text(&op(), "plain").unwrap();
    let bytes = fs::read(vault.history_path(&m.id, 1)).unwrap();
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("audio_source") && !text.contains("audio_transcript"));
    let dto = serde_json::to_value(&m).unwrap();
    assert!(dto["audio_source"].is_null() && dto["audio_transcript"].is_null());
}

#[test]
fn imported_wav_validates_bytes_and_refuses_unsafe_or_corrupt_files() {
    let f = Fx::new();
    let vault = f.vault();
    let dir = Fx::new();
    let good = dir.0.join("meeting.WAV");
    fs::write(&good, wav()).unwrap();
    let (name, bytes) = read_wav_import(&good).unwrap();
    assert_eq!(name, "meeting.WAV");
    let m = vault
        .audio_commit_capture(&op(), &bytes, "imported_wav", Some(&name))
        .unwrap();
    assert_eq!(
        m.audio_source.as_ref().unwrap().original_name.as_deref(),
        Some("meeting.WAV")
    );
    assert_eq!(m.source_name, "meeting.WAV");
    assert_eq!(vault.source(&m.id).unwrap().bytes, bytes);
    // The display name never became path authority.
    assert!(vault.path(&format!("Sources/{}.wav", m.id)).exists());
    assert!(!vault.path("Sources/meeting.WAV").exists());

    for (label, content) in [
        ("corrupt.wav", b"RIFF....WAVEgarbage".to_vec()),
        ("float.wav", {
            let mut w = wav();
            w[20] = 3;
            w
        }),
        ("truncated.wav", wav()[..1000].to_vec()),
        ("not-audio.wav", b"just text pretending".to_vec()),
    ] {
        let path = dir.0.join(label);
        fs::write(&path, content).unwrap();
        assert!(read_wav_import(&path).is_err(), "{label}");
    }
    // Wrong extension / name rules are checked even when the bytes are valid.
    let wrong = dir.0.join("audio.mp3");
    fs::write(&wrong, wav()).unwrap();
    assert!(read_wav_import(&wrong).is_err());
    assert!(safe_wav_name("..\\evil.wav").is_err());
    assert!(safe_wav_name("a/b.wav").is_err());
    assert!(safe_wav_name(".wav").is_err());
    assert!(safe_wav_name("ok name.wav").is_ok());
    // Directories and missing files.
    assert!(read_wav_import(&dir.0).is_err());
    assert!(read_wav_import(&dir.0.join("missing.wav")).is_err());
    // Oversize (beyond 24 MiB of PCM) is refused before any parsing of content.
    let huge = dir.0.join("huge.wav");
    let file = File::create(&huge).unwrap();
    file.set_len(MAX_WAV_FILE_BYTES as u64 + 1).unwrap();
    drop(file);
    assert!(read_wav_import(&huge).is_err());
}

#[test]
fn imported_wav_refuses_symlinks_and_links_when_the_platform_allows_creating_them() {
    let dir = Fx::new();
    let target = dir.0.join("real.wav");
    fs::write(&target, wav()).unwrap();
    let link = dir.0.join("link.wav");
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(&target, &link);
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&target, &link);
    match created {
        Ok(()) => assert!(read_wav_import(&link).is_err(), "symlink must be refused"),
        Err(e) => eprintln!("SKIPPED symlink assertion: cannot create symlink here ({e})"),
    }
    assert!(read_wav_import(&target).is_ok());
}

#[test]
fn source_mutation_is_detected_and_removes_the_recording_from_evidence() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let machine = machine_for(&m, "Remember the dentist tomorrow.", 2800.0, &op());
    vault
        .audio_apply_machine_transcript(&m.id, machine)
        .unwrap();
    assert_eq!(vault.ask_candidates().unwrap().len(), 1);
    let path = vault.path(&format!("Sources/{}.wav", m.id));
    let mut tampered = fs::read(&path).unwrap();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x7f;
    fs::write(&path, tampered).unwrap();
    assert!(vault.source(&m.id).unwrap_err().contains("hash mismatch"));
    assert!(vault.ask_candidates().unwrap().is_empty());
    let listed = vault.list("").unwrap();
    assert_eq!(listed[0].state, "conflict");
    assert!(listed[0]
        .conflict
        .as_deref()
        .unwrap()
        .contains("hash mismatch"));
}

#[test]
fn event_validation_rejects_forged_audio_provenance() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let good = vault.records(&m.id).unwrap().remove(0);
    let reject = |mutate: &dyn Fn(&mut Event)| {
        let mut e = good.clone();
        mutate(&mut e);
        assert!(vault.event_valid(&e).is_err());
    };
    reject(&|e| e.memory.audio_source.as_mut().unwrap().source_sha256 = "0".repeat(64));
    reject(&|e| e.memory.audio_source.as_mut().unwrap().channels = 6);
    reject(&|e| e.memory.audio_source.as_mut().unwrap().sample_rate_hz = 22_050);
    reject(&|e| e.memory.audio_source.as_mut().unwrap().duration_ms = 121_000);
    reject(&|e| e.memory.audio_source.as_mut().unwrap().media_type = "audio/mpeg".into());
    reject(&|e| e.memory.audio_source.as_mut().unwrap().original_name = Some("x.wav".into()));
    reject(&|e| e.format = FORMAT_V8.into());
    reject(&|e| e.memory.source_name = "recording.png".into());
    reject(&|e| e.kind = "audio_transcription".into());
    reject(&|e| {
        e.memory.imported_text = Some(ImportedText {
            original_name: "a.txt".into(),
            original_extension: "txt".into(),
            source_media_type: "text/plain; charset=utf-8".into(),
            semantic_sha256: "0".repeat(64),
            semantic_bytes: 0,
            semantic_characters: 0,
        })
    });
    // A text event may not carry audio provenance.
    let t = vault.capture_text(&op(), "text").unwrap();
    let mut text_event = vault.records(&t.id).unwrap().remove(0);
    text_event.memory.audio_source = good.memory.audio_source.clone();
    assert!(vault.event_valid(&text_event).is_err());
}

#[test]
fn recognizer_request_dispatch_and_result_are_create_only_and_unknown_is_never_rerun() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    assert!(vault.audio_asr_state(&m.id).unwrap().is_none());
    let begin = vault.audio_asr_begin(&m.id, &identity()).unwrap();
    assert_eq!(begin.phase, AsrPhase::Fresh);
    let derivative = begin.derivative.clone().unwrap();
    assert_eq!(hash(&derivative), begin.request.derivative_sha256);
    assert_eq!(begin.request.source_sha256, m.source_sha256);
    assert_eq!(
        begin.request.transform_version,
        audio_wav::TRANSFORM_VERSION
    );
    // Resuming returns the same single request; no second ID is ever minted.
    let again = vault.audio_asr_begin(&m.id, &identity()).unwrap();
    assert_eq!(again.request, begin.request);
    vault.audio_asr_mark_dispatched(&begin.request).unwrap();
    assert!(
        vault.audio_asr_mark_dispatched(&begin.request).is_err(),
        "no blind rerun"
    );
    let lost = vault.audio_asr_begin(&m.id, &identity()).unwrap();
    assert_eq!(
        lost.phase,
        AsrPhase::Unknown,
        "launched without a result is UNKNOWN"
    );
    assert!(lost.derivative.is_none());
    assert!(vault.audio_pending_asr().unwrap().is_empty());
    assert!(
        vault.audio_asr_commit(&begin.request).is_err(),
        "no result, nothing to promote"
    );
}

#[test]
fn source_is_saved_before_the_recognizer_request_exists() {
    let f = Fx::new();
    let vault = f.vault();
    let id_ = op();
    assert!(vault.audio_asr_begin(&id_, &identity()).is_err());
    let m = vault
        .audio_commit_capture(&id_, &wav(), "recorded", None)
        .unwrap();
    // The capture receipt and immutable original are durable before ASR metadata.
    assert!(vault.done_path(&id_).exists());
    assert!(!vault.path(&format!("_meta/audio/{}", m.id)).exists());
    assert_eq!(vault.audio_pending_asr().unwrap(), vec![id_.clone()]);
    vault.audio_asr_begin(&m.id, &identity()).unwrap();
    assert!(vault
        .path(&format!("_meta/audio/{}/asr-request.json", m.id))
        .exists());
}

#[test]
fn machine_transcript_correction_precedence_history_and_rerun_rules() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let machine = machine_for(&m, "Remember to call the dentist tomorrow.", 2800.0, &op());
    let transcribed = vault
        .audio_apply_machine_transcript(&m.id, machine.clone())
        .unwrap();
    assert_eq!(transcribed.revision, 2);
    let t = transcribed.audio_transcript.as_ref().unwrap();
    assert_eq!(t.machine, machine);
    assert!(t.human_correction.is_none());
    let event = vault.records(&m.id).unwrap().pop().unwrap();
    assert_eq!(event.kind, "audio_transcription");
    assert_eq!(event.origin, "machine:whisper-local");
    // Same ID, same payload: idempotent replay. Different payload: conflict.
    let replay = vault
        .audio_apply_machine_transcript(&m.id, machine.clone())
        .unwrap();
    assert_eq!(replay.revision, 2);
    let mut other = machine.clone();
    other.text = "different".into();
    assert!(vault.audio_apply_machine_transcript(&m.id, other).is_err());
    // Search follows the eligible machine wording.
    assert_eq!(vault.list("dentist").unwrap().len(), 1);
    let candidates = vault.ask_candidates().unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].evidence_kind, "machine_audio_transcript");
    assert_eq!(candidates[0].epistemic_state, "unreviewed");
    assert_eq!(candidates[0].text, "Remember to call the dentist tomorrow.");

    std::thread::sleep(std::time::Duration::from_secs(1));
    // Human correction: expected revision, stable ID, replay-safe, conflict-safe.
    let cid = op();
    assert!(
        vault.audio_correct(&m.id, 1, &cid, "stale").is_err(),
        "stale revision conflicts"
    );
    let corrected = vault
        .audio_correct(
            &m.id,
            transcribed.revision,
            &cid,
            "Call the dentist on Friday.",
        )
        .unwrap();
    assert_eq!(corrected.revision, 3);
    let ct = corrected.audio_transcript.as_ref().unwrap();
    assert_eq!(ct.machine, machine, "machine bytes are preserved");
    assert_eq!(
        ct.human_correction.as_ref().unwrap().text,
        "Call the dentist on Friday."
    );
    assert_eq!(
        vault
            .audio_correct(
                &m.id,
                transcribed.revision,
                &cid,
                "Call the dentist on Friday."
            )
            .unwrap()
            .revision,
        3
    );
    assert!(vault
        .audio_correct(&m.id, transcribed.revision, &cid, "other")
        .is_err());
    // Current search/Ask follow the correction; stale machine wording is gone.
    assert!(vault.list("tomorrow").unwrap().is_empty());
    assert_eq!(vault.list("friday").unwrap().len(), 1);
    let candidates = vault.ask_candidates().unwrap();
    assert_eq!(candidates[0].evidence_kind, "human_audio_correction");
    assert_eq!(candidates[0].epistemic_state, "reported");
    assert_eq!(candidates[0].text, "Call the dentist on Friday.");
    // A machine re-run never overwrites the human correction.
    let rerun = machine_for(&m, "Remember the dentist on tuesday.", 2800.0, &op());
    let after = vault
        .audio_apply_machine_transcript(&m.id, rerun.clone())
        .unwrap();
    let at = after.audio_transcript.as_ref().unwrap();
    assert_eq!(at.machine, rerun);
    assert_eq!(
        at.human_correction.as_ref().unwrap().text,
        "Call the dentist on Friday."
    );
    assert_eq!(
        vault.ask_candidates().unwrap()[0].text,
        "Call the dentist on Friday."
    );
    // History retains each machine reading and the correction.
    let history = vault.history(&m.id).unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(
        history[1].audio_transcript.as_ref().unwrap().machine.text,
        machine.text
    );
    assert!(history[1]
        .audio_transcript
        .as_ref()
        .unwrap()
        .human_correction
        .is_none());
    assert_eq!(history[2].kind, "audio_transcript_correction");
    // Deliberately empty correction suppresses everything current.
    let blank = vault
        .audio_correct(&m.id, after.revision, &op(), "")
        .unwrap();
    assert_eq!(
        blank
            .audio_transcript
            .as_ref()
            .unwrap()
            .human_correction
            .as_ref()
            .unwrap()
            .text,
        ""
    );
    assert!(vault.ask_candidates().unwrap().is_empty());
    assert!(vault.list("friday").unwrap().is_empty());
    assert!(vault.source(&m.id).is_ok(), "the original stays openable");
}

#[test]
fn ineligible_machine_output_never_becomes_search_or_ask_evidence() {
    let f = Fx::new();
    let vault = f.vault();
    for (text, rms, flag) in [
        ("you", 0.0, "rms_gate"),
        ("", 2000.0, "empty_output"),
        ("[Music]", 22.7, "non_speech_annotation"),
        (" [BLANK_AUDIO] ", 148.0, "non_speech_annotation"),
        ("[Music] [Music]", 90.0, "non_speech_annotation"),
        (
            "[Music]
[BLANK_AUDIO]
",
            90.0,
            "non_speech_annotation",
        ),
        ("(crickets chirping)", 1000.0, "non_speech_annotation"),
        ("\u{266a} \u{266a}", 1000.0, "non_speech_annotation"),
        ("[ Silence ] ...", 1000.0, "non_speech_annotation"),
    ] {
        let m = recorded(&vault);
        let machine = machine_for(&m, text, rms, &op());
        assert_eq!(machine.eligibility, "ineligible");
        assert_eq!(machine.quality_flags, vec![flag.to_owned()]);
        vault
            .audio_apply_machine_transcript(&m.id, machine)
            .unwrap();
    }
    assert!(vault.ask_candidates().unwrap().is_empty());
    assert!(vault.list("you").unwrap().is_empty());
    assert!(vault.list("music").unwrap().is_empty());
    assert!(vault.list("crickets").unwrap().is_empty());
    // Eligibility is derived, not trusted: a forged "eligible" flag is rejected.
    let m = recorded(&vault);
    let mut forged = machine_for(&m, "[Music]", 22.7, &op());
    forged.eligibility = "eligible".into();
    forged.quality_flags.clear();
    assert!(vault.audio_apply_machine_transcript(&m.id, forged).is_err());
    // A human can still supply wording for an ineligible recording.
    let ineligible = recorded(&vault);
    let t = vault
        .audio_apply_machine_transcript(
            &ineligible.id,
            machine_for(&ineligible, "[Music]", 22.7, &op()),
        )
        .unwrap();
    let fixed = vault
        .audio_correct(&ineligible.id, t.revision, &op(), "A human typed this.")
        .unwrap();
    assert_eq!(
        fixed.audio_transcript.unwrap().machine.eligibility,
        "ineligible"
    );
    assert_eq!(vault.ask_candidates().unwrap().len(), 1);
}

#[test]
fn current_and_historical_ask_use_audio_only_after_verification_and_pair_corrections() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let machine = machine_for(&m, "The meeting is in Zurich.", 2800.0, &op());
    let t = vault
        .audio_apply_machine_transcript(&m.id, machine)
        .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    let c = vault
        .audio_correct(&m.id, t.revision, &op(), "The meeting is in Geneva.")
        .unwrap();
    let end = utc_second(&c.updated_at).unwrap();
    let start = end - 86_400;
    let fmt = |v: u64| {
        let days = (v / 86_400) as i64;
        let z = days + 719468;
        let era = z.div_euclid(146097);
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let mut y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let mo = mp + if mp < 10 { 3 } else { -9 };
        y += i64::from(mo <= 2);
        format!(
            "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z",
            v / 3600 % 24,
            v / 60 % 60,
            v % 60
        )
    };
    let selection = vault
        .ask_history("Where is the meeting?", &fmt(start), &fmt(end), false)
        .unwrap_or_else(|e| panic!("history selection failed: {e}"));
    // The machine reading is retained with the later correction as its counterpoint.
    let kinds: Vec<_> = selection
        .evidence
        .iter()
        .map(|e| e.evidence_kind.as_str())
        .collect();
    assert!(kinds.contains(&"machine_audio_transcript"), "{kinds:?}");
    assert!(kinds.contains(&"human_audio_correction"), "{kinds:?}");
    let machine_evidence = selection
        .evidence
        .iter()
        .find(|e| e.evidence_kind == "machine_audio_transcript")
        .unwrap();
    assert_eq!(machine_evidence.history_status, "as_of_later_corrected");
    assert_eq!(machine_evidence.epistemic_state, "unreviewed");
    let citation = vault
        .history_citation(
            &m.id,
            machine_evidence.revision,
            &machine_evidence.event_sha256,
            &machine_evidence.source_sha256,
            &machine_evidence.excerpt,
        )
        .unwrap();
    assert_eq!(citation.original.mime_type, "audio/wav");
    assert_eq!(citation.original.sha256, m.source_sha256);
    assert!(citation.retained_revision.audio_transcript.is_some());
    // The quote must be a real span of the retained wording.
    assert!(vault
        .history_citation(
            &m.id,
            machine_evidence.revision,
            &machine_evidence.event_sha256,
            &machine_evidence.source_sha256,
            "never said"
        )
        .is_err());
    // After a source mutation, neither current nor retained evidence is offered.
    let path = vault.path(&format!("Sources/{}.wav", m.id));
    let mut bytes = fs::read(&path).unwrap();
    bytes[60] ^= 0xff;
    fs::write(&path, bytes).unwrap();
    assert!(vault.ask_candidates().unwrap().is_empty());
    assert_eq!(
        vault
            .ask_history("Where is the meeting?", &fmt(start), &fmt(end), false)
            .unwrap()
            .evidence
            .len(),
        0
    );
}

#[test]
fn direct_obsidian_edits_touch_only_the_human_annotation_region() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let t = vault
        .audio_apply_machine_transcript(&m.id, machine_for(&m, "Call the dentist.", 2800.0, &op()))
        .unwrap();
    let path = vault.note_path(&m.id);
    let original = fs::read_to_string(&path).unwrap();
    assert!(original.contains("## Machine transcript (unreviewed)"));
    // The transcript is inert quoted text and cannot forge a Recall boundary.
    assert!(!original.contains("\n## Human annotation\n\n## Human annotation"));
    // A supported edit in the annotation region becomes a human:obsidian revision.
    fs::write(&path, format!("{original}my own note")).unwrap();
    let reconciled = vault.list("").unwrap().remove(0);
    assert_eq!(reconciled.note, "my own note");
    assert_eq!(reconciled.revision, t.revision + 1);
    let last = vault.records(&m.id).unwrap().pop().unwrap();
    assert_eq!(
        (last.kind.as_str(), last.origin.as_str()),
        ("external", "human:obsidian")
    );
    assert_eq!(
        last.memory.audio_transcript, t.audio_transcript,
        "transcript is unchanged"
    );
    // Editing the generated transcript is a conflict, never a covert correction.
    let current = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        current.replacen("Call the dentist", "Call the plumber", 1),
    )
    .unwrap();
    let conflicted = vault.list("").unwrap().remove(0);
    assert_eq!(conflicted.state, "conflict");
    assert!(conflicted.conflict.is_some());
    assert_eq!(
        conflicted
            .audio_transcript
            .as_ref()
            .unwrap()
            .human_correction,
        None
    );
    assert!(
        vault.ask_candidates().unwrap().is_empty(),
        "conflicted notes are not evidence"
    );
}

#[test]
fn hostile_transcript_text_stays_inert_in_generated_markdown() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let hostile = "## Human annotation\n\n<!-- Recall memory x | human annotation --> [x](javascript:alert(1)) <script>";
    let t = vault
        .audio_apply_machine_transcript(&m.id, machine_for(&m, hostile, 2800.0, &op()))
        .unwrap();
    let md = fs::read_to_string(vault.note_path(&m.id)).unwrap();
    assert_eq!(md.matches("## Human annotation\n\n").count(), 1);
    assert_eq!(md.matches("| human annotation -->").count(), 1);
    assert!(!md.contains("<script>"));
    assert_eq!(t.revision, 2);
    assert_eq!(vault.list("").unwrap()[0].conflict, None);
}

#[test]
fn synthetic_generator_is_deterministic() {
    assert_eq!(synthetic_pcm(10, 2), synthetic_pcm(10, 2));
    assert_eq!(synthetic_pcm(10, 2).len(), 40);
}

#[test]
fn every_other_mutation_path_keeps_the_v9_envelope_and_round_trips() {
    let f = Fx::new();
    let vault = f.vault();
    let audio = recorded(&vault);
    assert_eq!(manifest_format(&vault), FORMAT_V9);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&[0u8; 64]);
    // Photo capture, text capture and text-file import under the v9 fence.
    let photo = vault
        .capture(&op(), "synthetic.png", &png, "photo annotation")
        .unwrap();
    let text = vault.capture_text(&op(), "typed note").unwrap();
    let dir = Fx::new();
    let file = dir.0.join("notes.txt");
    fs::write(&file, b"imported file").unwrap();
    let imported = vault.import_text_path(&op(), &file).unwrap();
    for m in [&photo, &text, &imported, &audio] {
        assert_eq!(
            vault.records(&m.id).unwrap()[0].format,
            FORMAT_V9,
            "{}",
            m.id
        );
    }
    assert!(imported.imported_text.is_some());
    assert_eq!(vault.source(&photo.id).unwrap().mime_type, "image/png");
    assert_eq!(vault.source(&imported.id).unwrap().bytes, b"imported file");
    // Direct Obsidian edits reconcile as v9 events. (Un-organized photo notes already
    // conflict on direct edits in v7/v8; v9 inherits that, so photos are not edited here.)
    for m in [&text, &imported, &audio] {
        let path = vault.note_path(&m.id);
        let existing = fs::read_to_string(&path).unwrap();
        fs::write(&path, format!("{existing} edited in obsidian")).unwrap();
    }
    let listed = vault.list("").unwrap();
    assert_eq!(listed.len(), 4);
    for m in listed.iter().filter(|m| m.id != photo.id) {
        assert!(m.conflict.is_none(), "{}: {:?}", m.id, m.conflict);
        let last = vault.records(&m.id).unwrap().pop().unwrap();
        assert_eq!(
            (last.kind.as_str(), last.format.as_str()),
            ("external", FORMAT_V9)
        );
        assert!(m.note.ends_with("edited in obsidian"));
    }
    // Missing note -> explicit restore, then removal: all v9.
    let victim = listed.iter().find(|m| m.id == text.id).unwrap().clone();
    fs::remove_file(vault.note_path(&text.id)).unwrap();
    let missing = vault
        .list("")
        .unwrap()
        .into_iter()
        .find(|m| m.id == text.id)
        .unwrap();
    assert_eq!(missing.state, "missing");
    let restored = vault
        .restore_note(&text.id, victim.revision, &op())
        .unwrap();
    assert_eq!(restored.state, "active");
    let removed = vault
        .remove(&text.id, restored.revision, &op(), "active")
        .unwrap();
    assert_eq!(removed.state, "deleted");
    let kinds: Vec<_> = vault
        .records(&text.id)
        .unwrap()
        .iter()
        .map(|e| (e.kind.clone(), e.format.clone()))
        .collect();
    assert!(
        kinds.iter().all(|(_, format)| format == FORMAT_V9),
        "{kinds:?}"
    );
    // A fresh process replays everything.
    let again = f.vault();
    assert_eq!(again.list_with_deleted("", true).unwrap().len(), 4);
    assert!(again
        .list_with_deleted("", true)
        .unwrap()
        .iter()
        .all(|m| m.conflict.is_none()));
}

#[test]
fn mixed_speech_with_annotations_stays_eligible_and_forgeries_are_rejected() {
    for text in [
        "(laughs) call at 3",
        "[Music] call the dentist",
        "Call (the) dentist",
        "[unclosed bracket call",
        "(crickets) hello",
        "no brackets at all",
    ] {
        assert_eq!(
            classify_machine_output(text, 900.0),
            (true, vec![]),
            "{text}"
        );
    }
    for text in ["", "   ", ".", "[Music]", "(a) [b] (c)", "[x (y] )"] {
        assert!(!classify_machine_output(text, 900.0).0, "{text:?}");
    }
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let mut forged = machine_for(&m, "(crickets chirping)", 900.0, &op());
    forged.eligibility = "eligible".into();
    forged.quality_flags.clear();
    assert!(vault.audio_apply_machine_transcript(&m.id, forged).is_err());
    let mixed = machine_for(&m, "(laughs) call at 3", 900.0, &op());
    let saved = vault.audio_apply_machine_transcript(&m.id, mixed).unwrap();
    assert_eq!(
        vault.ask_candidates().unwrap()[0].text,
        "(laughs) call at 3"
    );
    assert_eq!(
        saved.audio_transcript.unwrap().machine.eligibility,
        "eligible"
    );
}

#[test]
fn segments_must_be_monotonic_and_strictly_within_the_recording() {
    let f = Fx::new();
    let vault = f.vault();
    let seg = |a: u64, b: u64| AudioSegment {
        start_ms: a,
        end_ms: b,
        text: "x".into(),
    };
    for (segments, ok) in [
        (vec![seg(0, 500), seg(500, 1000)], true),
        (vec![seg(0, 1001)], false),
        (vec![seg(0, 600), seg(500, 900)], false),
        (vec![seg(300, 300)], false),
    ] {
        let m = recorded(&vault);
        let mut machine = machine_for(&m, "hello there", 2000.0, &op());
        machine.segments = Some(segments);
        assert_eq!(
            vault.audio_apply_machine_transcript(&m.id, machine).is_ok(),
            ok
        );
    }
}

#[test]
fn forged_or_mismatched_audio_proposals_are_rejected_by_event_validation() {
    use crate::local_audio_organization::tests::{queued, run};
    let (_env, guard, memory, fake) = queued();
    let vault = &guard.vault;
    run(&guard, &fake).unwrap();
    let good = vault.records(&memory.id).unwrap().pop().unwrap();
    assert_eq!(good.kind, "audio_organization");
    vault.event_valid(&good).unwrap();
    let reject = |mutate: &dyn Fn(&mut Event)| {
        let mut e = good.clone();
        mutate(&mut e);
        assert!(vault.event_valid(&e).is_err());
    };
    reject(&|e| {
        e.memory
            .audio_organization
            .as_mut()
            .unwrap()
            .binding
            .input_sha256 = "0".repeat(64)
    });
    reject(&|e| e.memory.audio_organization.as_mut().unwrap().suppressed = true);
    reject(&|e| {
        e.memory
            .audio_organization
            .as_mut()
            .unwrap()
            .binding
            .source_sha256 = "0".repeat(64)
    });
    reject(&|e| {
        e.memory
            .audio_organization
            .as_mut()
            .unwrap()
            .binding
            .schema_version = "2.0".into()
    });
    reject(&|e| {
        e.memory
            .audio_organization
            .as_mut()
            .unwrap()
            .result
            .extraction["pages"][0]["transcription"] = "different words".into()
    });
    reject(&|e| e.origin = "human:recall".into());
    reject(&|e| e.memory.audio_organization = None);
    // A proposal on a text memory is never valid.
    let text = vault.capture_text(&op(), "plain").unwrap();
    let mut text_event = vault.records(&text.id).unwrap().remove(0);
    text_event.memory.audio_organization = good.memory.audio_organization.clone();
    assert!(vault.event_valid(&text_event).is_err());
    // Transition rules: an unsuppressed proposal cannot survive a correction, vanish, or be forged.
    let mut survives = good.clone();
    survives.kind = "audio_transcript_correction".into();
    assert!(vault.audio_transition(&good, &survives).is_err());
}

#[test]
fn existing_v9_audio_events_keep_their_digest_and_never_serialize_an_empty_proposal() {
    let f = Fx::new();
    let vault = f.vault();
    let m = recorded(&vault);
    let saved = vault
        .audio_apply_machine_transcript(&m.id, machine_for(&m, "Call the dentist.", 2800.0, &op()))
        .unwrap();
    for revision in [1, saved.revision] {
        let text = fs::read_to_string(vault.history_path(&m.id, revision)).unwrap();
        assert!(
            !text.contains("audio_organization"),
            "older events carry no new key"
        );
        // Recompute the pre-AUDIO-ORG v9 digest chain literally and compare.
        let e: Event = serde_json::from_str(&text).unwrap();
        let base = payload(
            &e.kind,
            &e.memory.id,
            e.expected_revision,
            &e.memory.note,
            &e.memory.source_sha256,
            &e.memory.source_name,
        )
        .unwrap();
        let chain = hash(&json(&(base, &e.memory.reading)).unwrap());
        let chain = hash(&json(&(chain, &e.memory.organization)).unwrap());
        let expected = hash(
            &json(&(
                chain,
                &e.context_link_projection,
                &e.memory.imported_text,
                &e.memory.audio_source,
                &e.memory.audio_transcript,
            ))
            .unwrap(),
        );
        assert_eq!(e.payload_sha256, expected, "revision {revision}");
    }
    assert!(serde_json::to_value(&saved).unwrap()["audio_organization"].is_null());
}
