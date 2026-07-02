import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AudioFile,
  CudaInfo,
  DashboardSnapshot,
  ExportFormat,
  ExportRequest,
  RelocateResult,
  ServerConfig,
  ServerStatus,
  TranscriptionPartial,
  TranscriptionProgress,
  TranscriptionRequest,
  TranscriptionResult,
  UpdateTranscriptionRequest,
  VadConfig,
  VadSegment,
  WaveformData,
  WhisperModel,
} from "@/lib/types";

/**
 * 与 Tauri 后端通信的统一封装层
 *
 * 检测运行环境：
 * - Tauri WebView 中 → 走 invoke / listen（IPC）
 * - 普通浏览器中 → 走 HTTP fetch / EventSource（REST API）
 *
 * 上层组件通过此模块调用后端命令，不直接使用 invoke 或 fetch。
 */

// ── 环境检测 ──

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 浏览器模式下 API 服务的基地址。
 * Web 前端和后台 API 运行在不同端口时，需要跨域请求。
 * 值由 Web 服务器在 index.html 中注入 window.__WHISPERDESK_API_PORT__。
 */
function resolveApiBase(): string {
  if (IS_TAURI) return "";
  const apiPort = (window as unknown as Record<string, unknown>).__WHISPERDESK_API_PORT__;
  if (typeof apiPort === "number" && apiPort > 0) {
    return `http://${window.location.hostname}:${apiPort}`;
  }
  return "";
}
const API_BASE = resolveApiBase();

// ── 浏览器模式：内部事件总线 ──

const eventBus = new EventTarget();

function emitBrowserEvent(name: string, detail: unknown) {
  eventBus.dispatchEvent(new CustomEvent(name, { detail }));
}

// ── 浏览器模式：SSE 流读取 ──

interface SSEHandlers {
  onProgress?: (data: TranscriptionProgress) => void;
  onPartial?: (data: TranscriptionPartial) => void;
  onLog?: (data: { message: string }) => void;
  onModelProgress?: (data: { modelName: string; progress: number }) => void;
}

async function readSSEResponse<T>(
  response: Response,
  handlers: SSEHandlers,
): Promise<T> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  return new Promise<T>((resolve, reject) => {
    (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              try {
                const data = JSON.parse(raw);
                switch (currentEvent) {
                  case "progress":
                    handlers.onProgress?.(data);
                    emitBrowserEvent("transcription-progress", data);
                    break;
                  case "partial":
                    handlers.onPartial?.(data);
                    emitBrowserEvent("transcription-partial", data);
                    break;
                  case "log":
                    handlers.onLog?.(data);
                    emitBrowserEvent("whisper-log", data);
                    break;
                  case "model_progress":
                    handlers.onModelProgress?.(data);
                    emitBrowserEvent("model-download-progress", data);
                    break;
                  case "complete":
                    resolve(data as T);
                    return;
                  case "error":
                    reject(new Error(raw));
                    return;
                }
              } catch {
                if (currentEvent === "error") {
                  reject(new Error(raw));
                  return;
                }
              }
              currentEvent = "";
            }
          }
        }
        reject(new Error("SSE 流意外结束"));
      } catch (e) {
        reject(e);
      }
    })();
  });
}

async function httpGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function httpPut(path: string, body: unknown): Promise<void> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await resp.text());
}

// ── 文件管理 ──

export async function selectAudioFile(): Promise<AudioFile | null> {
  if (!IS_TAURI) return null;
  return invoke<AudioFile | null>("select_audio_file");
}

export async function importAudioFolder(): Promise<AudioFile[]> {
  if (!IS_TAURI) return [];
  return invoke<AudioFile[]>("import_audio_folder");
}

export async function listAudioFiles(): Promise<AudioFile[]> {
  if (IS_TAURI) return invoke<AudioFile[]>("list_audio_files");
  return httpGet<AudioFile[]>("/api/files");
}

export async function deleteAudioFile(id: string): Promise<void> {
  return invoke<void>("delete_audio_file", { id });
}

export async function importAudioFiles(paths: string[]): Promise<AudioFile[]> {
  if (!IS_TAURI) return [];
  return invoke<AudioFile[]>("import_audio_files", { paths });
}

export async function toggleStar(id: string): Promise<boolean> {
  if (IS_TAURI) return invoke<boolean>("toggle_star", { id });
  return httpPost<boolean>(`/api/files/${id}/star`);
}

export async function setFileTags(
  id: string,
  tags: string[],
): Promise<void> {
  if (IS_TAURI) return invoke<void>("set_file_tags", { id, tags });
  return httpPut(`/api/files/${id}/tags`, { tags });
}

