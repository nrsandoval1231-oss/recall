//! v9 audio source/transcript projection for the vault journal.
//!
//! The immutable original is `Recall/Sources/<memory-id>.wav`; its SHA-256 is the
//! hash of the full WAV bytes. Machine transcripts, human corrections and the
//! local-recognizer bookkeeping are separate, validated and create-only: model
//! (recognizer) output never chooses paths, permissions, event kinds or status.
use super::*;
use crate::audio_wav::{self, MAX_WAV_FILE_BYTES, SUPPORTED_RATES};

pub const AUDIO_MEDIA_TYPE: &str = "audio/wav";
/// F0-tested zero/near-zero input gate (RMS in PCM16 sample units).
pub const RMS_GATE: f64 = 5.0;
const MAX_TRANSCRIPT_BYTES: usize = 64 * 1024;
const MAX_SEGMENTS: usize = 512;
const AUDIO_MAX_DURATION_MS: u64 = audio_wav::MAX_SECONDS * 1000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioSource {
    pub capture_origin: String,
    pub original_name: Option<String>,
    pub media_type: String,
    pub source_sha256: String,
    pub source_bytes: u64,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub pcm_bits: u16,
    pub duration_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioMachineTranscript {
    pub operation_id: String,
    pub source_sha256: String,
    pub source_revision: u64,
    pub runtime_source_commit: String,
    pub runtime_binary_sha256: String,
    pub model_sha256: String,
    pub derivative_sha256: String,
    pub transform_version: String,
    pub output_sha256: String,
    pub text: String,
    pub segments: Option<Vec<AudioSegment>>,
    pub input_rms_pcm16: f64,
    pub quality_flags: Vec<String>,
    pub eligibility: String,
    pub quality_state: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioHumanCorrection {
    pub operation_id: String,
    pub text: String,
    pub corrected_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioTranscript {
    pub machine: AudioMachineTranscript,
    pub human_correction: Option<AudioHumanCorrection>,
}

/// Pinned recognizer identity recorded with every request (from the checked-in
/// asset manifest, never from recognizer output).
#[derive(Clone, Debug, PartialEq)]
pub struct AsrIdentity {
    pub runtime_source_commit: String,
    pub runtime_binary_sha256: String,
    pub model_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AsrRequest {
    pub schema_version: String,
    pub asr_operation_id: String,
    pub vault_id: String,
    pub memory_id: String,
    pub capture_revision: u64,
    pub source_sha256: String,
    pub source_bytes: u64,
    pub derivative_sha256: String,
    pub derivative_frames: u64,
    pub transform_version: String,
    pub runtime_source_commit: String,
    pub runtime_binary_sha256: String,
    pub model_sha256: String,
    pub input_rms_pcm16: f64,
    pub duration_ms: u64,
    pub requested_at: String,
}
/// Operational recognizer outcome, retained create-only. `completed` means the
/// recognizer exited successfully with parseable output (possibly empty or a
/// non-speech marker); everything else is a failed attempt with a stable code.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AsrResult {
    pub schema_version: String,
    pub asr_operation_id: String,
    pub memory_id: String,
    pub source_sha256: String,
    pub derivative_sha256: String,
    pub state: String,
    pub error_code: Option<String>,
    pub output_sha256: Option<String>,
    pub text: Option<String>,
    pub segments: Option<Vec<AudioSegment>>,
    pub gated_before_launch: bool,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u64,
    pub completed_at: String,
}
#[derive(Clone, Debug, PartialEq)]
pub enum AsrPhase {
    /// Nothing has launched; the derivative is provided for one attempt.
    Fresh,
    /// A launch may have happened without a recorded result: never rerun.
    Unknown,
    /// A result is retained but not yet promoted to the vault journal.
    ResultReady,
    Failed(String),
    Committed,
}
pub struct AsrBegin {
    pub request: AsrRequest,
    pub phase: AsrPhase,
    pub derivative: Option<Vec<u8>>,
}

fn lower_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn safe_wav_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0'])
        || name.chars().any(char::is_control)
        || Path::new(name).components().count() != 1
        || !name.to_ascii_lowercase().ends_with(".wav")
        || name.len() == 4
    {
        return Err("Choose one .wav file with a plain file name".into());
    }
    Ok(())
}

/// Structural rule, no thresholds: remove every whole `[...]` and `(...)` span; if only
/// whitespace, punctuation or music-note symbols remain, the output is a recognizer
/// annotation (`[Music]`, `[BLANK_AUDIO]`, `[Music] [Music]`, `(crickets chirping)`),
/// not speech. Mixed text such as `(laughs) call at 3` keeps its words and stays
/// eligible. Unmatched brackets are ordinary characters.
fn is_non_speech_annotation(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut kept = String::new();
    let mut i = 0;
    while i < chars.len() {
        let close = match chars[i] {
            '[' => Some(']'),
            '(' => Some(')'),
            _ => None,
        };
        if let Some(end) = close.and_then(|c| chars[i + 1..].iter().position(|x| *x == c)) {
            i += end + 2;
        } else {
            kept.push(chars[i]);
            i += 1;
        }
    }
    kept.chars().all(|c| !c.is_alphanumeric())
}
/// Eligibility is derived, never taken from the recognizer: only the F0-observed
/// zero gate, empty output and the structural non-speech annotation rule exclude
/// a result. This is not voice-activity detection; louder noise can still yield
/// ordinary-looking text.
pub fn classify_machine_output(text: &str, rms_pcm16: f64) -> (bool, Vec<String>) {
    if rms_pcm16 <= RMS_GATE {
        (false, vec!["rms_gate".into()])
    } else if text.trim().is_empty() {
        (false, vec!["empty_output".into()])
    } else if is_non_speech_annotation(text) {
        (false, vec!["non_speech_annotation".into()])
    } else {
        (true, Vec::new())
    }
}

/// The wording that is current for search/Ask: a human correction (even empty,
/// which suppresses the machine text) else an eligible unreviewed machine text.
pub(super) fn audio_current_text(m: &VaultMemory) -> Option<(&str, &'static str, &'static str)> {
    m.audio_source.as_ref()?;
    let transcript = m.audio_transcript.as_ref()?;
    if let Some(human) = &transcript.human_correction {
        return if human.text.trim().is_empty() {
            None
        } else {
            Some((&human.text, "human_audio_correction", "reported"))
        };
    }
    let machine = &transcript.machine;
    if machine.eligibility == "eligible" && !machine.text.trim().is_empty() {
        Some((&machine.text, "machine_audio_transcript", "unreviewed"))
    } else {
        None
    }
}

fn quoted(text: &str) -> String {
    if text.trim().is_empty() {
        "> (empty)\n".into()
    } else {
        format!("> {}\n", markdown_text(text))
    }
}
/// Inert generated Markdown. Transcript wording is escaped quoted text, so it
/// cannot introduce a Recall marker, heading or link. Only the region after the
/// final "Human annotation" heading participates in direct-edit reconciliation;
/// any change to the generated region is a conflict.
pub(super) fn audio_markdown(m: &VaultMemory) -> String {
    let state = match m.audio_transcript.as_ref() {
        None => "none",
        Some(t) if t.human_correction.is_some() => "corrected",
        Some(t) if t.machine.eligibility == "eligible" => "machine_unreviewed",
        Some(_) => "unavailable",
    };
    let source = format!("../Sources/{}.wav", m.id);
    let mut out = format!(
        "---\nid: {}\nstatus: {}\ncaptured: {}\nsource: {}\ntranscript: {}\n---\n\n<!-- Recall memory {} | generated audio -->\n[Original recording]({source})\n\n",
        yaml(&m.id), yaml("saved"), yaml(&m.captured_at),
        yaml(&format!("[[Recall/Sources/{}.wav]]", m.id)), yaml(state), m.id
    );
    if let Some(src) = &m.audio_source {
        out.push_str(&format!(
            "Recording: {} ms, {} Hz, {} channel(s), {}. Source SHA-256: `{}`\n\n",
            src.duration_ms,
            src.sample_rate_hz,
            src.channels,
            if src.capture_origin == "recorded" {
                "recorded in Recall".to_owned()
            } else {
                format!(
                    "imported WAV {}",
                    md_text(src.original_name.as_deref().unwrap_or(""))
                )
            },
            src.source_sha256
        ));
    }
    match m.audio_transcript.as_ref() {
        None => out.push_str("No transcript has been produced yet.\n\n"),
        Some(t) => {
            if let Some(human) = &t.human_correction {
                out.push_str("## Human transcript correction\n\n");
                out.push_str(&quoted(&human.text));
                out.push_str("\nHuman correction is current; the earlier machine transcript stays in history.\n\n");
            } else if t.machine.eligibility == "eligible" {
                out.push_str("## Machine transcript (unreviewed)\n\n");
                out.push_str(&quoted(&t.machine.text));
                out.push_str(&format!(
                    "\nMachine transcript may omit or mishear words; check the recording.\n\nRuntime: whisper.cpp {}  \nModel SHA-256: `{}`  \nOutput SHA-256: `{}`\n\n",
                    t.machine.runtime_source_commit, t.machine.model_sha256, t.machine.output_sha256
                ));
            } else {
                out.push_str(&format!(
                    "## Machine transcript unavailable\n\nThe recording is saved, but no usable transcript was produced ({}).\n\n",
                    t.machine.quality_flags.join(", ")
                ));
            }
        }
    }
    out.push_str(&format!(
        "<!-- Recall memory {} | human annotation -->\n[Original recording]({source})\n\n## Human annotation\n\n{}",
        m.id, m.note
    ));
    out
}

fn segments_valid(segments: &[AudioSegment], duration_ms: u64) -> bool {
    let mut previous_end = 0;
    segments.len() <= MAX_SEGMENTS
        && segments.iter().all(|s| {
            let ok = s.start_ms >= previous_end
                && s.start_ms < s.end_ms
                && s.end_ms <= duration_ms
                && s.text.len() <= MAX_TRANSCRIPT_BYTES
                && !s.text.contains('\0');
            previous_end = s.end_ms;
            ok
        })
}

pub fn utc_now() -> String {
    timestamp()
}

/// Read one user-selected WAV for import. The path is used only to open this
/// regular file; its name is display-only. Links and reparse points, a file that
/// changes while read, non-WAV bytes and oversize input are refused.
pub fn read_wav_import(path: &Path) -> Result<(String, Vec<u8>)> {
    let max = MAX_WAV_FILE_BYTES;
    let before = fs::symlink_metadata(path).map_err(fail)?;
    if !before.is_file() || before.file_type().is_symlink() || reparse(&before) {
        return Err("Choose a regular .wav file (links are not supported)".into());
    }
    if before.len() > max as u64 {
        return Err("WAV file is larger than the 24 MiB / 120 second limit".into());
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid WAV file name")?
        .to_owned();
    safe_wav_name(&name)?;
    let mut file = File::open(path).map_err(fail)?;
    let opened = file.metadata().map_err(fail)?;
    if !same_file(&before, &opened) || reparse(&opened) {
        return Err("WAV file changed while it was being imported".into());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file)
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(fail)?;
    file.seek(SeekFrom::Start(0)).map_err(fail)?;
    let mut confirmation = Vec::with_capacity(bytes.len());
    (&mut file)
        .take(max as u64 + 1)
        .read_to_end(&mut confirmation)
        .map_err(fail)?;
    let after = fs::symlink_metadata(path).map_err(fail)?;
    if bytes.len() > max
        || bytes.len() as u64 != before.len()
        || confirmation != bytes
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || after.file_type().is_symlink()
        || reparse(&after)
        || !same_file(&before, &after)
    {
        return Err("WAV file changed while it was being imported".into());
    }
    audio_wav::parse_wav(&bytes)?;
    Ok((name, bytes))
}

impl Vault {
    fn audio_dir(&self, memory_id: &str) -> Result<PathBuf> {
        id(memory_id)?;
        Ok(self.path(&format!("_meta/audio/{memory_id}")))
    }
    fn ensure_audio_dir(&self, memory_id: &str) -> Result<PathBuf> {
        let root = self.path("_meta/audio");
        safe(&root)?;
        if !root.exists() {
            fs::create_dir(&root).map_err(fail)?;
            sync_dir(root.parent().ok_or("Missing audio metadata parent")?)?;
        }
        let dir = self.audio_dir(memory_id)?;
        safe(&dir)?;
        if !dir.exists() {
            if entries(&root)?.len() + 2 > MAX_RECORDS {
                return Err("Audio operation retention capacity reached".into());
            }
            fs::create_dir(&dir).map_err(fail)?;
            sync_dir(&root)?;
        }
        if !dir.is_dir() {
            return Err("Audio operation storage is unavailable".into());
        }
        Ok(dir)
    }
    pub(super) fn verify_audio_source(
        &self,
        m: &VaultMemory,
        expected: &Path,
    ) -> Result<(Vec<u8>, String)> {
        let source = m
            .audio_source
            .as_ref()
            .ok_or("Memory has no audio provenance")?;
        let bytes = read(expected, MAX_WAV_FILE_BYTES as u64)?;
        let info = audio_wav::parse_wav(&bytes)?;
        if source.media_type != AUDIO_MEDIA_TYPE
            || source.source_bytes != bytes.len() as u64
            || source.sample_rate_hz != info.sample_rate_hz
            || source.channels != info.channels
            || source.pcm_bits != 16
            || source.duration_ms != info.duration_ms
        {
            return Err("Audio source does not match its provenance".into());
        }
        Ok((bytes, AUDIO_MEDIA_TYPE.into()))
    }

    pub(super) fn audio_event_valid(&self, e: &Event) -> Result<()> {
        let m = &e.memory;
        let audio_kind =
            ["audio_transcription", "audio_transcript_correction"].contains(&e.kind.as_str());
        let Some(source) = m.audio_source.as_ref() else {
            if m.audio_transcript.is_some() || audio_kind {
                return Err("Audio provenance requires an audio source".into());
            }
            return Ok(());
        };
        let malformed = || -> Result<()> { Err("Malformed audio provenance".into()) };
        if e.format != FORMAT_V9
            || m.reading.is_some()
            || m.organization.is_some()
            || m.imported_text.is_some()
            || source.media_type != AUDIO_MEDIA_TYPE
            || !lower_hex(&source.source_sha256, 64)
            || source.source_sha256 != m.source_sha256
            || source.pcm_bits != 16
            || !(1..=2).contains(&source.channels)
            || !SUPPORTED_RATES.contains(&source.sample_rate_hz)
            || source.source_bytes < audio_wav::HEADER_LEN as u64
            || source.source_bytes > MAX_WAV_FILE_BYTES as u64
            || source.duration_ms == 0
            || source.duration_ms > AUDIO_MAX_DURATION_MS
        {
            return malformed();
        }
        match (
            source.capture_origin.as_str(),
            source.original_name.as_deref(),
        ) {
            ("recorded", None) if m.source_name == "recording.wav" => {}
            ("imported_wav", Some(name)) if m.source_name == name => safe_wav_name(name)?,
            _ => return malformed(),
        }
        if e.kind == "capture" && m.audio_transcript.is_some() {
            return Err("Capture cannot invent a transcript".into());
        }
        if let Some(t) = &m.audio_transcript {
            let mt = &t.machine;
            id(&mt.operation_id)?;
            if mt.source_sha256 != m.source_sha256
                || mt.source_revision == 0
                || mt.source_revision >= m.revision
                || !lower_hex(&mt.runtime_source_commit, 40)
                || !lower_hex(&mt.runtime_binary_sha256, 64)
                || !lower_hex(&mt.model_sha256, 64)
                || !lower_hex(&mt.derivative_sha256, 64)
                || !lower_hex(&mt.output_sha256, 64)
                || mt.transform_version != audio_wav::TRANSFORM_VERSION
                || mt.quality_state != "machine_unreviewed"
                || !["eligible", "ineligible"].contains(&mt.eligibility.as_str())
                || mt.text.len() > MAX_TRANSCRIPT_BYTES
                || mt.text.contains('\0')
                || !mt.input_rms_pcm16.is_finite()
                || !(0.0..=32768.0).contains(&mt.input_rms_pcm16)
                || mt.quality_flags.len() > 8
                || mt.quality_flags.iter().any(|flag| {
                    flag.is_empty()
                        || flag.len() > 64
                        || !flag
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                })
                || mt
                    .segments
                    .as_deref()
                    .is_some_and(|s| !segments_valid(s, source.duration_ms))
                || (mt.eligibility == "eligible"
                    && !classify_machine_output(&mt.text, mt.input_rms_pcm16).0)
            {
                return malformed();
            }
            if let Some(human) = &t.human_correction {
                id(&human.operation_id)?;
                note_valid(&human.text)?;
                if human.corrected_at.len() != 20 {
                    return malformed();
                }
            }
        }
        match e.kind.as_str() {
            "audio_transcription" => {
                if m.audio_transcript
                    .as_ref()
                    .is_none_or(|t| t.machine.operation_id != e.operation_id)
                {
                    return Err("Audio transcription revision binding mismatch".into());
                }
            }
            "audio_transcript_correction" => {
                if m.audio_transcript
                    .as_ref()
                    .and_then(|t| t.human_correction.as_ref())
                    .is_none_or(|h| h.operation_id != e.operation_id)
                {
                    return Err("Audio correction revision binding mismatch".into());
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) fn audio_transition(&self, prev: &Event, next: &Event) -> Result<()> {
        if prev.memory.audio_source != next.memory.audio_source {
            return Err("Audio source provenance is immutable".into());
        }
        if next.memory.audio_source.is_none() {
            return Ok(());
        }
        let a = prev.memory.audio_transcript.as_ref();
        let b = next.memory.audio_transcript.as_ref();
        match next.kind.as_str() {
            "audio_transcription" => {
                let b = b.ok_or("Missing machine transcript")?;
                if prev.memory.note != next.memory.note
                    || a.and_then(|t| t.human_correction.as_ref()) != b.human_correction.as_ref()
                    || a.is_some_and(|t| t.machine.operation_id == b.machine.operation_id)
                {
                    return Err("Machine transcription changed human content".into());
                }
            }
            "audio_transcript_correction" => {
                let (Some(a), Some(b)) = (a, b) else {
                    return Err("No machine transcript to correct".into());
                };
                if prev.memory.note != next.memory.note
                    || a.machine != b.machine
                    || b.human_correction.is_none()
                {
                    return Err("Correction changed the machine transcript".into());
                }
            }
            _ => {
                if a != b {
                    return Err("Unrelated event changed the audio transcript".into());
                }
            }
        }
        Ok(())
    }

    fn v9_digest(&self, e: &Event) -> Result<String> {
        let base = payload(
            &e.kind,
            &e.memory.id,
            e.expected_revision,
            &e.memory.note,
            &e.memory.source_sha256,
            &e.memory.source_name,
        )?;
        let with_reading = hash(&json(&(base, &e.memory.reading))?);
        let with_org = hash(&json(&(with_reading, &e.memory.organization))?);
        Ok(hash(&json(&(
            with_org,
            &e.context_link_projection,
            &e.memory.imported_text,
            &e.memory.audio_source,
            &e.memory.audio_transcript,
        ))?))
    }

    /// Publish a validated WAV create-only, then commit its v9 `capture` event.
    /// The same operation ID and identical bytes replay to the same memory; a
    /// different payload under that ID is a hard conflict.
    pub fn audio_commit_capture(
        &self,
        operation_id: &str,
        bytes: &[u8],
        origin: &str,
        original_name: Option<&str>,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        let info = audio_wav::parse_wav(bytes)?;
        let source_hash = hash(bytes);
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "capture"
                || e.memory.audio_source.as_ref().map(|s| {
                    (
                        s.source_sha256.as_str(),
                        s.capture_origin.as_str(),
                        s.original_name.as_deref(),
                    )
                }) != Some((source_hash.as_str(), origin, original_name))
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, &pending);
        }
        if let Some(error) = pending.get(operation_id) {
            return Err(error.clone());
        }
        let (source_name, display_name) = match (origin, original_name) {
            ("recorded", None) => ("recording.wav".to_owned(), None),
            ("imported_wav", Some(name)) => {
                safe_wav_name(name)?;
                (name.to_owned(), Some(name.to_owned()))
            }
            _ => return Err("Invalid audio capture origin".into()),
        };
        let now = timestamp();
        let memory = VaultMemory {
            id: operation_id.into(),
            revision: 1,
            note: String::new(),
            reading: None,
            organization: None,
            source_sha256: source_hash.clone(),
            source_name,
            captured_at: now.clone(),
            updated_at: now,
            conflict: None,
            state: "active".into(),
            note_path: None,
            related_context: Vec::new(),
            context_repair_pending: false,
            imported_text: None,
            audio_source: Some(AudioSource {
                capture_origin: origin.into(),
                original_name: display_name,
                media_type: AUDIO_MEDIA_TYPE.into(),
                source_sha256: source_hash,
                source_bytes: bytes.len() as u64,
                sample_rate_hz: info.sample_rate_hz,
                channels: info.channels,
                pcm_bits: 16,
                duration_ms: info.duration_ms,
            }),
            audio_transcript: None,
        };
        let mut e = Event {
            format: FORMAT_V9.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "capture".into(),
            expected_revision: 0,
            payload_sha256: String::new(),
            parent_sha256: None,
            origin: "human:recall".into(),
            note_path: Some(format!("{operation_id}.md")),
            expected_state: None,
            previous_markdown: None,
            markdown: String::new(),
            memory,
            context_link_projection: Some(Vec::new()),
        };
        e.markdown = markdown_for_event(&e)?;
        e.payload_sha256 = self.v9_digest(&e)?;
        // Capacity is reserved before the immutable original is published.
        self.preflight_capacity(&e)?;
        immutable(&self.path(&format!("Sources/{operation_id}.wav")), bytes)?;
        self.commit(&e)
    }

    /// The committed capture memory for an operation, if any.
    pub fn audio_capture_receipt(&self, operation_id: &str) -> Result<Option<VaultMemory>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(operation_id)?;
        match self.receipt(operation_id)? {
            Some(e) if e.kind == "capture" && e.memory.audio_source.is_some() => {
                self.current(&e.memory.id, &pending).map(Some)
            }
            Some(_) => Err("Operation ID was used for another capture".into()),
            None => Ok(None),
        }
    }
    /// True when an immutable original exists without a committed receipt. A
    /// private stage may not be discarded while this is ambiguous.
    pub fn audio_source_published(&self, operation_id: &str) -> Result<bool> {
        let _lock = self.lock()?;
        id(operation_id)?;
        let path = self.path(&format!("Sources/{operation_id}.wav"));
        safe(&path)?;
        path.try_exists().map_err(fail)
    }

    // --- Recognizer bookkeeping: create-only request / dispatch marker / result ---
    fn asr_file(&self, memory_id: &str, name: &str) -> Result<PathBuf> {
        Ok(self.audio_dir(memory_id)?.join(name))
    }
    fn load_asr_request(&self, memory_id: &str) -> Result<Option<AsrRequest>> {
        let path = self.asr_file(memory_id, "asr-request.json")?;
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let request: AsrRequest = decode(&path)?;
        if request.schema_version != "1.0"
            || request.vault_id != self.id
            || request.memory_id != memory_id
            || id(&request.asr_operation_id).is_err()
            || !lower_hex(&request.source_sha256, 64)
            || !lower_hex(&request.derivative_sha256, 64)
        {
            return Err("Invalid recognizer request".into());
        }
        Ok(Some(request))
    }
    fn load_asr_result(&self, request: &AsrRequest) -> Result<Option<AsrResult>> {
        let path = self.asr_file(&request.memory_id, "asr-result.json")?;
        safe(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let result: AsrResult = decode(&path)?;
        if result.schema_version != "1.0"
            || result.asr_operation_id != request.asr_operation_id
            || result.memory_id != request.memory_id
            || result.source_sha256 != request.source_sha256
            || result.derivative_sha256 != request.derivative_sha256
            || !["completed", "failed"].contains(&result.state.as_str())
        {
            return Err("Recognizer result does not match its request".into());
        }
        Ok(Some(result))
    }
    fn asr_phase(&self, request: &AsrRequest, memory: &VaultMemory) -> Result<AsrPhase> {
        if memory
            .audio_transcript
            .as_ref()
            .is_some_and(|t| t.machine.operation_id == request.asr_operation_id)
        {
            return Ok(AsrPhase::Committed);
        }
        if let Some(result) = self.load_asr_result(request)? {
            return Ok(if result.state == "completed" {
                AsrPhase::ResultReady
            } else {
                AsrPhase::Failed(result.error_code.unwrap_or_else(|| "asr_failed".into()))
            });
        }
        let marker = self.asr_file(&request.memory_id, "asr-dispatched")?;
        if marker.exists() {
            return Ok(AsrPhase::Unknown);
        }
        Ok(AsrPhase::Fresh)
    }
    /// Current recognizer phase for status reads; never starts or retries work.
    pub fn audio_asr_state(&self, memory_id: &str) -> Result<Option<(AsrRequest, AsrPhase)>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let Some(request) = self.load_asr_request(memory_id)? else {
            return Ok(None);
        };
        let memory = self.current(memory_id, &pending)?;
        let phase = self.asr_phase(&request, &memory)?;
        Ok(Some((request, phase)))
    }
    /// Create (or resume) the single recognizer request for a saved recording.
    /// The saved-local receipt must already exist; a derivative is produced only
    /// for a `Fresh` phase so a launched-but-unrecorded attempt stays UNKNOWN.
    pub fn audio_asr_begin(&self, memory_id: &str, identity: &AsrIdentity) -> Result<AsrBegin> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(memory_id)?;
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let memory = self.current(memory_id, &pending)?;
        let source = memory
            .audio_source
            .clone()
            .ok_or("Memory has no audio recording")?;
        if memory.state != "active" || memory.conflict.is_some() {
            return Err("Resolve this memory's conflict before transcribing".into());
        }
        let verified = self.verify_source(&memory)?;
        if self.receipt(memory_id)?.is_none() {
            return Err("Recording is not saved yet".into());
        }
        if let Some(request) = self.load_asr_request(memory_id)? {
            if request.source_sha256 != source.source_sha256 {
                return Err("Recognizer request does not match the saved recording".into());
            }
            let phase = self.asr_phase(&request, &memory)?;
            let derivative = if phase == AsrPhase::Fresh {
                let derived = audio_wav::derive_16k_mono(&verified.bytes)?;
                if derived.sha256 != request.derivative_sha256 {
                    return Err("Derivative no longer matches its recognizer request".into());
                }
                Some(derived.wav)
            } else {
                None
            };
            return Ok(AsrBegin {
                request,
                phase,
                derivative,
            });
        }
        if memory.audio_transcript.is_some() {
            return Err("A transcript already exists for this recording".into());
        }
        let info = audio_wav::parse_wav(&verified.bytes)?;
        let derived = audio_wav::derive_16k_mono(&verified.bytes)?;
        let rms = audio_wav::rms_rounded(audio_wav::rms_pcm16(
            &verified.bytes[info.data_offset..info.data_offset + info.data_len],
        ));
        let request = AsrRequest {
            schema_version: "1.0".into(),
            asr_operation_id: Uuid::new_v4().to_string(),
            vault_id: self.id.clone(),
            memory_id: memory_id.into(),
            capture_revision: 1,
            source_sha256: source.source_sha256,
            source_bytes: source.source_bytes,
            derivative_sha256: derived.sha256,
            derivative_frames: derived.frames,
            transform_version: audio_wav::TRANSFORM_VERSION.into(),
            runtime_source_commit: identity.runtime_source_commit.clone(),
            runtime_binary_sha256: identity.runtime_binary_sha256.clone(),
            model_sha256: identity.model_sha256.clone(),
            input_rms_pcm16: rms,
            duration_ms: source.duration_ms,
            requested_at: timestamp(),
        };
        self.ensure_audio_dir(memory_id)?;
        immutable(
            &self.asr_file(memory_id, "asr-request.json")?,
            &json(&request)?,
        )?;
        Ok(AsrBegin {
            request,
            phase: AsrPhase::Fresh,
            derivative: Some(derived.wav),
        })
    }
    /// Durable "may have run" marker, created immediately before launch. A
    /// second attempt is refused so an ambiguous launch is never blindly rerun.
    pub fn audio_asr_mark_dispatched(&self, request: &AsrRequest) -> Result<()> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        if self.load_asr_request(&request.memory_id)?.as_ref() != Some(request) {
            return Err("Recognizer request changed".into());
        }
        let memory = self.current(&request.memory_id, &pending)?;
        if memory.state != "active"
            || memory.conflict.is_some()
            || memory.source_sha256 != request.source_sha256
        {
            return Err("Recording changed before transcription".into());
        }
        self.verify_source(&memory)?;
        if self.asr_phase(request, &memory)? != AsrPhase::Fresh {
            return Err("Recognizer attempt already started".into());
        }
        let marker = self.asr_file(&request.memory_id, "asr-dispatched")?;
        create(&marker, b"may-have-been-run")
    }
    pub fn audio_asr_record_result(&self, request: &AsrRequest, result: &AsrResult) -> Result<()> {
        let _lock = self.lock()?;
        if self.load_asr_request(&request.memory_id)?.as_ref() != Some(request)
            || result.asr_operation_id != request.asr_operation_id
            || result.memory_id != request.memory_id
            || result.source_sha256 != request.source_sha256
            || result.derivative_sha256 != request.derivative_sha256
        {
            return Err("Recognizer result does not match its request".into());
        }
        immutable(
            &self.asr_file(&request.memory_id, "asr-result.json")?,
            &json(result)?,
        )
    }
    /// Promote a retained `completed` result to the journal after revalidating
    /// vault, source hash and request binding under the writer lock.
    pub fn audio_asr_commit(&self, request: &AsrRequest) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        if self.load_asr_request(&request.memory_id)?.as_ref() != Some(request) {
            return Err("Recognizer request changed".into());
        }
        let result = self
            .load_asr_result(request)?
            .ok_or("Recognizer result is missing")?;
        if result.state != "completed" {
            return Err("Recognizer did not produce a transcript".into());
        }
        let text = result.text.clone().unwrap_or_default();
        let (eligible, flags) = classify_machine_output(&text, request.input_rms_pcm16);
        let machine = AudioMachineTranscript {
            operation_id: request.asr_operation_id.clone(),
            source_sha256: request.source_sha256.clone(),
            source_revision: request.capture_revision,
            runtime_source_commit: request.runtime_source_commit.clone(),
            runtime_binary_sha256: request.runtime_binary_sha256.clone(),
            model_sha256: request.model_sha256.clone(),
            derivative_sha256: request.derivative_sha256.clone(),
            transform_version: request.transform_version.clone(),
            output_sha256: result
                .output_sha256
                .clone()
                .unwrap_or_else(|| hash(text.as_bytes())),
            text,
            segments: result.segments.clone(),
            input_rms_pcm16: request.input_rms_pcm16,
            quality_flags: flags,
            eligibility: if eligible { "eligible" } else { "ineligible" }.into(),
            quality_state: "machine_unreviewed".into(),
        };
        self.apply_machine_locked(&pending, &request.memory_id, machine)
    }
    /// Test-only entry for machine re-run semantics (no command re-runs a transcript yet).
    #[cfg(test)]
    /// Append a machine transcript to a saved recording. A human correction in
    /// the current revision is carried forward untouched: a machine run never
    /// overwrites it.
    pub fn audio_apply_machine_transcript(
        &self,
        memory_id: &str,
        machine: AudioMachineTranscript,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(memory_id)?;
        self.apply_machine_locked(&pending, memory_id, machine)
    }
    fn apply_machine_locked(
        &self,
        pending: &BTreeMap<String, String>,
        memory_id: &str,
        machine: AudioMachineTranscript,
    ) -> Result<VaultMemory> {
        id(&machine.operation_id)?;
        if let Some(e) = self.receipt(&machine.operation_id)? {
            if e.kind != "audio_transcription"
                || e.memory.audio_transcript.as_ref().map(|t| &t.machine) != Some(&machine)
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(&e.memory.id, pending);
        }
        id(memory_id)?;
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let mut m = self.reconciled(memory_id)?;
        if m.state != "active"
            || m.conflict.is_some()
            || m.audio_source.as_ref().map(|s| s.source_sha256.as_str())
                != Some(machine.source_sha256.as_str())
        {
            return Err("Recording changed before its transcript was saved".into());
        }
        self.verify_source(&m)?;
        let last = self.records(memory_id)?.pop().ok_or("Missing history")?;
        let human = m
            .audio_transcript
            .as_ref()
            .and_then(|t| t.human_correction.clone());
        let expected_revision = m.revision;
        m.revision += 1;
        m.updated_at = timestamp();
        let operation = machine.operation_id.clone();
        m.audio_transcript = Some(AudioTranscript {
            machine,
            human_correction: human,
        });
        let e = Event {
            format: FORMAT_V9.into(),
            vault_id: self.id.clone(),
            operation_id: operation,
            kind: "audio_transcription".into(),
            expected_revision,
            payload_sha256: String::new(),
            parent_sha256: Some(self.parent_hash(memory_id, last.memory.revision)?),
            origin: "machine:whisper-local".into(),
            note_path: m.note_path.clone(),
            expected_state: None,
            previous_markdown: Some(last.markdown),
            markdown: String::new(),
            memory: m,
            context_link_projection: None,
        };
        self.commit(&e)
    }
    /// Memories with a saved recording whose recognizer never launched: safe to
    /// resume after a restart, as is a retained completed result that was never
    /// promoted (promotion is idempotent and launches nothing). Launched attempts
    /// without a recorded result are excluded: they stay UNKNOWN.
    pub fn audio_pending_asr(&self) -> Result<Vec<String>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let mut out = Vec::new();
        for dir in entries(&self.path("History"))? {
            let Some(memory_id) = dir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if id(memory_id).is_err() || pending.contains_key(memory_id) {
                continue;
            }
            let Ok(memory) = self.current(memory_id, &pending) else {
                continue;
            };
            if memory.audio_source.is_none()
                || memory.audio_transcript.is_some()
                || memory.state != "active"
                || memory.conflict.is_some()
            {
                continue;
            }
            match self.load_asr_request(memory_id) {
                Ok(Some(request)) => {
                    if matches!(
                        self.asr_phase(&request, &memory).ok(),
                        Some(AsrPhase::Fresh | AsrPhase::ResultReady)
                    ) {
                        out.push(memory_id.to_owned());
                    }
                }
                Ok(None) => out.push(memory_id.to_owned()),
                Err(_) => {}
            }
        }
        Ok(out)
    }

    /// Append one human transcript correction. It preserves the source, machine
    /// transcript and history, may deliberately be empty, and makes the human
    /// wording the only current reading.
    pub fn audio_correct(
        &self,
        memory_id: &str,
        expected_revision: u64,
        operation_id: &str,
        text: &str,
    ) -> Result<VaultMemory> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        id(memory_id)?;
        id(operation_id)?;
        note_valid(text)?;
        if let Some(e) = self.receipt(operation_id)? {
            if e.kind != "audio_transcript_correction"
                || e.memory.id != memory_id
                || e.expected_revision != expected_revision
                || e.memory
                    .audio_transcript
                    .as_ref()
                    .and_then(|t| t.human_correction.as_ref())
                    .map(|h| h.text.as_str())
                    != Some(text)
            {
                return Err("Operation ID reused with different payload".into());
            }
            return self.current(memory_id, &pending);
        }
        if let Some(error) = pending.get(memory_id) {
            return Err(error.clone());
        }
        let mut m = self.reconciled(memory_id)?;
        if m.state != "active" || m.conflict.is_some() || m.revision != expected_revision {
            return Err(
                "Conflict: the recording changed. Refresh, review it, then retry your correction"
                    .into(),
            );
        }
        let machine = m
            .audio_transcript
            .as_ref()
            .ok_or("There is no machine transcript to correct yet")?
            .machine
            .clone();
        let last = self.records(memory_id)?.pop().ok_or("Missing history")?;
        m.revision += 1;
        m.updated_at = timestamp();
        m.audio_transcript = Some(AudioTranscript {
            machine,
            human_correction: Some(AudioHumanCorrection {
                operation_id: operation_id.into(),
                text: text.into(),
                corrected_at: timestamp(),
            }),
        });
        let e = Event {
            format: FORMAT_V9.into(),
            vault_id: self.id.clone(),
            operation_id: operation_id.into(),
            kind: "audio_transcript_correction".into(),
            expected_revision,
            payload_sha256: String::new(),
            parent_sha256: Some(self.parent_hash(memory_id, last.memory.revision)?),
            origin: "human:recall".into(),
            note_path: m.note_path.clone(),
            expected_state: None,
            previous_markdown: Some(last.markdown),
            markdown: String::new(),
            memory: m,
            context_link_projection: None,
        };
        self.commit(&e)
    }
}

#[cfg(test)]
impl Vault {
    /// Test-only view of the organization context a text/photo packet would send.
    pub fn organization_context_for_test(
        &self,
        memory_id: &str,
    ) -> Result<Vec<OrganizationContextExcerpt>> {
        let _lock = self.lock()?;
        let pending = self.recover()?;
        let memory = self.current(memory_id, &pending)?;
        Ok(self.select_organization_context(&memory, &pending)?.1)
    }
}

#[cfg(test)]
#[path = "local_vault_audio_tests.rs"]
mod tests;
