//! sherpa-onnx 推理后端（Paraformer / SenseVoice / FireRedASR）

#[cfg(feature = "sherpa-onnx-backend")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "sherpa-onnx-backend")]
use std::sync::Arc;

#[cfg(feature = "sherpa-onnx-backend")]
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig,
    OfflineParaformerModelConfig, OfflineSenseVoiceModelConfig,
    OfflineFireRedAsrModelConfig,
    OfflinePunctuation, OfflinePunctuationConfig, OfflinePunctuationModelConfig,
};

#[cfg(feature = "sherpa-onnx-backend")]
use crate::models::audio::{SherpaModelType, TranscriptionRequest, TranscriptionSegment, VadConfig};
#[cfg(feature = "sherpa-onnx-backend")]
use crate::models::error::AppError;
#[cfg(feature = "sherpa-onnx-backend")]
use crate::services::transcriber::TranscriberService;
#[cfg(feature = "sherpa-onnx-backend")]
use crate::services::vad;

#[cfg(feature = "sherpa-onnx-backend")]
pub fn transcribe_on_thread(
    model_dir_str: String,
    mut samples: Vec<f32>,
    request: &TranscriptionRequest,
    time_offset: f64,
    _duration: f64,
    progress_cb: impl Fn(f32, &str) + Clone + Send + 'static,
    log_cb: impl Fn(&str) + Clone + Send + 'static,
    partial_cb: impl Fn(&[TranscriptionSegment]) + Clone + Send + 'static,
    abort_flag: Arc<AtomicBool>,
    punct_model_path: Option<String>,
) -> Result<(Vec<TranscriptionSegment>, String), AppError> {
    let model_type = TranscriberService::sherpa_model_type(&request.model_name)
        .ok_or_else(|| AppError::Transcription(format!(
            "未知 sherpa 模型类型: {}", request.model_name
        )))?;

    let n_threads = request.threads.unwrap_or(4) as i32;
    let language = request.language.clone().unwrap_or_else(|| "zh".to_string());
    let enable_vad = request.enable_vad.unwrap_or(true);
    let vad_config = request.vad_config.clone().unwrap_or_else(VadConfig::default);

    let cuda_available = is_cuda_ep_available();
    let use_gpu = request.use_gpu.unwrap_or(true);
    let actual_provider = if use_gpu && cuda_available { "cuda" } else { "cpu" };

    log_cb(&format!(
        "[推理] sherpa-onnx 参数: model_type={:?}, threads={}, lang={}, vad={}, provider={}, samples={}",
        model_type, n_threads, language, enable_vad, actual_provider, samples.len()
    ));
    if use_gpu && !cuda_available {
        log_cb("[推理] 用户请求 GPU 但 cuDNN 9.x (cudnn64_9.dll) 未找到，回退到 CPU");
    }

    crate::services::audio::normalize_peak(&mut samples);

    // ── 构建 OfflineRecognizerConfig ──
    let config = build_config(&model_dir_str, &model_type, n_threads, &language, request)?;

    log_cb("[推理] 创建 sherpa-onnx OfflineRecognizer...");
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| AppError::Transcription("创建 OfflineRecognizer 失败，请检查模型文件完整性".to_string()))?;
    log_cb("[推理] OfflineRecognizer 创建完成");

    // ── VAD 预分割 ──
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
                "backend": "sherpa-onnx",
                "modelType": format!("{:?}", model_type).to_lowercase(),
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

    // ── 逐段推理 ──
    let total_voice_samples: usize = voice_chunks.iter()
        .map(|(s, e)| ((e - s) * 16_000.0) as usize)
        .sum();
    let mut cumulative_samples = 0usize;
    let mut all_segments: Vec<TranscriptionSegment> = Vec::new();

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

        let stream = recognizer.create_stream();
        stream.accept_waveform(16_000, chunk_samples);
        recognizer.decode(&stream);

        let result = stream.get_result()
            .ok_or_else(|| AppError::Transcription(format!(
                "段 {} 获取识别结果失败", chunk_idx + 1
            )))?;

        let chunk_segments = tokens_to_segments(
            &result.text,
            &result.tokens,
            result.timestamps.as_deref(),
            result.durations.as_deref(),
            chunk_start + time_offset,
            chunk_end - chunk_start,
        );

        if !chunk_segments.is_empty() {
            partial_cb(&chunk_segments);
            all_segments.extend(chunk_segments);
        }

        cumulative_samples += chunk_sample_count;
        let progress = 0.05 + (cumulative_samples as f32 / total_voice_samples.max(1) as f32) * 0.90;
        progress_cb(progress, &format!(
            "段 {}/{} 完成", chunk_idx + 1, voice_chunks.len()
        ));
    }

    log_cb(&format!(
        "[推理] sherpa-onnx 全部 {} 段推理完成，共 {} 个分段",
        voice_chunks.len(), all_segments.len()
    ));

    // ── 标点恢复后处理 ──
    let punct_applied = if let Some(ref punct_path) = punct_model_path {
        if !all_segments.is_empty() && needs_punctuation(&all_segments) {
            log_cb("[标点] 检测到 ASR 输出缺少标点，启动标点恢复...");
            match apply_punctuation(&all_segments, punct_path, n_threads, &log_cb) {
                Ok(new_segments) => {
                    log_cb(&format!(
                        "[标点] 标点恢复完成：{} 段 → {} 段",
                        all_segments.len(), new_segments.len()
                    ));
                    all_segments = new_segments;
                    true
                }
                Err(e) => {
                    log_cb(&format!("[标点] 标点恢复失败，保留原始分段: {e}"));
                    false
                }
            }
        } else {
            log_cb("[标点] ASR 输出已包含标点，跳过标点恢复");
            false
        }
    } else {
        false
    };

    let params_json = serde_json::to_string(&serde_json::json!({
        "backend": "sherpa-onnx",
        "modelType": format!("{:?}", model_type).to_lowercase(),
        "threads": n_threads,
        "language": language,
        "enableVad": enable_vad,
        "punctuationApplied": punct_applied,
    })).unwrap_or_default();

    Ok((all_segments, params_json))
}

