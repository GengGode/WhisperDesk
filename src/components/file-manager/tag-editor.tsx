import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAudioStore } from "@/stores/audio-store";
import { setFileTags, listAllTags } from "@/lib/tauri";

interface TagEditorProps {
  fileIds: string[];
  anchorRect?: DOMRect | null;
  onClose: () => void;
}

export function TagEditor({ fileIds, anchorRect, onClose }: TagEditorProps) {
  const files = useAudioStore((s) => s.files);
  const updateFile = useAudioStore((s) => s.updateFile);
  const allTags = useAudioStore((s) => s.allTags);
  const setAllTags = useAudioStore((s) => s.setAllTags);

  const commonTags = getCommonTags(fileIds, files);
  const [localTags, setLocalTags] = useState<string[]>(commonTags);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (input.trim()) {
      const q = input.toLowerCase();
      setSuggestions(
        allTags.filter((t) => t.toLowerCase().includes(q) && !localTags.includes(t)).slice(0, 5),
      );
    } else {
      setSuggestions([]);
    }
  }, [input, allTags, localTags]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || localTags.includes(trimmed)) return;
    setLocalTags([...localTags, trimmed]);
    setInput("");
  };

  const removeTag = (tag: string) => {
    setLocalTags(localTags.filter((t) => t !== tag));
  };

  const handleConfirm = async () => {
    for (const id of fileIds) {
      try {
        await setFileTags(id, localTags);
        updateFile(id, { tags: [...localTags] });
      } catch (err) {
        console.error("[标签] 设置失败", err);
      }
    }
    try {
      const tags = await listAllTags();
      setAllTags(tags);
    } catch { /* skip */ }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) {
        addTag(suggestions[0]);
      } else {
        addTag(input);
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const style: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: Math.min(anchorRect.bottom + 4, window.innerHeight - 280),
        left: Math.min(anchorRect.left, window.innerWidth - 260),
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };

  return createPortal(
    <div ref={panelRef} style={style} className="z-50 w-60 rounded-xl border border-border bg-surface p-3 shadow-lg">
      <p className="mb-2 text-xs font-medium text-text-secondary">
        {fileIds.length > 1 ? `编辑 ${fileIds.length} 个文件的标签` : "编辑标签"}
      </p>

      {/* 已有标签 */}
      <div className="mb-2 flex flex-wrap gap-1">
        {localTags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {tag}
            <button onClick={() => removeTag(tag)} className="hover:text-red-500">&times;</button>
          </span>
        ))}
      </div>

      {/* 输入框 */}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入标签名…"
        className="mb-1 w-full rounded-lg border border-border bg-surface-secondary px-2 py-1 text-sm outline-none focus:border-primary"
      />

      {/* 自动补全 */}
      {suggestions.length > 0 && (
        <div className="mb-2 rounded-lg border border-border bg-surface">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => addTag(s)}
              className="block w-full px-2 py-1 text-left text-xs hover:bg-surface-secondary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleConfirm}
        className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90"
      >
        确认
      </button>
    </div>,
    document.body,
  );
}

function getCommonTags(ids: string[], files: { id: string; tags: string[] }[]): string[] {
  const selected = files.filter((f) => ids.includes(f.id));
  if (selected.length === 0) return [];
  if (selected.length === 1) return [...selected[0].tags];
  const first = new Set(selected[0].tags);
  for (let i = 1; i < selected.length; i++) {
    const cur = new Set(selected[i].tags);
    for (const t of first) {
      if (!cur.has(t)) first.delete(t);
    }
  }
  return Array.from(first);
}
