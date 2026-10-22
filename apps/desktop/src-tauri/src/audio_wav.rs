//! Byte-level RIFF/WAVE PCM16 validation, canonical WAV writing, input RMS and
//! the frozen deterministic ASR derivative (`pcm16-mono-16khz-rubato-fft-v1`).
//!
//! The derivative is never the evidence: the immutable source hash is always
//! the hash of the full original WAV bytes. The derivative only feeds the local
//! recognizer, and its hash plus this transform version are recorded with the
//! machine transcript so a later transform change cannot silently alias it.
use rubato::{audioadapter_buffers::owned::InterleavedOwned, Fft, FixedSync, Resampler};
use sha2::{Digest, Sha256};

pub const TRANSFORM_VERSION: &str = "pcm16-mono-16khz-rubato-fft-v1";
pub const SUPPORTED_RATES: [u32; 4] = [16_000, 32_000, 44_100, 48_000];
pub const TARGET_RATE: u32 = 16_000;
pub const MAX_SECONDS: u64 = 120;
pub const MAX_PCM_BYTES: usize = 24 * 1024 * 1024;
pub const HEADER_LEN: usize = 44;
/// Whole-file bound for imported WAVs: capped PCM plus a modest allowance for
/// header and ignorable metadata chunks.
pub const MAX_WAV_FILE_BYTES: usize = MAX_PCM_BYTES + 64 * 1024;
const MAX_CHUNKS: usize = 64;
const RESAMPLE_CHUNK_FRAMES: usize = 1024;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WavInfo {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub data_offset: usize,
    pub data_len: usize,
    pub frames: u64,
    pub duration_ms: u64,
}

pub struct Derivative {
    pub wav: Vec<u8>,
    pub sha256: String,
    pub frames: u64,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Maximum PCM payload bytes a recording may reach for this format: the lower of
/// 120 seconds and 24 MiB, rounded down to whole frames.
pub fn pcm_cap_bytes(sample_rate_hz: u32, channels: u16) -> usize {
    let block = channels as usize * 2;
    let by_duration = sample_rate_hz as usize * MAX_SECONDS as usize * block;
    by_duration.min(MAX_PCM_BYTES) / block * block
}

fn le16(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}
fn le32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Validate a complete WAV file from its bytes only. File names, extensions and
/// MIME hints are never consulted. Only uncompressed PCM16 mono/stereo at the
/// four supported rates is accepted, within the recording duration/byte caps.
pub fn parse_wav(bytes: &[u8]) -> Result<WavInfo> {
    if bytes.len() < HEADER_LEN || bytes.len() > MAX_WAV_FILE_BYTES {
        return Err("Audio file is not a valid WAV or exceeds the size limit".into());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Audio file is not a RIFF/WAVE file".into());
    }
    if le32(bytes, 4) as u64 + 8 != bytes.len() as u64 {
        return Err("WAV RIFF length does not match the file".into());
    }
    let mut at = 12usize;
    let mut format: Option<(u32, u16)> = None;
    let mut data: Option<(usize, usize)> = None;
    let mut chunks = 0usize;
    while at < bytes.len() {
        chunks += 1;
        if chunks > MAX_CHUNKS || at + 8 > bytes.len() {
            return Err("WAV chunk table is malformed".into());
        }
        let id = &bytes[at..at + 4];
        let size = le32(bytes, at + 4) as usize;
        let body = at + 8;
        let end = body
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or("WAV chunk extends past the file")?;
        match id {
            b"fmt " => {
                if format.is_some() || !(16..=40).contains(&size) {
                    return Err("WAV format chunk is malformed".into());
                }
                let tag = le16(bytes, body);
                let channels = le16(bytes, body + 2);
                let rate = le32(bytes, body + 4);
                let byte_rate = le32(bytes, body + 8);
                let block = le16(bytes, body + 12);
                let bits = le16(bytes, body + 14);
                if tag != 1 {
                    return Err("Only uncompressed PCM WAV is supported".into());
                }
                if !(1..=2).contains(&channels) {
                    return Err("Only mono or stereo WAV is supported".into());
                }
                if !SUPPORTED_RATES.contains(&rate) {
                    return Err("Unsupported WAV sample rate".into());
                }
                if bits != 16
                    || block != channels * 2
                    || byte_rate as u64 != rate as u64 * block as u64
                {
                    return Err("Only 16-bit PCM WAV is supported".into());
                }
                format = Some((rate, channels));
            }
            b"data" => {
                if data.is_some() || format.is_none() {
                    return Err("WAV data chunk is duplicated or precedes its format".into());
                }
                data = Some((body, size));
            }
            _ => {}
        }
        at = end + (size & 1);
        if at > bytes.len() && end != bytes.len() {
            return Err("WAV chunk padding extends past the file".into());
        }
    }
    let ((rate, channels), (data_offset, data_len)) = format
        .zip(data)
        .ok_or("WAV is missing its format or data chunk")?;
    let block = channels as usize * 2;
    if data_len == 0 || data_len % block != 0 || data_len > pcm_cap_bytes(rate, channels) {
        return Err("WAV audio is empty, misaligned or longer than 120 seconds / 24 MiB".into());
    }
    let frames = (data_len / block) as u64;
    Ok(WavInfo {
        sample_rate_hz: rate,
        channels,
        data_offset,
        data_len,
        frames,
        duration_ms: frames * 1000 / rate as u64,
    })
}

pub fn wav_header(sample_rate_hz: u32, channels: u16, data_len: usize) -> [u8; HEADER_LEN] {
    let block = channels as u32 * 2;
    let mut h = [0u8; HEADER_LEN];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len as u32).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate_hz.to_le_bytes());
    h[28..32].copy_from_slice(&(sample_rate_hz * block).to_le_bytes());
    h[32..34].copy_from_slice(&(block as u16).to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&(data_len as u32).to_le_bytes());
    h
}

