use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::models::audio::{
    ExportFormat, ExportRequest, TranscriptionProgressPayload, TranscriptionRequest,
    TranscriptionResult, UpdateTranscriptionRequest, WhisperLogPayload,
};
use crate::models::error::AppError;
use crate::services::cuda::CudaInfo;
use crate::services::file_index::FileIndexService;
use crate::services::paths;
use crate::services::transcriber::{ModelInfo, TranscriberService};

/// 转录中止标志，通过 Tauri State 在命令间共享
pub struct TranscriptionAbortFlag(pub Arc<AtomicBool>);

impl TranscriptionAbortFlag {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

/// 构造转录进度回调闭包（Window → Tauri event）
fn make_progress_cb(window: &Window, audio_file_id: &str) -> impl Fn(f32, &str) + Clone + Send + 'static {
    let w = window.clone();
    let fid = audio_file_id.to_string();
    move |progress: f32, msg: &str| {
        let _ = w.emit(
            "transcription-progress",
            TranscriptionProgressPayload {
                audio_file_id: fid.clone(),
                progress,
                current_segment: Some(msg.to_string()),
            },
        );
    }
}

/// 构造模型下载进度回调闭包（Window → Tauri event）
fn make_model_dl_cb(window: &Window) -> impl Fn(&str, f32) + Clone + Send + 'static {
    let w = window.clone();
    move |model_name: &str, progress: f32| {
        let _ = w.emit(
            "model-download-progress",
            serde_json::json!({ "modelName": model_name, "progress": progress }),
        );
    }
}

/// 构造 whisper 日志回调闭包（Window → Tauri event）
fn make_log_cb(window: &Window) -> impl Fn(&str) + Clone + Send + 'static {
    let w = window.clone();
    move |msg: &str| {
        let _ = w.emit(
            "whisper-log",
            WhisperLogPayload {
                message: msg.to_string(),
            },
        );
    }
}

#[tauri::command]
pub async fn transcribe_audio(
    window: Window,
    abort_flag: State<'_, TranscriptionAbortFlag>,
    request: TranscriptionRequest,
) -> Result<TranscriptionResult, AppError> {
    let log = make_log_cb(&window);
    let flag = abort_flag.0.clone();
    flag.store(false, Ordering::Relaxed);

    log(&format!(
        "[转录] 收到转录请求: file_id={}, path={}, model={}",
        request.audio_file_id, request.audio_path, request.model_name
    ));
    let index_service = FileIndexService::portable()?;
    index_service.init()?;

    let result = if let Some(url) = request.remote_url.as_deref().filter(|u| !u.is_empty()) {
        log(&format!("[转录] 使用远程推理: {url}"));
        let mut r = transcribe_via_remote(&window, url, &request).await?;
        r.audio_file_id = request.audio_file_id.clone();
        r
    } else {
        let transcriber = TranscriberService::portable()?;
        log("[转录] 开始本地推理...");
        transcriber
            .transcribe(
                make_progress_cb(&window, &request.audio_file_id),
                make_model_dl_cb(&window),
                log.clone(),
                flag,
                &request,
            )
            .await?
    };

    log(&format!(
        "[转录] 推理完成，共 {} 个分段",
        result.segments.len()
    ));
    index_service.save_transcription_result(&result)?;
    log("[转录] 结果已保存到数据库");
    Ok(result)
}

#[tauri::command]
pub fn abort_transcription(
    window: Window,
    abort_flag: State<'_, TranscriptionAbortFlag>,
) {
    abort_flag.0.store(true, Ordering::Relaxed);
    let _ = window.emit(
        "whisper-log",
        WhisperLogPayload {
            message: "[转录] 收到停止请求，正在中止...".to_string(),
        },
    );
}

/// 远程推理：读取本地音频 → multipart POST → 解析 SSE 流 → 转发进度
async fn transcribe_via_remote(
    window: &Window,
    remote_url: &str,
    request: &TranscriptionRequest,
) -> Result<TranscriptionResult, AppError> {
    use reqwest::Client;

    let audio_bytes = tokio::fs::read(&request.audio_path)
        .await
        .map_err(|e| AppError::FileSystem(format!("读取音频文件失败: {e}")))?;

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio")
        .mime_str("application/octet-stream")
        .unwrap();

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model_name", request.model_name.clone());

    if let Some(lang) = &request.language {
        form = form.text("language", lang.clone());
    }
    if let Some(t) = request.threads {
        form = form.text("threads", t.to_string());
    }

    let url = format!("{}/api/transcribe", remote_url.trim_end_matches('/'));
    let client = Client::builder()
        .user_agent("WhisperDesk/0.1")
        .build()
        .map_err(|e| AppError::Transcription(format!("创建 HTTP 客户端失败: {e}")))?;

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Transcription(format!("远程推理请求失败: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "远程服务器返回错误 {status}: {body}"
        )));
    }

    let on_progress = make_progress_cb(window, &request.audio_file_id);
    let mut result: Option<TranscriptionResult> = None;
    let mut current_event = String::new();
    let mut data_buf = String::new();
    let mut line_buf = String::new();

    let mut stream = resp;
    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| AppError::Transcription(format!("读取远程响应失败: {e}")))?
    {
        let text = String::from_utf8_lossy(&chunk);
        line_buf.push_str(&text);

        while let Some(pos) = line_buf.find('\n') {
            let line = line_buf[..pos].trim_end_matches('\r').to_string();
            line_buf = line_buf[pos + 1..].to_string();

            if let Some(ev) = line.strip_prefix("event: ") {
                current_event = ev.trim().to_string();
            } else if let Some(d) = line.strip_prefix("data: ") {
                data_buf = d.to_string();
            } else if line.is_empty() && !current_event.is_empty() {
                match current_event.as_str() {
                    "progress" => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data_buf) {
                            let p = v["progress"].as_f64().unwrap_or(0.0) as f32;
                            let msg = v["message"].as_str().unwrap_or("");
                            on_progress(p, msg);
                        }
                    }
                    "complete" => {
                        let r: TranscriptionResult = serde_json::from_str(&data_buf)
                            .map_err(|e| AppError::Transcription(format!("解析远程结果失败: {e}")))?;
                        result = Some(r);
                    }
                    "error" => {
                        return Err(AppError::Transcription(format!("远程推理错误: {data_buf}")));
                    }
                    _ => {}
                }
                current_event.clear();
                data_buf.clear();
            }
        }
    }

    result.ok_or_else(|| AppError::Transcription("远程服务器未返回转录结果".to_string()))
}

