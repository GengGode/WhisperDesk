use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

use crate::models::error::AppError;

/// 仅从文件头读取的轻量元数据，不解码任何音频数据
pub struct AudioMetadata {
    pub sample_rate: u32,
    pub channels: usize,
    pub duration_seconds: f64,
}

/// 只读取文件头获取元数据，不解码音频数据。
/// 比 decode_to_16k_mono 快几个数量级。
pub fn probe_audio_metadata(path: &Path) -> Result<AudioMetadata, AppError> {
    let file = File::open(path).map_err(|e| AppError::Audio(format!("打开音频失败: {e}")))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AppError::Audio(format!("探测音频格式失败: {e}")))?;

    let track = probed
        .format
        .default_track()
        .ok_or_else(|| AppError::Audio("未找到默认音轨".to_string()))?;

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| AppError::Audio("无法读取采样率".to_string()))?;

    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .ok_or_else(|| AppError::Audio("无法读取声道数".to_string()))?;

    let duration_seconds = match (track.codec_params.n_frames, track.codec_params.time_base) {
        (Some(n), Some(tb)) => n as f64 * tb.numer as f64 / tb.denom as f64,
        (Some(n), None) if sample_rate > 0 => n as f64 / sample_rate as f64,
        _ => 0.0,
    };

    Ok(AudioMetadata {
        sample_rate,
        channels,
        duration_seconds,
    })
}

#[allow(dead_code)]
pub struct DecodedAudio {
    pub samples_16k_mono: Vec<f32>,
    pub source_sample_rate: u32,
    pub source_channels: usize,
    pub duration_seconds: f64,
}

/// 解析音频并转换为 whisper 所需 16k 单声道 f32 PCM
pub fn decode_to_16k_mono(path: &Path) -> Result<DecodedAudio, AppError> {
    let file = File::open(path).map_err(|e| AppError::Audio(format!("打开音频失败: {e}")))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AppError::Audio(format!("探测音频格式失败: {e}")))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| AppError::Audio("未找到默认音轨".to_string()))?;

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| AppError::Audio("无法读取采样率".to_string()))?;

    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .ok_or_else(|| AppError::Audio("无法读取声道数".to_string()))?;

    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Audio(format!("创建解码器失败: {e}")))?;

    let mut interleaved: Vec<f32> = Vec::new();
    let track_id = track.id;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                return Err(AppError::Audio("音频流重置未实现".to_string()));
            }
            Err(e) => return Err(AppError::Audio(format!("读取音频包失败: {e}"))),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(audio_buf) => audio_buf,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(AppError::Audio(format!("解码失败: {e}"))),
        };

        let mut sample_buf =
            SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buf.copy_interleaved_ref(decoded);
        interleaved.extend_from_slice(sample_buf.samples());
    }

    if interleaved.is_empty() {
        return Err(AppError::Audio("音频样本为空".to_string()));
    }

    let mono = to_mono(&interleaved, channels);
    let resampled = resample_linear(&mono, sample_rate, 16_000);
    let duration_seconds = mono.len() as f64 / sample_rate as f64;

    Ok(DecodedAudio {
        samples_16k_mono: resampled,
        source_sample_rate: sample_rate,
        source_channels: channels,
        duration_seconds,
    })
}