/// 根据模型类型构建 OfflineRecognizerConfig
#[cfg(feature = "sherpa-onnx-backend")]
fn build_config(
    model_dir: &str,
    model_type: &SherpaModelType,
    n_threads: i32,
    language: &str,
    request: &TranscriptionRequest,
) -> Result<OfflineRecognizerConfig, AppError> {
    use std::path::Path;

    let dir = Path::new(model_dir);
    let tokens_path = dir.join("tokens.txt");
    if !tokens_path.exists() {
        return Err(AppError::Transcription(format!(
            "tokens 文件不存在: {}", tokens_path.display()
        )));
    }

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.tokens = Some(tokens_path.to_string_lossy().to_string());
    config.model_config.num_threads = n_threads;
    config.model_config.debug = false;

    // GPU provider 设置：用户请求 GPU 且 cuDNN 可用时才启用 CUDA，
    // 否则回退到 CPU（onnxruntime 缺少 cuDNN 时会抛出 C++ 异常导致进程崩溃）
    let provider = if request.use_gpu.unwrap_or(true) && is_cuda_ep_available() {
        "cuda"
    } else {
        "cpu"
    };
    config.model_config.provider = Some(provider.to_string());

    match model_type {
        SherpaModelType::Paraformer => {
            let model_path = dir.join("model.int8.onnx");
            if !model_path.exists() {
                return Err(AppError::Transcription(format!(
                    "Paraformer 模型文件不存在: {}", model_path.display()
                )));
            }
            config.model_config.paraformer = OfflineParaformerModelConfig {
                model: Some(model_path.to_string_lossy().to_string()),
            };
        }
        SherpaModelType::SenseVoice => {
            let model_path = dir.join("model.int8.onnx");
            if !model_path.exists() {
                return Err(AppError::Transcription(format!(
                    "SenseVoice 模型文件不存在: {}", model_path.display()
                )));
            }
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: Some(model_path.to_string_lossy().to_string()),
                language: Some(language.to_string()),
                use_itn: true,
            };
        }
        SherpaModelType::FireRedAsr => {
            let encoder = dir.join("encoder.int8.onnx");
            let decoder = dir.join("decoder.int8.onnx");
            if !encoder.exists() {
                return Err(AppError::Transcription(format!(
                    "FireRedASR encoder 不存在: {}", encoder.display()
                )));
            }
            if !decoder.exists() {
                return Err(AppError::Transcription(format!(
                    "FireRedASR decoder 不存在: {}", decoder.display()
                )));
            }
            config.model_config.fire_red_asr = OfflineFireRedAsrModelConfig {
                encoder: Some(encoder.to_string_lossy().to_string()),
                decoder: Some(decoder.to_string_lossy().to_string()),
            };
        }
    }

    Ok(config)
}

