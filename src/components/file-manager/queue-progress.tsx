import { useTranscriptionStore } from "@/stores/transcription-store";
import { useAudioStore } from "@/stores/audio-store";

export function QueueProgress() {
  const queue = useTranscriptionStore((s) => s.queue);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);
  const queueIndex = useTranscriptionStore((s) => s.queueIndex);
  const clearQueue = useTranscriptionStore((s) => s.clearQueue);
  const activeTask = useTranscriptionStore((s) => s.activeTask);
  const files = useAudioStore((s) => s.files);

  if (!queueRunning || queue.length === 0) return null;

  const currentId = queue[queueIndex];
  const currentFile = files.find((f) => f.id === currentId);
  const completed = queueIndex;
  const total = queue.length;
  const overallPct = total > 0 ? (completed / total) * 100 : 0;
  const currentPct = activeTask ? activeTask.progress * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-sm font-medium">
          转录队列: {completed}/{total} 完成
        </span>

        {currentFile && (
          <span className="flex-1 truncate text-xs text-text-secondary">
            当前: {currentFile.name}
            {activeTask && ` ${Math.round(currentPct)}%`}
          </span>
        )}

        <button
          onClick={clearQueue}
          className="rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20"
        >
          停止
        </button>
      </div>

      {/* 总体进度条 */}
      <div className="h-2 overflow-hidden rounded-full bg-surface-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {/* 当前文件进度（叠加在总进度下方） */}
      {activeTask && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-secondary">
          <div
            className="h-full rounded-full bg-blue-400 transition-all duration-300"
            style={{ width: `${currentPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
