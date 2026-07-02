use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder};

const LYRICS_WINDOW_LABEL: &str = "lyrics";
const LYRICS_POS_FILE: &str = "lyrics-window-pos.json";

#[derive(Serialize, Deserialize, Default)]
struct LyricsWindowPos {
    x: i32,
    y: i32,
}

fn lyrics_pos_path() -> Result<PathBuf, String> {
    Ok(crate::services::paths::app_data_dir()
        .map_err(|e| e.to_string())?
        .join(LYRICS_POS_FILE))
}

fn load_lyrics_position() -> Option<(i32, i32)> {
    let path = lyrics_pos_path().ok()?;
    let data = std::fs::read_to_string(path).ok()?;
    let pos: LyricsWindowPos = serde_json::from_str(&data).ok()?;
    Some((pos.x, pos.y))
}

fn save_lyrics_position(x: i32, y: i32) -> Result<(), String> {
    let path = lyrics_pos_path()?;
    let json = serde_json::to_string(&LyricsWindowPos { x, y }).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// 保存歌词窗口位置（供前端拖拽结束时调用）
#[tauri::command]
pub async fn save_lyrics_window_position(x: i32, y: i32) -> Result<(), String> {
    save_lyrics_position(x, y)
}

/// 切换桌面歌词窗口：已打开则关闭并返回 false，否则创建并返回 true
#[tauri::command]
pub async fn toggle_desktop_lyrics(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LYRICS_WINDOW_LABEL) {
        // 关闭前保存当前位置
        if let Ok(pos) = window.outer_position() {
            let _ = save_lyrics_position(pos.x, pos.y);
        }
        window.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }

    let webview_dir = crate::services::paths::webview_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyrics");
    std::fs::create_dir_all(&webview_dir).map_err(|e| e.to_string())?;

    let window = WebviewWindowBuilder::new(
        &app,
        LYRICS_WINDOW_LABEL,
        WebviewUrl::App("lyrics.html".into()),
    )
    .title("桌面歌词")
    .inner_size(800.0, 120.0)
    .min_inner_size(400.0, 80.0)
    .resizable(true)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .data_directory(webview_dir)
    .build()
    .map_err(|e| e.to_string())?;

    // 恢复上次物理坐标，否则默认屏幕底部居中
    let target_pos = if let Some((x, y)) = load_lyrics_position() {
        PhysicalPosition::new(x, y)
    } else if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let win_w = 800i32;
        let win_h = 120i32;
        let x = ((size.width as i32) - win_w).max(0) / 2;
        let y = ((size.height as i32) * 3 / 4).max(0) - win_h / 2;
        PhysicalPosition::new(x, y.max(0))
    } else {
        PhysicalPosition::new(100, 100)
    };

    window
        .set_position(Position::Physical(target_pos))
        .map_err(|e| e.to_string())?;

    Ok(true)
}

/// 设置歌词窗口鼠标穿透（锁定后不可交互）
#[tauri::command]
pub async fn set_lyrics_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(LYRICS_WINDOW_LABEL)
        .ok_or_else(|| "歌词窗口未打开".to_string())?;
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}
