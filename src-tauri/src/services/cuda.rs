use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CudaInfo {
    pub available: bool,
    pub message: String,
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
    if cuda_dll_load_failed() {
        println!("[CUDA] 延迟加载阶段检测到 DLL 缺失，回退 CPU");
        return CudaInfo {
            available: false,
            message: "CUDA DLL 加载失败（延迟加载阶段已检测到缺失）".to_string(),
        };
    }

    if !try_load_dll("nvcuda.dll") {
        return CudaInfo {
            available: false,
            message: "未检测到 NVIDIA 驱动 (nvcuda.dll)".to_string(),
        };
    }

    let all_present = try_load_dll("cublas64_12.dll")
        && try_load_dll("cublasLt64_12.dll")
        && try_load_dll("cudart64_12.dll");

    if !all_present {
        return CudaInfo {
            available: false,
            message: "NVIDIA 驱动已安装，但 CUDA 运行时库缺失（需要 cublas/cublasLt/cudart）".to_string(),
        };
    }

    CudaInfo {
        available: true,
        message: "CUDA 可用".to_string(),
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
    if cfg!(feature = "cuda") {
        CudaInfo {
            available: true,
            message: "CUDA feature 已启用（未执行运行时检测）".to_string(),
        }
    } else {
        CudaInfo {
            available: false,
            message: "当前构建未启用 CUDA".to_string(),
        }
    }
}