/// 将 sherpa-onnx 的 token 级结果转换为句子级 TranscriptionSegment。
///
/// 策略：按标点符号分句，利用 token 时间戳确定每句的 start/end。
/// 如果没有时间戳，则按文本均匀分配到 chunk 时间范围。
#[cfg(feature = "sherpa-onnx-backend")]
fn tokens_to_segments(
    full_text: &str,
    tokens: &[String],
    timestamps: Option<&[f32]>,
    durations: Option<&[f32]>,
    chunk_abs_start: f64,
    chunk_duration: f64,
) -> Vec<TranscriptionSegment> {
    let trimmed = full_text.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // 如果有 token 级时间戳，按标点分句
    if let Some(ts) = timestamps {
        if !ts.is_empty() && ts.len() == tokens.len() {
            return split_by_punctuation_with_timestamps(
                tokens, ts, durations, chunk_abs_start,
            );
        }
    }

    // 无时间戳时回退：按标点分句，时间均匀分配
    split_by_punctuation_uniform(trimmed, chunk_abs_start, chunk_duration)
}

/// 有时间戳时：按标点分句，使用 token 时间戳定位
#[cfg(feature = "sherpa-onnx-backend")]
fn split_by_punctuation_with_timestamps(
    tokens: &[String],
    timestamps: &[f32],
    durations: Option<&[f32]>,
    chunk_abs_start: f64,
) -> Vec<TranscriptionSegment> {
    let mut segments: Vec<TranscriptionSegment> = Vec::new();
    let mut sentence_start_idx: Option<usize> = None;
    let mut sentence_text = String::new();

    for (i, token) in tokens.iter().enumerate() {
        let t = token.trim();
        if t.is_empty() || t == "▁" {
            continue;
        }

        if sentence_start_idx.is_none() {
            sentence_start_idx = Some(i);
        }
        sentence_text.push_str(t);

        let is_sentence_end = is_sentence_punct_char(t) || i == tokens.len() - 1;

        if is_sentence_end && !sentence_text.trim().is_empty() {
            let start_ts = timestamps[sentence_start_idx.unwrap()] as f64 + chunk_abs_start;
            let end_ts = if let Some(durs) = durations {
                (timestamps[i] + durs[i]) as f64 + chunk_abs_start
            } else if i + 1 < timestamps.len() {
                timestamps[i + 1] as f64 + chunk_abs_start
            } else {
                timestamps[i] as f64 + 0.3 + chunk_abs_start
            };

            segments.push(TranscriptionSegment {
                start: start_ts,
                end: end_ts.max(start_ts + 0.1),
                text: sentence_text.trim().to_string(),
            });

            sentence_start_idx = None;
            sentence_text.clear();
        }
    }

    // 残留文本
    if !sentence_text.trim().is_empty() {
        if let Some(start_idx) = sentence_start_idx {
            let start_ts = timestamps[start_idx] as f64 + chunk_abs_start;
            let end_ts = timestamps.last().map(|&t| t as f64 + 0.3).unwrap_or(start_ts + 0.5) + chunk_abs_start;
            segments.push(TranscriptionSegment {
                start: start_ts,
                end: end_ts,
                text: sentence_text.trim().to_string(),
            });
        }
    }

    segments
}

/// 无时间戳回退：按标点分句，时间均匀分配
#[cfg(feature = "sherpa-onnx-backend")]
fn split_by_punctuation_uniform(
    text: &str,
    chunk_abs_start: f64,
    chunk_duration: f64,
) -> Vec<TranscriptionSegment> {
    let sentences = split_text_by_punctuation(text);
    if sentences.is_empty() {
        return vec![];
    }

    let total_chars: usize = sentences.iter().map(|s| s.chars().count()).sum();
    if total_chars == 0 {
        return vec![TranscriptionSegment {
            start: chunk_abs_start,
            end: chunk_abs_start + chunk_duration,
            text: text.to_string(),
        }];
    }

    let mut segments = Vec::with_capacity(sentences.len());
    let mut cursor = chunk_abs_start;

    for sentence in &sentences {
        let char_ratio = sentence.chars().count() as f64 / total_chars as f64;
        let seg_duration = chunk_duration * char_ratio;
        segments.push(TranscriptionSegment {
            start: cursor,
            end: cursor + seg_duration,
            text: sentence.clone(),
        });
        cursor += seg_duration;
    }

    segments
}

/// 按中英文句末标点拆分文本
#[cfg(feature = "sherpa-onnx-backend")]
fn split_text_by_punctuation(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    let remaining = current.trim().to_string();
    if !remaining.is_empty() {
        sentences.push(remaining);
    }

    sentences
}

#[cfg(feature = "sherpa-onnx-backend")]
fn is_sentence_punct_char(s: &str) -> bool {
    s.len() == 1 && {
        let ch = s.chars().next().unwrap();
        matches!(ch, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';' | '，' | ',')
    }
}

