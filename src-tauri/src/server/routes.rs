use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, State},
    response::{
        sse::{Event, Sse},
        Html, IntoResponse, Response,
    },
    routing::{get, post, put},
    Json, Router,
};
use rust_embed::Embed;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::models::audio::{AudioFileMeta, TranscriptionRequest, TranscriptionResult};
use crate::services::file_index::FileIndexService;
use crate::services::transcriber::TranscriberService;

use super::dashboard::DashboardState;

/// 编译时嵌入前端 SPA 构建产物（`pnpm build` 输出的 `dist/`）
#[derive(Embed)]
#[folder = "../dist/"]
#[include = "*.html"]
#[include = "*.js"]
#[include = "*.css"]
#[include = "*.svg"]
#[include = "*.png"]
#[include = "*.ico"]
#[include = "*.woff"]
#[include = "*.woff2"]
#[include = "*.json"]
struct SpaAssets;

/// 包装 SSE 流并设置 `Content-Type: text/event-stream; charset=utf-8`
fn sse_utf8<S>(stream: S) -> Response
where
    S: tokio_stream::Stream<Item = Result<Event, Infallible>> + Send + 'static,
{
    let mut resp = Sse::new(stream).into_response();
    resp.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "text/event-stream; charset=utf-8".parse().unwrap(),
    );
    resp
}

/// 创建后台 API 路由器（推理 + 文件管理 + Dashboard）
pub fn create_router(dashboard: Arc<DashboardState>) -> Router {
    Router::new()
        .route("/", get(dashboard_page))
        .route("/dashboard", get(dashboard_page))
        .route("/api/health", get(health))
        .route("/api/models", get(models))
        .route("/api/transcribe", post(transcribe))
        .route("/api/dashboard", get(dashboard_api))
        .route("/api/dashboard/events", get(dashboard_events))
        // REST API — 文件管理
        .route("/api/files", get(list_files))
        .route("/api/files/{id}/transcriptions", get(get_transcriptions))
        .route("/api/files/{id}/transcribe", post(transcribe_by_id))
        .route("/api/files/{id}/star", post(toggle_star))
        .route("/api/files/{id}/tags", put(set_tags))
        .route("/api/tags", get(list_tags))
        .route("/api/audio/{id}", get(stream_audio))
        .route("/api/cuda", get(cuda_info))
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(dashboard)
}

/// 检查 SPA 资源是否已嵌入（编译时 `dist/` 是否存在）
pub fn has_embedded_spa() -> bool {
    SpaAssets::get("index.html").is_some()
}

/// 创建 Web 前端路由器（从编译时嵌入的资源提供 SPA）
pub fn create_web_router(api_port: u16) -> Router {
    let raw_index = SpaAssets::get("index.html")
        .map(|f| String::from_utf8_lossy(&f.data).into_owned())
        .unwrap_or_else(|| "<html><body>SPA 未嵌入，请先 pnpm build 再编译 Rust</body></html>".into());

    let config_script = format!(
        r#"<script>window.__WHISPERDESK_API_PORT__={};</script>"#,
        api_port
    );
    let index_html = raw_index.replace("</head>", &format!("{config_script}</head>"));

    Router::new()
        .route("/{*path}", get(serve_embedded))
        .route("/", get({
            let html = index_html.clone();
            move || {
                let h = html.clone();
                async move { Html(h) }
            }
        }))
        .layer(CorsLayer::permissive())
        .with_state(index_html)
}

/// 从嵌入资源提供静态文件，未命中时回退到 index.html（SPA 路由）
async fn serve_embedded(
    Path(path): Path<String>,
    State(index_html): State<String>,
) -> Response {
    if let Some(file) = SpaAssets::get(&path) {
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();
        axum::http::Response::builder()
            .header("content-type", mime)
            .header("cache-control", "public, max-age=31536000, immutable")
            .body(axum::body::Body::from(file.data.to_vec()))
            .unwrap()
            .into_response()
    } else {
        Html(index_html).into_response()
    }
}

