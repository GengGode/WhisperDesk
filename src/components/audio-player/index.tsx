import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

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

        <div className="mb-2 flex items-center gap-3">
          <button
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
