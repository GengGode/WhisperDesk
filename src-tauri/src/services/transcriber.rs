//! 转录服务：模型管理 + 引擎分发 + 后处理

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use reqwest::Client;
use tokio::io::AsyncWriteExt;

use serde::Serialize;

use crate::models::audio::{
    TranscriptionBackend, TranscriptionRequest, TranscriptionResult, TranscriptionSegment,
    SherpaModelType,
};
use crate::models::error::AppError;
use crate::services::audio::{decode_to_16k_mono, decode_range_to_16k_mono};
use crate::services::paths;

// ── 模型信息 ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub downloaded: bool,
    pub size: u64,
    pub path: String,
    /// 转录后端标识
    pub backend: String,
    /// sherpa-onnx 模型架构类型（仅 sherpa 后端有值）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_type: Option<String>,
    /// 参考 CER（字错误率），用于前端展示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cer: Option<String>,
}

// ── sherpa-onnx 模型注册表 ──

struct SherpaModelEntry {
    name: &'static str,
    dir_name: &'static str,
    model_type: SherpaModelType,
    download_url: &'static str,
    cer: &'static str,
    /// 模型就绪的标志文件（相对于模型目录）
    marker_file: &'static str,
}

// ── 标点恢复模型 ──

const PUNCT_MODEL_DIR_NAME: &str = "sherpa-punct-ct-transformer-zh-en";
const PUNCT_MODEL_DOWNLOAD_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2";
const PUNCT_MODEL_MARKER: &str = "model.int8.onnx";

const SHERPA_MODELS: &[SherpaModelEntry] = &[
    SherpaModelEntry {
        name: "paraformer-zh",
        dir_name: "sherpa-paraformer-zh",
        model_type: SherpaModelType::Paraformer,
        download_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2024-03-09.tar.bz2",
        cer: "1.95%",
        marker_file: "model.int8.onnx",
    },
    SherpaModelEntry {
        name: "sensevoice-zh",
        dir_name: "sherpa-sensevoice-zh",
        model_type: SherpaModelType::SenseVoice,
        download_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        cer: "~3.0%",
        marker_file: "model.int8.onnx",
    },
    SherpaModelEntry {
        name: "fireredasr2-zh",
        dir_name: "sherpa-fireredasr2-zh",
        model_type: SherpaModelType::FireRedAsr,
        download_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2",
        cer: "0.57%",
        marker_file: "encoder.int8.onnx",
    },
];

// ── 转录服务 ──

pub struct TranscriberService {
    model_dir: PathBuf,
}

impl TranscriberService {
    pub fn portable() -> Result<Self, AppError> {
        Ok(Self {
            model_dir: paths::models_dir()?,
        })
    }

    // ── Whisper 模型路径 ──

    pub fn whisper_model_path(&self, model_name: &str) -> PathBuf {
        self.model_dir.join(format!("ggml-{model_name}.bin"))
    }

    // ── sherpa-onnx 模型路径 ──

    fn sherpa_model_dir(&self, model_name: &str) -> PathBuf {
        if let Some(entry) = SHERPA_MODELS.iter().find(|e| e.name == model_name) {
            self.model_dir.join(entry.dir_name)
        } else {
            self.model_dir.join(format!("sherpa-{model_name}"))
        }
    }

    fn is_sherpa_model(model_name: &str) -> bool {
        SHERPA_MODELS.iter().any(|e| e.name == model_name)
    }

    /// 获取 sherpa 模型的类型信息
    pub fn sherpa_model_type(model_name: &str) -> Option<SherpaModelType> {
        SHERPA_MODELS.iter().find(|e| e.name == model_name).map(|e| e.model_type.clone())
    }

    // ── 标点恢复模型路径 ──

    pub fn punct_model_dir(&self) -> PathBuf {
        self.model_dir.join(PUNCT_MODEL_DIR_NAME)
    }

    /// 标点恢复模型 ONNX 文件路径
    pub fn punct_model_onnx_path(&self) -> PathBuf {
        self.punct_model_dir().join(PUNCT_MODEL_MARKER)
    }

    pub fn is_punct_model_ready(&self) -> bool {
        self.punct_model_onnx_path().exists()
    }

    pub async fn ensure_punct_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        proxy: Option<&str>,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        let dir = self.punct_model_dir();
        let marker = dir.join(PUNCT_MODEL_MARKER);

        if marker.exists() {
            on_log(&format!("[标点] 标点恢复模型已就绪: {}", dir.display()));
            return Ok(dir);
        }

