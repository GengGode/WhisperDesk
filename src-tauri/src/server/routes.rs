use std::convert::Infallible;

use axum::{
    extract::Multipart,
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::models::audio::TranscriptionRequest;
use crate::services::transcriber::TranscriberService;

pub fn create_router() -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/models", get(models))
        .route("/api/transcribe", post(transcribe))
        .layer(CorsLayer::permissive())
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

/// POST /api/transcribe — multipart 接收音频 + 参数，SSE 流式返回进度和结果
async fn transcribe(
    mut multipart: Multipart,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (axum::http::StatusCode, String)> {
    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut model_name = "base".to_string();
    let mut language: Option<String> = None;
    let mut threads: Option<u8> = None;
    let mut use_gpu: Option<bool> = None;

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
            "model_name" => model_name = field.text().await.unwrap_or_default(),
            "language" => {
                let v = field.text().await.unwrap_or_default();
                if !v.is_empty() { language = Some(v); }
            }
            "threads" => threads = field.text().await.ok().and_then(|t| t.parse().ok()),
            "use_gpu" => use_gpu = field.text().await.ok().and_then(|t| t.parse().ok()),
            _ => {}
        }
    }

    let audio_bytes = audio_bytes
        .ok_or_else(|| (axum::http::StatusCode::BAD_REQUEST, "缺少音频文件 (field name: file)".to_string()))?;

    let tmp_dir = std::env::temp_dir().join("whisperdesk_server");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("创建临时目录失败: {e}")))?;

    let tmp_path = tmp_dir.join(format!("{}.audio", uuid::Uuid::new_v4()));
    std::fs::write(&tmp_path, &audio_bytes)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("写入临时文件失败: {e}")))?;

    let request = TranscriptionRequest {
        audio_file_id: uuid::Uuid::new_v4().to_string(),
        audio_path: tmp_path.to_string_lossy().to_string(),
        model_name,
        language,
        threads,
        use_gpu,
        remote_url: None,
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    tokio::spawn(async move {
        let transcriber = match TranscriberService::portable() {
            Ok(t) => t,
            Err(e) => {
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
                let _ = std::fs::remove_file(&tmp_path);
                return;
            }
        };

        let ptx = tx.clone();
        let on_progress = move |progress: f32, msg: &str| {
            let d = serde_json::json!({ "progress": progress, "message": msg });
            let _ = ptx.try_send(Ok(Event::default().event("progress").data(d.to_string())));
        };

        let mtx = tx.clone();
        let on_model_dl = move |name: &str, progress: f32| {
            let d = serde_json::json!({ "modelName": name, "progress": progress });
            let _ = mtx.try_send(Ok(Event::default().event("model_progress").data(d.to_string())));
        };

        match transcriber.transcribe(on_progress, on_model_dl, &request).await {
            Ok(result) => {
                let json = serde_json::to_string(&result).unwrap_or_default();
                let _ = tx.send(Ok(Event::default().event("complete").data(json))).await;
            }
            Err(e) => {
                let _ = tx.send(Ok(Event::default().event("error").data(e.to_string()))).await;
            }
        }

        let _ = std::fs::remove_file(&tmp_path);
    });

    Ok(Sse::new(ReceiverStream::new(rx)))
}
