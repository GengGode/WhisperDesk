import type { AudioFile, TranscriptionStatus } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";

interface FileItemProps {
  file: AudioFile;
  onContextMenu: (e: React.MouseEvent, file: AudioFile) => void;
}

const STATUS_CONFIG: Record<
  TranscriptionStatus,
  { color: string; label: string; animate?: boolean }
> = {
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

export function FileItem({ file, onContextMenu }: FileItemProps) {
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const selectFile = useAudioStore((s) => s.selectFile);
  const isSelected = selectedFileId === file.id;

  const status = STATUS_CONFIG[file.transcriptionStatus];
  const formatClass = FORMAT_COLORS[file.format] ?? "bg-gray-500/15 text-gray-600";

  return (
    <button
      onClick={() => selectFile(file.id)}
      onContextMenu={(e) => onContextMenu(e, file)}
      className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        isSelected
          ? "bg-primary/10 text-primary"
          : "hover:bg-surface-secondary"
      }`}
    >
      {/* 转录状态指示器 */}
      <span
        className={`size-2 shrink-0 rounded-full ${status.color} ${status.animate ? "animate-pulse" : ""}`}
        title={status.label}
      />

      {/* 文件名 */}
      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>

      {/* 格式标签 */}
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${formatClass}`}
      >
        {file.format}
      </span>

      {/* 时长 */}
      <span className="shrink-0 text-xs tabular-nums text-text-secondary">
        {formatDuration(file.duration)}
      </span>

      {/* 文件大小 */}
      <span className="hidden shrink-0 text-xs text-text-secondary group-hover:inline sm:inline">
        {formatSize(file.size)}
      </span>
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
