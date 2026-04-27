/** 音频文件元数据 */
export interface AudioFile {
  id: string;
  name: string;
  path: string;
  format: string;
  duration: number;
  sampleRate: number;
  channels: number;
  size: number;
  createdAt: string;
  transcriptionStatus: TranscriptionStatus;
}

export type TranscriptionStatus =
  | "pending"
  | "transcribing"
  | "completed"
  | "failed";

/** 转录结果 */
export interface TranscriptionResult {
  /** 结果唯一标识，每次转录生成一个 */
  id: string;
  audioFileId: string;
  /** 使用的模型名称 */
  modelName: string;
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  createdAt: string;
}

/** 转录分段（带时间戳） */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

/** Whisper 模型信息 */
export interface WhisperModel {
  name: string;
  /** 文件大小（字节） */
  size: number;
  downloaded: boolean;
  path: string;
}

/** 转录任务进度 */
export interface TranscriptionProgress {
  audioFileId: string;
  progress: number;
  currentSegment?: string;
  /** 当前阶段 */
  phase?: "local" | "remote_connecting" | "remote_uploading" | "remote_transcribing" | "complete";
}

/** Whisper 引擎日志条目 */
export interface WhisperLog {
  message: string;
  timestamp: number;
}

export interface TranscriptionRequest {
  audioFileId: string;
  audioPath: string;
  modelName: string;
  language?: string;
  threads?: number;
  useGpu?: boolean;
  remoteUrl?: string;
}

export type ExportFormat = "txt" | "srt" | "json" | "lrc";

export interface ExportRequest {
  resultId: string;
  format: ExportFormat;
}

/** 更新转录结果请求（通过 result id 定位） */
export interface UpdateTranscriptionRequest {
  id: string;
  text: string;
  segments: TranscriptionSegment[];
}

/** 波形峰值数据 */
export interface WaveformData {
  peaks: number[];
  duration: number;
  numPeaks: number;
}

export interface AppSettings {
  modelName: string;
  language: string;
  threads: number;
  useGpu: boolean;
  /** 远程推理服务器地址，留空表示使用本机推理 */
  remoteUrl: string;
  /** 是否开启本机推理服务（供其他设备调用） */
  inferenceServerEnabled: boolean;
  /** 推理服务监听端口 */
  inferenceServerPort: number;
}

/** 推理服务运行状态 */
export interface ServerStatus {
  running: boolean;
  port: number;
}

/** CUDA 运行时检测结果 */
export interface CudaInfo {
  available: boolean;
  message: string;
}

/** Dashboard 任务信息 */
export interface DashboardTaskInfo {
  id: string;
  clientIp: string;
  fileSize: number;
  modelName: string;
  status: "receiving" | "transcribing" | "completed" | "failed";
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  resultSummary?: string;
}

/** 服务端转录配置 */
export interface ServerConfig {
  modelName: string;
  threads: number;
  useGpu: boolean;
}

/** Dashboard 快照 */
export interface DashboardSnapshot {
  uptimeSeconds: number;
  gpu: boolean;
  gpuMessage: string;
  serverConfig: ServerConfig;
  activeTasks: DashboardTaskInfo[];
  completedTasks: DashboardTaskInfo[];
}
