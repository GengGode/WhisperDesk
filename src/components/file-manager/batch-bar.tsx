import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { IS_TAURI, toggleStar, deleteAudioFile } from "@/lib/tauri";

interface BatchBarProps {
  onOpenTagEditor: () => void;
}

export function BatchBar({ onOpenTagEditor }: BatchBarProps) {
  const selectedFileIds = useAudioStore((s) => s.selectedFileIds);
  const files = useAudioStore((s) => s.files);
  const clearSelection = useAudioStore((s) => s.clearSelection);
  const updateFile = useAudioStore((s) => s.updateFile);
  const removeFile = useAudioStore((s) => s.removeFile);
  const enqueueFiles = useTranscriptionStore((s) => s.enqueueFiles);
  const setQueueRunning = useTranscriptionStore((s) => s.setQueueRunning);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);

  const count = selectedFileIds.size;
  if (count === 0) return null;

  const selectedIds = Array.from(selectedFileIds);

  const handleBatchTranscribe = () => {
    const pending = selectedIds.filter((id) => {
      const f = files.find((file) => file.id === id);
      return f && f.transcriptionStatus !== "transcribing";
    });
    if (pending.length === 0) return;
    enqueueFiles(pending);
    if (!queueRunning) setQueueRunning(true);
    clearSelection();
  };

  const handleBatchStar = async () => {
    for (const id of selectedIds) {
      try {
        const newVal = await toggleStar(id);
        updateFile(id, { starred: newVal });
      } catch { /* skip */ }
    }
  };

  const handleBatchDelete = async () => {
    for (const id of selectedIds) {
      try {
        await deleteAudioFile(id);
        removeFile(id);
      } catch { /* skip */ }
    }
    clearSelection();
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2">
      <span className="text-sm font-medium text-primary">
        已选 {count} 个文件
      </span>

      <div className="h-4 w-px bg-border" />

      <button
        onClick={handleBatchTranscribe}
        className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/90"
      >
        批量转录
      </button>
      <button
        onClick={handleBatchStar}
        className="rounded-lg bg-surface-secondary px-3 py-1 text-xs font-medium transition-colors hover:bg-amber-500/20 hover:text-amber-600"
      >
        收藏
      </button>
      <button
        onClick={onOpenTagEditor}
        className="rounded-lg bg-surface-secondary px-3 py-1 text-xs font-medium transition-colors hover:bg-primary/10 hover:text-primary"
      >
        加标签
      </button>
      {IS_TAURI && <button
        onClick={handleBatchDelete}
        className="rounded-lg bg-surface-secondary px-3 py-1 text-xs font-medium transition-colors hover:bg-red-500/10 hover:text-red-600"
      >
        删除
      </button>}

      <div className="flex-1" />

      <button
        onClick={clearSelection}
        className="text-xs text-text-secondary hover:text-text-primary"
      >
        取消选择
      </button>
    </div>
  );
}
