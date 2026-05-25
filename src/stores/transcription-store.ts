import { create } from "zustand";
import type {
  TranscriptionPartial,
  TranscriptionResult,
  TranscriptionProgress,
  WhisperLog,
} from "@/lib/types";

const MAX_LOGS = 500;

interface TranscriptionState {
  results: Map<string, TranscriptionResult[]>;
  liveSegmentsByFile: Map<string, TranscriptionPartial["segments"]>;
  activeTask: TranscriptionProgress | null;
  modelDownload: { modelName: string; progress: number } | null;
  logs: WhisperLog[];

  // 批量转录队列
  queue: string[];
  queueRunning: boolean;
  queueIndex: number;

  addResult: (audioFileId: string, result: TranscriptionResult) => void;
  setResults: (audioFileId: string, results: TranscriptionResult[]) => void;
  appendLiveSegments: (audioFileId: string, segments: TranscriptionPartial["segments"]) => void;
  clearLiveSegments: (audioFileId: string) => void;
  setActiveTask: (task: TranscriptionProgress | null) => void;
  setModelDownload: (
    value: { modelName: string; progress: number } | null,
  ) => void;
  addLog: (message: string) => void;
  clearLogs: () => void;

  enqueueFiles: (ids: string[]) => void;
  dequeueFile: (id: string) => void;
  advanceQueue: () => void;
  clearQueue: () => void;
  setQueueRunning: (running: boolean) => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  results: new Map(),
  liveSegmentsByFile: new Map(),
  activeTask: null,
  modelDownload: null,
  logs: [],
  queue: [],
  queueRunning: false,
  queueIndex: 0,

  addResult: (audioFileId, result) =>
    set((state) => {
      const next = new Map(state.results);
      const existing = next.get(audioFileId) ?? [];
      const liveSegmentsByFile = new Map(state.liveSegmentsByFile);
      liveSegmentsByFile.delete(audioFileId);
      next.set(audioFileId, [result, ...existing]);
      return { results: next, liveSegmentsByFile };
    }),

  setResults: (audioFileId, results) =>
    set((state) => {
      const next = new Map(state.results);
      const liveSegmentsByFile = new Map(state.liveSegmentsByFile);
      liveSegmentsByFile.delete(audioFileId);
      next.set(audioFileId, results);
      return { results: next, liveSegmentsByFile };
    }),

  appendLiveSegments: (audioFileId, segments) =>
    set((state) => {
      if (segments.length === 0) return state;
      const next = new Map(state.liveSegmentsByFile);
      const existing = next.get(audioFileId) ?? [];
      next.set(audioFileId, [...existing, ...segments]);
      return { liveSegmentsByFile: next };
    }),

  clearLiveSegments: (audioFileId) =>
    set((state) => {
      const next = new Map(state.liveSegmentsByFile);
      next.delete(audioFileId);
      return { liveSegmentsByFile: next };
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

  enqueueFiles: (ids) =>
    set((state) => {
      const existing = new Set(state.queue);
      const toAdd = ids.filter((id) => !existing.has(id));
      return { queue: [...state.queue, ...toAdd] };
    }),

  dequeueFile: (id) =>
    set((state) => ({
      queue: state.queue.filter((qid) => qid !== id),
    })),

  advanceQueue: () =>
    set((state) => ({ queueIndex: state.queueIndex + 1 })),

  clearQueue: () =>
    set({ queue: [], queueIndex: 0, queueRunning: false }),

  setQueueRunning: (running) =>
    set(running ? { queueRunning: true, queueIndex: 0 } : { queueRunning: false }),
}));
