import { create } from "zustand";
import type { AudioFile, TranscriptionStatus } from "@/lib/types";

export type SortField = "name" | "duration" | "size" | "createdAt";
export type SortOrder = "asc" | "desc";
export type StatusFilter = TranscriptionStatus | "all";
export type ViewMode = "list" | "grid";

interface AudioState {
  files: AudioFile[];
  selectedFileId: string | null;

  // 多选
  selectedFileIds: Set<string>;
  lastClickedId: string | null;

  // 筛选 / 排序
  searchQuery: string;
  sortField: SortField;
  sortOrder: SortOrder;
  statusFilter: StatusFilter;
  expandedFolders: Set<string>;
  tagFilter: string | null;
  starFilter: boolean;

  // 视图
  viewMode: ViewMode;

  // 全局标签列表（从后端加载）
  allTags: string[];

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

  // 多选操作
  toggleSelect: (id: string) => void;
  selectRange: (id: string, visibleIds: string[]) => void;
  selectAllFiltered: (ids: string[]) => void;
  clearSelection: () => void;

  // 视图 / 标签 / 收藏
  setViewMode: (mode: ViewMode) => void;
  setTagFilter: (tag: string | null) => void;
  setStarFilter: (on: boolean) => void;
  setAllTags: (tags: string[]) => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  files: [],
  selectedFileId: null,
  selectedFileIds: new Set<string>(),
  lastClickedId: null,

  searchQuery: "",
  sortField: "createdAt",
  sortOrder: "desc",
  statusFilter: "all",
  expandedFolders: new Set<string>(),
  tagFilter: null,
  starFilter: false,

  viewMode: "list",
  allTags: [],

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
    set((state) => {
      const nextSel = new Set(state.selectedFileIds);
      nextSel.delete(id);
      return {
        files: state.files.filter((f) => f.id !== id),
        selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
        selectedFileIds: nextSel,
      };
    }),

  selectFile: (id) => set({ selectedFileId: id, lastClickedId: id }),

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

  // 多选
  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedFileIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedFileIds: next, lastClickedId: id };
    }),

  selectRange: (id, visibleIds) =>
    set((state) => {
      const anchor = state.lastClickedId;
      if (!anchor) return { selectedFileIds: new Set([id]), lastClickedId: id };
      const startIdx = visibleIds.indexOf(anchor);
      const endIdx = visibleIds.indexOf(id);
      if (startIdx === -1 || endIdx === -1) return { selectedFileIds: new Set([id]), lastClickedId: id };
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const range = visibleIds.slice(lo, hi + 1);
      const next = new Set(state.selectedFileIds);
      for (const fid of range) next.add(fid);
      return { selectedFileIds: next, lastClickedId: id };
    }),

  selectAllFiltered: (ids) =>
    set({ selectedFileIds: new Set(ids) }),

  clearSelection: () =>
    set({ selectedFileIds: new Set<string>() }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setStarFilter: (on) => set({ starFilter: on }),
  setAllTags: (tags) => set({ allTags: tags }),
}));