export async function listAllTags(): Promise<string[]> {
  if (IS_TAURI) return invoke<string[]>("list_all_tags");
  return httpGet<string[]>("/api/tags");
}

export async function relocateFolder(
  oldFolder: string,
): Promise<RelocateResult | null> {
  if (!IS_TAURI) return null;
  return invoke<RelocateResult | null>("relocate_folder", { oldFolder });
}

export async function relocateFile(
  id: string,
): Promise<AudioFile | null> {
  if (!IS_TAURI) return null;
  return invoke<AudioFile | null>("relocate_file", { id });
}

// ── 转录 ──

export async function transcribeAudio(
  request: TranscriptionRequest,
): Promise<TranscriptionResult> {
  if (IS_TAURI) return invoke<TranscriptionResult>("transcribe_audio", { request });

  const resp = await fetch(`${API_BASE}/api/files/${request.audioFileId}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelName: request.modelName,
      language: request.language,
      backend: request.backend,
      enableVad: request.enableVad,
      enablePunctuation: request.enablePunctuation,
      initialPrompt: request.initialPrompt,
      downloadProxy: request.downloadProxy,
    }),
  });

  if (!resp.ok) throw new Error(await resp.text());
  return readSSEResponse<TranscriptionResult>(resp, {});
}

export async function ensureModel(
  modelName: string,
  proxy?: string,
): Promise<string> {
  return invoke<string>("ensure_model", { modelName, proxy: proxy || null });
}

export async function abortTranscription(): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>("abort_transcription");
}

export async function getTranscriptionResults(
  audioFileId: string,
): Promise<TranscriptionResult[]> {
  if (IS_TAURI) {
    return invoke<TranscriptionResult[]>("get_transcription_results", {
      audioFileId,
    });
  }
  return httpGet<TranscriptionResult[]>(
    `/api/files/${audioFileId}/transcriptions`,
  );
}

export async function exportTranscription(
  request: ExportRequest,
): Promise<string | null> {
  if (!IS_TAURI) return null;
  return invoke<string | null>("export_transcription", { request });
}

// ── 事件监听 ──

type UnlistenFn = () => void;

export function listenTranscriptionProgress(
  cb: (progress: TranscriptionProgress) => void,
): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<TranscriptionProgress>(
      "transcription-progress",
      (event) => cb(event.payload),
    );
  }
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  eventBus.addEventListener("transcription-progress", handler);
  return Promise.resolve(() =>
    eventBus.removeEventListener("transcription-progress", handler),
  );
}

export function listenTranscriptionPartial(
  cb: (payload: TranscriptionPartial) => void,
): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<TranscriptionPartial>(
      "transcription-partial",
      (event) => cb(event.payload),
    );
  }
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  eventBus.addEventListener("transcription-partial", handler);
  return Promise.resolve(() =>
    eventBus.removeEventListener("transcription-partial", handler),
  );
}

export function listenModelDownloadProgress(
  cb: (payload: { modelName: string; progress: number }) => void,
): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<{ modelName: string; progress: number }>(
      "model-download-progress",
      (event) => cb(event.payload),
    );
  }
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  eventBus.addEventListener("model-download-progress", handler);
  return Promise.resolve(() =>
    eventBus.removeEventListener("model-download-progress", handler),
  );
}

export function listenWhisperLog(
  cb: (payload: { message: string }) => void,
): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<{ message: string }>("whisper-log", (event) =>
      cb(event.payload),
    );
  }
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  eventBus.addEventListener("whisper-log", handler);
  return Promise.resolve(() =>
    eventBus.removeEventListener("whisper-log", handler),
  );
}

export interface ImportFolderProgress {
  total: number;
  current: number;
  currentName: string;
}

export function listenImportFolderProgress(
  cb: (progress: ImportFolderProgress) => void,
): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<ImportFolderProgress>(
      "import-folder-progress",
      (event) => cb(event.payload),
    );
  }
  return Promise.resolve(() => {});
}

export const exportFormats: ExportFormat[] = ["txt", "srt", "json", "lrc"];

// ── 模型管理 ──

export async function listModels(): Promise<WhisperModel[]> {
  if (IS_TAURI) return invoke<WhisperModel[]>("list_models");
  return httpGet<WhisperModel[]>("/api/models");
}

export async function getModelsDir(): Promise<string> {
  return invoke<string>("get_models_dir");
}

export async function openModelsDir(): Promise<void> {
  return invoke<void>("open_models_dir");
}

export async function deleteModel(modelName: string): Promise<void> {
  return invoke<void>("delete_model", { modelName });
}

// ── 音频分析 ──

export async function getAudioPeaks(
  audioPath: string,
  numPeaks?: number,
  fileId?: string,
): Promise<WaveformData> {
  if (IS_TAURI) {
    return invoke<WaveformData>("get_audio_peaks", { audioPath, numPeaks });
  }
  return computePeaksInBrowser(fileId ?? audioPath, numPeaks ?? 8000);
}

/**
 * 浏览器模式：通过 Web Audio API 解码音频并计算峰值。
 * 返回格式与 Rust 端 get_audio_peaks 一致（[min, max] 对的扁平数组）。
 */
async function computePeaksInBrowser(
  fileId: string,
  numPeaks: number,
): Promise<WaveformData> {
  const url = `${API_BASE}/api/audio/${fileId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`获取音频失败: ${resp.status}`);

  const arrayBuffer = await resp.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  const channel = decoded.getChannelData(0);
  const samplesPerPeak = Math.max(1, Math.floor(channel.length / numPeaks));
  const actualPeaks = Math.min(numPeaks, Math.ceil(channel.length / samplesPerPeak));
  const peaks: number[] = new Array(actualPeaks * 2);

  for (let i = 0; i < actualPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channel.length);
    let min = Infinity;
    let max = -Infinity;
    for (let j = start; j < end; j++) {
      if (channel[j] < min) min = channel[j];
      if (channel[j] > max) max = channel[j];
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }

  audioCtx.close();
  return { peaks, duration: decoded.duration, numPeaks: actualPeaks };
}

export async function analyzeVad(
  audioPath: string,
  config: VadConfig,
): Promise<VadSegment[]> {
  if (!IS_TAURI) return [];
  return invoke<VadSegment[]>("analyze_vad", { audioPath, config });
}

export async function updateTranscriptionResult(
  request: UpdateTranscriptionRequest,
): Promise<void> {
  return invoke<void>("update_transcription_result", { request });
}

// ── 服务管理（仅桌面端） ──

export async function startApiServer(port: number): Promise<void> {
  return invoke<void>("start_api_server", { port });
}

export async function stopApiServer(): Promise<void> {
  return invoke<void>("stop_api_server");
}

export async function startWebServer(webPort: number, apiPort: number): Promise<void> {
  return invoke<void>("start_web_server", { webPort, apiPort });
}

export async function stopWebServer(): Promise<void> {
  return invoke<void>("stop_web_server");
}

export async function stopAllServers(): Promise<void> {
  return invoke<void>("stop_all_servers");
}

export async function getInferenceServerStatus(): Promise<ServerStatus> {
  return invoke<ServerStatus>("get_inference_server_status");
}

export async function testRemoteConnection(
  url: string,
): Promise<{ status: string; gpu: boolean }> {
  const resp = await fetch(`${url.replace(/\/$/, "")}/api/health`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function checkCuda(): Promise<CudaInfo> {
  if (IS_TAURI) return invoke<CudaInfo>("check_cuda");
  return httpGet<CudaInfo>("/api/cuda");
}

export async function getDashboardStatus(): Promise<DashboardSnapshot> {
  return invoke<DashboardSnapshot>("get_dashboard_status");
}

export async function setServerConfig(config: ServerConfig): Promise<void> {
  return invoke<void>("set_server_config", { config });
}

// ── 浏览器模式：音频播放地址 ──

/**
 * 获取音频文件的播放 URL
 * - Tauri 模式：使用 asset 协议访问本地文件
 * - 浏览器模式：使用 HTTP API 流式传输
 */
export function getAudioUrl(fileId: string, filePath: string): string {
  if (IS_TAURI) {
    return convertFileSrc(filePath);
  }
  return `${API_BASE}/api/audio/${fileId}`;
}

// ── 桌面歌词（仅桌面端） ──

/** 切换桌面歌词窗口，返回切换后是否可见 */
export async function toggleDesktopLyrics(): Promise<boolean> {
  if (!IS_TAURI) return false;
  return invoke<boolean>("toggle_desktop_lyrics");
}

/** 设置歌词窗口鼠标穿透 */
export async function setLyricsClickThrough(enabled: boolean): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>("set_lyrics_click_through", { enabled });
}

/** 保存歌词窗口位置 */
export async function saveLyricsWindowPosition(x: number, y: number): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>("save_lyrics_window_position", { x, y });
}

/** 设置歌词窗口毛玻璃背景效果 */
export async function setLyricsBackdrop(
  effect: string,
  color?: [number, number, number, number],
): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>("set_lyrics_backdrop", { effect, color });
}

/** 导入 LRC 歌词文件并关联到音频，返回新建的转录结果 ID */
export async function importLrc(audioFileId: string, lrcPath: string): Promise<string> {
  return invoke<string>("import_lrc", { audioFileId, lrcPath });
}
