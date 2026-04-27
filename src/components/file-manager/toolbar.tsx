import { useState, useRef, useEffect, useCallback } from "react";
import { useAudioStore, type SortField, type StatusFilter } from "@/stores/audio-store";
import {
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

  const [sortOpen, setSortOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportFolderProgress | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
      if (importRef.current && !importRef.current.contains(e.target as Node)) {
        setImportOpen(false);
      }
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
          <svg
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-text-secondary focus:border-primary"
          />
        </div>

        {/* 导入下拉 */}
        <div ref={importRef} className="relative">
          <button
            onClick={() => setImportOpen((v) => !v)}
            disabled={importProgress !== null}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {importProgress
              ? `${importProgress.current}/${importProgress.total}`
              : "导入"}
          </button>
          {importOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              <button
                onClick={handleImportFile}
                className="flex w-full items-center px-3 py-2 text-sm hover:bg-surface-secondary"
              >
                导入文件
              </button>
              <button
                onClick={handleImportFolder}
                className="flex w-full items-center px-3 py-2 text-sm hover:bg-surface-secondary"
              >
                导入文件夹
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 第二行：状态筛选 + 排序 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                statusFilter === opt.value
                  ? "bg-primary/15 text-primary"
                  : "text-text-secondary hover:bg-surface-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 排序下拉 */}
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
                  onClick={() => {
                    setSortField(opt.value);
                    setSortOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-2 text-xs transition-colors ${
                    sortField === opt.value
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-surface-secondary"
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
            <span className="ml-2 shrink-0">
              {importProgress.current}/{importProgress.total}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${(importProgress.current / importProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
