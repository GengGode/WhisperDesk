import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { deleteAudioFile } from "@/lib/tauri";
import { useAudioStore } from "@/stores/audio-store";
import type { AudioFile } from "@/lib/types";

export interface ContextMenuState {
  file: AudioFile;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const removeFile = useAudioStore((s) => s.removeFile);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = state.x;
    let y = state.y;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    menuRef.current.style.left = `${x}px`;
    menuRef.current.style.top = `${y}px`;
  });

  const items: { label: string; danger?: boolean; action: () => void }[] = [
    {
      label: "在资源管理器中显示",
      action: async () => {
        onClose();
        try {
          await revealItemInDir(state.file.path);
        } catch (err) {
          console.error("[文件] 打开资源管理器失败", err);
        }
      },
    },
    {
      label: "复制文件路径",
      action: async () => {
        onClose();
        try {
          await navigator.clipboard.writeText(state.file.path);
        } catch (err) {
          console.error("[文件] 复制路径失败", err);
        }
      },
    },
    {
      label: "从列表中移除",
      danger: true,
      action: async () => {
        onClose();
        try {
          await deleteAudioFile(state.file.id);
          removeFile(state.file.id);
        } catch (err) {
          console.error("[文件] 删除失败", err);
        }
      },
    },
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
            item.danger
              ? "text-red-500 hover:bg-red-500/10"
              : "hover:bg-surface-secondary"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
