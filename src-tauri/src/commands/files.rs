use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::models::audio::AudioFileMeta;
use crate::models::error::AppError;
use crate::services::file_index::FileIndexService;

#[tauri::command]
pub fn select_audio_file(app: AppHandle) -> Result<Option<AudioFileMeta>, AppError> {
    println!("[文件] 打开文件选择对话框");
    let service = FileIndexService::portable()?;
    service.init()?;

    let picked = app
        .dialog()
        .file()
        .add_filter("音频文件", &["wav", "mp3", "flac", "ogg", "m4a", "aac"])
        .blocking_pick_file();

    let Some(path) = dialog_path_to_pathbuf(picked) else {
        println!("[文件] 用户取消选择");
        return Ok(None);
    };

    println!("[文件] 选中文件: {}", path.display());
    let file = service.import_audio_file(&path)?;
    println!("[文件] 导入成功: id={}, duration={}s, sr={}", file.id, file.duration, file.sample_rate);
    Ok(Some(file))
}

#[tauri::command]
pub fn import_audio_folder(app: AppHandle) -> Result<Vec<AudioFileMeta>, AppError> {
    let service = FileIndexService::portable()?;
    service.init()?;

    let picked = app.dialog().file().blocking_pick_folder();
    let Some(folder_path) = dialog_path_to_pathbuf(picked) else {
        return Ok(vec![]);
    };

    let mut imported = Vec::new();
    for entry in WalkDir::new(folder_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        if !is_audio_file(entry.path()) {
            continue;
        }

        if let Ok(file) = service.import_audio_file(entry.path()) {
            imported.push(file);
        }
    }

    Ok(imported)
}

#[tauri::command]
pub fn list_audio_files() -> Result<Vec<AudioFileMeta>, AppError> {
    println!("[文件] 查询音频列表");
    let service = FileIndexService::portable()?;
    service.init()?;
    let list = service.list_audio()?;
    println!("[文件] 返回 {} 个文件", list.len());
    Ok(list)
}

fn is_audio_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        ext.to_lowercase().as_str(),
        "wav" | "mp3" | "flac" | "ogg" | "m4a" | "aac"
    )
}

fn dialog_path_to_pathbuf(path: Option<tauri_plugin_dialog::FilePath>) -> Option<PathBuf> {
    match path {
        Some(tauri_plugin_dialog::FilePath::Path(path_buf)) => Some(path_buf),
        _ => None,
    }
}
