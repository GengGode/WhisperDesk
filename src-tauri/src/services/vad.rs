use crate::models::audio::{VadConfig, VadSegment};

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            energy_threshold_db: -40.0,
            min_silence_ms: 300,
            min_speech_ms: 250,
            padding_ms: 100,
        }
    }
}

/// 帧级 RMS 能量 VAD：检测有声段和静音段。
///
/// 算法流程：
/// 1. 按 30ms 帧计算 RMS 能量（dB）
/// 2. 超过阈值标记为 speech
/// 3. 合并间距过短的 speech 段、过滤过短的 speech 段
/// 4. 添加前后 padding 缓冲
/// 5. 返回完整的有声 + 静音段列表（覆盖整段音频时间线）
pub fn detect_voice_segments(
    samples: &[f32],
    sample_rate: u32,
    config: &VadConfig,
) -> Vec<VadSegment> {
    if samples.is_empty() || sample_rate == 0 {
        return vec![];
    }

    let total_duration = samples.len() as f64 / sample_rate as f64;
    let frame_size = (sample_rate as usize * 30) / 1000; // 30ms 帧
    if frame_size == 0 {
        return vec![VadSegment {
            start_seconds: 0.0,
            end_seconds: total_duration,
            is_voice: true,
        }];
    }

    // 逐帧计算 RMS 能量并判定 speech/silence
    let mut speech_frames: Vec<bool> = Vec::with_capacity(samples.len() / frame_size + 1);
    for chunk in samples.chunks(frame_size) {
        let rms = frame_rms(chunk);
        let db = rms_to_db(rms);
        speech_frames.push(db >= config.energy_threshold_db);
    }

    // 将帧级 bool 转换为粗略的 speech 区间（样本索引）
    let mut raw_intervals: Vec<(usize, usize)> = Vec::new();
    let mut in_speech = false;
    let mut start_frame = 0usize;

    for (i, &is_speech) in speech_frames.iter().enumerate() {
        if is_speech && !in_speech {
            start_frame = i;
            in_speech = true;
        } else if !is_speech && in_speech {
            raw_intervals.push((start_frame * frame_size, i * frame_size));
            in_speech = false;
        }
    }
    if in_speech {
        raw_intervals.push((start_frame * frame_size, samples.len()));
    }

    if raw_intervals.is_empty() {
        return vec![VadSegment {
            start_seconds: 0.0,
            end_seconds: total_duration,
            is_voice: false,
        }];
    }

    // 合并间距 < min_silence_ms 的相邻 speech 段
    let min_silence_samples = ms_to_samples(config.min_silence_ms, sample_rate);
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(raw_intervals.len());
    merged.push(raw_intervals[0]);

    for &(start, end) in &raw_intervals[1..] {
        let last = merged.last_mut().unwrap();
        if start.saturating_sub(last.1) < min_silence_samples {
            last.1 = end;
        } else {
            merged.push((start, end));
        }
    }

    // 过滤持续 < min_speech_ms 的过短 speech 段
    let min_speech_samples = ms_to_samples(config.min_speech_ms, sample_rate);
    merged.retain(|&(s, e)| e - s >= min_speech_samples);

    if merged.is_empty() {
        return vec![VadSegment {
            start_seconds: 0.0,
            end_seconds: total_duration,
            is_voice: false,
        }];
    }

    // 添加 padding 并 clamp 到合法范围
    let padding_samples = ms_to_samples(config.padding_ms, sample_rate);
    for interval in &mut merged {
        interval.0 = interval.0.saturating_sub(padding_samples);
        interval.1 = (interval.1 + padding_samples).min(samples.len());
    }

    // 再次合并 padding 导致重叠的相邻段
    let mut padded: Vec<(usize, usize)> = Vec::with_capacity(merged.len());
    padded.push(merged[0]);
    for &(start, end) in &merged[1..] {
        let last = padded.last_mut().unwrap();
        if start <= last.1 {
            last.1 = last.1.max(end);
        } else {
            padded.push((start, end));
        }
    }

    // 转换为 VadSegment 列表（有声 + 静音交替，覆盖完整时间线）
    build_full_timeline(&padded, samples.len(), sample_rate)
}

