#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // release 模式下尝试附加到父进程控制台，这样从终端启动时 println 可见
    #[cfg(all(not(debug_assertions), target_os = "windows"))]
    unsafe {
        AttachConsole(0xFFFFFFFF); // ATTACH_PARENT_PROCESS
    }

    println!("[启动] WhisperDesk 进程已启动 (pid={})", std::process::id());
    println!("[启动] exe 路径: {:?}", std::env::current_exe().unwrap_or_default());
    println!("[启动] 工作目录: {:?}", std::env::current_dir().unwrap_or_default());
    println!(
        "[启动] CUDA feature: {}",
        if cfg!(feature = "cuda") { "已启用" } else { "未启用" }
    );

    // 检查是否有 CUDA DLL 在 main() 之前就加载失败了
    println!(
        "[启动] CUDA DLL 延迟加载失败: {}",
        whisper_desk_lib::services::cuda::cuda_dll_load_failed()
    );

    let args: Vec<String> = std::env::args().collect();
    println!("[启动] 命令行参数: {args:?}");

    if args.iter().any(|a| a == "--headless") {
        let port = parse_port(&args).unwrap_or(3000);
        whisper_desk_lib::run_headless(port);
    } else {
        whisper_desk_lib::run();
    }
}

fn parse_port(args: &[String]) -> Option<u16> {
    args.iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

#[cfg(all(not(debug_assertions), target_os = "windows"))]
extern "system" {
    fn AttachConsole(process_id: u32) -> i32;
}
