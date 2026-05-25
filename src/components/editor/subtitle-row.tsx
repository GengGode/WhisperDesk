import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptionSegment } from "@/lib/types";

interface SubtitleRowProps {
  index: number;
  segment: TranscriptionSegment;
  isActive: boolean;
  onSeek: (time: number) => void;
  onTextChange: (index: number, text: string) => void;
  onTimeChange: (index: number, field: "start" | "end", value: number) => void;
  onRemove: (index: number) => void;
  onSplit: (index: number, cursorPos?: number) => void;
  onMergeWithNext: (index: number) => void;
  isLast: boolean;
  /** 注册 textarea 引用，用于外部焦点管理 */
  registerTextarea?: (index: number, el: HTMLTextAreaElement | null) => void;
  /** 设置循环播放区间 */
  onLoopSegment?: (seg: { start: number; end: number } | null) => void;
  /** 当前是否正在循环播放此段 */
  isLooping?: boolean;
}

/** CPS 阈值：<= 正常，<= 警告，> 危险 */
const CPS_NORMAL = 15;
const CPS_WARN = 20;

export function SubtitleRow({
  index,
  segment,
  isActive,
  onSeek,
  onTextChange,
  onTimeChange,
  onRemove,
  onSplit,
  onMergeWithNext,
  isLast,
  registerTextarea,
  onLoopSegment,
  isLooping,
}: SubtitleRowProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);

  const textareaRefCallback = useCallback(
    (el: HTMLTextAreaElement | null) => {
      (textRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      registerTextarea?.(index, el);
    },
    [index, registerTextarea],
  );

  const [editingTime, setEditingTime] = useState<{
    field: "start" | "end";
    value: string;
  } | null>(null);

  // textarea 自适应高度
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [segment.text]);

  const segDuration = segment.end - segment.start;
  const cps = segDuration > 0 ? segment.text.length / segDuration : 0;

  const cpsColor =
    cps <= CPS_NORMAL
      ? "text-emerald-500"
      : cps <= CPS_WARN
        ? "text-amber-500"
        : "text-red-500";

  const handleTimeBlur = (field: "start" | "end") => {
    if (!editingTime) return;
    const parsed = parseTimeInput(editingTime.value);
    if (parsed !== null) {
      onTimeChange(index, field, parsed);
    }
    setEditingTime(null);
  };

  const handleTimeKeyDown = (
    e: React.KeyboardEvent,
    field: "start" | "end",
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTimeBlur(field);
    } else if (e.key === "Escape") {
      setEditingTime(null);
    }
  };

  return (
    <div
      className={`group flex cursor-pointer gap-2 rounded-md border px-3 py-2 transition-colors ${
        isActive
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:bg-surface-secondary"
      }`}
      onClick={() => onSeek(segment.start)}
    >
      <span className="shrink-0 pt-1.5 text-xs tabular-nums text-text-secondary">
        {index + 1}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {editingTime?.field === "start" ? (
            <input
              autoFocus
              className="w-20 rounded border border-primary bg-white px-1.5 py-0.5 text-xs tabular-nums outline-none"
              value={editingTime.value}
              onChange={(e) =>
                setEditingTime({ field: "start", value: e.target.value })
              }
              onBlur={() => handleTimeBlur("start")}
              onKeyDown={(e) => handleTimeKeyDown(e, "start")}
            />
          ) : (
            <button
              className="rounded px-1.5 py-0.5 text-xs tabular-nums text-primary hover:bg-primary/10"
              onClick={(e) => { e.stopPropagation(); onSeek(segment.start); }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingTime({ field: "start", value: formatTimeMs(segment.start) });
              }}
              title="单击跳转，双击编辑"
            >
              {formatTimeMs(segment.start)}
            </button>
          )}
          <span className="text-xs text-text-secondary">→</span>
          {editingTime?.field === "end" ? (
            <input
              autoFocus
              className="w-20 rounded border border-primary bg-white px-1.5 py-0.5 text-xs tabular-nums outline-none"
              value={editingTime.value}
              onChange={(e) =>
                setEditingTime({ field: "end", value: e.target.value })
              }
              onBlur={() => handleTimeBlur("end")}
              onKeyDown={(e) => handleTimeKeyDown(e, "end")}
            />
          ) : (
            <button
              className="rounded px-1.5 py-0.5 text-xs tabular-nums text-primary hover:bg-primary/10"
              onClick={(e) => { e.stopPropagation(); onSeek(segment.end); }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingTime({ field: "end", value: formatTimeMs(segment.end) });
              }}
              title="单击跳转，双击编辑"
            >
              {formatTimeMs(segment.end)}
            </button>
          )}

          {/* 段落时长 */}
          <span className="text-[10px] tabular-nums text-text-secondary/60">
            {segDuration.toFixed(1)}s
          </span>

          {/* CPS 指示器 */}
          {segment.text.length > 0 && (
            <span className={`text-[10px] tabular-nums ${cpsColor}`} title={`${cps.toFixed(1)} 字/秒`}>
              {cps.toFixed(0)}c/s
            </span>
          )}

          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            {onLoopSegment && (
              <button
                className={`rounded px-1.5 py-0.5 text-xs ${
                  isLooping
                    ? "bg-indigo-100 text-indigo-600"
                    : "text-text-secondary hover:bg-surface-secondary hover:text-text"
                }`}
                onClick={() => {
                  if (isLooping) {
                    onLoopSegment(null);
                  } else {
                    onLoopSegment({ start: segment.start, end: segment.end });
                  }
                }}
                title={isLooping ? "取消循环播放" : "循环播放此段"}
              >
                ↻
              </button>
            )}
            <button
              className="rounded px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-secondary hover:text-text"
              onClick={() => {
                const cursorPos = textRef.current?.selectionStart;
                onSplit(index, cursorPos ?? undefined);
              }}
              title="拆分段落（在光标位置）"
            >
              ÷
            </button>
            {!isLast && (
              <button
                className="rounded px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-secondary hover:text-text"
                onClick={() => onMergeWithNext(index)}
                title="与下一段合并"
              >
                ⊕
              </button>
            )}
            <button
              className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => onRemove(index)}
              title="删除段落"
            >
              ✕
            </button>
          </div>
        </div>

        <textarea
          ref={textareaRefCallback}
          className="w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-relaxed outline-none transition-colors hover:border-border focus:border-primary"
          style={{ minHeight: "1.5em" }}
          value={segment.text}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onTextChange(index, e.target.value)}
        />
      </div>
    </div>
  );
}

function formatTimeMs(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00.00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

/** 解析 mm:ss.cc 或 mm:ss 格式的时间输入 */
function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();

  const matchFull = trimmed.match(/^(\d+):(\d+)\.(\d+)$/);
  if (matchFull) {
    const [, m, s, cs] = matchFull;
    const frac = Number(cs) / Math.pow(10, cs.length);
    return Number(m) * 60 + Number(s) + frac;
  }

  const matchShort = trimmed.match(/^(\d+):(\d+)$/);
  if (matchShort) {
    const [, m, s] = matchShort;
    return Number(m) * 60 + Number(s);
  }

  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : null;
}
