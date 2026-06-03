mod commands;
mod models;
pub mod server;
mod services;

use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(server::InferenceServerState::new())
        .manage(commands::whisper::TranscriptionAbortFlag::new())
        .invoke_handler(tauri::generate_handler![
            commands::files::select_audio_file,
            commands::files::import_audio_folder,
            commands::files::list_audio_files,
            commands::files::delete_audio_file,
            commands::files::import_audio_files,
            commands::files::toggle_star,
            commands::files::set_file_tags,
            commands::files::list_all_tags,
            commands::files::relocate_folder,
            commands::files::relocate_file,
            commands::whisper::transcribe_audio,
            commands::whisper::get_transcription_results,
            commands::whisper::ensure_model,
            commands::whisper::export_transcription,
            commands::whisper::list_models,
            commands::whisper::get_models_dir,
            commands::whisper::open_models_dir,
            commands::whisper::delete_model,
            commands::whisper::update_transcription_result,
            commands::whisper::check_cuda,
            commands::whisper::abort_transcription,
            commands::audio::get_audio_peaks,
            commands::audio::analyze_vad,
            commands::server::start_api_server,
            commands::server::stop_api_server,
            commands::server::start_web_server,
            commands::server::stop_web_server,
            commands::server::stop_all_servers,
            commands::server::get_inference_server_status,
            commands::server::get_dashboard_status,
            commands::server::set_server_config,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏主界面", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("WhisperDesk")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            let webview_dir = services::paths::webview_data_dir()
                .map_err(|e| e.to_string())?;

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("WhisperDesk")
            .inner_size(1100.0, 750.0)
            .visible(false)
            .data_directory(webview_dir)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("WhisperDesk 启动失败");
}

/// 无头模式：不启动 Tauri GUI，运行 API 服务 + Web 前端
pub fn run_headless(api_port: u16, web_port: Option<u16>, auth: Option<server::AuthConfig>) {
    let rt = tokio::runtime::Runtime::new().expect("创建 tokio runtime 失败");
    rt.block_on(async {
        let state = server::InferenceServerState::new();

        // 如果命令行指定了鉴权，先设置
        if let Some(auth_cfg) = auth {
            state.set_auth_config(auth_cfg).await;
        }

        state.start_api(api_port).await.expect("启动 API 服务失败");

        if let Some(wp) = web_port {
            state.start_web(wp, api_port).await.expect("启动 Web 服务失败");
        }

        println!("[无头模式] 服务已就绪，按 Ctrl+C 退出");
        tokio::signal::ctrl_c().await.ok();

        println!("[无头模式] 正在关闭...");
        state.stop().await.ok();
    });
}