        on_log(&format!("[标点] 开始下载标点恢复模型: {PUNCT_MODEL_DOWNLOAD_URL}"));

        let tmp_archive = self.model_dir.join(format!("{PUNCT_MODEL_DIR_NAME}.tar.bz2"));
        self.download_single_file(
            PUNCT_MODEL_DOWNLOAD_URL, &tmp_archive,
            on_model_progress.clone(), on_log.clone(),
            "punct-zh-en", proxy,
        ).await?;

        on_log("[标点] 正在解压标点模型...");
        on_model_progress("punct-zh-en", 0.99);

        let target_dir = dir.clone();
        let archive_path = tmp_archive.clone();
        tokio::task::spawn_blocking(move || {
            Self::extract_tar_bz2(&archive_path, &target_dir)
        })
        .await
        .map_err(|e| AppError::Transcription(format!("解压线程错误: {e}")))?
        .map_err(|e| AppError::Transcription(format!("解压标点模型失败: {e}")))?;

        let _ = std::fs::remove_file(&tmp_archive);

        if !marker.exists() {
            return Err(AppError::Transcription(format!(
                "标点模型解压后未找到标志文件: {}", marker.display()
            )));
        }

        on_log(&format!("[标点] 标点恢复模型就绪: {}", dir.display()));
        on_model_progress("punct-zh-en", 1.0);
        Ok(dir)
    }

    /// 根据 model_name 推断后端
    pub fn infer_backend(model_name: &str) -> TranscriptionBackend {
        if Self::is_sherpa_model(model_name) {
            TranscriptionBackend::SherpaOnnx
        } else {
            TranscriptionBackend::Whisper
        }
    }

    // ── 模型大小常量 ──

    const MIN_MODEL_BYTES: u64 = 10 * 1024 * 1024;

    // ── 模型列表 ──

    pub fn list_models(&self) -> Result<Vec<ModelInfo>, AppError> {
        let mut models = Vec::new();

        // Whisper GGML 模型
        let whisper_known = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"];
        for name in &whisper_known {
            let path = self.whisper_model_path(name);
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
                backend: "whisper".to_string(),
                model_type: None,
                cer: None,
            });
        }

        // sherpa-onnx 模型
        for entry in SHERPA_MODELS {
            let dir = self.model_dir.join(entry.dir_name);
            let marker = dir.join(entry.marker_file);
            let (downloaded, size) = if marker.exists() {
                let sz = dir_total_size(&dir);
                (true, sz)
            } else {
                (false, 0)
            };
            models.push(ModelInfo {
                name: entry.name.to_string(),
                downloaded,
                size,
                path: dir.to_string_lossy().to_string(),
                backend: "sherpa-onnx".to_string(),
                model_type: Some(format!("{:?}", entry.model_type).to_lowercase()),
                cer: Some(entry.cer.to_string()),
            });
        }

        // 标点恢复模型
        {
            let dir = self.punct_model_dir();
            let marker = dir.join(PUNCT_MODEL_MARKER);
            let (downloaded, size) = if marker.exists() {
                let sz = dir_total_size(&dir);
                (true, sz)
            } else {
                (false, 0)
            };
            models.push(ModelInfo {
                name: "punct-zh-en".to_string(),
                downloaded,
                size,
                path: dir.to_string_lossy().to_string(),
                backend: "punctuation".to_string(),
                model_type: Some("ct-transformer".to_string()),
                cer: None,
            });
        }

        Ok(models)
    }

    // ── 模型下载 / 确保就绪 ──

    pub async fn ensure_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
        proxy: Option<&str>,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        if let Some(p) = proxy {
            on_log(&format!("[模型] 使用代理: {p}"));
        }
        if model_name == "punct-zh-en" {
            self.ensure_punct_model(on_model_progress, on_log, proxy).await
        } else if Self::is_sherpa_model(model_name) {
            self.ensure_sherpa_model(on_model_progress, on_log, model_name, proxy).await
        } else {
            self.ensure_whisper_model(on_model_progress, on_log, model_name, proxy).await
        }
    }

    async fn ensure_whisper_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
        proxy: Option<&str>,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        let path = self.whisper_model_path(model_name);
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

        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin"
        );
        self.download_single_file(&url, &path, on_model_progress, on_log, model_name, proxy).await?;
        Ok(path)
    }

    async fn ensure_sherpa_model<M, L>(
        &self,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
        proxy: Option<&str>,
    ) -> Result<PathBuf, AppError>
    where
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
    {
        let entry = SHERPA_MODELS.iter().find(|e| e.name == model_name)
            .ok_or_else(|| AppError::Transcription(format!("未知 sherpa 模型: {model_name}")))?;

        let dir = self.model_dir.join(entry.dir_name);
        let marker = dir.join(entry.marker_file);

        if marker.exists() {
            on_log(&format!("[模型] sherpa 模型已就绪: {}", dir.display()));
            return Ok(dir);
        }

        on_log(&format!("[模型] 开始下载 sherpa 模型: {}", entry.download_url));

        // 下载 tar.bz2 到临时文件
        let tmp_archive = self.model_dir.join(format!("{}.tar.bz2", entry.dir_name));
        self.download_single_file(entry.download_url, &tmp_archive, on_model_progress.clone(), on_log.clone(), model_name, proxy).await?;

        // 解压到模型目录
        on_log("[模型] 正在解压模型...");
        on_model_progress(model_name, 0.99);

        let target_dir = dir.clone();
        let archive_path = tmp_archive.clone();
        tokio::task::spawn_blocking(move || {
            Self::extract_tar_bz2(&archive_path, &target_dir)
        })
        .await
        .map_err(|e| AppError::Transcription(format!("解压线程错误: {e}")))?
        .map_err(|e| AppError::Transcription(format!("解压模型失败: {e}")))?;

        let _ = std::fs::remove_file(&tmp_archive);

        if !marker.exists() {
            return Err(AppError::Transcription(format!(
                "模型解压后未找到标志文件: {}",
                marker.display()
            )));
        }

        on_log(&format!("[模型] sherpa 模型就绪: {}", dir.display()));
        on_model_progress(model_name, 1.0);
        Ok(dir)
    }

    /// 解压 tar.bz2，将内部顶级目录的内容平铺到 target_dir
    fn extract_tar_bz2(archive: &Path, target_dir: &Path) -> Result<(), String> {
        use std::io::Read;

        let file = std::fs::File::open(archive)
            .map_err(|e| format!("打开压缩包失败: {e}"))?;
        let decompressor = bzip2::read::BzDecoder::new(file);
        let mut archive = tar::Archive::new(decompressor);

        std::fs::create_dir_all(target_dir)
            .map_err(|e| format!("创建目录失败: {e}"))?;

        // sherpa-onnx 模型包内通常有一层顶级目录，需要剥离
        for entry in archive.entries().map_err(|e| format!("读取 tar 条目失败: {e}"))? {
            let mut entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
            let raw_path = entry.path().map_err(|e| format!("读取路径失败: {e}"))?.to_path_buf();

            // 跳过顶级目录名（第一个路径分量）
            let components: Vec<_> = raw_path.components().collect();
            if components.len() <= 1 {
                continue;
            }
            let relative: PathBuf = components[1..].iter().collect();
            let dest = target_dir.join(&relative);

            if entry.header().entry_type().is_dir() {
                std::fs::create_dir_all(&dest)
                    .map_err(|e| format!("创建子目录失败: {e}"))?;
            } else {
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("创建父目录失败: {e}"))?;
                }
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf)
                    .map_err(|e| format!("读取文件内容失败: {e}"))?;
                std::fs::write(&dest, &buf)
                    .map_err(|e| format!("写入文件失败: {e}"))?;
            }
        }

        Ok(())
    }

    async fn download_single_file<M, L>(
        &self,
        url: &str,
        target: &Path,
        on_model_progress: M,
        on_log: L,
        model_name: &str,
        proxy: Option<&str>,
    ) -> Result<(), AppError>
    where
        M: Fn(&str, f32) + Send + 'static,
        L: Fn(&str) + Send + 'static,
    {
        on_log(&format!("[模型] 开始下载: {url}"));

        let mut builder = Client::builder()
            .user_agent("WhisperDesk/0.1")
            .redirect(reqwest::redirect::Policy::limited(10));

        if let Some(proxy_url) = proxy {
            let p = reqwest::Proxy::all(proxy_url)
                .map_err(|e| AppError::Transcription(format!("代理地址无效 ({proxy_url}): {e}")))?;
            builder = builder.proxy(p);
            on_log(&format!("[模型] 已配置下载代理: {proxy_url}"));
        }

        let client = builder
            .build()
            .map_err(|e| AppError::Transcription(format!("创建 HTTP 客户端失败: {e}")))?;

        let resp = client.get(url).send().await
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

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut file = tokio::fs::File::create(target).await
            .map_err(|e| AppError::FileSystem(format!("创建文件失败: {e}")))?;

        while let Some(chunk) = stream.chunk().await
            .map_err(|e| {
                let _ = std::fs::remove_file(target);
                AppError::Transcription(format!("下载分片失败: {e}"))
            })?
        {
            file.write_all(&chunk).await
                .map_err(|e| {
                    let _ = std::fs::remove_file(target);
                    AppError::FileSystem(format!("写入文件失败: {e}"))
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

    // ── 删除模型 ──

    pub fn delete_model(&self, model_name: &str) -> Result<(), AppError> {
        if model_name == "punct-zh-en" {
            let dir = self.punct_model_dir();
            if dir.exists() {
                std::fs::remove_dir_all(&dir)?;
            }
        } else if Self::is_sherpa_model(model_name) {
            let dir = self.sherpa_model_dir(model_name);
            if dir.exists() {
                std::fs::remove_dir_all(&dir)?;
            }
        } else {
            let path = self.whisper_model_path(model_name);
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
        }
        Ok(())
    }

    // ── 转录入口 ──

    pub async fn transcribe<P, M, L, S>(
        &self,
        on_progress: P,
        on_model_progress: M,
        on_log: L,
        on_partial: S,
        abort_flag: Arc<AtomicBool>,
        request: &TranscriptionRequest,
    ) -> Result<TranscriptionResult, AppError>
    where
        P: Fn(f32, &str) + Clone + Send + 'static,
        M: Fn(&str, f32) + Clone + Send + 'static,
        L: Fn(&str) + Clone + Send + 'static,
        S: Fn(&[TranscriptionSegment]) + Clone + Send + 'static,
    {
        let backend = request.backend.clone()
            .unwrap_or_else(|| Self::infer_backend(&request.model_name));

        on_log(&format!("[转录] 后端: {:?}, 模型: {}", backend, request.model_name));

        let model_path = self
            .ensure_model(on_model_progress.clone(), on_log.clone(), &request.model_name, request.download_proxy.as_deref())
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

        let audio_file_id = request.audio_file_id.clone();
        let model_name = request.model_name.clone();
        let req_language = request.language.clone();
        let duration = decoded.duration_seconds;
        let samples = decoded.samples_16k_mono;
        let max_repeat_filter = request.max_repeat_filter.unwrap_or(3);

        // 标点恢复：sherpa 后端 + 用户启用时预下载标点模型
        let enable_punct = request.enable_punctuation.unwrap_or(true)
            && backend == TranscriptionBackend::SherpaOnnx;
        let punct_model_path = if enable_punct {
            match self.ensure_punct_model(on_model_progress.clone(), on_log.clone(), request.download_proxy.as_deref()).await {
                Ok(dir) => {
                    let onnx = dir.join(PUNCT_MODEL_MARKER);
                    Some(onnx.to_string_lossy().to_string())
                }
                Err(e) => {
                    on_log(&format!("[标点] 标点模型下载失败，跳过标点恢复: {e}"));
                    None
                }
            }
        } else {
            None
        };

        let model_path_str = model_path
            .to_str()
            .ok_or_else(|| AppError::Transcription("模型路径非法".to_string()))?
            .to_string();

        let request_clone = request.clone();
        let progress_cb = on_progress.clone();
        let log_cb = on_log.clone();
        let partial_cb = on_partial.clone();
        let flag = abort_flag.clone();

        // 在独立 OS 线程执行推理，避免阻塞 tokio
        let (tx, rx) = tokio::sync::oneshot::channel();

        std::thread::spawn(move || {
            let result = match backend {
                TranscriptionBackend::Whisper => {
                    super::whisper_backend::transcribe_on_thread(
                        model_path_str,
                        samples,
                        &request_clone,
                        time_offset,
                        duration,
                        progress_cb.clone(),
                        log_cb.clone(),
                        partial_cb.clone(),
                        flag,
                    )
                }
                TranscriptionBackend::SherpaOnnx => {
                    super::sherpa_backend::transcribe_on_thread(
                        model_path_str,
                        samples,
                        &request_clone,
                        time_offset,
                        duration,
                        progress_cb.clone(),
                        log_cb.clone(),
                        partial_cb.clone(),
                        flag,
                        punct_model_path.clone(),
                    )
                }
            };

            match result {
                Ok((mut segments, params_json)) => {
                    // ── 后处理（所有后端共享） ──

                    segments.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

                    let pre_dedup_count = segments.len();
                    segments = dedup_overlap_segments(segments);
                    if segments.len() < pre_dedup_count {
                        log_cb(&format!(
                            "[后处理] 重叠去重：{pre_dedup_count} → {} 段",
                            segments.len()
                        ));
                    }

                    let pre_merge_count = segments.len();
                    segments = merge_short_segments(segments, 0.3, 12.0);
                    if segments.len() < pre_merge_count {
                        log_cb(&format!(
                            "[后处理] 短段合并：{pre_merge_count} → {} 段",
                            segments.len()
                        ));
                    }

                    let pre_filter_count = segments.len();

                    if max_repeat_filter > 0 {
                        let mut filtered = Vec::with_capacity(segments.len());
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
                        segments = filtered;
                    }

                    let hallucination_phrases = [
                        "谢谢观看", "感谢收看", "字幕由", "字幕提供",
                        "Thanks for watching", "Subscribe",
                        "请不吝点赞", "欢迎订阅", "下期再见",
                        "Subtitles by", "Copyright",
                    ];
                    segments.retain(|seg| {
                        let t = seg.text.trim();
                        !hallucination_phrases.iter().any(|&phrase| t.contains(phrase))
                    });

                    segments.retain(|seg| {
                        let seg_dur = seg.end - seg.start;
                        let char_count = seg.text.chars().count();
                        !(seg_dur > 25.0 && char_count < 3)
                    });

                    for seg in &mut segments {
                        if seg.end < seg.start {
                            seg.end = seg.start + 0.5;
                        }
                    }

                    let removed = pre_filter_count - segments.len();
                    if removed > 0 {
                        log_cb(&format!(
                            "[后处理] 过滤了 {removed} 个幻觉/异常分段（{pre_filter_count} → {}）",
                            segments.len()
                        ));
                    }

                    progress_cb(1.0, "转录完成");

                    let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n");
                    let _ = tx.send(Ok(TranscriptionResult {
                        id: uuid::Uuid::new_v4().to_string(),
                        audio_file_id,
                        model_name,
                        text,
                        segments,
                        language: req_language.unwrap_or_else(|| "auto".to_string()),
                        duration,
                        created_at: chrono::Utc::now().to_rfc3339(),
                        params_json: Some(params_json),
                    }));
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });

        rx.await.map_err(|_| AppError::Transcription("推理线程异常退出".to_string()))?
    }
}

// ── 后处理函数 ──

fn dedup_overlap_segments(mut segments: Vec<TranscriptionSegment>) -> Vec<TranscriptionSegment> {
    if segments.len() < 2 {
        return segments;
    }
    segments.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    let mut result: Vec<TranscriptionSegment> = Vec::with_capacity(segments.len());
    result.push(segments.remove(0));

    for seg in segments {
        let prev = result.last_mut().unwrap();
        if seg.start < prev.end {
            let prev_len = prev.text.chars().count();
            let seg_len = seg.text.chars().count();
            if seg_len > prev_len {
                prev.end = seg.start;
                if prev.end <= prev.start + 0.05 {
                    *prev = seg;
                } else {
                    result.push(seg);
                }
            } else {
                let mut adjusted = seg;
                adjusted.start = prev.end;
                if adjusted.start < adjusted.end - 0.05 {
                    result.push(adjusted);
                }
            }
        } else {
            result.push(seg);
        }
    }

    result
}

fn merge_short_segments(
    segments: Vec<TranscriptionSegment>,
    min_gap: f64,
    max_duration: f64,
) -> Vec<TranscriptionSegment> {
    if segments.is_empty() {
        return segments;
    }

    let mut result: Vec<TranscriptionSegment> = Vec::with_capacity(segments.len());
    result.push(segments[0].clone());

    for seg in segments.into_iter().skip(1) {
        let prev = result.last_mut().unwrap();
        let gap = seg.start - prev.end;
        let merged_duration = seg.end - prev.start;

        if gap < min_gap && merged_duration <= max_duration && !ends_with_sentence_punct(&prev.text) {
            prev.end = seg.end;
            prev.text.push_str(&seg.text);
        } else {
            result.push(seg);
        }
    }

    result
}

fn ends_with_sentence_punct(text: &str) -> bool {
    let t = text.trim_end();
    if t.is_empty() {
        return false;
    }
    let last = t.chars().last().unwrap();
    matches!(last, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';')
}

/// 递归计算目录总大小
fn dir_total_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}