/// Canonical 44-byte-header WAV. Identical PCM always yields identical bytes.
pub fn build_wav(sample_rate_hz: u32, channels: u16, pcm: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + pcm.len());
    out.extend_from_slice(&wav_header(sample_rate_hz, channels, pcm.len()));
    out.extend_from_slice(pcm);
    out
}

/// Input RMS over every interleaved PCM16 sample value (F0's measurement unit).
pub fn rms_pcm16(pcm: &[u8]) -> f64 {
    let mut count = 0u64;
    let mut sum = 0f64;
    for pair in pcm.chunks_exact(2) {
        let s = i16::from_le_bytes([pair[0], pair[1]]) as f64;
        sum += s * s;
        count += 1;
    }
    if count == 0 {
        0.0
    } else {
        (sum / count as f64).sqrt()
    }
}

/// Round to one decimal so the persisted value is stable and comparable.
pub fn rms_rounded(rms: f64) -> f64 {
    (rms * 10.0).round() / 10.0
}

/// Frozen transform: decode PCM16; mix stereo as (L+R)/2 in f64 (fixed channel
/// order); bypass at 16 kHz, otherwise one whole-clip rubato `Fft<f64>` pass
/// (BlackmanHarris2 anti-aliasing, 1024-frame chunks, FixedSync::Both); round
/// half away from zero, clip to i16; serialize as a canonical mono 16 kHz WAV.
pub fn derive_16k_mono(bytes: &[u8]) -> Result<Derivative> {
    let info = parse_wav(bytes)?;
    let channels = info.channels as usize;
    let pcm = &bytes[info.data_offset..info.data_offset + info.data_len];
    let mut mono: Vec<f64> = Vec::with_capacity(info.frames as usize);
    for frame in pcm.chunks_exact(2 * channels) {
        let left = i16::from_le_bytes([frame[0], frame[1]]) as f64;
        mono.push(if channels == 1 {
            left
        } else {
            (left + i16::from_le_bytes([frame[2], frame[3]]) as f64) / 2.0
        });
    }
    let samples = if info.sample_rate_hz == TARGET_RATE {
        mono
    } else {
        let frames = mono.len();
        let mut resampler = Fft::<f64>::new(
            info.sample_rate_hz as usize,
            TARGET_RATE as usize,
            RESAMPLE_CHUNK_FRAMES,
            1,
            FixedSync::Both,
        )
        .map_err(|e| format!("Audio resampler unavailable: {e}"))?;
        let input = InterleavedOwned::new_from(mono, 1, frames).map_err(|e| e.to_string())?;
        resampler
            .process_all(&input, frames, None)
            .map_err(|e| format!("Audio resampling failed: {e}"))?
            .take_data()
    };
    let mut out = Vec::with_capacity(samples.len() * 2);
    for x in &samples {
        out.extend_from_slice(&(x.round().clamp(-32768.0, 32767.0) as i16).to_le_bytes());
    }
    let wav = build_wav(TARGET_RATE, 1, &out);
    Ok(Derivative {
        sha256: sha256_hex(&wav),
        frames: samples.len() as u64,
        wav,
    })
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    /// Deterministic integer-only pseudo-signal (no libm), so golden hashes do
    /// not depend on transcendental function implementations.
    pub fn synthetic_pcm(frames: usize, channels: usize) -> Vec<u8> {
        let mut state: u32 = 0x1234_5678;
        let mut out = Vec::with_capacity(frames * channels * 2);
        for n in 0..frames {
            let ramp = ((n % 200) as i32 - 100) * 160;
            for c in 0..channels {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = ((state >> 20) as i32 & 0x3ff) - 512;
                let v = (ramp + noise + (c as i32) * 700).clamp(-32768, 32767) as i16;
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        out
    }
    pub fn synthetic_wav(rate: u32, channels: u16, frames: usize) -> Vec<u8> {
        build_wav(rate, channels, &synthetic_pcm(frames, channels as usize))
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    #[test]
    fn canonical_wav_roundtrips_and_is_hash_stable() {
        let wav = synthetic_wav(16_000, 1, 16_000);
        let info = parse_wav(&wav).unwrap();
        assert_eq!(info.sample_rate_hz, 16_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.frames, 16_000);
        assert_eq!(info.duration_ms, 1000);
        assert_eq!(info.data_offset, HEADER_LEN);
        assert_eq!(wav, build_wav(16_000, 1, &wav[HEADER_LEN..]));
        assert_eq!(sha256_hex(&wav), sha256_hex(&wav.clone()));
    }

    #[test]
    fn parser_refuses_malformed_and_unsupported_audio_from_bytes_alone() {
        let good = synthetic_wav(48_000, 2, 480);
        let mut cases: Vec<(&str, Vec<u8>)> = Vec::new();
        cases.push(("short", good[..20].to_vec()));
        let mut bad = good.clone();
        bad[0] = b'X';
        cases.push(("magic", bad));
        let mut bad = good.clone();
        bad[20] = 3; // IEEE float tag
        cases.push(("float", bad));
        let mut bad = good.clone();
        bad[34] = 24; // bits
        cases.push(("bits", bad));
        let mut bad = good.clone();
        bad[24..28].copy_from_slice(&22_050u32.to_le_bytes());
        cases.push(("rate", bad));
        let mut bad = good.clone();
        bad[22] = 3; // channels
        cases.push(("channels", bad));
        let mut bad = good.clone();
        bad.push(0); // trailing byte: RIFF length mismatch
        cases.push(("trailing", bad));
        let mut bad = good.clone();
        let truncated = bad.len() - 3;
        bad.truncate(truncated);
        cases.push(("truncated", bad));
        let mut bad = good.clone();
        bad[40..44].copy_from_slice(&0u32.to_le_bytes());
        cases.push(("empty-data", bad));
        let mut bad = good.clone();
        bad[40..44].copy_from_slice(&(1u32 << 31).to_le_bytes());
        cases.push(("huge-data", bad));
        for (name, bytes) in cases {
            assert!(parse_wav(&bytes).is_err(), "{name} must be refused");
        }
        // Misaligned data (not a whole stereo frame).
        let mut misaligned = build_wav(48_000, 2, &[1, 2, 3, 4, 5, 6]);
        misaligned.truncate(misaligned.len());
        assert!(parse_wav(&misaligned).is_err());
    }

    #[test]
    fn unknown_metadata_chunks_are_skipped_but_not_trusted() {
        let pcm = synthetic_pcm(160, 1);
        let mut wav = wav_header(16_000, 1, pcm.len()).to_vec();
        wav.extend_from_slice(&pcm);
        // Insert an odd-sized LIST chunk before data by rebuilding the layout.
        let mut with_list = Vec::new();
        with_list.extend_from_slice(&wav[..36]);
        with_list.extend_from_slice(b"LIST");
        with_list.extend_from_slice(&3u32.to_le_bytes());
        with_list.extend_from_slice(&[9, 9, 9, 0]);
        with_list.extend_from_slice(&wav[36..]);
        let riff = (with_list.len() - 8) as u32;
        with_list[4..8].copy_from_slice(&riff.to_le_bytes());
        let info = parse_wav(&with_list).unwrap();
        assert_eq!(info.frames, 160);
        assert_eq!(
            &with_list[info.data_offset..info.data_offset + info.data_len],
            &pcm[..]
        );
    }

    #[test]
    fn caps_are_120_seconds_or_24_mib() {
        assert_eq!(pcm_cap_bytes(48_000, 2), 23_040_000);
        assert_eq!(pcm_cap_bytes(16_000, 1), 3_840_000);
        assert!(pcm_cap_bytes(48_000, 2) <= MAX_PCM_BYTES);
        let over = build_wav(16_000, 1, &vec![0u8; 3_840_000 + 2]);
        assert!(parse_wav(&over).is_err());
        let exact = build_wav(16_000, 1, &vec![1u8; 3_840_000]);
        assert_eq!(parse_wav(&exact).unwrap().duration_ms, 120_000);
    }

    #[test]
    fn rms_matches_f0_unit_and_gate_boundary() {
        assert_eq!(rms_pcm16(&[0, 0, 0, 0]), 0.0);
        let pcm: Vec<u8> = [5i16, -5, 5, -5]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        assert_eq!(rms_rounded(rms_pcm16(&pcm)), 5.0);
    }

    // Golden hashes freeze the transform for every supported rate/channel layout
    // and the 1024-frame chunk boundary. Any change is a new transform version.
    fn derivative_hash(rate: u32, channels: u16, frames: usize) -> String {
        let derived = derive_16k_mono(&synthetic_wav(rate, channels, frames)).unwrap();
        let info = parse_wav(&derived.wav).unwrap();
        assert_eq!(info.sample_rate_hz, 16_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.frames, derived.frames);
        derived.sha256
    }

    #[test]
    fn derivative_is_deterministic_and_has_expected_length() {
        for (rate, channels, frames) in [
            (16_000u32, 1u16, 3_000usize),
            (32_000, 2, 6_000),
            (44_100, 1, 44_100),
            (48_000, 2, 48_000),
        ] {
            let a = derivative_hash(rate, channels, frames);
            let b = derivative_hash(rate, channels, frames);
            assert_eq!(a, b);
            let derived = derive_16k_mono(&synthetic_wav(rate, channels, frames)).unwrap();
            let expected = (frames as u64 * 16_000).div_ceil(rate as u64);
            assert_eq!(derived.frames, expected, "{rate}/{channels}");
        }
        // 16 kHz mono is a bit-exact bypass.
        let wav = synthetic_wav(16_000, 1, 2048);
        assert_eq!(derive_16k_mono(&wav).unwrap().wav, wav);
    }

    #[test]
    fn derivative_golden_hashes() {
        let cases: &[(u32, u16, usize, &str)] = GOLDEN;
        let mut mismatches = Vec::new();
        for (rate, channels, frames, expected) in cases {
            let actual = derivative_hash(*rate, *channels, *frames);
            if actual != *expected {
                mismatches.push(format!("({rate}, {channels}, {frames}, \"{actual}\"),"));
            }
        }
        assert!(
            mismatches.is_empty(),
            "update GOLDEN:\n{}",
            mismatches.join("\n")
        );
    }

    // (rate, channels, frames, derivative_sha256). Frames 1023/1024/1025/2048/2049
    // exercise the resampler chunk boundary at 48 kHz mono.
    const GOLDEN: &[(u32, u16, usize, &str)] = &[
        (
            16000,
            1,
            5000,
            "c2a2cc4d24f03474e37304a9a73aaa9a2a536679cc48f3bffc7808b0699a2d9e",
        ),
        (
            16000,
            2,
            5000,
            "375ea97b86d7f96d7a7a5600546e200de072b98cfb06f5af6e4d687b08f0f014",
        ),
        (
            32000,
            1,
            5000,
            "9930595500f318623b407f9ac112926ffaed654ce1f017fd1a75062106566d3b",
        ),
        (
            32000,
            2,
            5000,
            "e8738e301a1efc453d2ae8f9318fd275b0050066c3508cc857f34fabf2ac983e",
        ),
        (
            44100,
            1,
            5000,
            "d5b8c0e83cf61827453844c4d2cb70f60e11933142d51429433e5821b8b4ba89",
        ),
        (
            44100,
            2,
            5000,
            "906445fb9e7835edc526d679130259b3846674bf6c303acc659d392e2682e8ff",
        ),
        (
            48000,
            1,
            5000,
            "f1ff89efdf0ca6f6a2915687a9e878a403599e1101d1b6b6683ac08d2c8dd1d9",
        ),
        (
            48000,
            2,
            5000,
            "4939c17d06677081f3559b1714bef9da12a71f2aa2d98d6c30ff8efd01e849bb",
        ),
        (
            48000,
            1,
            1023,
            "844d449c33824ca30ccfe65f76d6f753673d37d0e5117294597b02fa705f3a57",
        ),
        (
            48000,
            1,
            1024,
            "796cd377b40f143f2e75513c83be09163c0a1b279e5083074cc6cda7a7e1c2a7",
        ),
        (
            48000,
            1,
            1025,
            "805a6490ea100f9ebfcdf29b7bc17b0d32a7b368a0d2f80029a450d507f29741",
        ),
        (
            48000,
            1,
            2048,
            "b786aec92d12ac946c6d126f5c325044995b0d0ac07c46c60878d7124df80882",
        ),
        (
            48000,
            1,
            2049,
            "3253c5f406e7565208e956f47bb9e9153bbd2004a480df63a5fb520aa5136d7f",
        ),
        (
            44100,
            1,
            1322,
            "c9c5f946870382ad268f426c3f3008098710ce566ded1d730e35d4cc073d1d47",
        ),
        (
            44100,
            1,
            1323,
            "44ee80bb80a454505639972fadaee9a5145e7993bb1592fdd1d3a59c869f28f1",
        ),
        (
            44100,
            1,
            1324,
            "12f3c2b6536ff007caaece4150f10ed5c04833b5001c89fbb531d96554a9cfbb",
        ),
    ];
}
