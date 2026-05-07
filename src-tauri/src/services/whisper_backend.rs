//! Whisper.cpp 推理后端（通过 whisper-rs 绑定）

#[cfg(feature = "whisper-rs-backend")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "whisper-rs-backend")]
use std::sync::Arc;

#[cfg(feature = "whisper-rs-backend")]
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
    install_logging_hooks,
};

#[cfg(feature = "whisper-rs-backend")]
use crate::models::audio::{TranscriptionRequest, TranscriptionSegment, VadConfig};
#[cfg(feature = "whisper-rs-backend")]
use crate::models::error::AppError;
#[cfg(feature = "whisper-rs-backend")]
use crate::services::vad;

/// whisper-rs 推理逻辑，在独立 OS 线程中运行。
/// 接收已解码的 16kHz 单声道 PCM 样本，执行 VAD + 推理，返回分段列表。
#[cfg(feature = "whisper-rs-backend")]
pub fn transcribe_on_thread(
    model_path_str: String,
    mut samples: Vec<f32>,
    request: &TranscriptionRequest,
    time_offset: f64,
    _duration: f64,
    progress_cb: impl Fn(f32, &str) + Clone + Send + 'static,
    log_cb: impl Fn(&str) + Clone + Send + 'static,
    abort_flag: Arc<AtomicBool>,
) -> Result<(Vec<TranscriptionSegment>, String), AppError> {
    install_logging_hooks();

    let requested_gpu = request.use_gpu.unwrap_or(true);
    let cuda_ok = crate::services::cuda::is_cuda_available();
    let use_gpu = requested_gpu && cuda_ok;
    if requested_gpu && !cuda_ok {
        log_cb("[推理] 用户请求 GPU 但 CUDA 不可用，自动回退 CPU");
        progress_cb(0.03, "CUDA 不可用，使用 CPU 推理");
    }
    log_cb(&format!(
        "[推理] use_gpu = {use_gpu} (requested={requested_gpu}, cuda_available={cuda_ok})"
    ));

    crate::services::audio::normalize_peak(&mut samples);
    let n_threads = request.threads.unwrap_or(4) as i32;
    let language = request.language.clone();

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
    let enable_vad = request.enable_vad.unwrap_or(true);
    let vad_config = request.vad_config.clone().unwrap_or_else(VadConfig::default);
    let initial_prompt = request.initial_prompt.clone();

    log_cb(&format!(
        "[推理] Whisper 参数: best_of={best_of}, threads={n_threads}, gpu={use_gpu}, \
         suppress_blank={suppress_blank}, suppress_nst={suppress_nst}, no_context={no_context}, \
         entropy={entropy_thold}, logprob={logprob_thold}, no_speech={no_speech_thold}, \
         temp={temperature}, temp_inc={temperature_inc}, max_init_ts={max_initial_ts}, \
         vad={enable_vad}, prompt={:?}, samples={}, lang={:?}",
        initial_prompt.as_deref().map(|s| if s.len() > 30 { &s[..30] } else { s }),
        samples.len(), language
    ));

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu = use_gpu;

    log_cb("[推理] 加载 Whisper 模型...");
    let ctx = WhisperContext::new_with_params(&model_path_str, ctx_params)
        .map_err(|e| AppError::Transcription(format!("加载模型失败: {e}")))?;
    log_cb("[推理] 模型加载完成");

    let mut state = ctx.create_state()
        .map_err(|e| AppError::Transcription(format!("创建推理状态失败: {e}")))?;

    // ── VAD 预分割 + 长段二次分割 ──
    let voice_chunks: Vec<(f64, f64)> = if enable_vad {
        let vad_segments = vad::detect_voice_segments(&samples, 16_000, &vad_config);
        let split_segments = vad::split_long_segments(&vad_segments, &samples, 16_000, 30.0);
        let voice: Vec<(f64, f64)> = split_segments
            .iter()
            .filter(|s| s.is_voice)
            .map(|s| (s.start_seconds, s.end_seconds))
            .collect();

        let total_voice: f64 = voice.iter().map(|(s, e)| e - s).sum();
        let total_dur = samples.len() as f64 / 16_000.0;
        log_cb(&format!(
            "[VAD] 分割完成：{} 个有声段，有声 {total_voice:.1}s / 总 {total_dur:.1}s（跳过 {:.0}% 静音）",
            voice.len(),
            (1.0 - total_voice / total_dur.max(0.001)) * 100.0
        ));

        if voice.is_empty() {
            log_cb("[VAD] 未检测到有声段，跳过推理");
            progress_cb(1.0, "未检测到有声内容");
            return Ok((vec![], serde_json::to_string(&serde_json::json!({
                "backend": "whisper",
                "bestOf": best_of,
                "suppressBlank": suppress_blank,
                "enableVad": enable_vad,
            })).unwrap_or_default()));
        }
        voice
    } else {
        vec![(0.0, samples.len() as f64 / 16_000.0)]
    };

    // ── 重叠扩展 ──
    let total_duration = samples.len() as f64 / 16_000.0;
    let voice_chunks = if enable_vad && voice_chunks.len() > 1 {
        let expanded = vad::add_overlap(&voice_chunks, 0.5, total_duration);
        log_cb(&format!("[VAD] 已为 {} 个段添加 0.5s 重叠缓冲", expanded.len()));
        expanded
    } else {
        voice_chunks
    };

    let total_voice_samples: usize = voice_chunks.iter()
        .map(|(s, e)| ((e - s) * 16_000.0) as usize)
        .sum();
    let mut cumulative_samples = 0usize;

    let mut all_segments: Vec<TranscriptionSegment> = Vec::new();
    let mut prev_tail_text: Option<String> = None;

    for (chunk_idx, &(chunk_start, chunk_end)) in voice_chunks.iter().enumerate() {
        if abort_flag.load(Ordering::Relaxed) {
            log_cb("[推理] 用户中止了转录");
            return Err(AppError::Transcription("用户中止了转录".to_string()));
        }

        let start_sample = (chunk_start * 16_000.0) as usize;
        let end_sample = ((chunk_end * 16_000.0) as usize).min(samples.len());
        let chunk_samples = &samples[start_sample..end_sample];
        let chunk_sample_count = chunk_samples.len();

        log_cb(&format!(
            "[推理] 段 {}/{}: {chunk_start:.2}s ~ {chunk_end:.2}s ({:.1}s)",
            chunk_idx + 1, voice_chunks.len(), chunk_end - chunk_start
        ));

        let progress_base = 0.05 + (cumulative_samples as f32 / total_voice_samples.max(1) as f32) * 0.90;
        let progress_span = (chunk_sample_count as f32 / total_voice_samples.max(1) as f32) * 0.90;
        let pcb = progress_cb.clone();
        let lcb = log_cb.clone();
        let chunk_idx_display = chunk_idx + 1;
        let total_chunks = voice_chunks.len();

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

        let effective_prompt: Option<String> = if chunk_idx == 0 {
            initial_prompt.clone()
        } else {
            prev_tail_text.clone().or_else(|| initial_prompt.clone())
        };
        if let Some(ref prompt) = effective_prompt {
            params.set_initial_prompt(prompt);
        }

        params.set_progress_callback_safe(move |pct: i32| {
            let mapped = progress_base + (pct as f32 / 100.0) * progress_span;
            pcb(mapped, &format!("段 {chunk_idx_display}/{total_chunks} 推理中 {pct}%"));
            lcb(&format!("[推理] 段 {chunk_idx_display}/{total_chunks} 进度 {pct}%"));
        });

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

        let full_result = state.full(params, chunk_samples);
        let aborted = abort_flag.load(Ordering::Relaxed);

        if let Err(e) = full_result {
            if aborted {
                log_cb("[推理] 用户中止了转录");
                return Err(AppError::Transcription("用户中止了转录".to_string()));
            } else {
                return Err(AppError::Transcription(format!("Whisper 推理失败: {e}")));
            }
        }

        let n_segs = state.full_n_segments();
        let mut chunk_last_text: Option<String> = None;

        for i in 0..n_segs {
            let Some(seg) = state.get_segment(i) else {
                return Err(AppError::Transcription(format!("读取分段 {i} 失败")));
            };
            let text = match seg.to_str_lossy() {
                Ok(t) => t.trim().to_string(),
                Err(e) => {
                    return Err(AppError::Transcription(format!("读取分段文本失败: {e}")));
                }
            };
            if text.is_empty() {
                continue;
            }
            chunk_last_text = Some(text.clone());
            all_segments.push(TranscriptionSegment {
                start: seg.start_timestamp() as f64 / 100.0 + chunk_start + time_offset,
                end: seg.end_timestamp() as f64 / 100.0 + chunk_start + time_offset,
                text,
            });
        }

        if let Some(tail) = chunk_last_text {
            let tail_chars: String = tail.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect();
            prev_tail_text = Some(tail_chars);
        }

        cumulative_samples += chunk_sample_count;
    }

    log_cb(&format!("[推理] 全部 {} 段推理完成，共 {} 个分段", voice_chunks.len(), all_segments.len()));

    let params_json = serde_json::to_string(&serde_json::json!({
        "backend": "whisper",
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
        "enableVad": enable_vad,
        "initialPrompt": initial_prompt,
    })).unwrap_or_default();

    Ok((all_segments, params_json))
}

/// Whisper 后端未启用时的占位实现
#[cfg(not(feature = "whisper-rs-backend"))]
pub fn transcribe_on_thread(
    _model_path_str: String,
    _samples: Vec<f32>,
    _request: &crate::models::audio::TranscriptionRequest,
    _time_offset: f64,
    _duration: f64,
    _progress_cb: impl Fn(f32, &str) + Clone + Send + 'static,
    _log_cb: impl Fn(&str) + Clone + Send + 'static,
    _abort_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(Vec<crate::models::audio::TranscriptionSegment>, String), crate::models::error::AppError> {
    Err(crate::models::error::AppError::Transcription(
        "当前构建未启用 whisper-rs-backend。".to_string(),
    ))
}