// ─── 现有路由 ────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    let cuda_info = crate::services::cuda::get_cuda_info();
    Json(serde_json::json!({
        "status": "ok",
        "gpu": cuda_info.available,
        "cudaMessage": cuda_info.message,
    }))
}

async fn models() -> Result<Json<Vec<crate::services::transcriber::ModelInfo>>, (axum::http::StatusCode, String)> {
    let svc = TranscriberService::portable()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    svc.list_models()
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn dashboard_api(
    State(dash): State<Arc<DashboardState>>,
) -> Json<super::dashboard::DashboardSnapshot> {
    Json(dash.snapshot())
}

async fn dashboard_events(
    State(dash): State<Arc<DashboardState>>,
) -> Response {
    let mut rx = dash.subscribe();
    let (tx, stream_rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    let snapshot = dash.snapshot();
    let init_data = serde_json::to_string(&snapshot).unwrap_or_default();
    let tx_init = tx.clone();
    tokio::spawn(async move {
        let _ = tx_init
            .send(Ok(Event::default().event("init").data(init_data)))
            .await;
    });

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    if tx.send(Ok(Event::default().event("update").data(data))).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    sse_utf8(ReceiverStream::new(stream_rx))
}

async fn dashboard_page() -> Html<&'static str> {
    Html(include_str!("dashboard.html"))
}

// ─── Multipart 上传转录（原有） ─────────────────────────────────

async fn transcribe(
    State(dash): State<Arc<DashboardState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut multipart: Multipart,
) -> Result<Response, (axum::http::StatusCode, String)> {
    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut language: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (axum::http::StatusCode::BAD_REQUEST, format!("解析 multipart 失败: {e}"))
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                audio_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, format!("读取音频数据失败: {e}")))?
                        .to_vec(),
                );
            }
            "language" => {
                let v = field.text().await.unwrap_or_default();
                if !v.is_empty() { language = Some(v); }
            }
            _ => {}
        }
    }

    let audio_bytes = audio_bytes
        .ok_or_else(|| (axum::http::StatusCode::BAD_REQUEST, "缺少音频文件 (field name: file)".to_string()))?;

    let cfg = dash.get_config();

    let task_id = uuid::Uuid::new_v4().to_string();
    let client_ip = addr.ip().to_string();
    let file_size = audio_bytes.len() as u64;

    dash.register_task(&task_id, &client_ip, file_size, &cfg.model_name);

    let tmp_dir = std::env::temp_dir().join("whisperdesk_server");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("创建临时目录失败: {e}")))?;

    let tmp_path = tmp_dir.join(format!("{}.audio", uuid::Uuid::new_v4()));
    std::fs::write(&tmp_path, &audio_bytes)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("写入临时文件失败: {e}")))?;

    let request = TranscriptionRequest {
        audio_file_id: task_id.clone(),
        audio_path: tmp_path.to_string_lossy().to_string(),
        model_name: cfg.model_name,
        language,
        threads: Some(cfg.threads),
        use_gpu: Some(cfg.use_gpu),
        remote_url: None,
        best_of: Some(cfg.best_of),
        suppress_blank: Some(cfg.suppress_blank),
        suppress_nst: Some(cfg.suppress_nst),
        no_context: Some(cfg.no_context),
        entropy_thold: Some(cfg.entropy_thold),
        logprob_thold: Some(cfg.logprob_thold),
        no_speech_thold: Some(cfg.no_speech_thold),
        temperature: Some(cfg.temperature),
        temperature_inc: Some(cfg.temperature_inc),
        max_initial_ts: Some(cfg.max_initial_ts),
        max_repeat_filter: Some(cfg.max_repeat_filter),
        start_seconds: None,
        end_seconds: None,
        enable_vad: Some(cfg.enable_vad),
        vad_config: None,
        initial_prompt: if cfg.initial_prompt.is_empty() { None } else { Some(cfg.initial_prompt) },
        enable_punctuation: Some(true),
        backend: None,
        download_proxy: None,
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    let dash_spawn = dash.clone();
    let task_id_spawn = task_id.clone();
    tokio::spawn(async move {
        let transcriber = match TranscriberService::portable() {
            Ok(t) => t,
            Err(e) => {
                dash_spawn.fail_task(&task_id_spawn, &e.to_string());
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
                let _ = std::fs::remove_file(&tmp_path);
                return;
            }
        };

        dash_spawn.set_transcribing(&task_id_spawn);

        let ptx = tx.clone();
        let dash_p = dash_spawn.clone();
        let tid_p = task_id_spawn.clone();
        let on_progress = move |progress: f32, msg: &str| {
            dash_p.update_progress(&tid_p, progress, msg);
            let d = serde_json::json!({ "progress": progress, "message": msg });
            let _ = ptx.try_send(Ok(Event::default().event("progress").data(d.to_string())));
        };

        let mtx = tx.clone();
        let on_model_dl = move |name: &str, progress: f32| {
            let d = serde_json::json!({ "modelName": name, "progress": progress });
            let _ = mtx.try_send(Ok(Event::default().event("model_progress").data(d.to_string())));
        };

        let ltx = tx.clone();
        let on_log = move |msg: &str| {
            let d = serde_json::json!({ "message": msg });
            let _ = ltx.try_send(Ok(Event::default().event("log").data(d.to_string())));
        };

        let abort_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        match transcriber.transcribe(on_progress, on_model_dl, on_log, abort_flag, &request).await {
            Ok(result) => {
                let summary = Some(truncate_chars(&result.text, 200));
                dash_spawn.complete_task(&task_id_spawn, summary);
                let json = serde_json::to_string(&result).unwrap_or_default();
                let _ = tx.send(Ok(Event::default().event("complete").data(json))).await;
            }
            Err(e) => {
                dash_spawn.fail_task(&task_id_spawn, &e.to_string());
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
            }
        }

        let _ = std::fs::remove_file(&tmp_path);
    });

    Ok(sse_utf8(ReceiverStream::new(rx)))
}

