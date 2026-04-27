use std::path::PathBuf;

use crate::models::error::AppError;

/// 便携模式：所有数据存储在 exe 同级目录的 `data/` 下
fn portable_base() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::FileSystem(format!("获取 exe 路径失败: {e}")))?;
    let base = exe
        .parent()
        .ok_or_else(|| AppError::FileSystem("exe 无父目录".to_string()))?
        .join("data");
    std::fs::create_dir_all(&base)?;
    Ok(base)
}

pub fn db_path() -> Result<PathBuf, AppError> {
    Ok(portable_base()?.join("whisperdesk.db"))
}

pub fn models_dir() -> Result<PathBuf, AppError> {
    let dir = portable_base()?.join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// WebView2 运行时数据（缓存、cookies 等）集中存放于 `data/webview/`，
/// 避免默认行为在 %LOCALAPPDATA% 下散落文件。
pub fn webview_data_dir() -> Result<PathBuf, AppError> {
    let dir = portable_base()?.join("webview");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
