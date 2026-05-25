import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptionSegment } from "@/lib/types";
import type { WaveformRenderContext } from "./waveform";

interface TimelineProps {
  ctx: WaveformRenderContext;
  segments: TranscriptionSegment[];
  activeIndex?: number;
  onSeekToSegment?: (index: number) => void;
  onSegmentTimeChange?: (index: number, field: "start" | "end", value: number) => void;
  onMoveSegment?: (index: number, deltaSeconds: number) => void;
}

/** 每行高度（色条 + 文本 + 间距） */
const LANE_HEIGHT = 36;
/** 行间距 */
const LANE_GAP = 4;
/** 行数上限（防止极端情况） */
const MAX_LANES = 64;
/** 色条高度 */
const BAR_HEIGHT = 6;
/** 文本字号 */
const FONT_SIZE = 11;
/** 边界命中范围（像素） */
const BOUNDARY_HIT_PX = 5;
/** 估算每个字符的像素宽度（CJK 为主，取较大值） */
const CHAR_WIDTH_CJK = 11;
const CHAR_WIDTH_LATIN = 6.5;
/** 文本与下一段之间的最小间距 */
const TEXT_GAP_PX = 12;

/** 段落色板（循环使用） */
const COLORS = [
  "rgba(99, 102, 241, 0.7)",   // indigo
  "rgba(16, 185, 129, 0.7)",   // emerald
  "rgba(245, 158, 11, 0.7)",   // amber
  "rgba(236, 72, 153, 0.7)",   // pink
  "rgba(59, 130, 246, 0.7)",   // blue
  "rgba(139, 92, 246, 0.7)",   // violet
  "rgba(20, 184, 166, 0.7)",   // teal
  "rgba(249, 115, 22, 0.7)",   // orange
];

const ACTIVE_BORDER = "rgba(99, 102, 241, 1)";

/** 估算文本渲染宽度 */
function estimateTextWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK 字符范围（粗略判断）
    if (code > 0x2e80) {
      width += CHAR_WIDTH_CJK;
    } else {
      width += CHAR_WIDTH_LATIN;
    }
  }
  return width;
}

interface LaneAssignment {
  index: number;
  lane: number;
}

/**
 * 基于文本视觉宽度的自动行分配算法：
 * 按 start 排序后，将每个段落放入第一个"文本不遮挡"的已有行；
 * 如果所有已有行都会遮挡，则开新行（直到上限）。
 * 行数 = 实际需要的最少行数。
 */
function assignLanes(
  segments: TranscriptionSegment[],
  timeToX: (t: number) => number,
): { assignments: LaneAssignment[]; laneCount: number } {
  if (segments.length === 0) return { assignments: [], laneCount: 1 };

  const sorted = segments
    .map((seg, i) => ({ seg, i }))
    .sort((a, b) => a.seg.start - b.seg.start);

  // 每行记录"已被文本占据到的最远 x 像素"
  const laneTextEnds: number[] = [];
  const assignments: LaneAssignment[] = new Array(segments.length);

  for (const { seg, i } of sorted) {
    const startX = timeToX(seg.start);
    const textWidth = estimateTextWidth(seg.text);
    const textEndX = startX + textWidth + TEXT_GAP_PX;

    // 找第一个文本不会重叠的已有行
    let placed = false;
    for (let lane = 0; lane < laneTextEnds.length; lane++) {
      if (startX >= laneTextEnds[lane]) {
        laneTextEnds[lane] = textEndX;
        assignments[i] = { index: i, lane };
        placed = true;
        break;
      }
    }

    if (!placed) {
      if (laneTextEnds.length < MAX_LANES) {
        // 开新行
        const lane = laneTextEnds.length;
        laneTextEnds.push(textEndX);
        assignments[i] = { index: i, lane };
      } else {
        // 已达上限：放入当前文本结束最早的行（尽量减少遮挡）
        let minLane = 0;
        let minEnd = laneTextEnds[0];
        for (let lane = 1; lane < laneTextEnds.length; lane++) {
          if (laneTextEnds[lane] < minEnd) {
            minEnd = laneTextEnds[lane];
            minLane = lane;
          }
        }
        laneTextEnds[minLane] = textEndX;
        assignments[i] = { index: i, lane: minLane };
      }
    }
  }

  const laneCount = Math.max(1, laneTextEnds.length);
  return { assignments, laneCount };
}

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  segIndex: number;
  mode: DragMode;
  startX: number;
  originalSeg: TranscriptionSegment;
}

