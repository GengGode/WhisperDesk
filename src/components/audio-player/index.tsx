import { forwardRef, useEffect, useImperativeHandle } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { audioEngine } from "@/lib/audio-engine";

export interface AudioPlayerHandle {
  togglePlay: () => void;
  isPlaying: boolean;
  audioElement: HTMLAudioElement | null;
}

interface AudioPlayerProps {
  /** 当前编辑器/面板关联的文件 ID */
  fileId: string;
  seekTime?: number;
  seekVersion?: number;
  onTimeUpdate?: (time: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ fileId, seekTime, seekVersion, onTimeUpdate }, ref) {
    const currentIndex = usePlayerStore((s) => s.currentIndex);
    const queue = usePlayerStore((s) => s.queue);
    const status = usePlayerStore((s) => s.status);
    const currentTime = usePlayerStore((s) => s.currentTime);
    const duration = usePlayerStore((s) => s.duration);
    const volume = usePlayerStore((s) => s.volume);
    const muted = usePlayerStore((s) => s.muted);
    const error = usePlayerStore((s) => s.error);

    const togglePlay = usePlayerStore((s) => s.togglePlay);
    const seek = usePlayerStore((s) => s.seek);
    const setVolume = usePlayerStore((s) => s.setVolume);
    const toggleMute = usePlayerStore((s) => s.toggleMute);
    const ensureFile = usePlayerStore((s) => s.ensureFile);

    const isCurrentFile =
      currentIndex >= 0 && queue[currentIndex] === fileId;
    const isPlaying = isCurrentFile && status === "playing";
    const displayTime = isCurrentFile ? currentTime : 0;
    const displayDuration = isCurrentFile ? duration : 0;
    const progress =
      displayDuration > 0 ? (displayTime / displayDuration) * 100 : 0;

    useEffect(() => {
      if (!isCurrentFile) return;
      onTimeUpdate?.(currentTime);
    }, [isCurrentFile, currentTime, onTimeUpdate]);

    useEffect(() => {
      if (seekTime == null || seekVersion == null) return;
      ensureFile(fileId);
      seek(seekTime);
      onTimeUpdate?.(seekTime);
    }, [seekVersion]);

    useImperativeHandle(
      ref,
      () => ({
        togglePlay: () => {
          ensureFile(fileId);
          if (isCurrentFile) {
            togglePlay();
          } else {
            usePlayerStore.getState().playFile(fileId);
          }
        },
        get isPlaying() {
          return isPlaying;
        },
        get audioElement() {
          return audioEngine.getElement();
        },
      }),
      [fileId, isCurrentFile, isPlaying, togglePlay, ensureFile],
    );

    const handleTogglePlay = () => {
      ensureFile(fileId);
      if (isCurrentFile) {
        togglePlay();
      } else {
        usePlayerStore.getState().playFile(fileId);
      }
    };

    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-secondary"
            onClick={handleTogglePlay}
          >
            {isPlaying ? "暂停" : "播放"}
          </button>
          <span className="text-xs text-text-secondary">
            {formatTime(displayTime)} / {formatTime(displayDuration)}
          </span>
          <div className="ml-auto flex min-w-[140px] flex-1 items-center gap-2 sm:max-w-[200px] sm:flex-none">
            <button
              type="button"
              className="shrink-0 rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-secondary"
              title={muted || volume === 0 ? "取消静音" : "静音"}
              aria-label={muted || volume === 0 ? "取消静音" : "静音"}
              onClick={toggleMute}
            >
              <VolumeIcon muted={muted || volume === 0} level={volume} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
              aria-label="音量"
              onChange={(e) => setVolume(Number(e.target.value))}
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-secondary">
              {muted ? 0 : volume}%
            </span>
          </div>
        </div>

        {error && isCurrentFile && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600">
            {error}
          </div>
        )}

        <input
          type="range"
          min={0}
          max={100}
          value={progress}
          className="w-full"
          onChange={(e) => {
            const next = (Number(e.target.value) / 100) * displayDuration;
            if (!Number.isFinite(next)) return;
            ensureFile(fileId);
            seek(next);
            onTimeUpdate?.(next);
          }}
        />
      </div>
    );
  },
);

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function VolumeIcon({ muted, level }: { muted: boolean; level: number }) {
  if (muted || level === 0) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );
  }
  if (level < 35) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
