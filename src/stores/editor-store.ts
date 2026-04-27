import { create } from "zustand";
import type { TranscriptionResult, TranscriptionSegment } from "@/lib/types";

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
  splitSegment: (index: number, atTime: number) => void;
  mergeSegments: (fromIndex: number, toIndex: number) => void;
  markSaved: () => void;
  reset: () => void;
}

function segmentsEqual(
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

  loadResult: (result, filePath, fileName) =>
    set({
      resultId: result.id,
      audioFileId: result.audioFileId,
      audioFilePath: filePath,
      audioFileName: fileName,
      segments: result.segments.map((s) => ({ ...s })),
      originalSegments: result.segments.map((s) => ({ ...s })),
      language: result.language,
      duration: result.duration,
      isDirty: false,
    }),

  updateSegmentText: (index, text) => {
    const segments = get().segments.map((s, i) =>
      i === index ? { ...s, text } : s,
    );
    set({ segments, isDirty: segmentsEqual(segments, get().originalSegments) });
  },

  updateSegmentTime: (index, field, value) => {
    const segments = get().segments.map((s, i) =>
      i === index ? { ...s, [field]: value } : s,
    );
    set({ segments, isDirty: segmentsEqual(segments, get().originalSegments) });
  },

  addSegment: (afterIndex) => {
    const { segments } = get();
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
    set({ segments: updated, isDirty: true });
  },

  removeSegment: (index) => {
    const segments = get().segments.filter((_, i) => i !== index);
    set({
      segments,
      isDirty: segmentsEqual(segments, get().originalSegments),
    });
  },

  splitSegment: (index, atTime) => {
    const { segments } = get();
    const seg = segments[index];
    if (!seg || atTime <= seg.start || atTime >= seg.end) return;
    const first: TranscriptionSegment = {
      start: seg.start,
      end: atTime,
      text: seg.text,
    };
    const second: TranscriptionSegment = { start: atTime, end: seg.end, text: "" };
    const updated = [
      ...segments.slice(0, index),
      first,
      second,
      ...segments.slice(index + 1),
    ];
    set({ segments: updated, isDirty: true });
  },

  mergeSegments: (fromIndex, toIndex) => {
    const { segments } = get();
    if (fromIndex < 0 || toIndex >= segments.length || fromIndex >= toIndex)
      return;
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
    set({ segments: updated, isDirty: true });
  },

  markSaved: () =>
    set((state) => ({
      originalSegments: state.segments.map((s) => ({ ...s })),
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
    }),
}));