/// 检测分段文本是否缺少标点（用于决定是否需要标点恢复）。
/// 策略：统计所有分段文本中句末标点字符的比例，低于阈值则认为缺少标点。
#[cfg(feature = "sherpa-onnx-backend")]
fn needs_punctuation(segments: &[TranscriptionSegment]) -> bool {
    let total_chars: usize = segments.iter().map(|s| s.text.chars().count()).sum();
    if total_chars == 0 {
        return false;
    }

    let punct_count: usize = segments.iter()
        .map(|s| {
            s.text.chars()
                .filter(|&ch| matches!(ch, '。' | '！' | '？' | '；' | '，' | ',' | '.' | '!' | '?' | ';'))
                .count()
        })
        .sum();

    // 标点占比低于 1% 认为需要补标点
    (punct_count as f64 / total_chars as f64) < 0.01
}

/// 对分段文本施加标点恢复，然后按标点重新分句。
/// 每个原始 segment 的时间范围内，按恢复后的句子均匀分配时间戳。
#[cfg(feature = "sherpa-onnx-backend")]
fn apply_punctuation(
    segments: &[TranscriptionSegment],
    punct_model_path: &str,
    n_threads: i32,
    log_cb: &impl Fn(&str),
) -> Result<Vec<TranscriptionSegment>, AppError> {
    let punct = OfflinePunctuation::create(&OfflinePunctuationConfig {
        model: OfflinePunctuationModelConfig {
            ct_transformer: Some(punct_model_path.to_string()),
            num_threads: n_threads,
            provider: Some("cpu".to_string()),
            debug: false,
            ..Default::default()
        },
    })
    .ok_or_else(|| AppError::Transcription(
        "创建 OfflinePunctuation 失败，请检查标点模型文件完整性".to_string()
    ))?;

    let mut new_segments: Vec<TranscriptionSegment> = Vec::new();

    for seg in segments {
        let raw_text = seg.text.trim();
        if raw_text.is_empty() {
            continue;
        }

        let punctuated = match punct.add_punctuation(raw_text) {
            Some(t) => t,
            None => {
                log_cb(&format!("[标点] 段 {:.2}s~{:.2}s 标点恢复返回空，保留原文", seg.start, seg.end));
                new_segments.push(seg.clone());
                continue;
            }
        };

        let sub_segments = split_by_punctuation_uniform(
            &punctuated, seg.start, seg.end - seg.start,
        );

        if sub_segments.is_empty() {
            new_segments.push(TranscriptionSegment {
                start: seg.start,
                end: seg.end,
                text: punctuated,
            });
        } else {
            new_segments.extend(sub_segments);
        }
    }

    Ok(new_segments)
}

/// 检查 CUDA Execution Provider 的运行时依赖（cuDNN 9.x）是否可用。
/// onnxruntime 的 CUDA EP 在加载失败时会抛出 C++ 异常，Rust 无法捕获，导致进程崩溃。
/// 因此必须在请求 CUDA provider 之前主动检测。
#[cfg(feature = "sherpa-onnx-backend")]
fn is_cuda_ep_available() -> bool {
    use std::path::Path;

    let cudnn_dll = "cudnn64_9.dll";

    // 检查可执行文件所在目录（DLL 可能被复制到了输出目录旁边）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join(cudnn_dll).exists() {
                return true;
            }
        }
    }

    // 检查 CUDA_PATH/bin
    if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
        if Path::new(&cuda_path).join("bin").join(cudnn_dll).exists() {
            return true;
        }
    }

    // 搜索 PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            if !dir.is_empty() && Path::new(dir).join(cudnn_dll).exists() {
                return true;
            }
        }
    }

    false
}

// ── 未启用 sherpa-onnx-backend 时的占位实现 ──

#[cfg(not(feature = "sherpa-onnx-backend"))]
pub fn transcribe_on_thread(
    _model_dir_str: String,
    _samples: Vec<f32>,
    _request: &crate::models::audio::TranscriptionRequest,
    _time_offset: f64,
    _duration: f64,
    _progress_cb: impl Fn(f32, &str) + Clone + Send + 'static,
    _log_cb: impl Fn(&str) + Clone + Send + 'static,
    _abort_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    _punct_model_path: Option<String>,
) -> Result<(Vec<crate::models::audio::TranscriptionSegment>, String), crate::models::error::AppError> {
    Err(crate::models::error::AppError::Transcription(
        "当前构建未启用 sherpa-onnx-backend。".to_string(),
    ))
}