// ─── 新增 REST API — 文件管理 ───────────────────────────────────

fn open_index() -> Result<FileIndexService, (axum::http::StatusCode, String)> {
    let idx = FileIndexService::portable()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    idx.init()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(idx)
}

async fn list_files() -> Result<Json<Vec<AudioFileMeta>>, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    idx.list_audio()
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_transcriptions(
    Path(id): Path<String>,
) -> Result<Json<Vec<TranscriptionResult>>, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    idx.get_transcription_results(&id)
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn list_tags() -> Result<Json<Vec<String>>, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    idx.list_all_tags()
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn toggle_star(
    Path(id): Path<String>,
) -> Result<Json<bool>, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    idx.toggle_star(&id)
        .map(Json)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(serde::Deserialize)]
struct SetTagsBody {
    tags: Vec<String>,
}

async fn set_tags(
    Path(id): Path<String>,
    Json(body): Json<SetTagsBody>,
) -> Result<(), (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    idx.set_tags(&id, &body.tags)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn cuda_info() -> Json<serde_json::Value> {
    let info = crate::services::cuda::get_cuda_info();
    Json(serde_json::json!({
        "available": info.available,
        "message": info.message,
        "sherpaGpu": info.sherpa_gpu,
        "sherpaAvailable": info.sherpa_available,
        "sherpaMessage": info.sherpa_message,
    }))
}

// ─── 音频流播放 ──────────────────────────────────────────────────

async fn stream_audio(
    Path(id): Path<String>,
) -> Result<Response, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    let file = idx.get_audio_by_id(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "音频文件不存在".to_string()))?;

    let path = std::path::Path::new(&file.path);
    if !path.exists() {
        return Err((axum::http::StatusCode::NOT_FOUND, "音频文件磁盘路径不存在".to_string()));
    }

    let bytes = tokio::fs::read(path).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("读取文件失败: {e}")))?;

    let content_type = match file.format.as_str() {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        _ => "application/octet-stream",
    };

    Ok(Response::builder()
        .header("Content-Type", content_type)
        .header("Content-Length", bytes.len().to_string())
        .header("Accept-Ranges", "bytes")
        .body(axum::body::Body::from(bytes))
        .unwrap())
}

