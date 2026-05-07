use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CudaInfo {
    pub available: bool,
    pub message: String,
    /// sherpa-onnx GPU provider 状态描述
    pub sherpa_gpu: Option<String>,
    /// sherpa-onnx 后端 DLL 是否在运行时可加载
    pub sherpa_available: bool,
    /// sherpa-onnx 不可用时的原因描述
    pub sherpa_message: Option<String>,
}

static CUDA_INFO: OnceLock<CudaInfo> = OnceLock::new();

pub fn is_cuda_available() -> bool {
    get_cuda_info().available
}

pub fn get_cuda_info() -> &'static CudaInfo {
    CUDA_INFO.get_or_init(detect_cuda)
}

// ============================================================
// C 侧延迟加载失败钩子互操作
// ============================================================
// delay_hook.c 中定义了 __pfnDliFailureHook2 和 cuda_delay_load_failed 标志。
// Rust 侧通过 FFI 读取该标志判断是否发生过延迟加载失败。

#[cfg(all(target_os = "windows", feature = "cuda"))]
extern "C" {
    /// delay_hook.c 中定义，钩子触发时置 1
    static cuda_delay_load_failed: std::ffi::c_int;
}

/// 延迟加载 DLL 是否曾失败
pub fn cuda_dll_load_failed() -> bool {
    #[cfg(all(target_os = "windows", feature = "cuda"))]
    {
        unsafe { cuda_delay_load_failed != 0 }
    }
    #[cfg(not(all(target_os = "windows", feature = "cuda")))]
    {
        false
    }
}

// ============================================================
// 运行时检测
// ============================================================

#[cfg(target_os = "windows")]
fn detect_cuda() -> CudaInfo {
    let sherpa_gpu = detect_sherpa_gpu();
    let (sherpa_available, sherpa_message) = detect_sherpa_available();

    if cuda_dll_load_failed() {
        println!("[CUDA] 延迟加载阶段检测到 DLL 缺失，回退 CPU");
        return CudaInfo {
            available: false,
            message: "CUDA DLL 加载失败（延迟加载阶段已检测到缺失）".to_string(),
            sherpa_gpu,
            sherpa_available,
            sherpa_message,
        };
    }

    if !try_load_dll("nvcuda.dll") {
        return CudaInfo {
            available: false,
            message: "未检测到 NVIDIA 驱动 (nvcuda.dll)".to_string(),
            sherpa_gpu,
            sherpa_available,
            sherpa_message,
        };
    }

    let all_present = try_load_dll("cublas64_12.dll")
        && try_load_dll("cublasLt64_12.dll")
        && try_load_dll("cudart64_12.dll");

    if !all_present {
        return CudaInfo {
            available: false,
            message: "NVIDIA 驱动已安装，但 CUDA 运行时库缺失（需要 cublas/cublasLt/cudart）".to_string(),
            sherpa_gpu,
            sherpa_available,
            sherpa_message,
        };
    }

    CudaInfo {
        available: true,
        message: "CUDA 可用".to_string(),
        sherpa_gpu,
        sherpa_available,
        sherpa_message,
    }
}

#[cfg(target_os = "windows")]
fn try_load_dll(name: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe { LoadLibraryW(wide.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    unsafe { FreeLibrary(handle) };
    true
}

#[cfg(target_os = "windows")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut std::ffi::c_void;
    fn FreeLibrary(handle: *mut std::ffi::c_void) -> i32;
}

#[cfg(not(target_os = "windows"))]
fn detect_cuda() -> CudaInfo {
    let sherpa_gpu = detect_sherpa_gpu();
    let (sherpa_available, sherpa_message) = detect_sherpa_available();
    if cfg!(feature = "cuda") {
        CudaInfo {
            available: true,
            message: "CUDA feature 已启用（未执行运行时检测）".to_string(),
            sherpa_gpu,
            sherpa_available,
            sherpa_message,
        }
    } else {
        CudaInfo {
            available: false,
            message: "当前构建未启用 CUDA".to_string(),
            sherpa_gpu,
            sherpa_available,
            sherpa_message,
        }
    }
}

/// sherpa-onnx GPU provider 检测
fn detect_sherpa_gpu() -> Option<String> {
    if cfg!(feature = "sherpa-onnx-backend") {
        Some(
            "sherpa-onnx 已启用，GPU 取决于预编译库（默认 CPU；设置 SHERPA_ONNX_LIB_DIR 指向 GPU 版本可启用）"
                .to_string(),
        )
    } else {
        None
    }
}

/// sherpa-onnx 运行时 DLL 可用性检测
#[cfg(target_os = "windows")]
fn detect_sherpa_available() -> (bool, Option<String>) {
    if !cfg!(feature = "sherpa-onnx-backend") {
        return (false, Some("当前构建未启用 sherpa-onnx-backend feature".to_string()));
    }

    let required_dlls = &["sherpa-onnx-c-api.dll", "onnxruntime.dll"];
    let mut missing = Vec::new();

    for dll in required_dlls {
        if !try_load_dll(dll) {
            missing.push(*dll);
        }
    }

    if missing.is_empty() {
        (true, None)
    } else {
        let msg = format!(
            "sherpa-onnx 运行时 DLL 缺失: {}",
            missing.join(", ")
        );
        println!("[sherpa-onnx] {}", msg);
        (false, Some(msg))
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_sherpa_available() -> (bool, Option<String>) {
    if cfg!(feature = "sherpa-onnx-backend") {
        (true, None)
    } else {
        (false, Some("当前构建未启用 sherpa-onnx-backend feature".to_string()))
    }
}
