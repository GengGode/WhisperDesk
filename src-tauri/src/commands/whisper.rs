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

/// 发射一次带 phase 的进度事件
fn emit_progress(window: &Window, audio_file_id: &str, progress: f32, msg: &str, phase: &str) {
    let _ = window.emit(
        "transcription-progress",
        TranscriptionProgressPayload {
            audio_file_id: audio_file_id.to_string(),
            progress,
            current_segment: Some(msg.to_string()),
            phase: Some(phase.to_string()),
        },
    );
}

/// 构造转录进度回调闭包（Window → Tauri event），固定 phase
fn make_progress_cb(window: &Window, audio_file_id: &str, phase: &str) -> impl Fn(f32, &str) + Clone + Send + 'static {
    let w = window.clone();
    let fid = audio_file_id.to_string();
    let ph = phase.to_string();
    move |progress: f32, msg: &str| {
        let _ = w.emit(
            "transcription-progress",
            TranscriptionProgressPayload {
                audio_file_id: fid.clone(),
                progress,
                current_segment: Some(msg.to_string()),
                phase: Some(ph.clone()),
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
        emit_progress(&window, &request.audio_file_id, 0.0, "正在连接远程服务器...", "remote_connecting");
        let mut r = transcribe_via_remote(&window, url, &request).await?;
        r.audio_file_id = request.audio_file_id.clone();
        r
    } else {
        let transcriber = TranscriberService::portable()?;
        log("[转录] 开始本地推理...");
        emit_progress(&window, &request.audio_file_id, 0.0, "开始本地推理...", "local");
        transcriber
            .transcribe(
                make_progress_cb(&window, &request.audio_file_id, "local"),
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

    let file_size_mb = audio_bytes.len() as f64 / (1024.0 * 1024.0);
    emit_progress(
        window,
        &request.audio_file_id,
        0.0,
        &format!("正在上传音频文件 ({file_size_mb:.1} MB)..."),
        "remote_uploading",
    );

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio")
        .mime_str("application/octet-stream")
        .unwrap();

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part);

    if let Some(lang) = &request.language {
        form = form.text("language", lang.clone());
    }

    let url = format!("{}/api/transcribe", remote_url.trim_end_matches('/'));
    let client = Client::builder()
        .user_agent("WhisperDesk/0.1")
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_proxy()
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

    let log = make_log_cb(window);

    log(&format!("[远程] HTTP 状态: {}, Content-Type: {:?}",
        resp.status(),
        resp.headers().get("content-type"),
    ));

    emit_progress(
        window,
        &request.audio_file_id,
        0.0,
        "远程服务器已接收，等待转录...",
        "remote_transcribing",
    );

    let on_progress = make_progress_cb(window, &request.audio_file_id, "remote_transcribing");
    let mut result: Option<TranscriptionResult> = None;

    use eventsource_stream::Eventsource;
    use tokio_stream::StreamExt;

    let mut stream = resp.bytes_stream().eventsource();
    let mut event_count: u64 = 0;

    while let Some(ev) = stream.next().await {
        match ev {
            Ok(event) => {
                event_count += 1;
                log(&format!("[远程] 事件 #{event_count} '{}', {} bytes",
                    event.event, event.data.len()));

                match event.event.as_str() {
                    "progress" => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&event.data) {
                            let p = v["progress"].as_f64().unwrap_or(0.0) as f32;
                            let msg = v["message"].as_str().unwrap_or("");
                            on_progress(p, msg);
                        }
                    }
                    "complete" => {
                        emit_progress(window, &request.audio_file_id, 1.0, "远程转录完成", "complete");
                        let r: TranscriptionResult = serde_json::from_str(&event.data)
                            .map_err(|e| {
                                let preview = if event.data.len() > 500 { &event.data[..500] } else { &event.data };
                                log(&format!("[远程] 解析 complete 失败: {e}, 前 500 字符: {preview:?}"));
                                AppError::Transcription(format!("解析远程结果失败: {e}"))
                            })?;
                        log(&format!("[远程] 解析成功，文本 {} chars, {} 个分段",
                            r.text.len(), r.segments.len()));
                        result = Some(r);
                        break;
                    }
                    "error" => {
                        return Err(AppError::Transcription(format!("远程推理错误: {}", event.data)));
                    }
                    _ => {}
                }
            }
            Err(e) => {
                return Err(AppError::Transcription(format!("SSE 流解析错误: {e}")));
            }
        }
    }

    log(&format!("[远程] SSE 流结束，共 {event_count} 个事件，结果: {}",
        if result.is_some() { "有" } else { "无" }));

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
        ExportFormat::Lrc => to_lrc(&result),
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

fn to_lrc(result: &TranscriptionResult) -> String {
    let mut lines = Vec::with_capacity(result.segments.len() + 3);
    lines.push("[by:WhisperDesk]".to_string());
    lines.push(format!("[length:{}]", format_lrc_time(result.duration)));
    lines.push(String::new());
    for segment in &result.segments {
        let text = segment.text.trim();
        if !text.is_empty() {
            lines.push(format!("[{}]{}", format_lrc_time(segment.start), text));
        }
    }
    lines.join("\n")
}

fn format_lrc_time(seconds: f64) -> String {
    let total_cs = (seconds * 100.0).round() as u64;
    let m = total_cs / 6000;
    let s = (total_cs % 6000) / 100;
    let cs = total_cs % 100;
    format!("{m:02}:{s:02}.{cs:02}")
}

fn export_filename(audio_id: &str, model_name: &str, format: &ExportFormat) -> String {
    let ext = match format {
        ExportFormat::Txt => "txt",
        ExportFormat::Json => "json",
        ExportFormat::Srt => "srt",
        ExportFormat::Lrc => "lrc",
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