/// 对超过 max_seconds 的有声段在能量最低处做二次分割，
/// 确保每段不超过上限（Whisper 对 ≤30s 片段效果最佳）。
pub fn split_long_segments(
    segments: &[VadSegment],
    samples: &[f32],
    sample_rate: u32,
    max_seconds: f64,
) -> Vec<VadSegment> {
    let mut result: Vec<VadSegment> = Vec::with_capacity(segments.len());

    for seg in segments {
        let seg_duration = seg.end_seconds - seg.start_seconds;
        if !seg.is_voice || seg_duration <= max_seconds {
            result.push(seg.clone());
            continue;
        }

        let start_sample = seconds_to_samples(seg.start_seconds, sample_rate);
        let end_sample = seconds_to_samples(seg.end_seconds, sample_rate).min(samples.len());
        let seg_samples = &samples[start_sample..end_sample];

        let sub_splits = split_at_silence(seg_samples, sample_rate, max_seconds);
        for (sub_start, sub_end) in sub_splits {
            let abs_start = start_sample + sub_start;
            let abs_end = start_sample + sub_end;
            result.push(VadSegment {
                start_seconds: abs_start as f64 / sample_rate as f64,
                end_seconds: abs_end as f64 / sample_rate as f64,
                is_voice: true,
            });
        }
    }

    result
}

/// 为相邻有声段之间添加重叠，防止 VAD 切割边界截断正在说的字。
/// 每个 chunk 的 start 向前扩展 overlap/2，end 向后扩展 overlap/2，
/// clamp 到 [0, total_duration]。不与相邻 chunk 合并——重叠区域会在推理后去重。
pub fn add_overlap(
    voice_chunks: &[(f64, f64)],
    overlap_seconds: f64,
    total_duration: f64,
) -> Vec<(f64, f64)> {
    if voice_chunks.is_empty() || overlap_seconds <= 0.0 {
        return voice_chunks.to_vec();
    }
    let half = overlap_seconds / 2.0;
    voice_chunks
        .iter()
        .map(|&(start, end)| {
            let new_start = (start - half).max(0.0);
            let new_end = (end + half).min(total_duration);
            (new_start, new_end)
        })
        .collect()
}

