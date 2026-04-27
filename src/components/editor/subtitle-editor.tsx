import { useEditorStore } from "@/stores/editor-store";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { SubtitleRow } from "./subtitle-row";

interface SubtitleEditorProps {
  currentTime: number;
  onSeek: (time: number) => void;
}

export function SubtitleEditor({ currentTime, onSeek }: SubtitleEditorProps) {
  const segments = useEditorStore((s) => s.segments);
  const updateSegmentText = useEditorStore((s) => s.updateSegmentText);
  const updateSegmentTime = useEditorStore((s) => s.updateSegmentTime);
  const addSegment = useEditorStore((s) => s.addSegment);
  const removeSegment = useEditorStore((s) => s.removeSegment);
  const splitSegment = useEditorStore((s) => s.splitSegment);
  const mergeSegments = useEditorStore((s) => s.mergeSegments);

  const activeRowRef = useRef<HTMLDivElement>(null);

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
    (index: number) => {
      const seg = segments[index];
      if (!seg) return;
      const mid = (seg.start + seg.end) / 2;
      splitSegment(index, mid);
    },
    [segments, splitSegment],
  );

  const handleMergeWithNext = useCallback(
    (index: number) => {
      mergeSegments(index, index + 1);
    },
    [mergeSegments],
  );

  return (
    <div className="space-y-1">
      <p className="mb-2 text-xs text-text-secondary">
        共 {segments.length} 个字幕段落
        <span className="ml-2 text-text-secondary/60">
          (单击时间戳跳转，双击编辑)
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
}
