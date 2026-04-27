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
}

/// 导出请求参数（通过 result id 定位）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub result_id: String,
    pub format: ExportFormat,
}
