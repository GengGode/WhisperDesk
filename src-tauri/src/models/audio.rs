use serde::{Deserialize, Serialize};

/// 音频文件元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileMeta {
    pub id: String,
    pub name: String,
    pub path: String,
    pub format: String,
    /// 时长（秒）
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u16,
    /// 文件大小（字节）
    pub size: u64,
    pub created_at: String,
    pub transcription_status: TranscriptionStatus,
    pub starred: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionStatus {
    Pending,
    Transcribing,
    Completed,
    Failed,
}

/// 转录结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    /// 结果唯一标识，每次转录生成一个
    pub id: String,
    pub audio_file_id: String,
    /// 使用的模型名称
    pub model_name: String,
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
    pub language: String,
    /// 音频时长（秒）
    pub duration: f64,
    pub created_at: String,
    /// 本次转录使用的 Whisper 推理参数快照（JSON），历史数据可能为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params_json: Option<String>,
}

/// 转录分段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    /// 开始时间（秒）
    pub start: f64,
    /// 结束时间（秒）
    pub end: f64,
    pub text: String,
}

/// 转录进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionProgressPayload {
    pub audio_file_id: String,
    /// 0.0 - 1.0
    pub progress: f32,
    pub current_segment: Option<String>,
    /// 当前阶段：local / remote_connecting / remote_uploading / remote_transcribing / complete
    pub phase: Option<String>,
}

/// Whisper 引擎日志事件（转发到前端界面展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperLogPayload {
    pub message: String,
}

/// 转录请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    pub audio_file_id: String,
    pub audio_path: String,
    pub model_name: String,
    pub language: Option<String>,
    pub threads: Option<u8>,
    /// 是否使用 GPU 加速（CUDA），为 None 时默认 true
    pub use_gpu: Option<bool>,
    /// 远程推理服务器地址，非空时走远程推理
    pub remote_url: Option<String>,

    // ── Whisper 推理参数（均为 Option，None 时使用默认值） ──

    /// Greedy 采样候选数量，默认 5
    pub best_of: Option<i32>,
    /// 抑制空白 token，默认 true
    pub suppress_blank: Option<bool>,
    /// 抑制非语音 token（笑声、音乐等），默认 true
    pub suppress_nst: Option<bool>,
    /// 禁止前段文本作为后段上下文（防止幻觉雪崩），默认 true
    pub no_context: Option<bool>,
    /// 熵阈值，输出熵过高时触发温度回退重试，默认 2.4
    pub entropy_thold: Option<f32>,
    /// 平均对数概率阈值，默认 -1.0
    pub logprob_thold: Option<f32>,
    /// 无语音概率阈值，超过此值判定为静音，默认 0.6
    pub no_speech_thold: Option<f32>,
    /// 初始解码温度，默认 0.0
    pub temperature: Option<f32>,
    /// 解码失败时温度递增步长，默认 0.2
    pub temperature_inc: Option<f32>,
    /// 首个时间戳最大偏移，默认 1.0
    pub max_initial_ts: Option<f32>,
    /// 连续重复分段过滤阈值（超过此数量的连续相同文本将被裁剪），0 表示不过滤，默认 3
    pub max_repeat_filter: Option<u32>,
}

/// 更新转录结果请求（通过 result id 定位）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTranscriptionRequest {
    pub id: String,
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
}

/// 导出格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Txt,
    Srt,
    Json,
    Lrc,
}

/// 导出请求参数（通过 result id 定位）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub result_id: String,
    pub format: ExportFormat,
}
