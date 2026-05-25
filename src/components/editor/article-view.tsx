import { useCallback, useEffect, useRef } from "react";
import type { TranscriptionSegment } from "@/lib/types";

interface ArticleViewProps {
  segments: TranscriptionSegment[];
  activeIndex?: number;
  onSeekToSegment?: (index: number) => void;
  onEditSegment?: (index: number) => void;
}

/** 两段合并文本长度低于此值时，允许不换行 */
const MERGE_MAX_CHARS = 20;
/** 静音间隔低于此值（秒）且文本短时，可合并到同一行 */
const MERGE_SILENCE_THRESHOLD = 0.8;
/** 静音间隔超过此阈值（秒）时插入段落间距（双换行） */
const PARAGRAPH_SILENCE_THRESHOLD = 2.0;

/**
 * 精简文章视图：将字幕段落以连续流式文本呈现，
 * 换行规则：
 * - 默认每段换行
 * - 如果前后两段合计文本 ≤ 20字 且 静音间隔 < 0.8s → 不换行，合并同行
 * - 静音 ≥ 2s → 分段（额外间距）
 */
export function ArticleView({
  segments,
  activeIndex,
  onSeekToSegment,
  onEditSegment,
}: ArticleViewProps) {
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const handleClick = useCallback(
    (index: number) => {
      onSeekToSegment?.(index);
    },
    [onSeekToSegment],
  );

  const handleDoubleClick = useCallback(
    (index: number) => {
      onEditSegment?.(index);
    },
    [onEditSegment],
  );

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
        暂无字幕内容
      </div>
    );
  }

  // 预计算分隔类型
  type SepType = "none" | "space" | "break" | "paragraph";
  const separators: SepType[] = segments.map((seg, i) => {
    if (i === 0) return "none";
    const prev = segments[i - 1];
    const gap = seg.start - prev.end;
    // 长静音 → 分段
    if (gap >= PARAGRAPH_SILENCE_THRESHOLD) return "paragraph";
    // 两段文本合计短 且 静音间隔短 → 合并同行
    const combinedLen = prev.text.length + seg.text.length;
    if (combinedLen <= MERGE_MAX_CHARS && gap < MERGE_SILENCE_THRESHOLD) return "space";
    // 默认换行
    return "break";
  });

  return (
    <div className="h-full overflow-y-auto px-6 py-4 text-sm leading-relaxed">
      {segments.map((seg, i) => {
        const isActive = i === activeIndex;
        const sep = separators[i];

        return (
          <span key={i}>
            {sep === "paragraph" && <span className="block h-3" />}
            {sep === "break" && <br />}
            {sep === "space" && " "}
            <span
              ref={isActive ? activeRef : undefined}
              className={`cursor-pointer rounded-sm transition-colors duration-150 ${
                isActive
                  ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200"
                  : "hover:bg-surface-secondary"
              }`}
              onClick={() => handleClick(i)}
              onDoubleClick={() => handleDoubleClick(i)}
              title={`${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s`}
            >
              {seg.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}