// ─── 按文件 ID 发起转录（SSE 流式返回） ─────────────────────────

/// 浏览器端通过文件 ID 发起转录的请求体
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeByIdBody {
    model_name: Option<String>,
    language: Option<String>,
    backend: Option<crate::models::audio::TranscriptionBackend>,
    enable_vad: Option<bool>,
    enable_punctuation: Option<bool>,
    initial_prompt: Option<String>,
    download_proxy: Option<String>,
}

async fn transcribe_by_id(
    State(dash): State<Arc<DashboardState>>,
    Path(id): Path<String>,
    Json(body): Json<TranscribeByIdBody>,
) -> Result<Response, (axum::http::StatusCode, String)> {
    let idx = open_index()?;
    let file = idx.get_audio_by_id(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "音频文件不存在".to_string()))?;

    let path = std::path::Path::new(&file.path);
    if !path.exists() {
        return Err((axum::http::StatusCode::NOT_FOUND, "音频文件磁盘路径不存在".to_string()));
    }

    let cfg = dash.get_config();

    let request = TranscriptionRequest {
        audio_file_id: id.clone(),
        audio_path: file.path.clone(),
        model_name: body.model_name.unwrap_or(cfg.model_name),
        language: body.language,
        threads: Some(cfg.threads),
        use_gpu: Some(cfg.use_gpu),
        remote_url: None,
        best_of: Some(cfg.best_of),
        suppress_blank: Some(cfg.suppress_blank),
        suppress_nst: Some(cfg.suppress_nst),
        no_context: Some(cfg.no_context),
        entropy_thold: Some(cfg.entropy_thold),
        logprob_thold: Some(cfg.logprob_thold),
        no_speech_thold: Some(cfg.no_speech_thold),
        temperature: Some(cfg.temperature),
        temperature_inc: Some(cfg.temperature_inc),
        max_initial_ts: Some(cfg.max_initial_ts),
        max_repeat_filter: Some(cfg.max_repeat_filter),
        start_seconds: None,
        end_seconds: None,
        enable_vad: body.enable_vad.or(Some(cfg.enable_vad)),
        vad_config: None,
        initial_prompt: body.initial_prompt
            .or(if cfg.initial_prompt.is_empty() { None } else { Some(cfg.initial_prompt) }),
        enable_punctuation: body.enable_punctuation.or(Some(true)),
        backend: body.backend,
        download_proxy: body.download_proxy,
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    let file_id = id.clone();
    tokio::spawn(async move {
        let transcriber = match TranscriberService::portable() {
            Ok(t) => t,
            Err(e) => {
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
                return;
            }
        };

        let ptx = tx.clone();
        let fid = file_id.clone();
        let on_progress = move |progress: f32, msg: &str| {
            let d = serde_json::json!({
                "audioFileId": fid,
                "progress": progress,
                "currentSegment": msg,
                "phase": "local"
            });
            let _ = ptx.try_send(Ok(Event::default().event("progress").data(d.to_string())));
        };

        let mtx = tx.clone();
        let on_model_dl = move |name: &str, progress: f32| {
            let d = serde_json::json!({ "modelName": name, "progress": progress });
            let _ = mtx.try_send(Ok(Event::default().event("model_progress").data(d.to_string())));
        };

        let ltx = tx.clone();
        let on_log = move |msg: &str| {
            let d = serde_json::json!({ "message": msg });
            let _ = ltx.try_send(Ok(Event::default().event("log").data(d.to_string())));
        };

        let abort_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        match transcriber.transcribe(on_progress, on_model_dl, on_log, abort_flag, &request).await {
            Ok(result) => {
                if let Ok(idx) = FileIndexService::portable() {
                    let _ = idx.init();
                    let _ = idx.save_transcription_result(&result);
                }
                let json = serde_json::to_string(&result).unwrap_or_default();
                let _ = tx.send(Ok(Event::default().event("complete").data(json))).await;
            }
            Err(e) => {
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
            }
        }
    });

    Ok(sse_utf8(ReceiverStream::new(rx)))
}

// ─── 工具函数 ────────────────────────────────────────────────────

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
