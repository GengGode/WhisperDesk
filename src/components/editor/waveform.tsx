import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IS_TAURI, getAudioPeaks } from "@/lib/tauri";
import type { TranscriptionSegment, VadSegment } from "@/lib/types";

interface WaveformProps {
  audioPath: string;
  fileId?: string;
  currentTime: number;
  duration: number;
  segments?: TranscriptionSegment[];
  activeSegment?: TranscriptionSegment;
  selection?: { start: number; end: number } | null;
  vadSegments?: VadSegment[];
  onSeek?: (time: number) => void;
  onRangeSelect?: (startTime: number, endTime: number) => void;
}

const WAVE_COLOR = "#94a3b8";
const PROGRESS_COLOR = "#6366f1";
const SEGMENT_COLOR = "rgba(99, 102, 241, 0.1)";
const SEGMENT_BORDER = "rgba(99, 102, 241, 0.3)";
const ACTIVE_COLOR = "#6366f1";
const SELECTION_FILL = "rgba(239, 68, 68, 0.12)";
const SELECTION_STROKE = "rgba(239, 68, 68, 0.5)";
const VAD_VOICE_COLOR = "rgba(34, 197, 94, 0.55)";
const VAD_SILENCE_COLOR = "rgba(148, 163, 184, 0.18)";
const VAD_BAR_HEIGHT = 12;

const MIN_SELECTION_SECONDS = 0.5;
const CANVAS_HEIGHT = 80;
const SOURCE_PEAKS_COUNT = 8000;
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

