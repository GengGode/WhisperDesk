import { useRef, useEffect } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";

export function LogsPanel() {
  const logs = useTranscriptionStore((s) => s.logs);
  const clearLogs = useTranscriptionStore((s) => s.clearLogs);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">引擎日志</h2>
        <button
          onClick={clearLogs}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          清空
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-zinc-400">暂无日志，开始转录后这里将显示引擎输出。</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-zinc-400">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="whitespace-pre-wrap break-all">{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
