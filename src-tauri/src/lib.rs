mod commands;
mod models;
pub mod server;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(server::InferenceServerState::new())
        .manage(commands::whisper::TranscriptionAbortFlag::new())
        .invoke_handler(tauri::generate_handler![
            commands::files::select_audio_file,
            commands::files::import_audio_folder,
            commands::files::list_audio_files,
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
            commands::server::start_inference_server,
            commands::server::stop_inference_server,
            commands::server::get_inference_server_status,
            commands::server::get_dashboard_status,
            commands::server::set_server_config,
        ])
        .setup(|app| {
            let webview_dir = services::paths::webview_data_dir()
                .map_err(|e| e.to_string())?;

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("WhisperDesk")
            .inner_size(1100.0, 750.0)
            .data_directory(webview_dir)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("WhisperDesk 启动失败");
}

/// 无头模式：不启动 Tauri GUI，仅运行 HTTP 推理服务
pub fn run_headless(port: u16) {
    let rt = tokio::runtime::Runtime::new().expect("创建 tokio runtime 失败");
    rt.block_on(async {
        let state = server::InferenceServerState::new();
        state.start(port).await.expect("启动推理服务失败");
        println!("[无头模式] 推理服务已就绪，按 Ctrl+C 退出");

        tokio::signal::ctrl_c().await.ok();

        println!("[无头模式] 正在关闭...");
        state.stop().await.ok();
    });
}
