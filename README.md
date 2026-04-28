# WhisperDesk

基于 [Tauri v2](https://v2.tauri.app/) 的桌面语音转录应用，集成 [whisper.cpp](https://github.com/ggerganov/whisper.cpp) 实现**完全本地**的语音识别，无需联网、无需 API Key。

## 功能特性

- **本地转录** — 通过 whisper-rs 集成 whisper.cpp，所有推理在本机完成，数据不离开你的电脑
- **CUDA 加速** — 自动检测 NVIDIA GPU，支持 CUDA 加速转录
- **音频文件管理** — 导入文件夹、递归扫描，支持 WAV / MP3 / FLAC / OGG / M4A / AAC 格式
- **字幕编辑器** — 波形可视化 + 逐句字幕编辑，转录结果随时修正
- **批量转录** — 转录队列支持批量任务，进度实时反馈
- **模型管理** — 内置模型下载，支持 tiny / base / small / medium / large 等多种规格
- **转录导出** — 导出转录结果为常见格式
- **推理服务** — 内建 HTTP 推理服务器，可作为本地 API 供其他应用调用
- **星标 & 标签** — 对音频文件标星、打标签，方便整理归档

## 技术栈

| 层面 | 技术 |
|------|------|
| 桌面框架 | Tauri v2 |
| 前端 | React 19 + TypeScript |
| 样式 | TailwindCSS v4 |
| 状态管理 | Zustand |
| 后端 | Rust |
| 语音识别 | whisper.cpp（whisper-rs） |
| 音频解码 | Symphonia |
| 本地存储 | SQLite（rusqlite） |
| HTTP 服务 | Axum |

## 环境要求

- **Node.js** 24+（通过 [fnm](https://github.com/Schniz/fnm) 管理）
- **pnpm**（通过 corepack 启用）
- **Rust** 稳定版工具链
- **LLVM / libclang** — 编译 whisper-rs 需要（项目约定放在 `.env/llvm/`）
- **CUDA Toolkit**（可选）— 启用 GPU 加速需要
- **CMake** + **Visual Studio Build Tools** — Windows 上编译 whisper.cpp 的 C/C++ 依赖

## 快速开始

### 1. 克隆仓库

```powershell
git clone https://github.com/YuSuiXian/WhisperDesk.git
cd WhisperDesk
```

### 2. 配置 Node.js 环境

```powershell
fnm env --use-on-cd --shell power-shell | Out-String | Invoke-Expression
fnm use
corepack enable pnpm
```

### 3. 安装前端依赖

```powershell
pnpm install
```

### 4. 配置 LLVM（编译 whisper-rs 所需）

将 LLVM 放置到项目根目录的 `.env/llvm/` 下，确保 `.env/llvm/bin/libclang.dll` 存在。

项目的 `src-tauri/.cargo/config.toml` 已配置 `LIBCLANG_PATH` 指向该路径，无需手动设置。

### 5. 启动开发模式

```powershell
pnpm tauri dev
```

### 6. 构建发布版本

```powershell
pnpm tauri build
```

构建便携版压缩包：

```powershell
pnpm portable
```

## 项目结构

```
WhisperDesk/
├── src/                          # 前端源码（React）
│   ├── components/
│   │   ├── audio-player/         # 音频播放器
│   │   ├── editor/               # 波形 + 字幕编辑器
│   │   ├── file-manager/         # 文件管理（树形/网格视图、导入、批量操作）
│   │   ├── settings/             # 设置页面
│   │   ├── transcription/        # 转录面板
│   │   └── ui/                   # 通用 UI 组件（侧边栏等）
│   ├── hooks/                    # 自定义 Hooks
│   ├── stores/                   # Zustand 状态管理
│   ├── lib/                      # 工具函数、类型定义、Tauri 调用封装
│   ├── App.tsx                   # 应用根组件
│   └── main.tsx                  # 入口
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── commands/             # Tauri Command 处理函数
│   │   │   ├── audio.rs          # 波形峰值计算
│   │   │   ├── files.rs          # 文件导入、列表、删除、标签
│   │   │   ├── whisper.rs        # 转录、模型管理、导出
│   │   │   └── server.rs         # 推理服务器控制
│   │   ├── services/             # 业务逻辑层
│   │   │   ├── audio.rs          # 音频解码与元数据探测
│   │   │   ├── cuda.rs           # CUDA 检测
│   │   │   ├── file_index.rs     # SQLite 文件索引
│   │   │   ├── paths.rs          # 应用路径管理
│   │   │   └── transcriber.rs    # Whisper 转录引擎
│   │   ├── models/               # 数据结构定义
│   │   ├── server/               # HTTP 推理服务
│   │   └── lib.rs                # Tauri 命令注册与应用初始化
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 编译特性（Cargo Features）

| Feature | 说明 | 默认 |
|---------|------|------|
| `whisper-rs-backend` | 使用 whisper-rs 本地推理 | 启用 |
| `cuda` | 启用 CUDA GPU 加速 | 启用 |

如需在无 CUDA 环境下编译：

```powershell
cd src-tauri
cargo build --no-default-features --features whisper-rs-backend
```

## 许可证

[MIT](LICENSE)
