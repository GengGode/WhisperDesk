import { useMemo, useState } from "react";
import type { PlayMode } from "@/lib/types";
import { emit } from "@tauri-apps/api/event";
import { IS_TAURI, toggleDesktopLyrics } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { useAudioStore } from "@/stores/audio-store";
import { usePlayerStore } from "@/stores/player-store";
import { QueueDrawer } from "./queue-drawer";

const PLAY_MODE_CYCLE: PlayMode[] = ["sequential", "loop-all", "loop-one", "shuffle"];

const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  sequential: "顺序",
  "loop-all": "列表循环",
  "loop-one": "单曲循环",
  shuffle: "随机",
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function PlayerBar() {
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queue = usePlayerStore((s) => s.queue);
  const status = usePlayerStore((s) => s.status);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const playMode = usePlayerStore((s) => s.playMode);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const desktopLyricsVisible = usePlayerStore((s) => s.desktopLyricsVisible);
  const error = usePlayerStore((s) => s.error);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seek = usePlayerStore((s) => s.seek);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const setDesktopLyricsVisible = usePlayerStore((s) => s.setDesktopLyricsVisible);

  const files = useAudioStore((s) => s.files);
  const lyricsSettings = useSettingsStore((s) => s.settings);
  const [queueOpen, setQueueOpen] = useState(false);

  const currentFile = useMemo(() => {
    if (currentIndex < 0) return null;
    const fileId = queue[currentIndex];
    return files.find((f) => f.id === fileId) ?? null;
  }, [currentIndex, queue, files]);

  if (currentIndex < 0 || !currentFile) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isPlaying = status === "playing";

  const cyclePlayMode = () => {
    const idx = PLAY_MODE_CYCLE.indexOf(playMode);
    const nextMode = PLAY_MODE_CYCLE[(idx + 1) % PLAY_MODE_CYCLE.length];
    setPlayMode(nextMode);
  };

  const handleToggleLyrics = async () => {
    if (!IS_TAURI) return;
    try {
      const visible = await toggleDesktopLyrics();
      setDesktopLyricsVisible(visible);
      if (visible) {
        await emit("lyrics-config", {
          fontSize: lyricsSettings.lyricsFontSize,
          theme: lyricsSettings.lyricsTheme,
        });
      }
    } catch (err) {
      console.error("[播放器] 切换桌面歌词失败", err);
    }
  };

  return (
    <>
      <footer className="shrink-0 border-t border-border bg-surface-secondary px-4 py-2">
        {error && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{currentFile.name}</p>
            <p className="text-xs text-text-secondary">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <IconButton title="上一首" onClick={previous}>
              ⏮
            </IconButton>
            <IconButton title={isPlaying ? "暂停" : "播放"} onClick={togglePlay}>
              {isPlaying ? "⏸" : "▶"}
            </IconButton>
            <IconButton title="下一首" onClick={next}>
              ⏭
            </IconButton>
            <IconButton title={`播放模式：${PLAY_MODE_LABELS[playMode]}`} onClick={cyclePlayMode}>
              {playMode === "loop-one" ? "🔂" : playMode === "loop-all" ? "🔁" : playMode === "shuffle" ? "🔀" : "➡"}
            </IconButton>
          </div>

          <div className="hidden min-w-[180px] flex-1 sm:block">
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              className="h-1.5 w-full cursor-pointer accent-primary"
              onChange={(e) => {
                const nextTime = (Number(e.target.value) / 100) * duration;
                seek(nextTime);
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface"
              onClick={() => setQueueOpen(true)}
            >
              队列 ({queue.length})
            </button>
            {IS_TAURI && (
              <button
                type="button"
                className={`rounded-md border px-2 py-1 text-xs ${
                  desktopLyricsVisible
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-surface"
                }`}
                onClick={handleToggleLyrics}
              >
                歌词
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-border p-1.5 text-xs hover:bg-surface"
              title={muted || volume === 0 ? "取消静音" : "静音"}
              onClick={toggleMute}
            >
              {muted || volume === 0 ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              className="h-1.5 w-20 cursor-pointer accent-primary"
              aria-label="音量"
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
        </div>
      </footer>

      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
    </>
  );
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className="rounded-md border border-border px-2 py-1 text-sm hover:bg-surface"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
