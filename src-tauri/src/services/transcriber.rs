use std::path::{Path, PathBuf};

use reqwest::Client;
use tokio::io::AsyncWriteExt;
#[cfg(feature = "whisper-rs-backend")]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use serde::Serialize;

use crate::models::audio::{TranscriptionRequest, TranscriptionResult};
use crate::models::error::AppError;
use crate::services::paths;
#[cfg(feature = "whisper-rs-backend")]
use crate::services::audio::decode_to_16k_mono;
#[cfg(feature = "whisper-rs-backend")]
use chrono::Utc;
#[cfg(feature = "whisper-rs-backend")]
use crate::models::audio::TranscriptionSegment;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub downloaded: bool,
    pub size: u64,
    pub path: String,
}

pub struct TranscriberService {
    model_dir: PathBuf,
}

impl TranscriberService {
    pub fn portable() -> Result<Self, AppError> {
        Ok(Self {
            model_dir: paths::models_dir()?,
        })
    }

    pub fn model_path(&self, model_name: &str) -> PathBuf {
        self.model_dir.join(format!("ggml-{model_name}.bin"))
    }

    /// 最小合法模型文件大小（10 MB），低于此值视为下载失败
    const MIN_MODEL_BYTES: u64 = 10 * 1024 * 1024;