#[tauri::command]
pub fn get_transcription_results(
    audio_file_id: String,
) -> Result<Vec<TranscriptionResult>, AppError> {
    let index_service = FileIndexService::portable()?;
    index_service.init()?;
    index_service.get_transcription_results(&audio_file_id)
}

#[tauri::command]
pub async fn ensure_model(
    window: Window,
    model_name: String,
) -> Result<String, AppError> {
    let service = TranscriberService::portable()?;
    let path = service
        .ensure_model(make_model_dl_cb(&window), make_log_cb(&window), &model_name)
        .await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_transcription(app: AppHandle, request: ExportRequest) -> Result<Option<String>, AppError> {
    let index_service = FileIndexService::portable()?;
    index_service.init()?;

    let Some(result) = index_service.get_transcription_result_by_id(&request.result_id)? else {
        return Err(AppError::InvalidArgument("未找到对应的转录结果".to_string()));
    };

    let save_path = app
        .dialog()
        .file()
        .set_file_name(export_filename(&result.audio_file_id, &result.model_name, &request.format).as_str())
        .blocking_save_file();

    let Some(path) = dialog_path_to_pathbuf(save_path) else {
        return Ok(None);
    };

    let content = match request.format {
        ExportFormat::Txt => result.text.clone(),
        ExportFormat::Json => serde_json::to_string_pretty(&result)
            .map_err(|e| AppError::FileSystem(format!("序列化 JSON 失败: {e}")))?,
        ExportFormat::Srt => to_srt(&result),
    };

    std::fs::write(&path, content)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn to_srt(result: &TranscriptionResult) -> String {
    let mut lines = Vec::with_capacity(result.segments.len() * 4);
    for (idx, segment) in result.segments.iter().enumerate() {
        lines.push((idx + 1).to_string());
        lines.push(format!(
            "{} --> {}",
            format_srt_time(segment.start),
            format_srt_time(segment.end)
        ));
        lines.push(segment.text.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

fn format_srt_time(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0).round() as u64;
    let h = total_ms / 3_600_000;
    let m = (total_ms % 3_600_000) / 60_000;
    let s = (total_ms % 60_000) / 1000;
    let ms = total_ms % 1000;
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

fn export_filename(audio_id: &str, model_name: &str, format: &ExportFormat) -> String {
    let ext = match format {
        ExportFormat::Txt => "txt",
        ExportFormat::Json => "json",
        ExportFormat::Srt => "srt",
    };
    format!("transcription-{audio_id}-{model_name}.{ext}")
}

fn dialog_path_to_pathbuf(path: Option<tauri_plugin_dialog::FilePath>) -> Option<PathBuf> {
    match path {
        Some(tauri_plugin_dialog::FilePath::Path(path_buf)) => Some(path_buf),
        _ => None,
    }
}

#[tauri::command]
pub fn update_transcription_result(
    request: UpdateTranscriptionRequest,
) -> Result<(), AppError> {
    let index_service = FileIndexService::portable()?;
    index_service.init()?;
    index_service.update_transcription(
        &request.id,
        &request.text,
        &request.segments,
    )
}

#[tauri::command]
pub fn list_models() -> Result<Vec<ModelInfo>, AppError> {
    let service = TranscriberService::portable()?;
    service.list_models()
}

#[tauri::command]
pub fn get_models_dir() -> Result<String, AppError> {
    let dir = paths::models_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_models_dir(app: AppHandle) -> Result<(), AppError> {
    let dir = paths::models_dir()?;
    let dir_str = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&dir_str, None::<&str>)
        .map_err(|e| AppError::FileSystem(format!("打开目录失败: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn delete_model(model_name: String) -> Result<(), AppError> {
    let service = TranscriberService::portable()?;
    let path = service.model_path(&model_name);
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

#[tauri::command]
pub fn check_cuda() -> CudaInfo {
    crate::services::cuda::get_cuda_info().clone()
}