/// 从音频文件生成波形峰值数据（用于前端 Canvas 绘制）。
/// 边解码边计算，不缓存全部样本，内存占用极小。
/// 返回 num_peaks 个 [min, max] 对，扁平存储为 Vec<f32>。
///
/// `on_progress(progress, peaks)` 在解码过程中被周期性调用，
/// progress 范围 0.0 ~ 1.0，peaks 为当前已有的峰值切片（可用于渐进式渲染）。
pub fn compute_waveform_peaks<F>(
    path: &Path,
    num_peaks: usize,
    on_progress: F,
) -> Result<(Vec<f32>, f64), AppError>
where
    F: Fn(f32, &[f32]),
{
    let file = File::open(path).map_err(|e| AppError::Audio(format!("打开音频失败: {e}")))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| AppError::Audio(format!("探测音频格式失败: {e}")))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| AppError::Audio("未找到默认音轨".to_string()))?;

    let sample_rate = track.codec_params.sample_rate
        .ok_or_else(|| AppError::Audio("无法读取采样率".to_string()))?;
    let channels = track.codec_params.channels
        .map(|c| c.count())
        .ok_or_else(|| AppError::Audio("无法读取声道数".to_string()))?;

    // n_frames 不可用时按 5 分钟兜底；多分配 50% 桶降低预估偏差，解码后精确合并
    let estimated_frames = track.codec_params.n_frames
        .unwrap_or(sample_rate as u64 * 300);
    let chunk_size = (estimated_frames as usize / (num_peaks + num_peaks / 2)).max(1);

    // 渐进式回调节流：~10% 间隔触发（带 peaks 数据，频率不宜过高）
    let report_interval = (estimated_frames as usize / 10).max(4096);

    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Audio(format!("创建解码器失败: {e}")))?;

    let track_id = track.id;
    let mut peaks = Vec::with_capacity(num_peaks * 2);
    let mut cur_min = f32::MAX;
    let mut cur_max = f32::MIN;
    let mut samples_in_chunk: usize = 0;
    let mut total_samples: usize = 0;
    let mut samples_since_report: usize = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(buf) => buf,
            Err(_) => continue,
        };
        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        // 边解码边统计 min/max
        if channels <= 1 {
            for &s in samples {
                if s < cur_min { cur_min = s; }
                if s > cur_max { cur_max = s; }
                samples_in_chunk += 1;
                total_samples += 1;
                if samples_in_chunk >= chunk_size {
                    peaks.push(cur_min);
                    peaks.push(cur_max);
                    cur_min = f32::MAX;
                    cur_max = f32::MIN;
                    samples_in_chunk = 0;
                }
            }
        } else {
            for frame in samples.chunks_exact(channels) {
                let mono = frame.iter().copied().sum::<f32>() / channels as f32;
                if mono < cur_min { cur_min = mono; }
                if mono > cur_max { cur_max = mono; }
                samples_in_chunk += 1;
                total_samples += 1;
                if samples_in_chunk >= chunk_size {
                    peaks.push(cur_min);
                    peaks.push(cur_max);
                    cur_min = f32::MAX;
                    cur_max = f32::MIN;
                    samples_in_chunk = 0;
                }
            }
        }

        samples_since_report += samples.len();
        if samples_since_report >= report_interval {
            samples_since_report = 0;
            let progress = (total_samples as f64 / estimated_frames as f64).min(1.0);
            on_progress(progress as f32, &peaks);
        }
    }

    // 最后一个不满的桶
    if samples_in_chunk > 0 {
        peaks.push(cur_min);
        peaks.push(cur_max);
    }

    // 预估帧数可能不准确导致实际桶数偏离目标，合并到精确数量
    let actual_peak_count = peaks.len() / 2;
    if actual_peak_count > num_peaks {
        peaks = merge_peaks(&peaks, num_peaks);
    }

    let duration = if sample_rate > 0 {
        total_samples as f64 / sample_rate as f64
    } else {
        0.0
    };

    Ok((peaks, duration))
}

fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }

    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
        .collect()
}

/// 将峰值数据（[min, max] 对的扁平数组）合并到目标数量
fn merge_peaks(source: &[f32], target_count: usize) -> Vec<f32> {
    let source_count = source.len() / 2;
    if source_count <= target_count {
        return source.to_vec();
    }

    let mut result = Vec::with_capacity(target_count * 2);
    let ratio = source_count as f64 / target_count as f64;

    for i in 0..target_count {
        let from = (i as f64 * ratio).floor() as usize;
        let to = (((i + 1) as f64) * ratio).floor().min(source_count as f64) as usize;
        let mut min = f32::MAX;
        let mut max = f32::MIN;
        for j in from..to {
            let s_min = source[j * 2];
            let s_max = source[j * 2 + 1];
            if s_min < min { min = s_min; }
            if s_max > max { max = s_max; }
        }
        result.push(min);
        result.push(max);
    }

    result
}

fn resample_linear(samples: &[f32], src_rate: u32, target_rate: u32) -> Vec<f32> {
    if src_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / src_rate as f64;
    let out_len = ((samples.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f64 / ratio;
        let left = src_pos.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let frac = (src_pos - left as f64) as f32;
        let value = samples[left] * (1.0 - frac) + samples[right] * frac;
        out.push(value);
    }

    out
}
