import { useState, useCallback } from "react";
import { useAudioStore } from "@/stores/audio-store";
import {
  importAudioFolder,
  selectAudioFile,
  listenImportFolderProgress,
  type ImportFolderProgress,
} from "@/lib/tauri";

export function FileManager() {
  const files = useAudioStore((s) => s.files);
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const selectFile = useAudioStore((s) => s.selectFile);
  const addFile = useAudioStore((s) => s.addFile);
  const mergeFiles = useAudioStore((s) => s.mergeFiles);

  const [importProgress, setImportProgress] =
    useState<ImportFolderProgress | null>(null);

  const handleImportFolder = useCallback(async () => {
    try {
      console.log("[文件] 开始导入文件夹");
      const unlisten = await listenImportFolderProgress((p) => {
        setImportProgress(p);
      });
      try {
        const imported = await importAudioFolder();
        console.log("[文件] 导入文件夹结果", imported);
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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h2 className="text-base font-medium">音频文件</h2>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-border px-4 py-1.5 text-sm transition-colors hover:bg-surface-secondary disabled:opacity-50"
            onClick={handleImportFolder}
            disabled={importProgress !== null}
          >
            {importProgress
              ? `导入中 ${importProgress.current}/${importProgress.total}`
              : "导入文件夹"}
          </button>
          <button
            className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
            onClick={async () => {
              try {
                console.log("[文件] 开始导入单文件");
                const file = await selectAudioFile();
                console.log("[文件] 导入结果", file);
                if (!file) return;
                addFile(file);
                selectFile(file.id);
              } catch (err) {
                console.error("[文件] 导入失败", err);
              }
            }}
          >
            导入文件
          </button>
        </div>
      </header>

      {importProgress && (
        <div className="border-b border-border bg-surface-secondary/50 px-6 py-2">
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

      <div className="flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-text-secondary">
            <svg
              className="size-12 opacity-40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              />
            </svg>
            <p className="text-sm">暂无音频文件</p>
            <p className="text-xs">点击「导入文件」添加音频，或将文件拖拽到此处</p>
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <button
                key={file.id}
                onClick={() => selectFile(file.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedFileId === file.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-surface-secondary"
                }`}
              >
                <span className="truncate text-sm font-medium">
                  {file.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-text-secondary">
                  {formatDuration(file.duration)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
