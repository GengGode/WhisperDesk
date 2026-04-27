import { create } from "zustand";
import type {
  TranscriptionResult,
  TranscriptionProgress,
  WhisperLog,
} from "@/lib/types";

const MAX_LOGS = 500;

interface TranscriptionState {
  /** key = audioFileId，值为该文件的全部转录结果（按时间倒序） */
  results: Map<string, TranscriptionResult[]>;
  activeTask: TranscriptionProgress | null;
  modelDownload: { modelName: string; progress: number } | null;
  logs: WhisperLog[];
  /** 追加一条转录结果（最新的插到数组头部） */
  addResult: (audioFileId: string, result: TranscriptionResult) => void;
  /** 批量设置某文件的所有结果（从数据库加载时用） */
  setResults: (audioFileId: string, results: TranscriptionResult[]) => void;
  setActiveTask: (task: TranscriptionProgress | null) => void;
  setModelDownload: (
    value: { modelName: string; progress: number } | null,
  ) => void;
  addLog: (message: string) => void;
  clearLogs: () => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  results: new Map(),
  activeTask: null,
  modelDownload: null,
  logs: [],

  addResult: (audioFileId, result) =>
    set((state) => {
      const next = new Map(state.results);
      const existing = next.get(audioFileId) ?? [];
      next.set(audioFileId, [result, ...existing]);
      return { results: next };
    }),

  setResults: (audioFileId, results) =>
    set((state) => {
      const next = new Map(state.results);
      next.set(audioFileId, results);
      return { results: next };
    }),

  setActiveTask: (task) => set({ activeTask: task }),
  setModelDownload: (value) => set({ modelDownload: value }),

  addLog: (message) =>
    set((state) => {
      const entry: WhisperLog = { message, timestamp: Date.now() };
      const next = [...state.logs, entry];
      return { logs: next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next };
    }),
  clearLogs: () => set({ logs: [] }),
}));
