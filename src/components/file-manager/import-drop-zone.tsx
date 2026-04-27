import { useState, useEffect, useCallback } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  importAudioFiles,
  listenImportFolderProgress,
  type ImportFolderProgress,
} from "@/lib/tauri";
import { useAudioStore } from "@/stores/audio-store";

export function ImportDropZone({ children }: { children: React.ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportFolderProgress | null>(null);
  const mergeFiles = useAudioStore((s) => s.mergeFiles);
  const selectFile = useAudioStore((s) => s.selectFile);

  const handleDrop = useCallback(
    async (paths: string[]) => {
      if (importing) return;
      setDragging(false);
      setImporting(true);

      try {
        const unlisten = await listenImportFolderProgress((p) => setProgress(p));
        try {
          const imported = await importAudioFiles(paths);
          if (imported.length > 0) {
            mergeFiles(imported);
            selectFile(imported[0].id);
          }
        } finally {
          unlisten();
          setProgress(null);
        }
      } catch (err) {
        console.error("[拖拽] 导入失败", err);
      } finally {
        setImporting(false);
      }
    },
    [importing, mergeFiles, selectFile],
  );

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      switch (event.payload.type) {
        case "enter":
          setDragging(true);
          break;
        case "leave":
          setDragging(false);
          break;
        case "drop":
          void handleDrop(event.payload.paths);
          break;
      }
    });

    return () => {
      cancelled = true;
      void unlistenPromise.then((off) => off());
    };
  }, [handleDrop]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {children}

      {/* 拖拽覆盖层 */}
      {dragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary/50 px-12 py-8">
            <svg
              className="size-10 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm font-medium text-primary">释放以导入音频文件</p>
          </div>
        </div>
      )}

      {/* 导入进度浮层 */}
      {importing && progress && (
        <div className="absolute bottom-4 left-4 right-4 z-40 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
            <span className="truncate">正在导入: {progress.currentName}</span>
            <span className="ml-2 shrink-0">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
