import { useRef } from "react";
import { useAudioStore } from "@/stores/audio-store";
import { usePlayerStore } from "@/stores/player-store";

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function QueueDrawer({ open, onClose }: QueueDrawerProps) {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const playFiles = usePlayerStore((s) => s.playFiles);
  const files = useAudioStore((s) => s.files);
  const dragItemRef = useRef(-1);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="flex-1 bg-black/20"
        aria-label="关闭播放队列"
        onClick={onClose}
      />
      <aside className="flex h-full w-80 flex-col border-l border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">播放队列</h3>
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                type="button"
                className="text-xs text-text-secondary hover:text-red-500"
                onClick={() => clearQueue()}
              >
                清空
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-secondary"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {queue.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-text-secondary">
              队列为空
            </p>
          ) : (
            queue.map((fileId, index) => {
              const file = files.find((f) => f.id === fileId);
              const isCurrent = index === currentIndex;
              return (
                <div
                  key={`${fileId}-${index}`}
                  draggable
                  className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-2 ${
                    isCurrent ? "bg-primary/10 text-primary" : "hover:bg-surface-secondary"
                  }`}
                  onDragStart={() => {
                    dragItemRef.current = index;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragItemRef.current >= 0 && dragItemRef.current !== index) {
                      reorderQueue(dragItemRef.current, index);
                    }
                    dragItemRef.current = -1;
                  }}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    onClick={() => playFiles(queue, index)}
                  >
                    {file?.name ?? fileId}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-text-secondary hover:bg-red-500/10 hover:text-red-500"
                    title="从队列移除"
                    onClick={() => removeFromQueue(index)}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