function nextZoom(z: number): number {
  for (const level of ZOOM_LEVELS) {
    if (level > z + 0.01) return level;
  }
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

function prevZoom(z: number): number {
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < z - 0.01) return ZOOM_LEVELS[i];
  }
  return ZOOM_LEVELS[0];
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const frac = Math.floor((seconds % 1) * 10);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${frac}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}.${frac}`;
}

/**
 * 将高精度源峰值降采样到目标数量。
 * 源数据为 [min, max] 对的扁平数组，按桶合并取极值。
 */
function downsamplePeaks(source: number[], targetCount: number): number[] {
  const sourceCount = source.length / 2;
  if (sourceCount <= targetCount) return source;

  const result = new Array<number>(targetCount * 2);
  const ratio = sourceCount / targetCount;

  for (let i = 0; i < targetCount; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(Math.floor((i + 1) * ratio), sourceCount);
    let min = Infinity;
    let max = -Infinity;
    for (let j = from; j < to; j++) {
      if (source[j * 2] < min) min = source[j * 2];
      if (source[j * 2 + 1] > max) max = source[j * 2 + 1];
    }
    result[i * 2] = min;
    result[i * 2 + 1] = max;
  }

  return result;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function Waveform({
  audioPath,
  fileId,
  currentTime,
  duration,
  segments,
  activeSegment,
  selection,
  vadSegments,
  onSeek,
  onRangeSelect,
}: WaveformProps) {
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const vadCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [sourcePeaks, setSourcePeaks] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; time: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 右键拖拽选区状态
  const [isRightDragging, setIsRightDragging] = useState(false);
  const rightDragStartRef = useRef(0);
  const [rightDragSelection, setRightDragSelection] = useState<{ start: number; end: number } | null>(null);

  const canvasWidth = Math.floor(containerWidth * zoom);

  // 滚轮缩放锚点：记录缩放时鼠标指向的时间比例和鼠标 x 偏移
  const zoomAnchorRef = useRef<{ ratio: number; mouseX: number } | null>(null);
  const canvasWidthRef = useRef(canvasWidth);
  canvasWidthRef.current = canvasWidth;

  // 前端降采样：加载中按进度比例渲染，加载完成后铺满整个 canvas
  const displayPeaks = useMemo(() => {
    if (!sourcePeaks || sourcePeaks.length === 0) return null;
    if (loadProgress !== null && loadProgress > 0) {
      const targetWidth = Math.max(1, Math.floor(canvasWidth * loadProgress));
      return downsamplePeaks(sourcePeaks, targetWidth);
    }
    return downsamplePeaks(sourcePeaks, canvasWidth);
  }, [sourcePeaks, canvasWidth, loadProgress]);

  // 监听容器宽度
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // 加载峰值：只在 audioPath 变化时请求一次，固定数量
  useEffect(() => {
    let cancelled = false;
    setSourcePeaks(null);
    setError(null);
    setLoadProgress(0);

    let unlistenPromise: Promise<() => void> | undefined;
    if (IS_TAURI) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        if (cancelled) return;
        unlistenPromise = listen<{ audioPath: string; progress: number; peaks: number[] }>(
          "waveform-progress",
          (event) => {
            if (!cancelled && event.payload.audioPath === audioPath) {
              setLoadProgress(event.payload.progress);
              setSourcePeaks(event.payload.peaks);
            }
          },
        );
      });
    }

    getAudioPeaks(audioPath, SOURCE_PEAKS_COUNT, fileId)
      .then((data) => {
        if (!cancelled) {
          setSourcePeaks(data.peaks);
          setLoadProgress(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoadProgress(null);
        }
      });

    return () => {
      cancelled = true;
      unlistenPromise?.then((fn) => fn());
    };
  }, [audioPath]);

  // Ctrl+滚轮缩放（以光标位置为中心）
  // 绑定到 containerRef（始终存在），而非条件渲染的 scrollRef
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const scrollEl = scrollRef.current;

      // 不按 Ctrl/Cmd：将垂直滚轮转为横向滚动
      if (!e.ctrlKey && !e.metaKey) {
        if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) {
          e.preventDefault();
          scrollEl.scrollLeft += e.deltaY;
        }
        return;
      }

      // Ctrl/Cmd + 滚轮：缩放
      e.preventDefault();
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const curW = canvasWidthRef.current;
      const ratio = curW > 0 ? (scrollEl.scrollLeft + mouseX) / curW : 0;

      zoomAnchorRef.current = { ratio, mouseX };

      if (e.deltaY < 0) {
        setZoom((z) => {
          const next = nextZoom(z);
          if (next === z) zoomAnchorRef.current = null;
          return next;
        });
      } else {
        setZoom((z) => {
          const next = prevZoom(z);
          if (next === z) zoomAnchorRef.current = null;
          return next;
        });
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // 播放时自动滚动 + 缩放后锚点定位
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    // 缩放锚点优先：保持鼠标指向的时间点不变
    const anchor = zoomAnchorRef.current;
    if (anchor) {
      zoomAnchorRef.current = null;
      scrollEl.scrollLeft = anchor.ratio * canvasWidth - anchor.mouseX;
      return;
    }

    if (duration <= 0 || zoom <= 1) return;
    const progressX = (currentTime / duration) * canvasWidth;
    const viewLeft = scrollEl.scrollLeft;
    const viewRight = viewLeft + scrollEl.clientWidth;
    if (progressX < viewLeft + 40 || progressX > viewRight - 40) {
      scrollEl.scrollLeft = progressX - scrollEl.clientWidth / 2;
    }
  }, [currentTime, duration, canvasWidth, zoom]);

  // ─── 静态层：波形条 + 字幕区间背景 ───
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas || !displayPeaks) return;

    const ctx = setupCanvas(canvas, canvasWidth, CANVAS_HEIGHT);
    if (!ctx) return;

    const w = canvasWidth;
    const h = CANVAS_HEIGHT;
    const numPeaks = displayPeaks.length / 2;
    if (numPeaks === 0) return;

    const mid = h / 2;
    const isLoading = loadProgress !== null;
    const barW = isLoading ? 1 : Math.max(1, w / numPeaks);

    // 字幕区间
    if (segments && duration > 0) {
      for (const seg of segments) {
        const x1 = (seg.start / duration) * w;
        const x2 = (seg.end / duration) * w;
        ctx.fillStyle = SEGMENT_COLOR;
        ctx.fillRect(x1, 0, x2 - x1, h);
        ctx.strokeStyle = SEGMENT_BORDER;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, h);
        ctx.stroke();
      }
    }

    // 活跃字幕区间的像素范围
    let activeX1 = -1;
    let activeX2 = -1;
    if (activeSegment && duration > 0) {
      activeX1 = (activeSegment.start / duration) * w;
      activeX2 = (activeSegment.end / duration) * w;
    }

    // 波形条：活跃区间高亮，其余灰色
    for (let i = 0; i < numPeaks; i++) {
      const minVal = displayPeaks[i * 2];
      const maxVal = displayPeaks[i * 2 + 1];
      const x = i * barW;
      const top = mid - maxVal * mid;
      const bottom = mid - minVal * mid;
      const barH = Math.max(1, bottom - top);
      const inActive = activeX1 >= 0 && x >= activeX1 && x < activeX2;
      ctx.fillStyle = inActive ? ACTIVE_COLOR : WAVE_COLOR;
      ctx.fillRect(x, top, Math.max(1, barW - 0.5), barH);
    }
  }, [displayPeaks, canvasWidth, segments, activeSegment, duration, loadProgress]);

  // ─── 动态层：播放指针 + 选区 ───
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = setupCanvas(canvas, canvasWidth, CANVAS_HEIGHT);
    if (!ctx) return;

    if (duration <= 0) return;

    // 选区可视化
    const sel = rightDragSelection ?? selection;
    if (sel) {
      const x1 = (sel.start / duration) * canvasWidth;
      const x2 = (sel.end / duration) * canvasWidth;
      ctx.fillStyle = SELECTION_FILL;
      ctx.fillRect(x1, 0, x2 - x1, CANVAS_HEIGHT);
      ctx.strokeStyle = SELECTION_STROKE;
      ctx.lineWidth = 1;
      for (const x of [x1, x2]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
    }

    // 播放指针
    const progressX = (currentTime / duration) * canvasWidth;
    if (progressX > 0) {
      ctx.strokeStyle = PROGRESS_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, CANVAS_HEIGHT);
      ctx.stroke();
    }
  }, [currentTime, duration, canvasWidth, selection, rightDragSelection]);

  // ─── VAD 指示条：独立 canvas，波形图下方 ───
  useEffect(() => {
    const canvas = vadCanvasRef.current;
    if (!canvas || !vadSegments || duration <= 0) return;

    const ctx = setupCanvas(canvas, canvasWidth, VAD_BAR_HEIGHT);
    if (!ctx) return;

    const w = canvasWidth;
    const h = VAD_BAR_HEIGHT;
    const r = 2; // 圆角半径

    for (const seg of vadSegments) {
      const x1 = Math.round((seg.startSeconds / duration) * w);
      const x2 = Math.round((seg.endSeconds / duration) * w);
      const segW = Math.max(1, x2 - x1);
      ctx.fillStyle = seg.isVoice ? VAD_VOICE_COLOR : VAD_SILENCE_COLOR;
      ctx.beginPath();
      ctx.roundRect(x1, 1, segW, h - 2, r);
      ctx.fill();
    }
  }, [vadSegments, canvasWidth, duration]);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || duration <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      return Math.max(0, Math.min(duration, (x / canvasWidth) * duration));
    },
    [duration, canvasWidth],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (duration <= 0) return;

      if (e.button === 2 && onRangeSelect) {
        // 右键：启动选区拖拽
        e.preventDefault();
        const time = getTimeFromClientX(e.clientX);
        rightDragStartRef.current = time;
        setIsRightDragging(true);
        setRightDragSelection({ start: time, end: time });
        return;
      }

      // 左键：seek
      if (e.button === 0 && onSeek) {
        setIsDragging(true);
        onSeek(getTimeFromClientX(e.clientX));
      }
    },
    [onSeek, onRangeSelect, duration, getTimeFromClientX],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || duration <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverInfo({ x, time: getTimeFromClientX(e.clientX) });
    },
    [duration, getTimeFromClientX],
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) setHoverInfo(null);
  }, [isDragging]);

  // 左键拖拽期间：跟随鼠标持续 seek，松开结束
  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      onSeek?.(getTimeFromClientX(e.clientX));
      const canvas = overlayCanvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setHoverInfo({ x: e.clientX - rect.left, time: getTimeFromClientX(e.clientX) });
      }
    };
    const handleUp = () => {
      setIsDragging(false);
      setHoverInfo(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, onSeek, getTimeFromClientX]);

  // 右键拖拽期间：实时更新选区范围，松开后提交
  useEffect(() => {
    if (!isRightDragging) return;
    const handleMove = (e: MouseEvent) => {
      const time = getTimeFromClientX(e.clientX);
      const s = rightDragStartRef.current;
      setRightDragSelection({
        start: Math.min(s, time),
        end: Math.max(s, time),
      });
    };
    const handleUp = (e: MouseEvent) => {
      setIsRightDragging(false);
      const time = getTimeFromClientX(e.clientX);
      const s = rightDragStartRef.current;
      const rangeStart = Math.min(s, time);
      const rangeEnd = Math.max(s, time);
      setRightDragSelection(null);
      if (rangeEnd - rangeStart >= MIN_SELECTION_SECONDS) {
        onRangeSelect?.(rangeStart, rangeEnd);
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isRightDragging, getTimeFromClientX, onRangeSelect]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
        波形加载失败: {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded-lg border border-border bg-surface p-3">
      {!displayPeaks ? (
        <div className="flex h-[80px] items-center justify-center text-xs text-text-secondary">
          正在生成波形...
        </div>
      ) : (
        <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden rounded">
          <div className="relative" style={{ width: canvasWidth, height: CANVAS_HEIGHT }}>
            <canvas ref={waveCanvasRef} className="absolute inset-0" />
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 cursor-pointer"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onContextMenu={(e) => e.preventDefault()}
            />
            {hoverInfo && (
              <div
                className="pointer-events-none absolute -top-7 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] tabular-nums text-white shadow"
                style={{ left: hoverInfo.x, transform: "translateX(-50%)" }}
              >
                {formatTime(hoverInfo.time)}
              </div>
            )}
          </div>
          {vadSegments && (
            <canvas
              ref={vadCanvasRef}
              style={{ width: canvasWidth, height: VAD_BAR_HEIGHT }}
              className="mt-0.5"
            />
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-secondary disabled:opacity-40"
          disabled={zoom <= ZOOM_LEVELS[0]}
          onClick={() => setZoom(prevZoom)}
        >
          -
        </button>
        <span className="text-xs tabular-nums text-text-secondary">
          {Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}x
        </span>
        <button
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-secondary disabled:opacity-40"
          disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          onClick={() => setZoom(nextZoom)}
        >
          +
        </button>
        <span className="text-[10px] text-text-secondary/60">
          Ctrl+滚轮缩放
        </span>
        {loadProgress !== null && (
          <span className="ml-auto text-xs tabular-nums text-indigo-500">
            波形加载中 {Math.round(loadProgress * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
