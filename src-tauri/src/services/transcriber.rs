use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use reqwest::Client;
use tokio::io::AsyncWriteExt;
#[cfg(feature = "whisper-rs-backend")]
use whisper_rs::{
    install_logging_hooks, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

use serde::Serialize;

use crate::models::audio::{TranscriptionRequest, TranscriptionResult};
use crate::models::error::AppError;
use crate::services::paths;
#[cfg(feature = "whisper-rs-backend")]
use crate::services::audio::{decode_to_16k_mono, decode_range_to_16k_mono};
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
    pub async fn ensure_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        let path = self.model_path(model_name);
        if path.exists() {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size >= Self::MIN_MODEL_BYTES {
                return Ok(path);
            }
            on_log(&format!(
                "[模型] 已有文件 {} 过小 ({size} B)，删除后重新下载",
                path.display()
            ));
            let _ = std::fs::remove_file(&path);
        }

        self.download_model(on_model_progress, on_log, model_name, &path)
            .await?;
        Ok(path)
    }

    async fn download_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
        target: &Path,
    ) -> Result<(), AppError>
    where
        M: Fn(&str, f32) + Send + 'static,
        L: Fn(&str) + Send + 'static,
    {
        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin"
        );
        on_log(&format!("[模型] 开始下载: {url}"));

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
        on_log(&format!("[模型] 文件大小: {total} bytes"));
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

        on_log(&format!(
            "[模型] 下载完成: {} ({final_size} bytes)",
            target.display()
        ));
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
    /// - `on_log(message)` 日志回调，转发到前端界面
    /// - `abort_flag` 为 true 时中止推理
    pub async fn transcribe<P, M, L>(
        &self,
        on_progress: P,
        on_model_progress: M,
        on_log: L,
        abort_flag: Arc<AtomicBool>,
        request: &TranscriptionRequest,
    ) -> Result<TranscriptionResult, AppError>
    where
        P: Fn(f32, &str) + Clone + Send + 'static,
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        #[cfg(not(feature = "whisper-rs-backend"))]
        {
            on_progress(1.0, "未启用 whisper-rs-backend 功能");
            let _ = (on_model_progress, on_log, abort_flag);
            return Err(AppError::Transcription(
                "当前构建未启用 whisper-rs-backend。若需真实推理，请安装 LLVM/Clang 并使用 `cargo check --features whisper-rs-backend` 构建。".to_string(),
            ));
        }

        #[cfg(feature = "whisper-rs-backend")]
        {
        install_logging_hooks();

        let model_path = self
            .ensure_model(on_model_progress, on_log.clone(), &request.model_name)
            .await?;
        let (decoded, time_offset) = match (request.start_seconds, request.end_seconds) {
            (Some(start), Some(end)) => {
                on_log(&format!("[推理] 区间转录模式: {start:.2}s ~ {end:.2}s"));
                let d = decode_range_to_16k_mono(Path::new(&request.audio_path), start, end)?;
                (d, start)
            }
            _ => (decode_to_16k_mono(Path::new(&request.audio_path))?, 0.0),
        };

        on_log("[推理] 音频解码完成");
        on_progress(0.05, "音频解码完成");

        let requested_gpu = request.use_gpu.unwrap_or(true);
        let cuda_ok = super::cuda::is_cuda_available();
        let use_gpu = requested_gpu && cuda_ok;
        if requested_gpu && !cuda_ok {
            on_log("[推理] 用户请求 GPU 但 CUDA 不可用，自动回退 CPU");
            on_progress(0.03, "CUDA 不可用，使用 CPU 推理");
        }
        on_log(&format!(
            "[推理] use_gpu = {use_gpu} (requested={requested_gpu}, cuda_available={cuda_ok})"
        ));

        let model_path_str = model_path
            .to_str()
            .ok_or_else(|| AppError::Transcription("模型路径非法".to_string()))?
            .to_string();
        let samples = decoded.samples_16k_mono;
        let n_threads = request.threads.unwrap_or(4) as i32;
        let language = request.language.clone();
        let audio_file_id = request.audio_file_id.clone();
        let model_name = request.model_name.clone();
        let req_language = request.language.clone();
        let duration = decoded.duration_seconds;

        let best_of = request.best_of.unwrap_or(5).clamp(1, 8);
        let suppress_blank = request.suppress_blank.unwrap_or(true);
        let suppress_nst = request.suppress_nst.unwrap_or(true);
        let no_context = request.no_context.unwrap_or(true);
        let entropy_thold = request.entropy_thold.unwrap_or(2.4).clamp(0.0, 10.0);
        let logprob_thold = request.logprob_thold.unwrap_or(-1.0).clamp(-5.0, 0.0);
        let no_speech_thold = request.no_speech_thold.unwrap_or(0.6).clamp(0.0, 1.0);
        let temperature = request.temperature.unwrap_or(0.0).clamp(0.0, 1.0);
        let temperature_inc = request.temperature_inc.unwrap_or(0.2).clamp(0.0, 1.0);
        let max_initial_ts = request.max_initial_ts.unwrap_or(1.0).clamp(0.0, 1.0);
        let max_repeat_filter = request.max_repeat_filter.unwrap_or(3);
        let time_offset = time_offset;

        on_log(&format!(
            "[推理] 参数: best_of={best_of}, threads={n_threads}, gpu={use_gpu}, \
             suppress_blank={suppress_blank}, suppress_nst={suppress_nst}, no_context={no_context}, \
             entropy={entropy_thold}, logprob={logprob_thold}, no_speech={no_speech_thold}, \
             temp={temperature}, temp_inc={temperature_inc}, max_init_ts={max_initial_ts}, \
             samples={}, lang={:?}",
            samples.len(), language
        ));

        // 将整个 whisper 推理放到独立 OS 线程，避免阻塞 tokio async runtime，
        // 使 abort_transcription 等命令能及时被调度执行。
        let (tx, rx) = tokio::sync::oneshot::channel();
        let progress_cb = on_progress.clone();
        let log_cb = on_log.clone();

        std::thread::spawn(move || {
            let mut ctx_params = WhisperContextParameters::default();
            ctx_params.use_gpu = use_gpu;

            log_cb("[推理] 加载模型...");
            let ctx = match WhisperContext::new_with_params(&model_path_str, ctx_params) {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx.send(Err(AppError::Transcription(format!("加载模型失败: {e}"))));
                    return;
                }
            };
            log_cb("[推理] 模型加载完成");

            let mut state = match ctx.create_state() {
                Ok(s) => s,
                Err(e) => {
                    let _ = tx.send(Err(AppError::Transcription(format!("创建推理状态失败: {e}"))));
                    return;
                }
            };

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of });
            params.set_n_threads(n_threads);
            if let Some(lang) = language.as_deref() {
                if lang != "auto" {
                    params.set_language(Some(lang));
                }
            }
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_special(false);
            params.set_print_timestamps(false);

            params.set_suppress_blank(suppress_blank);
            params.set_suppress_nst(suppress_nst);
            params.set_no_context(no_context);
            params.set_entropy_thold(entropy_thold);
            params.set_logprob_thold(logprob_thold);
            params.set_no_speech_thold(no_speech_thold);
            params.set_temperature(temperature);
            params.set_temperature_inc(temperature_inc);
            params.set_max_initial_ts(max_initial_ts);

            let pcb = progress_cb.clone();
            let lcb = log_cb.clone();
            params.set_progress_callback_safe(move |pct: i32| {
                let mapped = 0.05 + (pct as f32 / 100.0) * 0.90;
                pcb(mapped, &format!("推理中 {pct}%"));
                lcb(&format!("[推理] 进度 {pct}%"));
            });

            // 直接使用 unsafe C 回调，绕过 whisper-rs safe wrapper 的类型转发 bug
            unsafe extern "C" fn abort_trampoline(
                user_data: *mut std::ffi::c_void,
            ) -> bool {
                let flag = &*(user_data as *const AtomicBool);
                flag.load(Ordering::Relaxed)
            }
            unsafe {
                params.set_abort_callback(Some(abort_trampoline));
                params.set_abort_callback_user_data(
                    Arc::as_ptr(&abort_flag) as *mut std::ffi::c_void,
                );
            }

            log_cb("[推理] 开始 whisper 推理...");
            let full_result = state.full(params, &samples);
            let aborted = abort_flag.load(Ordering::Relaxed);

            if let Err(e) = full_result {
                if aborted {
                    log_cb("[推理] 用户中止了转录");
                    let _ = tx.send(Err(AppError::Transcription("用户中止了转录".to_string())));
                } else {
                    let _ = tx.send(Err(AppError::Transcription(format!("Whisper 推理失败: {e}"))));
                }
                return;
            }

            let n_segs = state.full_n_segments();
            log_cb(&format!("[推理] 推理完成，共 {n_segs} 个分段"));

            let mut segments = Vec::with_capacity(n_segs as usize);
            for i in 0..n_segs {
                let Some(seg) = state.get_segment(i) else {
                    let _ = tx.send(Err(AppError::Transcription(format!("读取分段 {i} 失败"))));
                    return;
                };
                let text = match seg.to_str_lossy() {
                    Ok(t) => t.trim().to_string(),
                    Err(e) => {
                        let _ = tx.send(Err(AppError::Transcription(format!("读取分段文本失败: {e}"))));
                        return;
                    }
                };
                if text.is_empty() {
                    continue;
                }
                segments.push(TranscriptionSegment {
                    start: seg.start_timestamp() as f64 / 100.0 + time_offset,
                    end: seg.end_timestamp() as f64 / 100.0 + time_offset,
                    text,
                });
            }

            // 后处理：检测并过滤连续重复的幻觉分段
            if max_repeat_filter > 0 {
                let pre_filter = segments.len();
                let mut filtered = Vec::with_capacity(pre_filter);
                let mut repeat_count = 0u32;
                for seg in segments {
                    if let Some(prev) = filtered.last() {
                        let prev: &TranscriptionSegment = prev;
                        if seg.text == prev.text {
                            repeat_count += 1;
                            if repeat_count >= max_repeat_filter {
                                continue;
                            }
                        } else {
                            repeat_count = 0;
                        }
                    }
                    filtered.push(seg);
                }
                let removed = pre_filter - filtered.len();
                if removed > 0 {
                    log_cb(&format!(
                        "[推理] 后处理：检测到 {removed} 个连续重复幻觉分段已过滤（共 {pre_filter} → {}）",
                        filtered.len()
                    ));
                }
                segments = filtered;
            }

            progress_cb(1.0, "转录完成");

            let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n");
            let params_json = serde_json::to_string(&serde_json::json!({
                "bestOf": best_of,
                "suppressBlank": suppress_blank,
                "suppressNst": suppress_nst,
                "noContext": no_context,
                "entropyThold": entropy_thold,
                "logprobThold": logprob_thold,
                "noSpeechThold": no_speech_thold,
                "temperature": temperature,
                "temperatureInc": temperature_inc,
                "maxInitialTs": max_initial_ts,
                "maxRepeatFilter": max_repeat_filter,
            })).ok();
            let _ = tx.send(Ok(TranscriptionResult {
                id: uuid::Uuid::new_v4().to_string(),
                audio_file_id,
                model_name,
                text,
                segments,
                language: req_language.unwrap_or_else(|| "auto".to_string()),
                duration,
                created_at: Utc::now().to_rfc3339(),
                params_json,
            }));
        });

        rx.await.map_err(|_| AppError::Transcription("推理线程异常退出".to_string()))?
        }
    }
}
