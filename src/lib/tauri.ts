import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AudioFile,
  CudaInfo,
  DashboardSnapshot,
  ExportFormat,
  ExportRequest,
  ServerConfig,
  ServerStatus,
  TranscriptionProgress,
  TranscriptionRequest,
  TranscriptionResult,
  UpdateTranscriptionRequest,
  WaveformData,
  WhisperModel,
} from "@/lib/types";


/**
 * 与 Tauri 后端通信的统一封装层
 * 所有前端组件通过此模块调用后端命令，不直接使用 invoke
 */

export async function selectAudioFile(): Promise<AudioFile | null> {
  return invoke<AudioFile | null>("select_audio_file");
}

export async function importAudioFolder(): Promise<AudioFile[]> {
  return invoke<AudioFile[]>("import_audio_folder");
}

export async function listAudioFiles(): Promise<AudioFile[]> {
  return invoke<AudioFile[]>("list_audio_files");
}

export async function deleteAudioFile(id: string): Promise<void> {
  return invoke<void>("delete_audio_file", { id });
}

export async function importAudioFiles(paths: string[]): Promise<AudioFile[]> {
  return invoke<AudioFile[]>("import_audio_files", { paths });
}

export async function toggleStar(id: string): Promise<boolean> {
  return invoke<boolean>("toggle_star", { id });
}

export async function setFileTags(id: string, tags: string[]): Promise<void> {
  return invoke<void>("set_file_tags", { id, tags });
}

export async function listAllTags(): Promise<string[]> {
  return invoke<string[]>("list_all_tags");
}

export async function transcribeAudio(
  request: TranscriptionRequest,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", { request });
}

export async function ensureModel(modelName: string): Promise<string> {
  return invoke<string>("ensure_model", { modelName });
}

export async function abortTranscription(): Promise<void> {
  return invoke<void>("abort_transcription");
}

export async function getTranscriptionResults(
  audioFileId: string,
): Promise<TranscriptionResult[]> {
  return invoke<TranscriptionResult[]>("get_transcription_results", {
    audioFileId,
  });
}

export async function exportTranscription(
  request: ExportRequest,
): Promise<string | null> {
  return invoke<string | null>("export_transcription", { request });
}

export function listenTranscriptionProgress(
  cb: (progress: TranscriptionProgress) => void,
) {
  return listen<TranscriptionProgress>("transcription-progress", (event) => {
    cb(event.payload);
  });
}

export function listenModelDownloadProgress(
  cb: (payload: { modelName: string; progress: number }) => void,
) {
  return listen<{ modelName: string; progress: number }>(
    "model-download-progress",
    (event) => cb(event.payload),
  );
}

export function listenWhisperLog(
  cb: (payload: { message: string }) => void,
) {
  return listen<{ message: string }>("whisper-log", (event) => {
    cb(event.payload);
  });
}

export interface ImportFolderProgress {
  total: number;
  current: number;
  currentName: string;
}

export function listenImportFolderProgress(
  cb: (progress: ImportFolderProgress) => void,
) {
  return listen<ImportFolderProgress>("import-folder-progress", (event) => {
    cb(event.payload);
  });
}

export const exportFormats: ExportFormat[] = ["txt", "srt", "json", "lrc"];

export async function listModels(): Promise<WhisperModel[]> {
  return invoke<WhisperModel[]>("list_models");
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

export async function getAudioPeaks(
  audioPath: string,
  numPeaks?: number,
): Promise<WaveformData> {
  return invoke<WaveformData>("get_audio_peaks", { audioPath, numPeaks });
}

export async function updateTranscriptionResult(
  request: UpdateTranscriptionRequest,
): Promise<void> {
  return invoke<void>("update_transcription_result", { request });
}

export async function startInferenceServer(port: number): Promise<void> {
  return invoke<void>("start_inference_server", { port });
}

export async function stopInferenceServer(): Promise<void> {
  return invoke<void>("stop_inference_server");
}

export async function getInferenceServerStatus(): Promise<ServerStatus> {
  return invoke<ServerStatus>("get_inference_server_status");
}

/** 测试远程推理服务器连接 */
export async function testRemoteConnection(
  url: string,
): Promise<{ status: string; gpu: boolean }> {
  const resp = await fetch(`${url.replace(/\/$/, "")}/api/health`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** 检测本机 CUDA 是否可用 */
export async function checkCuda(): Promise<CudaInfo> {
  return invoke<CudaInfo>("check_cuda");
}

/** 获取推理服务 Dashboard 快照 */
export async function getDashboardStatus(): Promise<DashboardSnapshot> {
  return invoke<DashboardSnapshot>("get_dashboard_status");
}

/** 同步客户端转录配置到服务端内存 */
export async function setServerConfig(config: ServerConfig): Promise<void> {
  return invoke<void>("set_server_config", { config });
}
