fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    {
        compile_delay_hook();
        setup_cuda_delay_load();
        setup_sherpa_delay_load();
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
    let has_cuda = std::env::var("CARGO_FEATURE_CUDA").is_ok();
    let has_sherpa = std::env::var("CARGO_FEATURE_SHERPA_ONNX_BACKEND").is_ok();
    if !has_cuda && !has_sherpa {
        return;
    }
    cc::Build::new()
        .file("src/delay_hook.c")
        .compile("delay_hook");
    println!("cargo:warning=已编译延迟加载失败钩子 (delay_hook.c)");
}

/// 在 Windows + cuda feature 下，为所有 CUDA DLL 设置延迟加载。
/// 这样程序启动时不需要 CUDA DLL 存在，仅在首次调用 CUDA 函数时才加载。
#[cfg(target_os = "windows")]
fn setup_cuda_delay_load() {
    use std::path::PathBuf;

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

    println!("cargo:rustc-link-arg-bins=/DELAYLOAD:nvcuda.dll");
    delay_loaded.push("nvcuda.dll".to_string());

    println!("cargo:rustc-link-lib=delayimp");

    println!(
        "cargo:warning=已配置 CUDA 延迟加载: {:?}",
        delay_loaded
    );
}

/// 为 sherpa-onnx 相关 DLL 设置延迟加载。
/// 使程序在缺少 sherpa-onnx DLL 时仍能启动，而非弹出系统错误对话框。
/// 运行时通过 cuda.rs 的 detect_sherpa_available() 检测可用性并在 UI 上禁用。
#[cfg(target_os = "windows")]
fn setup_sherpa_delay_load() {
    if std::env::var("CARGO_FEATURE_SHERPA_ONNX_BACKEND").is_err() {
        return;
    }

    let sherpa_dlls = [
        "sherpa-onnx-c-api.dll",
        "sherpa-onnx-cxx-api.dll",
        "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
        "onnxruntime_providers_cuda.dll",
        "onnxruntime_providers_tensorrt.dll",
        "cargs.dll",
    ];

    for dll in &sherpa_dlls {
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:{dll}");
    }

    // delayimp 可能已被 CUDA 延迟加载添加过，重复链接无副作用
    println!("cargo:rustc-link-lib=delayimp");

    println!(
        "cargo:warning=已配置 sherpa-onnx 延迟加载: {:?}",
        sherpa_dlls
    );
}
