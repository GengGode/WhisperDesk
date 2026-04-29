use std::path::Path;

use serde::Serialize;
use tauri::{Emitter, Window};

use crate::models::audio::{VadConfig, VadSegment};
use crate::models::error::AppError;
use crate::services::audio::{compute_waveform_peaks, decode_to_16k_mono};
use crate::services::vad;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub duration: f64,
    pub num_peaks: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformProgress {
    audio_path: String,
    progress: f32,
    peaks: Vec<f32>,
}

#[tauri::command]
pub async fn get_audio_peaks(
    window: Window,
    audio_path: String,
    num_peaks: Option<usize>,
) -> Result<WaveformData, AppError> {
    let n = num_peaks.unwrap_or(2000);
    let path_for_event = audio_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        compute_waveform_peaks(Path::new(&audio_path), n, |progress, peaks| {
            let _ = window.emit(
                "waveform-progress",
                WaveformProgress {
                    audio_path: path_for_event.clone(),
                    progress,
                    peaks: peaks.to_vec(),
                },
            );
        })
    })
    .await
    .map_err(|e| AppError::Audio(format!("峰值计算线程错误: {e}")))?;

    let (peaks, duration) = result?;
    let actual_peaks = peaks.len() / 2;
    Ok(WaveformData {
        num_peaks: actual_peaks,
        peaks,
        duration,
    })
}

/// 独立 VAD 分析命令：解码音频后运行 VAD，返回有声/静音段列表。
/// 供前端在波形图上预览分割效果，不触发推理。
#[tauri::command]
pub async fn analyze_vad(
    audio_path: String,
    config: VadConfig,
) -> Result<Vec<VadSegment>, AppError> {
    tokio::task::spawn_blocking(move || {
        let decoded = decode_to_16k_mono(Path::new(&audio_path))?;
        let mut samples = decoded.samples_16k_mono;
        crate::services::audio::normalize_peak(&mut samples);
        let segments = vad::detect_voice_segments(
            &samples,
            16_000,
            &config,
        );
        Ok(segments)
    })
    .await
    .map_err(|e| AppError::Audio(format!("VAD 分析线程错误: {e}")))?
}