export function Timeline({
  ctx,
  segments,
  activeIndex,
  onSeekToSegment,
  onSegmentTimeChange,
  onMoveSegment,
}: TimelineProps) {
  const { canvasWidth, duration, timeToX, xToTime } = ctx;
  const containerRef = useRef<HTMLDivElement>(null);

  const [hoverCursor, setHoverCursor] = useState<string>("default");
  const [dragState, setDragState] = useState<DragState | null>(null);

  const { assignments: laneAssignments, laneCount } = useMemo(
    () => assignLanes(segments, timeToX),
    [segments, timeToX],
  );

  const totalHeight = laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP + 8;

  /** 判断鼠标在某个色块上的位置类型 */
  const hitTest = useCallback(
    (clientX: number, clientY: number): { segIndex: number; mode: DragMode } | null => {
      const el = containerRef.current;
      if (!el || segments.length === 0 || duration <= 0) return null;
      const rect = el.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const assignment = laneAssignments[i];
        if (!assignment) continue;

        const x1 = timeToX(seg.start);
        const x2 = timeToX(seg.end);
        const laneTop = assignment.lane * (LANE_HEIGHT + LANE_GAP) + 4;
        const laneBottom = laneTop + LANE_HEIGHT;

        // 判断是否在行范围内
        if (my < laneTop || my > laneBottom) continue;

        // 色条区域检测（用于 resize）
        if (mx >= x1 - BOUNDARY_HIT_PX && mx <= x2 + BOUNDARY_HIT_PX) {
          if (Math.abs(mx - x1) <= BOUNDARY_HIT_PX) return { segIndex: i, mode: "resize-start" };
          if (Math.abs(mx - x2) <= BOUNDARY_HIT_PX) return { segIndex: i, mode: "resize-end" };
          if (mx >= x1 && mx <= x2) return { segIndex: i, mode: "move" };
        }

        // 文本区域检测（用于 move）
        const textWidth = estimateTextWidth(seg.text);
        if (mx >= x1 && mx <= x1 + textWidth) {
          return { segIndex: i, mode: "move" };
        }
      }
      return null;
    },
    [segments, laneAssignments, duration, timeToX],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragState) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) {
        setHoverCursor("default");
      } else if (hit.mode === "move") {
        setHoverCursor("grab");
      } else {
        setHoverCursor("col-resize");
      }
    },
    [hitTest, dragState],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;

      e.preventDefault();
      e.stopPropagation();

      setDragState({
        segIndex: hit.segIndex,
        mode: hit.mode,
        startX: e.clientX,
        originalSeg: { ...segments[hit.segIndex] },
      });
    },
    [hitTest, segments],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragState) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (hit && onSeekToSegment) {
        onSeekToSegment(hit.segIndex);
      }
    },
    [hitTest, dragState, onSeekToSegment],
  );

  // 拖拽逻辑
  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const dtSeconds = xToTime(dx) - xToTime(0);
      const seg = dragState.originalSeg;

      if (dragState.mode === "move" && onMoveSegment) {
        const segDur = seg.end - seg.start;
        let newStart = seg.start + dtSeconds;
        let newEnd = seg.end + dtSeconds;
        if (newStart < 0) { newStart = 0; newEnd = segDur; }
        if (newEnd > duration) { newEnd = duration; newStart = duration - segDur; }
        const actualDelta = newStart - segments[dragState.segIndex].start;
        if (Math.abs(actualDelta) > 0.001) {
          onMoveSegment(dragState.segIndex, actualDelta);
        }
      } else if (dragState.mode === "resize-start" && onSegmentTimeChange) {
        let newTime = seg.start + dtSeconds;
        newTime = Math.max(0, Math.min(seg.end - 0.05, newTime));
        onSegmentTimeChange(dragState.segIndex, "start", newTime);
      } else if (dragState.mode === "resize-end" && onSegmentTimeChange) {
        let newTime = seg.end + dtSeconds;
        newTime = Math.max(seg.start + 0.05, Math.min(duration, newTime));
        onSegmentTimeChange(dragState.segIndex, "end", newTime);
      }
    };

    const handleUp = () => setDragState(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragState, segments, duration, xToTime, onMoveSegment, onSegmentTimeChange]);

  if (segments.length === 0 || duration <= 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative mt-1 select-none border-t border-border/40"
      style={{ width: canvasWidth, height: totalHeight, cursor: hoverCursor }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseLeave={() => !dragState && setHoverCursor("default")}
    >
      {/* 行背景分隔线 */}
      {Array.from({ length: laneCount - 1 }, (_, lane) => (
        <div
          key={`lane-bg-${lane}`}
          className="absolute left-0 right-0 border-b border-border/20"
          style={{ top: (lane + 1) * (LANE_HEIGHT + LANE_GAP) }}
        />
      ))}

      {segments.map((seg, i) => {
        const assignment = laneAssignments[i];
        if (!assignment) return null;

        const barX = timeToX(seg.start);
        const barW = Math.max(timeToX(seg.end) - barX, 2);
        const laneTop = assignment.lane * (LANE_HEIGHT + LANE_GAP) + 4;
        const isActive = i === activeIndex;
        const color = COLORS[i % COLORS.length];

        return (
          <div
            key={i}
            className="absolute"
            style={{ left: barX, top: laneTop, height: LANE_HEIGHT }}
            title={`[${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s] ${seg.text}`}
          >
            {/* 色条：严格按时间范围 */}
            <div
              className="rounded-sm"
              style={{
                width: barW,
                height: BAR_HEIGHT,
                marginTop: 2,
                backgroundColor: color,
                border: isActive ? `1.5px solid ${ACTIVE_BORDER}` : "none",
                boxSizing: "border-box",
              }}
            />
            {/* 文本：完整显示，不截断，从色条左边缘开始 */}
            <div
              className="whitespace-nowrap pointer-events-none"
              style={{
                fontSize: FONT_SIZE,
                lineHeight: `${LANE_HEIGHT - BAR_HEIGHT - 4}px`,
                color: isActive ? "var(--color-text-primary, #1e293b)" : "var(--color-text-secondary, #64748b)",
                fontWeight: isActive ? 500 : 400,
                marginTop: 1,
              }}
            >
              {seg.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
