use std::path::Path;

use serde::Serialize;
use tauri::{Emitter, Window};

use crate::models::error::AppError;
use crate::services::audio::compute_waveform_peaks;

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
