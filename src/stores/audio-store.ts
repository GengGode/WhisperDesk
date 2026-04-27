import { create } from "zustand";
import type { AudioFile } from "@/lib/types";

interface AudioState {
  files: AudioFile[];
  selectedFileId: string | null;
  setFiles: (files: AudioFile[]) => void;
  addFile: (file: AudioFile) => void;
  mergeFiles: (files: AudioFile[]) => void;
  removeFile: (id: string) => void;
  selectFile: (id: string | null) => void;
  updateFile: (id: string, updates: Partial<AudioFile>) => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  files: [],
  selectedFileId: null,

  setFiles: (files) => set({ files }),

  addFile: (file) => set((state) => ({ files: [...state.files, file] })),

  mergeFiles: (files) =>
    set((state) => {
      const map = new Map(state.files.map((f) => [f.path, f]));
      for (const file of files) {
        map.set(file.path, file);
      }
      return { files: Array.from(map.values()) };
    }),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
    })),

  selectFile: (id) => set({ selectedFileId: id }),

  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),
}));