/// 在一段音频内按最大时长切分，优先在能量谷底位置切割
fn split_at_silence(
    samples: &[f32],
    sample_rate: u32,
    max_seconds: f64,
) -> Vec<(usize, usize)> {
    let max_samples = (max_seconds * sample_rate as f64) as usize;
    if samples.len() <= max_samples {
        return vec![(0, samples.len())];
    }

    // 200ms 帧，计算能量曲线用于寻找最佳切割点
    let analysis_frame = (sample_rate as usize * 200) / 1000;
    let energies: Vec<f32> = samples
        .chunks(analysis_frame.max(1))
        .map(|chunk| frame_rms(chunk))
        .collect();

    let mut splits = Vec::new();
    let mut pos = 0usize;

    while pos < samples.len() {
        let remaining = samples.len() - pos;
        if remaining <= max_samples {
            splits.push((pos, samples.len()));
            break;
        }

        // 在 [0.5*max, max] 区间内找能量最低的帧作为切割点
        let search_start = max_samples / 2;
        let search_end = max_samples;
        let frame_start = (pos + search_start) / analysis_frame;
        let frame_end = ((pos + search_end) / analysis_frame).min(energies.len());

        let best_frame = if frame_start < frame_end {
            (frame_start..frame_end)
                .min_by(|&a, &b| {
                    energies.get(a).unwrap_or(&f32::MAX)
                        .partial_cmp(energies.get(b).unwrap_or(&f32::MAX))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(frame_start)
        } else {
            (pos + max_samples) / analysis_frame
        };

        let cut_sample = (best_frame * analysis_frame).min(samples.len());
        if cut_sample <= pos {
            splits.push((pos, (pos + max_samples).min(samples.len())));
            pos += max_samples;
        } else {
            splits.push((pos, cut_sample));
            pos = cut_sample;
        }
    }

    splits
}

/// 将有声段列表转为完整时间线（有声 + 静音交替）
fn build_full_timeline(
    voice_intervals: &[(usize, usize)],
    total_samples: usize,
    sample_rate: u32,
) -> Vec<VadSegment> {
    let sr = sample_rate as f64;
    let total_dur = total_samples as f64 / sr;
    let mut segments = Vec::with_capacity(voice_intervals.len() * 2 + 1);
    let mut cursor = 0.0f64;

    for &(start, end) in voice_intervals {
        let seg_start = start as f64 / sr;
        let seg_end = end as f64 / sr;

        if seg_start > cursor + 0.001 {
            segments.push(VadSegment {
                start_seconds: cursor,
                end_seconds: seg_start,
                is_voice: false,
            });
        }
        segments.push(VadSegment {
            start_seconds: seg_start,
            end_seconds: seg_end,
            is_voice: true,
        });
        cursor = seg_end;
    }

    if cursor < total_dur - 0.001 {
        segments.push(VadSegment {
            start_seconds: cursor,
            end_seconds: total_dur,
            is_voice: false,
        });
    }

    segments
}

fn frame_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

fn rms_to_db(rms: f32) -> f32 {
    if rms <= 1e-10 {
        return -100.0;
    }
    20.0 * rms.log10()
}

fn ms_to_samples(ms: u32, sample_rate: u32) -> usize {
    (sample_rate as usize * ms as usize) / 1000
}

fn seconds_to_samples(seconds: f64, sample_rate: u32) -> usize {
    (seconds * sample_rate as f64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sine(freq_hz: f32, duration_sec: f32, sample_rate: u32, amplitude: f32) -> Vec<f32> {
        let n = (duration_sec * sample_rate as f32) as usize;
        (0..n)
            .map(|i| {
                amplitude * (2.0 * std::f32::consts::PI * freq_hz * i as f32 / sample_rate as f32).sin()
            })
            .collect()
    }

    fn make_silence(duration_sec: f32, sample_rate: u32) -> Vec<f32> {
        vec![0.0; (duration_sec * sample_rate as f32) as usize]
    }

    #[test]
    fn test_pure_silence() {
        let samples = make_silence(5.0, 16000);
        let segs = detect_voice_segments(&samples, 16000, &VadConfig::default());
        assert!(!segs.is_empty());
        assert!(segs.iter().all(|s| !s.is_voice));
    }

    #[test]
    fn test_pure_speech() {
        let samples = make_sine(440.0, 3.0, 16000, 0.5);
        let segs = detect_voice_segments(&samples, 16000, &VadConfig::default());
        let voice: Vec<_> = segs.iter().filter(|s| s.is_voice).collect();
        assert!(!voice.is_empty());
    }

    #[test]
    fn test_speech_silence_speech() {
        let sr = 16000u32;
        let mut samples = make_sine(440.0, 2.0, sr, 0.5);
        samples.extend(make_silence(1.0, sr));
        samples.extend(make_sine(440.0, 2.0, sr, 0.5));

        let segs = detect_voice_segments(&samples, sr, &VadConfig::default());
        let voice_count = segs.iter().filter(|s| s.is_voice).count();
        assert!(voice_count >= 1);
    }

    #[test]
    fn test_split_long_segments() {
        let sr = 16000u32;
        let samples = make_sine(440.0, 60.0, sr, 0.3);
        let initial = vec![VadSegment {
            start_seconds: 0.0,
            end_seconds: 60.0,
            is_voice: true,
        }];
        let result = split_long_segments(&initial, &samples, sr, 30.0);
        assert!(result.len() >= 2, "60s 段应被分为至少 2 段");
        for seg in &result {
            assert!(seg.end_seconds - seg.start_seconds <= 30.5);
        }
    }
}
