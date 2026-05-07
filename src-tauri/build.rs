fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    {
        compile_delay_hook();
        setup_cuda_delay_load();
        fix_crt_conflict();
    }
}

/// sherpa-onnx 使用 features=["shared"]（动态链接），其 /MT 编译的代码封装在 DLL 内部，
/// 不会与主 exe 的 /MD CRT 冲突，因此无需 /NODEFAULTLIB:LIBCMT。
/// 保留此函数以备将来需要处理静态链接场景。
#[cfg(target_os = "windows")]
fn fix_crt_conflict() {
    // sherpa-onnx shared 模式下无 CRT 冲突，不需要干预链接器
}

/// 编译 C 延迟加载失败钩子（覆盖 delayimp.lib 中默认的 NULL）
#[cfg(target_os = "windows")]
fn compile_delay_hook() {
    if std::env::var("CARGO_FEATURE_CUDA").is_err() {
        return;
    }
    cc::Build::new()
        .file("src/delay_hook.c")
        .compile("delay_hook");
    println!("cargo:warning=已编译 CUDA 延迟加载失败钩子 (delay_hook.c)");
}

/// 在 Windows + cuda feature 下，为所有 CUDA DLL 设置延迟加载。
/// 这样程序启动时不需要 CUDA DLL 存在，仅在首次调用 CUDA 函数时才加载。
#[cfg(target_os = "windows")]
fn setup_cuda_delay_load() {
    use std::path::PathBuf;

    // 仅在 cuda feature 启用时才需要延迟加载
    if std::env::var("CARGO_FEATURE_CUDA").is_err() {
        return;
    }

    let Ok(cuda_path) = std::env::var("CUDA_PATH") else {
        println!("cargo:warning=CUDA_PATH 未设置，跳过延迟加载配置");
        return;
    };

    let cuda_bin = PathBuf::from(&cuda_path).join("bin");
    if !cuda_bin.exists() {
        println!(
            "cargo:warning=CUDA bin 目录不存在: {}",
            cuda_bin.display()
        );
        return;
    }

    // 扫描 CUDA bin 目录，找出需要延迟加载的 DLL（带版本号，如 cublas64_12.dll）
    let prefixes = ["cublas64_", "cublasLt64_", "cudart64_"];
    let mut delay_loaded = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&cuda_bin) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".dll") {
                continue;
            }
            for prefix in &prefixes {
                if name.starts_with(prefix) && !delay_loaded.contains(&name) {
                    println!("cargo:rustc-link-arg-bins=/DELAYLOAD:{name}");
                    delay_loaded.push(name.clone());
                    break;
                }
            }
        }
    }

    // nvcuda.dll 由 NVIDIA 驱动提供，文件名固定
    println!("cargo:rustc-link-arg-bins=/DELAYLOAD:nvcuda.dll");
    delay_loaded.push("nvcuda.dll".to_string());

    // 链接 MSVC 延迟加载辅助库
    println!("cargo:rustc-link-lib=delayimp");

    println!(
        "cargo:warning=已配置 CUDA 延迟加载: {:?}",
        delay_loaded
    );
}
