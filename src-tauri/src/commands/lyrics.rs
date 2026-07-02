use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder,
    window::{Color, Effect, EffectState, EffectsBuilder},
};

const LYRICS_WINDOW_LABEL: &str = "lyrics";
const LYRICS_POS_FILE: &str = "lyrics-window-pos.json";

#[derive(Serialize, Deserialize, Default)]
struct LyricsWindowPos {
    x: i32,
    y: i32,
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
}

fn lyrics_pos_path() -> Result<PathBuf, String> {
    Ok(crate::services::paths::app_data_dir()
        .map_err(|e| e.to_string())?
        .join(LYRICS_POS_FILE))
}

fn load_lyrics_geometry() -> Option<LyricsWindowPos> {
    let path = lyrics_pos_path().ok()?;
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

/// 保存歌词窗口几何信息（位置 + 可选尺寸）
pub(crate) fn save_lyrics_geometry(x: i32, y: i32, width: Option<f64>, height: Option<f64>) -> Result<(), String> {
    let path = lyrics_pos_path()?;
    let json = serde_json::to_string(&LyricsWindowPos { x, y, width, height })
        .map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// 检查指定物理坐标是否落在某个显示器的可见区域内
fn is_position_on_screen(app: &AppHandle, x: i32, y: i32) -> bool {
    match app.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors.iter().any(|m| {
            let pos = m.position();
            let size = m.size();
            x >= pos.x
                && x < pos.x + size.width as i32
                && y >= pos.y
                && y < pos.y + size.height as i32
        }),
        _ => true,
    }
}

/// 计算默认歌词窗口位置（屏幕底部 3/4 处居中）
fn default_lyrics_position(app: &AppHandle, win_w: i32, win_h: i32) -> PhysicalPosition<i32> {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let x = ((size.width as i32) - win_w).max(0) / 2;
        let y = ((size.height as i32) * 3 / 4).max(0) - win_h / 2;
        PhysicalPosition::new(x, y.max(0))
    } else {
        PhysicalPosition::new(100, 100)
    }
}

/// 保存歌词窗口位置（供前端拖拽结束时调用）
#[tauri::command]
pub async fn save_lyrics_window_position(x: i32, y: i32) -> Result<(), String> {
    save_lyrics_geometry(x, y, None, None)
}

/// 切换桌面歌词窗口：已打开则关闭并返回 false，否则创建并返回 true
#[tauri::command]
pub async fn toggle_desktop_lyrics(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LYRICS_WINDOW_LABEL) {
        save_window_geometry(&window);
        window.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }

    let webview_dir = crate::services::paths::webview_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyrics");
    std::fs::create_dir_all(&webview_dir).map_err(|e| e.to_string())?;

    let geo = load_lyrics_geometry();
    let (init_w, init_h) = geo
        .as_ref()
        .and_then(|g| g.width.zip(g.height))
        .unwrap_or((800.0, 120.0));

    let window = WebviewWindowBuilder::new(
        &app,
        LYRICS_WINDOW_LABEL,
        WebviewUrl::App("lyrics.html".into()),
    )
    .title("桌面歌词")
    .inner_size(init_w, init_h)
    .min_inner_size(400.0, 80.0)
    .resizable(true)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .data_directory(webview_dir)
    .build()
    .map_err(|e| e.to_string())?;

    // 恢复上次坐标，越界时回退到默认位置
    let target_pos = if let Some(g) = &geo {
        if is_position_on_screen(&app, g.x, g.y) {
            PhysicalPosition::new(g.x, g.y)
        } else {
            default_lyrics_position(&app, init_w as i32, init_h as i32)
        }
    } else {
        default_lyrics_position(&app, init_w as i32, init_h as i32)
    };

    window
        .set_position(Position::Physical(target_pos))
        .map_err(|e| e.to_string())?;

    Ok(true)
}

/// 保存窗口当前位置和尺寸
pub(crate) fn save_window_geometry(window: &tauri::WebviewWindow) {
    let pos = window.outer_position().ok();
    let size = window.inner_size().ok();
    if let Some(p) = pos {
        let (w, h) = size
            .map(|s| (Some(s.width as f64), Some(s.height as f64)))
            .unwrap_or((None, None));
        let _ = save_lyrics_geometry(p.x, p.y, w, h);
    }
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

/// 设置歌词窗口毛玻璃背景效果
///
/// effect 取值: "none" | "blur" | "acrylic" | "mica"
/// color: 可选 [r, g, b, a] 数组，控制效果叠加色
#[tauri::command]
pub async fn set_lyrics_backdrop(
    app: AppHandle,
    effect: String,
    color: Option<[u8; 4]>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(LYRICS_WINDOW_LABEL)
        .ok_or_else(|| "歌词窗口未打开".to_string())?;

    if effect == "none" {
        window
            .set_effects(None::<tauri::utils::config::WindowEffectsConfig>)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let eff = match effect.as_str() {
        "blur" => Effect::Blur,
        "acrylic" => Effect::Acrylic,
        "mica" => Effect::Mica,
        other => return Err(format!("不支持的效果类型: {other}")),
    };

    let c = color.unwrap_or([0, 0, 0, 128]);

    window
        .set_effects(
            EffectsBuilder::new()
                .effect(eff)
                .state(EffectState::Active)
                .color(Color(c[0], c[1], c[2], c[3]))
                .build(),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 导入 LRC 歌词文件并关联到音频文件，保存为一条转录结果
#[tauri::command]
pub async fn import_lrc(audio_file_id: String, lrc_path: String) -> Result<String, String> {
    use chrono::Utc;
    use uuid::Uuid;
    use std::path::Path;
    use crate::services::file_index::FileIndexService;
    use crate::services::lrc;
    use crate::models::audio::TranscriptionResult;

    let svc = FileIndexService::portable().map_err(|e| e.to_string())?;
    let audio = svc
        .get_audio_by_id(&audio_file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "找不到对应的音频文件".to_string())?;

    let parsed = lrc::parse_lrc_file(Path::new(&lrc_path), audio.duration)
        .map_err(|e| e.to_string())?;

    let full_text = parsed
        .segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let result = TranscriptionResult {
        id: Uuid::new_v4().to_string(),
        audio_file_id: audio_file_id.clone(),
        model_name: "lrc-import".to_string(),
        text: full_text,
        segments: parsed.segments,
        language: String::new(),
        duration: audio.duration,
        created_at: Utc::now().to_rfc3339(),
        params_json: None,
    };

    svc.save_transcription_result(&result)
        .map_err(|e| e.to_string())?;

    Ok(result.id)
}
