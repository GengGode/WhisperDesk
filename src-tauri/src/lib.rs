mod commands;
mod models;
pub mod server;
pub mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[启动] 进入 lib::run()");

    // 尽早执行 CUDA 检测并输出结果
    let cuda_info = services::cuda::get_cuda_info();
    println!("[启动] CUDA 检测结果: available={}, message={}", cuda_info.available, cuda_info.message);

    println!("[启动] 初始化 Tauri Builder...");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(server::InferenceServerState::new())
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
            commands::audio::get_audio_peaks,
            commands::server::start_inference_server,
            commands::server::stop_inference_server,
            commands::server::get_inference_server_status,
        ])
        .setup(|app| {
            println!("[启动] Tauri setup 回调开始");

            println!("[启动] 解析 webview 数据目录...");
            let webview_dir = services::paths::webview_data_dir()
                .map_err(|e| {
                    eprintln!("[启动] webview 数据目录解析失败: {e}");
                    e.to_string()
                })?;
            println!("[启动] webview 数据目录: {}", webview_dir.display());

            println!("[启动] 创建主窗口...");
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("WhisperDesk")
            .inner_size(1100.0, 750.0)
            .data_directory(webview_dir)
            .build()?;

            println!("[启动] 主窗口创建完成");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("WhisperDesk 启动失败");

    println!("[启动] Tauri 事件循环已退出");
}

/// 无头模式：不启动 Tauri GUI，仅运行 HTTP 推理服务
pub fn run_headless(port: u16) {
    println!("[无头模式] 进入 run_headless(port={port})");

    let cuda_info = services::cuda::get_cuda_info();
    println!("[无头模式] CUDA 检测: available={}, message={}", cuda_info.available, cuda_info.message);

    let rt = tokio::runtime::Runtime::new().expect("创建 tokio runtime 失败");
    rt.block_on(async {
        let state = server::InferenceServerState::new();
        state.start(port).await.expect("启动推理服务失败");
        println!("[无头模式] 推理服务已就绪 http://0.0.0.0:{port}，按 Ctrl+C 退出");

        tokio::signal::ctrl_c().await.ok();

        println!("[无头模式] 正在关闭...");
        state.stop().await.ok();
    });
}
