import { create } from "zustand";
import type { TranscriptionResult, TranscriptionSegment } from "@/lib/types";

const MAX_HISTORY = 50;

interface EditorState {
  /** 当前编辑的转录结果 id */
  resultId: string | null;
  audioFileId: string | null;
  audioFilePath: string | null;
  audioFileName: string | null;
  segments: TranscriptionSegment[];
  originalSegments: TranscriptionSegment[];
  language: string;
  duration: number;
  isDirty: boolean;

  /** 撤销/重做历史栈 */
  history: TranscriptionSegment[][];
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;

  loadResult: (
    result: TranscriptionResult,
    filePath: string,
    fileName: string,
  ) => void;
  updateSegmentText: (index: number, text: string) => void;
  updateSegmentTime: (
    index: number,
    field: "start" | "end",
    value: number,
  ) => void;
  addSegment: (afterIndex: number) => void;
  removeSegment: (index: number) => void;
  splitSegment: (index: number, atTime: number, textSplitPos?: number) => void;
  mergeSegments: (fromIndex: number, toIndex: number) => void;
  /** 平移段落（同时移动 start 和 end，保持时长不变） */
  moveSegment: (index: number, deltaSeconds: number) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  reset: () => void;
}

/** 检测两个 segments 数组是否存在差异（用于判断 isDirty） */
function hasSegmentChanges(
  a: TranscriptionSegment[],
  b: TranscriptionSegment[],
): boolean {
  if (a.length !== b.length) return true;
  return a.some(
    (seg, i) =>
      seg.text !== b[i].text ||
      seg.start !== b[i].start ||
      seg.end !== b[i].end,
  );
}

function cloneSegments(segs: TranscriptionSegment[]): TranscriptionSegment[] {
  return segs.map((s) => ({ ...s }));
}

/**
 * 将当前 segments 压入历史栈，截断 historyIndex 之后的未来记录。
 * 返回新的 history 和 historyIndex 供 set() 使用。
 */
