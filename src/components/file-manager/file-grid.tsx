import type { AudioFile, TranscriptionStatus } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";
import { toggleStar } from "@/lib/tauri";

interface FileGridProps {
  files: AudioFile[];
  visibleIds: string[];
  onContextMenu: (e: React.MouseEvent, file: AudioFile) => void;
}

const STATUS_CONFIG: Record<TranscriptionStatus, { color: string; label: string; animate?: boolean }> = {
  pending: { color: "bg-text-secondary/40", label: "待转录" },
  transcribing: { color: "bg-blue-500", label: "转录中", animate: true },
  completed: { color: "bg-emerald-500", label: "已完成" },
  failed: { color: "bg-red-500", label: "失败" },
};

const FORMAT_COLORS: Record<string, string> = {
  wav: "bg-sky-500/15 text-sky-600",
  mp3: "bg-violet-500/15 text-violet-600",
  flac: "bg-amber-500/15 text-amber-600",
  ogg: "bg-emerald-500/15 text-emerald-600",
  m4a: "bg-rose-500/15 text-rose-600",
  aac: "bg-rose-500/15 text-rose-600",
};

export function FileGrid({ files, visibleIds, onContextMenu }: FileGridProps) {
  return (
    <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-2">
      {files.map((file) => (
        <GridCard key={file.id} file={file} visibleIds={visibleIds} onContextMenu={onContextMenu} />
      ))}
    </div>
  );
}

function GridCard({
  file,
  visibleIds,
  onContextMenu,
}: {
  file: AudioFile;
  visibleIds: string[];
  onContextMenu: (e: React.MouseEvent, file: AudioFile) => void;
}) {
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const selectedFileIds = useAudioStore((s) => s.selectedFileIds);
  const selectFile = useAudioStore((s) => s.selectFile);
  const toggleSelect = useAudioStore((s) => s.toggleSelect);
  const selectRange = useAudioStore((s) => s.selectRange);
  const updateFile = useAudioStore((s) => s.updateFile);
  const setTagFilter = useAudioStore((s) => s.setTagFilter);

  const isFocused = selectedFileId === file.id;
  const isChecked = selectedFileIds.has(file.id);
  const hasSelection = selectedFileIds.size > 0;
  const status = STATUS_CONFIG[file.transcriptionStatus];
  const formatClass = FORMAT_COLORS[file.format] ?? "bg-gray-500/15 text-gray-600";

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectRange(file.id, visibleIds);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleSelect(file.id);
    } else {
      selectFile(file.id);
    }
  };

  const handleStar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const newVal = await toggleStar(file.id);
      updateFile(file.id, { starred: newVal });
    } catch (err) {
      console.error("[文件] 切换收藏失败", err);
    }
  };

  return (
    <button
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, file)}
      className={`group relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
        isFocused
          ? "border-primary bg-primary/5"
          : isChecked
            ? "border-primary/40 bg-primary/5"
            : "border-border hover:border-primary/30 hover:bg-surface-secondary"
      }`}
    >
      {/* 左上角复选框 */}
      <span
        className={`absolute left-2 top-2 flex size-4 items-center justify-center rounded border transition-colors ${
          isChecked
            ? "border-primary bg-primary text-white"
            : "border-border group-hover:border-text-secondary"
        } ${hasSelection ? "" : "opacity-0 group-hover:opacity-100"}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(file.id);
        }}
      >
        {isChecked && (
          <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>

      {/* 右上角星标 */}
      <span
        className={`absolute right-2 top-2 cursor-pointer transition-colors ${
          file.starred
            ? "text-amber-500"
            : "text-transparent group-hover:text-text-secondary/40"
        }`}
        onClick={handleStar}
      >
        <svg className="size-4" fill={file.starred ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      </span>

      {/* 文件名 + 状态 */}
      <div className="flex items-start gap-1.5 pt-4">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${status.color} ${status.animate ? "animate-pulse" : ""}`} title={status.label} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
      </div>

      {/* 格式 + 时长 */}
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${formatClass}`}>{file.format}</span>
        <span className="tabular-nums">{formatDuration(file.duration)}</span>
        <span>{formatSize(file.size)}</span>
      </div>

      {/* 标签 */}
      {file.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {file.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              onClick={(e) => {
                e.stopPropagation();
                setTagFilter(tag);
              }}
              className="cursor-pointer rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-primary/10 hover:text-primary"
            >
              {tag}
            </span>
          ))}
          {file.tags.length > 3 && (
            <span className="text-[10px] text-text-secondary">+{file.tags.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
