/**
 * CUDA 延迟加载失败钩子（C 实现）
 *
 * 当程序用 /DELAYLOAD 链接了 CUDA DLL，但目标机器上没有安装 CUDA 时，
 * __delayLoadHelper2 在 LoadLibrary 失败后会查找此钩子。
 * 我们返回 stub 值防止 RaiseException(0xc06d007e) 导致进程崩溃，
 * 让 ggml-cuda 侧收到错误码后自行放弃 GPU 初始化。
 *
 * 此文件由 build.rs 通过 cc crate 编译为 .obj，
 * 其中的 __pfnDliFailureHook2 强符号覆盖 delayimp.lib 中的默认 NULL。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

/* 延迟加载通知类型（与 delayimp.h 一致） */
#define dliFailLoadLib  0x03
#define dliFailGetProc  0x04

typedef FARPROC (WINAPI *PfnDliHook)(unsigned dliNotify, void *pdli);

/* 标记是否发生过延迟加载失败，Rust 侧通过 FFI 读取 */
volatile int cuda_delay_load_failed = 0;

static FARPROC WINAPI cuda_api_stub(void)
{
    return (FARPROC)(intptr_t)1;
}

static FARPROC WINAPI delay_load_failure_hook(unsigned dliNotify, void *pdli)
{
    (void)pdli;
    cuda_delay_load_failed = 1;

    if (dliNotify == dliFailLoadLib) {
        fprintf(stderr,
                "[CUDA] delay-load: DLL not found, falling back to CPU\n");
        /* 返回 exe 自身句柄作为 dummy HMODULE */
        return (FARPROC)GetModuleHandleW(NULL);
    }

    if (dliNotify == dliFailGetProc) {
        /* 返回通用 stub；x64 调用约定下调用者清理参数 */
        return (FARPROC)cuda_api_stub;
    }

    return NULL;
}

/*
 * 覆盖 delayimp.lib 中的默认定义（NULL）。
 * 链接器处理 .obj 符号优先于 .lib，所以此定义生效。
 */
PfnDliHook __pfnDliFailureHook2 = delay_load_failure_hook;
