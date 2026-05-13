use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::models::audio::{AudioFileMeta, RelocateResult};
use crate::models::error::AppError;
use crate::services::file_index::FileIndexService;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFolderProgress {
    total: usize,
    current: usize,
    current_name: String,
}

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

    let audio_entries: Vec<_> = WalkDir::new(folder_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_audio_file(entry.path()))
        .collect();

    let total = audio_entries.len();
    let mut imported = Vec::new();

    for (i, entry) in audio_entries.iter().enumerate() {
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let _ = app.emit(
            "import-folder-progress",
            ImportFolderProgress {
                total,
                current: i + 1,
                current_name: name,
            },
        );

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

#[tauri::command]
pub fn delete_audio_file(id: String) -> Result<(), AppError> {
    println!("[文件] 删除音频: id={id}");
    let service = FileIndexService::portable()?;
    service.init()?;
    service.delete_audio(&id)?;
    println!("[文件] 删除成功: id={id}");
    Ok(())
}

#[tauri::command]
pub fn import_audio_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<AudioFileMeta>, AppError> {
    let service = FileIndexService::portable()?;
    service.init()?;

    let audio_paths: Vec<PathBuf> = paths
        .into_iter()
        .flat_map(|p| {
            let path = PathBuf::from(&p);
            if path.is_dir() {
                WalkDir::new(&path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
                    .map(|e| e.into_path())
                    .collect::<Vec<_>>()
            } else if path.is_file() && is_audio_file(&path) {
                vec![path]
            } else {
                vec![]
            }
        })
        .collect();

    let total = audio_paths.len();
    let mut imported = Vec::new();

    for (i, path) in audio_paths.iter().enumerate() {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let _ = app.emit(
            "import-folder-progress",
            ImportFolderProgress {
                total,
                current: i + 1,
                current_name: name,
            },
        );

        if let Ok(file) = service.import_audio_file(path) {
            imported.push(file);
        }
    }

    Ok(imported)
}

#[tauri::command]
pub fn toggle_star(id: String) -> Result<bool, AppError> {
    let service = FileIndexService::portable()?;
    service.init()?;
    service.toggle_star(&id)
}

#[tauri::command]
pub fn set_file_tags(id: String, tags: Vec<String>) -> Result<(), AppError> {
    let service = FileIndexService::portable()?;
    service.init()?;
    service.set_tags(&id, &tags)
}

#[tauri::command]
pub fn list_all_tags() -> Result<Vec<String>, AppError> {
    let service = FileIndexService::portable()?;
    service.init()?;
    service.list_all_tags()
}

#[tauri::command]
pub fn relocate_folder(app: AppHandle, old_folder: String) -> Result<Option<RelocateResult>, AppError> {
    println!("[路径配准] 旧路径: {old_folder}");

    let picked = app.dialog().file().blocking_pick_folder();
    let Some(new_folder) = dialog_path_to_pathbuf(picked) else {
        println!("[路径配准] 用户取消选择");
        return Ok(None);
    };

    println!("[路径配准] 新路径: {}", new_folder.display());
    let service = FileIndexService::portable()?;
    service.init()?;
    let result = service.relocate_folder(&old_folder, &new_folder)?;
    println!(
        "[路径配准] 匹配 {} 个, 未匹配 {} 个",
        result.matched.len(),
        result.unmatched.len()
    );
    Ok(Some(result))
}

#[tauri::command]
pub fn relocate_file(app: AppHandle, id: String) -> Result<Option<AudioFileMeta>, AppError> {
    println!("[路径配准] 单文件重定位: id={id}");

    let picked = app
        .dialog()
        .file()
        .add_filter("音频文件", &["wav", "mp3", "flac", "ogg", "m4a", "aac"])
        .blocking_pick_file();

    let Some(new_path) = dialog_path_to_pathbuf(picked) else {
        println!("[路径配准] 用户取消选择");
        return Ok(None);
    };

    println!("[路径配准] 新文件: {}", new_path.display());
    let service = FileIndexService::portable()?;
    service.init()?;
    service.relocate_file(&id, &new_path)?;

    // 返回更新后的完整文件列表中该记录
    let all = service.list_audio()?;
    let updated = all.into_iter().find(|f| f.id == id);
    Ok(updated)
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
