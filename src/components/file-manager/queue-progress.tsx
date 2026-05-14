import { useState } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { useAudioStore } from "@/stores/audio-store";

export function QueueProgress() {
  const queue = useTranscriptionStore((s) => s.queue);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);
  const queueIndex = useTranscriptionStore((s) => s.queueIndex);
  const clearQueue = useTranscriptionStore((s) => s.clearQueue);
  const dequeueFile = useTranscriptionStore((s) => s.dequeueFile);
  const activeTask = useTranscriptionStore((s) => s.activeTask);
  const files = useAudioStore((s) => s.files);

  const [expanded, setExpanded] = useState(false);

  if (!queueRunning || queue.length === 0) return null;

  const currentId = queue[queueIndex];
  const currentFile = files.find((f) => f.id === currentId);
  const completed = queueIndex;
  const total = queue.length;
  const overallPct = total > 0 ? (completed / total) * 100 : 0;
  const currentPct = activeTask ? activeTask.progress * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      {/* 汇总行 */}
      <div className="mb-2 flex items-center gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors"
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
          转录队列: {completed}/{total} 完成
        </button>

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

      {/* 当前文件进度 */}
      {activeTask && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-secondary">
          <div
            className="h-full rounded-full bg-blue-400 transition-all duration-300"
            style={{ width: `${currentPct}%` }}
          />
        </div>
      )}

      {/* 队列文件列表 */}
      {expanded && (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
          {queue.map((id, idx) => {
            const file = files.find((f) => f.id === id);
            const name = file?.name ?? id;

            let status: "done" | "active" | "waiting";
            if (idx < queueIndex) status = "done";
            else if (idx === queueIndex) status = "active";
            else status = "waiting";

            return (
              <li
                key={id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
                  status === "active"
                    ? "bg-primary/10 text-primary font-medium"
                    : status === "done"
                      ? "text-text-secondary line-through opacity-60"
                      : "text-text-secondary"
                }`}
              >
                <span className="w-4 shrink-0 text-center">
                  {status === "done" && "✓"}
                  {status === "active" && "▶"}
                  {status === "waiting" && "·"}
                </span>
                <span className="flex-1 truncate">{name}</span>
                {status === "active" && activeTask && (
                  <span className="shrink-0 tabular-nums">
                    {Math.round(activeTask.progress * 100)}%
                  </span>
                )}
                {status === "waiting" && (
                  <button
                    onClick={() => dequeueFile(id)}
                    className="shrink-0 rounded px-1 text-text-secondary hover:text-red-500 transition-colors"
                    title="移出队列"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
