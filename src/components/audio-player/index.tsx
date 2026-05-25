import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

const VOLUME_STORAGE_KEY = "whisperdesk.playbackVolume";

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw == null) return 100;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 100;
  }
}

export interface AudioPlayerHandle {
  togglePlay: () => void;
  isPlaying: boolean;
  audioElement: HTMLAudioElement | null;
}

interface AudioPlayerProps {
  /** Tauri 模式：本地文件路径；浏览器模式：HTTP URL（如 /api/audio/:id） */
  src: string;
  seekTime?: number;
  seekVersion?: number;
  /** 循环播放区间，播放超出 end 时自动跳回 start */
  loopRange?: { start: number; end: number } | null;
  onTimeUpdate?: (time: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, seekTime, seekVersion, loopRange, onTimeUpdate }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [position, setPosition] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState(readStoredVolume);
    const [muted, setMuted] = useState(false);
    const volumeBeforeMuteRef = useRef(volume);

    const applyVolume = useCallback((audio: HTMLAudioElement, vol: number, isMuted: boolean) => {
      audio.volume = vol / 100;
      audio.muted = isMuted;
    }, []);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      applyVolume(audio, volume, muted);
    }, [src, volume, muted, applyVolume]);

    const handleVolumeChange = (next: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(next)));
      setVolume(clamped);
      if (clamped > 0) {
        setMuted(false);
        volumeBeforeMuteRef.current = clamped;
      }
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
      } catch {
        /* 忽略存储失败 */
      }
    };

    const toggleMute = () => {
      if (muted) {
        const restore = volumeBeforeMuteRef.current > 0 ? volumeBeforeMuteRef.current : 100;
        setVolume(restore);
        setMuted(false);
        try {
          localStorage.setItem(VOLUME_STORAGE_KEY, String(restore));
        } catch {
          /* 忽略 */
        }
        return;
      }
      volumeBeforeMuteRef.current = volume > 0 ? volume : 100;
      setMuted(true);
    };

    const progress = useMemo(() => {
      if (duration <= 0) return 0;
      return (position / duration) * 100;
    }, [duration, position]);

    useImperativeHandle(ref, () => ({
      togglePlay: () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
          audio.play().catch((err) => setError(String(err)));
        } else {
          audio.pause();
        }
      },
      get isPlaying() {
        return isPlaying;
      },
      get audioElement() {
        return audioRef.current;
      },
    }), [isPlaying]);

    // seekVersion 变化时跳转到 seekTime
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio || seekTime == null || seekVersion == null) return;
      audio.currentTime = seekTime;
      setPosition(seekTime);
      onTimeUpdate?.(seekTime);
    }, [seekVersion]);

    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const value = e.currentTarget.currentTime;
      setPosition(value);
      onTimeUpdate?.(value);

      // 循环播放：超出区间 end 时跳回 start
      if (loopRange && value >= loopRange.end) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = loopRange.start;
          setPosition(loopRange.start);
          onTimeUpdate?.(loopRange.start);
        }
      }
    };

    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            setError(null);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            const msg = e.currentTarget.error?.message || "未知错误";
            setError(`音频加载失败 (code=${code}): ${msg}`);
          }}
        />

        <div className="mb-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-secondary"
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) {
                audio.play().catch((err) => setError(String(err)));
              } else {
                audio.pause();
              }
            }}
          >
            {isPlaying ? "暂停" : "播放"}
          </button>
          <span className="text-xs text-text-secondary">
            {formatTime(position)} / {formatTime(duration)}
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
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-secondary">
              {muted ? 0 : volume}%
            </span>
          </div>
        </div>

        {error && (
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
            const next = (Number(e.target.value) / 100) * duration;
            const audio = audioRef.current;
            if (!audio || !Number.isFinite(next)) return;
            audio.currentTime = next;
            setPosition(next);
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

/** 音量图标（内联 SVG，避免额外依赖） */
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