    /// 确保模型文件已下载，不足则自动下载。
    /// `on_model_progress(model_name, progress_0_to_1)` 在下载过程中回调。
    pub async fn ensure_model<M>(
        &self,
        on_model_progress: M,
        model_name: &str,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
    {
        let path = self.model_path(model_name);
        if path.exists() {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size >= Self::MIN_MODEL_BYTES {
                return Ok(path);
            }
            println!("[模型] 已有文件 {} 过小 ({size} B)，删除后重新下载", path.display());
            let _ = std::fs::remove_file(&path);
        }

        self.download_model(on_model_progress, model_name, &path).await?;
        Ok(path)
    }

    async fn download_model<M>(
        &self,
        on_model_progress: M,
        model_name: &str,
        target: &Path,
    ) -> Result<(), AppError>
    where
        M: Fn(&str, f32) + Send + 'static,
    {
        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin"
        );
        println!("[模型] 开始下载: {url}");

        let client = Client::builder()
            .user_agent("WhisperDesk/0.1")
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| AppError::Transcription(format!("创建 HTTP 客户端失败: {e}")))?;

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Transcription(format!("请求模型下载失败: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            return Err(AppError::Transcription(format!(
                "模型下载失败，HTTP 状态码: {status}。请尝试手动下载模型。"
            )));
        }

        let total = resp.content_length().unwrap_or(0);
        println!("[模型] 文件大小: {total} bytes");
        let mut downloaded: u64 = 0;
        let mut stream = resp;

        let mut file = tokio::fs::File::create(target)
            .await
            .map_err(|e| AppError::FileSystem(format!("创建模型文件失败: {e}")))?;

        while let Some(chunk) = stream
            .chunk()
            .await
            .map_err(|e| {
                let _ = std::fs::remove_file(target);
                AppError::Transcription(format!("下载模型分片失败: {e}"))
            })?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| {
                    let _ = std::fs::remove_file(target);
                    AppError::FileSystem(format!("写入模型文件失败: {e}"))
                })?;
            downloaded += chunk.len() as u64;

            if total > 0 {
                let progress = downloaded as f32 / total as f32;
                on_model_progress(model_name, progress);
            }
        }

        drop(file);

        let final_size = std::fs::metadata(target).map(|m| m.len()).unwrap_or(0);
        if final_size < Self::MIN_MODEL_BYTES {
            let _ = std::fs::remove_file(target);
            return Err(AppError::Transcription(format!(
                "下载的文件过小 ({final_size} B)，可能不是有效模型。请尝试手动下载。"
            )));
        }

        println!("[模型] 下载完成: {} ({final_size} bytes)", target.display());
        Ok(())
    }

    pub fn list_models(&self) -> Result<Vec<ModelInfo>, AppError> {
        let mut models = Vec::new();
        let known = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"];

        for name in &known {
            let path = self.model_path(name);
            let (downloaded, size) = if path.exists() {
                let sz = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                (sz >= Self::MIN_MODEL_BYTES, sz)
            } else {
                (false, 0)
            };
            models.push(ModelInfo {
                name: name.to_string(),
                downloaded,
                size,
                path: path.to_string_lossy().to_string(),
            });
        }

        Ok(models)
    }

    /// 执行 whisper 推理。
    /// - `on_progress(progress_0_to_1, message)` 推理进度回调
    /// - `on_model_progress(model_name, progress_0_to_1)` 模型下载进度回调
    pub async fn transcribe<P, M>(
        &self,
        on_progress: P,
        on_model_progress: M,
        request: &TranscriptionRequest,
    ) -> Result<TranscriptionResult, AppError>
    where
        P: Fn(f32, &str) + Clone + Send + 'static,
        M: Fn(&str, f32) + Clone + Send + 'static,
    {
        #[cfg(not(feature = "whisper-rs-backend"))]
        {
            on_progress(1.0, "未启用 whisper-rs-backend 功能");
            let _ = on_model_progress;
            return Err(AppError::Transcription(
                "当前构建未启用 whisper-rs-backend。若需真实推理，请安装 LLVM/Clang 并使用 `cargo check --features whisper-rs-backend` 构建。".to_string(),
            ));
        }

        #[cfg(feature = "whisper-rs-backend")]
        {
        let model_path = self.ensure_model(on_model_progress, &request.model_name).await?;
        let decoded = decode_to_16k_mono(Path::new(&request.audio_path))?;

        on_progress(0.05, "音频解码完成");

        let requested_gpu = request.use_gpu.unwrap_or(true);
        let cuda_ok = super::cuda::is_cuda_available();
        let use_gpu = requested_gpu && cuda_ok;
        if requested_gpu && !cuda_ok {
            println!("[推理] 用户请求 GPU 但 CUDA 不可用，自动回退 CPU");
            on_progress(0.03, "CUDA 不可用，使用 CPU 推理");
        }
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu = use_gpu;
        println!("[推理] use_gpu = {use_gpu} (requested={requested_gpu}, cuda_available={cuda_ok})");

        let ctx = WhisperContext::new_with_params(
            model_path
                .to_str()
                .ok_or_else(|| AppError::Transcription("模型路径非法".to_string()))?,
            ctx_params,
        )
        .map_err(|e| AppError::Transcription(format!("加载模型失败: {e}")))?;

        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Transcription(format!("创建推理状态失败: {e}")))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(request.threads.unwrap_or(4) as i32);
        if let Some(language) = request.language.as_deref() {
            if language != "auto" {
                params.set_language(Some(language));
            }
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        // 通过回调在推理过程中实时上报进度（5% ~ 95%）
        let cb = on_progress.clone();
        params.set_progress_callback_safe(move |pct: i32| {
            let mapped = 0.05 + (pct as f32 / 100.0) * 0.90;
            cb(mapped, &format!("推理中 {pct}%"));
        });

        state
            .full(params, &decoded.samples_16k_mono)
            .map_err(|e| AppError::Transcription(format!("Whisper 推理失败: {e}")))?;

        let n_segments = state.full_n_segments();

        let mut segments = Vec::with_capacity(n_segments as usize);
        for i in 0..n_segments {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| AppError::Transcription(format!("读取分段 {i} 失败")))?;

            let text = seg
                .to_str_lossy()
                .map_err(|e| AppError::Transcription(format!("读取分段文本失败: {e}")))?
                .trim()
                .to_string();
            let t0 = seg.start_timestamp();
            let t1 = seg.end_timestamp();

            segments.push(TranscriptionSegment {
                start: t0 as f64 / 100.0,
                end: t1 as f64 / 100.0,
                text,
            });
        }

        on_progress(1.0, "转录完成");

        let text = segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        Ok(TranscriptionResult {
            id: uuid::Uuid::new_v4().to_string(),
            audio_file_id: request.audio_file_id.clone(),
            model_name: request.model_name.clone(),
            text,
            segments,
            language: request
                .language
                .clone()
                .unwrap_or_else(|| "auto".to_string()),
            duration: decoded.duration_seconds,
            created_at: Utc::now().to_rfc3339(),
        })
        }
    }
}
