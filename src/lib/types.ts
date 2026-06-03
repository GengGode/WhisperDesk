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
  starred: boolean;
  tags: string[];
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
  /** 本次转录使用的推理参数快照（JSON 字符串），历史数据可能缺失 */
  paramsJson?: string;
}

/** 转录分段（带时间戳） */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

/** 转录后端标识 */
export type TranscriptionBackend = "whisper" | "sherpa-onnx";

/** 模型信息（支持多后端） */
export interface WhisperModel {
  name: string;
  /** 文件大小（字节） */
  size: number;
  downloaded: boolean;
  path: string;
  /** 所属后端/类型标识 */
  backend: TranscriptionBackend | "punctuation";
  /** sherpa-onnx 模型架构类型 */
  modelType?: string;
  /** 参考字错误率 */
  cer?: string;
}

/** 转录任务进度 */
export interface TranscriptionProgress {
  audioFileId: string;
  progress: number;
  currentSegment?: string;
  /** 当前阶段 */
  phase?: "local" | "remote_connecting" | "remote_uploading" | "remote_transcribing" | "complete";
}

/** 转录过程中的实时新增分段 */
export interface TranscriptionPartial {
  audioFileId: string;
  segments: TranscriptionSegment[];
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
  /** 转录后端，不传时根据 modelName 自动推断 */
  backend?: TranscriptionBackend;

  // Whisper 推理参数
  bestOf?: number;
  suppressBlank?: boolean;
  suppressNst?: boolean;
  noContext?: boolean;
  entropyThold?: number;
  logprobThold?: number;
  noSpeechThold?: number;
  temperature?: number;
  temperatureInc?: number;
  maxInitialTs?: number;
  maxRepeatFilter?: number;

  // 区间转录
  startSeconds?: number;
  endSeconds?: number;

  // VAD 预分割
  enableVad?: boolean;
  vadConfig?: VadConfig;

  // Prompt 引导
  initialPrompt?: string;

  // 标点恢复
  /** 启用标点恢复后处理（对无标点的 ASR 输出自动补充标点） */
  enablePunctuation?: boolean;

  /** 模型下载代理（http/https/socks5） */
  downloadProxy?: string;
}

// ── VAD 相关类型 ──

/** VAD 算法参数 */
export interface VadConfig {
  energyThresholdDb: number;
  minSilenceMs: number;
  minSpeechMs: number;
  paddingMs: number;
}

/** VAD 分割结果段 */
export interface VadSegment {
  startSeconds: number;
  endSeconds: number;
  isVoice: boolean;
}

/** VAD 默认参数 */
export const defaultVadConfig: VadConfig = {
  energyThresholdDb: -40,
  minSilenceMs: 300,
  minSpeechMs: 250,
  paddingMs: 100,
};

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

// ── 路径配准（重新定位） ──

/** 缺失文件信息 */
export interface MissingFileInfo {
  id: string;
  name: string;
  path: string;
}

/** 单条配准匹配结果 */
export interface RelocateMatch {
  id: string;
  name: string;
  oldPath: string;
  newPath: string;
}

/** 路径配准整体结果 */
export interface RelocateResult {
  matched: RelocateMatch[];
  unmatched: MissingFileInfo[];
}

/** 波形峰值数据 */
export interface WaveformData {
  peaks: number[];
  duration: number;
  numPeaks: number;
}

export type ThemeMode = "light" | "dark" | "system";

export interface AppSettings {
  theme: ThemeMode;
  /** 当前选用的转录后端 */
  backend: TranscriptionBackend;
  modelName: string;
  language: string;
  threads: number;
  useGpu: boolean;
  /** 远程推理服务器地址，留空表示使用本机推理 */
  remoteUrl: string;
  /** 启动后自动开启后台 API 推理服务（供其他设备调用） */
  apiAutoStart: boolean;
  /** 启动后自动开启 Web 前端服务（浏览器远程访问） */
  webAutoStart: boolean;
  /** 推理服务监听端口（后台 API） */
  inferenceServerPort: number;
  /** Web 前端服务端口 */
  webPort: number;
  /** 静默启动：启动时最小化到系统托盘 */
  silentStart: boolean;

  // Whisper 推理参数
  bestOf: number;
  suppressBlank: boolean;
  suppressNst: boolean;
  noContext: boolean;
  entropyThold: number;
  logprobThold: number;
  noSpeechThold: number;
  temperature: number;
  temperatureInc: number;
  maxInitialTs: number;
  maxRepeatFilter: number;

  // VAD 预分割
  enableVad: boolean;
  vadConfig: VadConfig;

  // Prompt 引导
  initialPrompt: string;

  // 标点恢复
  /** 启用标点恢复后处理 */
  enablePunctuation: boolean;

  /** 模型下载代理地址，留空则不使用代理（支持 http/https/socks5） */
  downloadProxy: string;
}

/** 推理服务运行状态 */
export interface ServerStatus {
  running: boolean;
  port: number;
  webRunning: boolean;
  webPort: number;
}


/** CUDA 运行时检测结果 */
export interface CudaInfo {
  available: boolean;
  message: string;
  /** sherpa-onnx GPU provider 状态描述 */
  sherpaGpu?: string;
  /** sherpa-onnx 后端 DLL 是否在运行时可加载 */
  sherpaAvailable: boolean;
  /** sherpa-onnx 不可用时的原因描述 */
  sherpaMessage?: string;
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
  bestOf: number;
  suppressBlank: boolean;
  suppressNst: boolean;
  noContext: boolean;
  entropyThold: number;
  logprobThold: number;
  noSpeechThold: number;
  temperature: number;
  temperatureInc: number;
  maxInitialTs: number;
  maxRepeatFilter: number;
  enableVad: boolean;
  initialPrompt: string;
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
