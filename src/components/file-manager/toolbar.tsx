import { useState, useRef, useEffect, useCallback } from "react";
import { useAudioStore, type SortField, type StatusFilter } from "@/stores/audio-store";
import {
  IS_TAURI,
  importAudioFolder,
  selectAudioFile,
  listenImportFolderProgress,
  type ImportFolderProgress,
} from "@/lib/tauri";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待转录" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "name", label: "名称" },
  { value: "duration", label: "时长" },
  { value: "size", label: "大小" },
  { value: "createdAt", label: "导入时间" },
];

export function Toolbar() {
  const searchQuery = useAudioStore((s) => s.searchQuery);
  const setSearchQuery = useAudioStore((s) => s.setSearchQuery);
  const sortField = useAudioStore((s) => s.sortField);
  const sortOrder = useAudioStore((s) => s.sortOrder);
  const setSortField = useAudioStore((s) => s.setSortField);
  const statusFilter = useAudioStore((s) => s.statusFilter);
  const setStatusFilter = useAudioStore((s) => s.setStatusFilter);
  const addFile = useAudioStore((s) => s.addFile);
  const mergeFiles = useAudioStore((s) => s.mergeFiles);
  const selectFile = useAudioStore((s) => s.selectFile);

  const tagFilter = useAudioStore((s) => s.tagFilter);
  const setTagFilter = useAudioStore((s) => s.setTagFilter);
  const starFilter = useAudioStore((s) => s.starFilter);
  const setStarFilter = useAudioStore((s) => s.setStarFilter);
  const viewMode = useAudioStore((s) => s.viewMode);
  const setViewMode = useAudioStore((s) => s.setViewMode);
  const allTags = useAudioStore((s) => s.allTags);

  const [sortOpen, setSortOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportFolderProgress | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
      if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleImportFolder = useCallback(async () => {
    setImportOpen(false);
    try {
      const unlisten = await listenImportFolderProgress((p) => setImportProgress(p));
      try {
        const imported = await importAudioFolder();
        if (imported.length > 0) {
          mergeFiles(imported);
          selectFile(imported[0].id);
        }
      } finally {
        unlisten();
        setImportProgress(null);
      }
    } catch (err) {
      console.error("[文件] 导入文件夹失败", err);
    }
  }, [mergeFiles, selectFile]);

  const handleImportFile = useCallback(async () => {
    setImportOpen(false);
    try {
      const file = await selectAudioFile();
      if (!file) return;
      addFile(file);
      selectFile(file.id);
    } catch (err) {
      console.error("[文件] 导入失败", err);
    }
  }, [addFile, selectFile]);

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
      {/* 第一行：搜索 + 导入 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-text-secondary focus:border-primary"
          />
        </div>

        {IS_TAURI && (
          <div ref={importRef} className="relative">
            <button
              onClick={() => setImportOpen((v) => !v)}
              disabled={importProgress !== null}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {importProgress ? `${importProgress.current}/${importProgress.total}` : "导入"}
            </button>
            {importOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                <button onClick={handleImportFile} className="flex w-full items-center px-3 py-2 text-sm hover:bg-surface-secondary">导入文件</button>
                <button onClick={handleImportFolder} className="flex w-full items-center px-3 py-2 text-sm hover:bg-surface-secondary">导入文件夹</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 第二行：状态筛选 + 标签筛选 + 收藏 + 视图切换 + 排序 */}
      <div className="flex items-center gap-2">
        {/* 状态筛选 */}
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                statusFilter === opt.value ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-surface-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* 标签筛选 */}
        <div ref={tagRef} className="relative">
          <button
            onClick={() => setTagOpen((v) => !v)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              tagFilter ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-surface-secondary"
            }`}
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
            </svg>
            {tagFilter ?? "标签"}
          </button>
          {tagOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-36 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
              <button
                onClick={() => { setTagFilter(null); setTagOpen(false); }}
                className={`flex w-full items-center px-3 py-2 text-xs transition-colors ${!tagFilter ? "bg-primary/10 text-primary" : "hover:bg-surface-secondary"}`}
              >
                全部标签
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setTagFilter(tag); setTagOpen(false); }}
                  className={`flex w-full items-center px-3 py-2 text-xs transition-colors ${tagFilter === tag ? "bg-primary/10 text-primary" : "hover:bg-surface-secondary"}`}
                >
                  {tag}
                </button>
              ))}
              {allTags.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-secondary">暂无标签</p>
              )}
            </div>
          )}
        </div>

        {/* 收藏筛选 */}
        <button
          onClick={() => setStarFilter(!starFilter)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
            starFilter ? "bg-amber-500/15 text-amber-600" : "text-text-secondary hover:bg-surface-secondary"
          }`}
          title={starFilter ? "显示全部" : "仅收藏"}
        >
          <svg className="size-3.5" fill={starFilter ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          收藏
        </button>

        <div className="flex-1" />

        {/* 视图切换 */}
        <div className="flex items-center rounded-md border border-border">
          <button
            onClick={() => setViewMode("list")}
            className={`rounded-l-md px-2 py-1 transition-colors ${viewMode === "list" ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-surface-secondary"}`}
            title="列表视图"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`rounded-r-md px-2 py-1 transition-colors ${viewMode === "grid" ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-surface-secondary"}`}
            title="网格视图"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </button>
        </div>

        {/* 排序 */}
        <div ref={sortRef} className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            {SORT_OPTIONS.find((o) => o.value === sortField)?.label}
            {sortOrder === "asc" ? " ↑" : " ↓"}
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setSortField(opt.value); setSortOpen(false); }}
                  className={`flex w-full items-center px-3 py-2 text-xs transition-colors ${
                    sortField === opt.value ? "bg-primary/10 text-primary" : "hover:bg-surface-secondary"
                  }`}
                >
                  {opt.label}
                  {sortField === opt.value && (sortOrder === "asc" ? " ↑" : " ↓")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 导入进度条 */}
      {importProgress && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
            <span className="truncate">{importProgress.currentName}</span>
            <span className="ml-2 shrink-0">{importProgress.current}/{importProgress.total}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
