import { create } from "zustand";
import type { AudioFile, TranscriptionStatus } from "@/lib/types";

export type SortField = "name" | "duration" | "size" | "createdAt";
export type SortOrder = "asc" | "desc";
export type StatusFilter = TranscriptionStatus | "all";

interface AudioState {
  files: AudioFile[];
  selectedFileId: string | null;

  searchQuery: string;
  sortField: SortField;
  sortOrder: SortOrder;
  statusFilter: StatusFilter;
  expandedFolders: Set<string>;

  setFiles: (files: AudioFile[]) => void;
  addFile: (file: AudioFile) => void;
  mergeFiles: (files: AudioFile[]) => void;
  removeFile: (id: string) => void;
  selectFile: (id: string | null) => void;
  updateFile: (id: string, updates: Partial<AudioFile>) => void;

  setSearchQuery: (query: string) => void;
  setSortField: (field: SortField) => void;
  toggleSortOrder: () => void;
  setStatusFilter: (status: StatusFilter) => void;
  toggleFolder: (folderPath: string) => void;
  expandAllFolders: (paths: string[]) => void;
  collapseAllFolders: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  files: [],
  selectedFileId: null,

  searchQuery: "",
  sortField: "createdAt",
  sortOrder: "desc",
  statusFilter: "all",
  expandedFolders: new Set<string>(),

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

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSortField: (field) =>
    set((state) => ({
      sortField: field,
      sortOrder: state.sortField === field
        ? (state.sortOrder === "asc" ? "desc" : "asc")
        : "asc",
    })),

  toggleSortOrder: () =>
    set((state) => ({
      sortOrder: state.sortOrder === "asc" ? "desc" : "asc",
    })),

  setStatusFilter: (status) => set({ statusFilter: status }),

  toggleFolder: (folderPath) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return { expandedFolders: next };
    }),

  expandAllFolders: (paths) =>
    set({ expandedFolders: new Set(paths) }),

  collapseAllFolders: () =>
    set({ expandedFolders: new Set<string>() }),
}));
