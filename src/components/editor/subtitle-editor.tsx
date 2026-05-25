import { useEditorStore } from "@/stores/editor-store";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { SubtitleRow } from "./subtitle-row";

export interface SubtitleEditorHandle {
  /** 聚焦指定索引的 textarea */
  focusRow: (index: number) => void;
  /** 当前获得焦点的 textarea 索引，无焦点返回 -1 */
  focusedIndex: () => number;
}

interface SubtitleEditorProps {
  currentTime: number;
  onSeek: (time: number) => void;
  onLoopSegment?: (seg: { start: number; end: number } | null) => void;
  /** 当前正在循环的区间 */
  loopSegment?: { start: number; end: number } | null;
}

export const SubtitleEditor = forwardRef<SubtitleEditorHandle, SubtitleEditorProps>(
  function SubtitleEditor({ currentTime, onSeek, onLoopSegment, loopSegment }, ref) {
    const segments = useEditorStore((s) => s.segments);
    const updateSegmentText = useEditorStore((s) => s.updateSegmentText);
    const updateSegmentTime = useEditorStore((s) => s.updateSegmentTime);
    const addSegment = useEditorStore((s) => s.addSegment);
    const removeSegment = useEditorStore((s) => s.removeSegment);
    const splitSegment = useEditorStore((s) => s.splitSegment);
    const mergeSegments = useEditorStore((s) => s.mergeSegments);

    const activeRowRef = useRef<HTMLDivElement>(null);
    const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());

    const registerTextarea = useCallback(
      (index: number, el: HTMLTextAreaElement | null) => {
        if (el) {
          textareaRefs.current.set(index, el);
        } else {
          textareaRefs.current.delete(index);
        }
      },
      [],
    );

    const focusRow = useCallback((index: number) => {
      const el = textareaRefs.current.get(index);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, []);

    const focusedIndex = useCallback(() => {
      const active = document.activeElement;
      if (!active || !(active instanceof HTMLTextAreaElement)) return -1;
      for (const [idx, el] of textareaRefs.current) {
        if (el === active) return idx;
      }
      return -1;
    }, []);

    useImperativeHandle(ref, () => ({ focusRow, focusedIndex }), [focusRow, focusedIndex]);

    const activeIndex = useMemo(() => {
      return segments.findIndex(
        (seg) => currentTime >= seg.start && currentTime < seg.end,
      );
    }, [segments, currentTime]);

    useEffect(() => {
      if (activeIndex >= 0 && activeRowRef.current) {
        activeRowRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }, [activeIndex]);

    const handleSplit = useCallback(
      (index: number, cursorPos?: number) => {
        const seg = segments[index];
        if (!seg) return;

        // 有光标位置时按文本比例拆分时间，否则取时间中点
        if (cursorPos != null && seg.text.length > 0) {
          const ratio = Math.max(0, Math.min(1, cursorPos / seg.text.length));
          const splitTime = seg.start + (seg.end - seg.start) * ratio;
          splitSegment(index, splitTime, cursorPos);
        } else {
          const mid = (seg.start + seg.end) / 2;
          splitSegment(index, mid);
        }
      },
      [segments, splitSegment],
    );

    const handleMergeWithNext = useCallback(
      (index: number) => {
        mergeSegments(index, index + 1);
      },
      [mergeSegments],
    );

    // Tab / Shift+Tab / Ctrl+Enter 焦点导航
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        const focused = focusedIndex();
        if (focused < 0) return;

        if (e.key === "Tab") {
          e.preventDefault();
          const next = e.shiftKey
            ? Math.max(0, focused - 1)
            : Math.min(segments.length - 1, focused + 1);
          focusRow(next);
          return;
        }

        if (e.key === "Enter" && e.ctrlKey) {
          e.preventDefault();
          const next = Math.min(segments.length - 1, focused + 1);
          focusRow(next);
          return;
        }
      },
      [focusedIndex, focusRow, segments.length],
    );

    return (
      <div className="space-y-1" onKeyDown={handleKeyDown}>
        <p className="mb-2 text-xs text-text-secondary">
          共 {segments.length} 个字幕段落
          <span className="ml-2 text-text-secondary/60">
            (单击时间戳跳转，双击编辑 | Tab 切换段落)
          </span>
        </p>
        {segments.map((seg, i) => (
          <div key={i} ref={i === activeIndex ? activeRowRef : undefined}>
            <SubtitleRow
              index={i}
              segment={seg}
              isActive={i === activeIndex}
              onSeek={onSeek}
              onTextChange={updateSegmentText}
              onTimeChange={updateSegmentTime}
              onRemove={removeSegment}
              onSplit={handleSplit}
              onMergeWithNext={handleMergeWithNext}
              isLast={i === segments.length - 1}
              registerTextarea={registerTextarea}
              onLoopSegment={onLoopSegment}
              isLooping={
                !!loopSegment &&
                loopSegment.start === seg.start &&
                loopSegment.end === seg.end
              }
            />
          </div>
        ))}
        <button
          className="mt-2 w-full rounded-md border border-dashed border-border py-2 text-xs text-text-secondary hover:border-primary hover:text-primary"
          onClick={() => addSegment(segments.length - 1)}
        >
          + 添加段落
        </button>
      </div>
    );
  },
);
