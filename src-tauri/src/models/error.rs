use serde::Serialize;

/// 统一错误类型，可序列化后传递给前端
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("音频处理失败: {0}")]
    Audio(String),

    #[error("转录失败: {0}")]
    Transcription(String),

    #[error("文件操作失败: {0}")]
    FileSystem(String),

    #[error("数据库错误: {0}")]
    Database(String),

    #[error("参数错误: {0}")]
    InvalidArgument(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::FileSystem(value.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value.to_string())
    }
}