function pushHistory(state: EditorState) {
  const truncated = state.history.slice(0, state.historyIndex + 1);
  truncated.push(cloneSegments(state.segments));
  // 超出上限时丢弃最早的记录
  if (truncated.length > MAX_HISTORY) truncated.shift();
  const newIndex = truncated.length - 1;
  return {
    history: truncated,
    historyIndex: newIndex,
    canUndo: newIndex > 0,
    canRedo: false,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  resultId: null,
  audioFileId: null,
  audioFilePath: null,
  audioFileName: null,
  segments: [],
  originalSegments: [],
  language: "",
  duration: 0,
  isDirty: false,
  history: [],
  historyIndex: -1,
  canUndo: false,
  canRedo: false,

  loadResult: (result, filePath, fileName) => {
    const segs = cloneSegments(result.segments);
    set({
      resultId: result.id,
      audioFileId: result.audioFileId,
      audioFilePath: filePath,
      audioFileName: fileName,
      segments: segs,
      originalSegments: cloneSegments(result.segments),
      language: result.language,
      duration: result.duration,
      isDirty: false,
      history: [cloneSegments(segs)],
      historyIndex: 0,
      canUndo: false,
      canRedo: false,
    });
  },

  updateSegmentText: (index, text) => {
    const state = get();
    const hist = pushHistory(state);
    const segments = state.segments.map((s, i) =>
      i === index ? { ...s, text } : s,
    );
    set({ segments, isDirty: hasSegmentChanges(segments, state.originalSegments), ...hist });
  },

  updateSegmentTime: (index, field, value) => {
    const state = get();
    const hist = pushHistory(state);
    const segments = state.segments.map((s, i) =>
      i === index ? { ...s, [field]: value } : s,
    );
    set({ segments, isDirty: hasSegmentChanges(segments, state.originalSegments), ...hist });
  },

  addSegment: (afterIndex) => {
    const state = get();
    const hist = pushHistory(state);
    const { segments } = state;
    const prev = segments[afterIndex];
    const next = segments[afterIndex + 1];
    const start = prev ? prev.end : 0;
    const end = next ? next.start : start + 1;
    const newSeg: TranscriptionSegment = { start, end, text: "" };
    const updated = [
      ...segments.slice(0, afterIndex + 1),
      newSeg,
      ...segments.slice(afterIndex + 1),
    ];
    set({ segments: updated, isDirty: true, ...hist });
  },

  removeSegment: (index) => {
    const state = get();
    const hist = pushHistory(state);
    const segments = state.segments.filter((_, i) => i !== index);
    set({
      segments,
      isDirty: hasSegmentChanges(segments, state.originalSegments),
      ...hist,
    });
  },

  splitSegment: (index, atTime, textSplitPos) => {
    const state = get();
    const seg = state.segments[index];
    if (!seg || atTime <= seg.start || atTime >= seg.end) return;
    const hist = pushHistory(state);

    let firstText = seg.text;
    let secondText = "";
    if (textSplitPos != null && textSplitPos >= 0 && textSplitPos <= seg.text.length) {
      firstText = seg.text.slice(0, textSplitPos);
      secondText = seg.text.slice(textSplitPos);
    }

    const first: TranscriptionSegment = {
      start: seg.start,
      end: atTime,
      text: firstText,
    };
    const second: TranscriptionSegment = {
      start: atTime,
      end: seg.end,
      text: secondText,
    };
    const updated = [
      ...state.segments.slice(0, index),
      first,
      second,
      ...state.segments.slice(index + 1),
    ];
    set({ segments: updated, isDirty: true, ...hist });
  },

  mergeSegments: (fromIndex, toIndex) => {
    const state = get();
    const { segments } = state;
    if (fromIndex < 0 || toIndex >= segments.length || fromIndex >= toIndex)
      return;
    const hist = pushHistory(state);
    const merged: TranscriptionSegment = {
      start: segments[fromIndex].start,
      end: segments[toIndex].end,
      text: segments
        .slice(fromIndex, toIndex + 1)
        .map((s) => s.text)
        .join(""),
    };
    const updated = [
      ...segments.slice(0, fromIndex),
      merged,
      ...segments.slice(toIndex + 1),
    ];
    set({ segments: updated, isDirty: true, ...hist });
  },

  moveSegment: (index, deltaSeconds) => {
    const state = get();
    const seg = state.segments[index];
    if (!seg) return;
    const segDuration = seg.end - seg.start;
    let newStart = seg.start + deltaSeconds;
    let newEnd = seg.end + deltaSeconds;
    // 约束不超出 [0, duration]
    if (newStart < 0) {
      newStart = 0;
      newEnd = segDuration;
    }
    if (newEnd > state.duration) {
      newEnd = state.duration;
      newStart = state.duration - segDuration;
    }
    if (newStart === seg.start && newEnd === seg.end) return;
    const hist = pushHistory(state);
    const segments = state.segments.map((s, i) =>
      i === index ? { ...s, start: newStart, end: newEnd } : s,
    );
    set({ segments, isDirty: true, ...hist });
  },

  undo: () => {
    const { history, historyIndex, originalSegments } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const segments = cloneSegments(history[newIndex]);
    set({
      segments,
      historyIndex: newIndex,
      isDirty: hasSegmentChanges(segments, originalSegments),
      canUndo: newIndex > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { history, historyIndex, originalSegments } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const segments = cloneSegments(history[newIndex]);
    set({
      segments,
      historyIndex: newIndex,
      isDirty: hasSegmentChanges(segments, originalSegments),
      canUndo: true,
      canRedo: newIndex < history.length - 1,
    });
  },

  markSaved: () =>
    set((state) => ({
      originalSegments: cloneSegments(state.segments),
      isDirty: false,
    })),

  reset: () =>
    set({
      resultId: null,
      audioFileId: null,
      audioFilePath: null,
      audioFileName: null,
      segments: [],
      originalSegments: [],
      language: "",
      duration: 0,
      isDirty: false,
      history: [],
      historyIndex: -1,
      canUndo: false,
      canRedo: false,
    }),
}));
