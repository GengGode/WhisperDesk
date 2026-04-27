use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, State},
    response::{
        sse::{Event, Sse},
        Html,
    },
    routing::{get, post},
    Json, Router,
};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::models::audio::TranscriptionRequest;
use crate::services::transcriber::TranscriberService;

use super::dashboard::DashboardState;

pub fn create_router(dashboard: Arc<DashboardState>) -> Router {
    Router::new()
        .route("/", get(dashboard_page))
        .route("/api/health", get(health))
        .route("/api/models", get(models))
        .route("/api/transcribe", post(transcribe))
        .route("/api/dashboard", get(dashboard_api))
        .route("/api/dashboard/events", get(dashboard_events))
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(dashboard)
}

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

// ─── Dashboard API ────────────────────────────────────────────────

async fn dashboard_api(
    State(dash): State<Arc<DashboardState>>,
) -> Json<super::dashboard::DashboardSnapshot> {
    Json(dash.snapshot())
}

async fn dashboard_events(
    State(dash): State<Arc<DashboardState>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
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

    Sse::new(ReceiverStream::new(stream_rx))
}

async fn dashboard_page() -> Html<&'static str> {
    Html(include_str!("dashboard.html"))
}

// ─── Transcribe ───────────────────────────────────────────────────

/// POST /api/transcribe — multipart 接收音频 + 参数，SSE 流式返回进度和结果
async fn transcribe(
    State(dash): State<Arc<DashboardState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut multipart: Multipart,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (axum::http::StatusCode, String)> {
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
        best_of: None,
        suppress_blank: None,
        suppress_nst: None,
        no_context: None,
        entropy_thold: None,
        logprob_thold: None,
        no_speech_thold: None,
        temperature: None,
        temperature_inc: None,
        max_initial_ts: None,
        max_repeat_filter: None,
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

    Ok(Sse::new(ReceiverStream::new(rx)))
}

/// 按字符数安全截断 UTF-8 字符串，避免切到多字节字符中间
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
