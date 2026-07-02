import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IS_TAURI, deleteAudioFile, toggleStar, relocateFolder, relocateFile } from "@/lib/tauri";
import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { usePlayerStore } from "@/stores/player-store";
import type { AudioFile, RelocateResult } from "@/lib/types";
import type { FolderNode } from "@/lib/file-tree";

export interface ContextMenuState {
  file: AudioFile;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onEditTags: (file: AudioFile, rect: DOMRect) => void;
}

export function ContextMenu({ state, onClose, onEditTags }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const removeFile = useAudioStore((s) => s.removeFile);
  const updateFile = useAudioStore((s) => s.updateFile);
  const enqueueFiles = useTranscriptionStore((s) => s.enqueueFiles);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);
  const setQueueRunning = useTranscriptionStore((s) => s.setQueueRunning);
  const playFile = usePlayerStore((s) => s.playFile);
  const playNextAfterCurrent = usePlayerStore((s) => s.playNextAfterCurrent);
  const enqueue = usePlayerStore((s) => s.enqueue);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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

  const items: { label: string; danger?: boolean; action: () => void; tauriOnly?: boolean }[] = [
    {
      label: "播放",
      action: () => {
        onClose();
        playFile(state.file.id);
      },
    },
    {
      label: "下一首播放",
      action: () => {
        onClose();
        playNextAfterCurrent([state.file.id]);
      },
    },
    {
      label: "添加到播放队列",
      action: () => {
        onClose();
        enqueue([state.file.id]);
      },
    },
    {
      label: state.file.starred ? "取消收藏" : "收藏",
      action: async () => {
        onClose();
        try {
          const newVal = await toggleStar(state.file.id);
          updateFile(state.file.id, { starred: newVal });
        } catch (err) {
          console.error("[文件] 切换收藏失败", err);
        }
      },
    },
    {
      label: "编辑标签",
      action: () => {
        const rect = menuRef.current?.getBoundingClientRect();
        onClose();
        if (rect) onEditTags(state.file, rect);
      },
    },
    {
      label: "转录此文件",
      action: () => {
        onClose();
        enqueueFiles([state.file.id]);
        if (!queueRunning) setQueueRunning(true);
      },
    },
    {
      label: "重新定位文件",
      tauriOnly: true,
      action: async () => {
        onClose();
        try {
          const updated = await relocateFile(state.file.id);
          if (updated) {
            updateFile(state.file.id, { path: updated.path, name: updated.name });
          }
        } catch (err) {
          console.error("[路径配准] 单文件重定位失败", err);
        }
      },
    },
    {
      label: "在资源管理器中显示",
      tauriOnly: true,
      action: async () => {
        onClose();
        try {
          const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
          await revealItemInDir(state.file.path);
        } catch (err) {
          console.error("[文件] 打开资源管理器失败", err);
        }
      },
    },
    {
      label: "复制文件路径",
      tauriOnly: true,
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
      tauriOnly: true,
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

  const visibleItems = items.filter((i) => !i.tauriOnly || IS_TAURI);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      {visibleItems.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
            item.danger ? "text-red-500 hover:bg-red-500/10" : "hover:bg-surface-secondary"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ---- 文件夹右键菜单 ----

export interface FolderContextMenuState {
  folder: FolderNode;
  x: number;
  y: number;
}

interface FolderContextMenuProps {
  state: FolderContextMenuState;
  onClose: () => void;
  onRelocateResult: (result: RelocateResult) => void;
}

/** 递归收集文件夹下所有音频文件 */
function collectAllFiles(node: FolderNode): AudioFile[] {
  const result: AudioFile[] = [...node.files];
  for (const child of node.children) {
    result.push(...collectAllFiles(child));
  }
  return result;
}

export function FolderContextMenu({ state, onClose, onRelocateResult }: FolderContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const enqueueFiles = useTranscriptionStore((s) => s.enqueueFiles);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);
  const setQueueRunning = useTranscriptionStore((s) => s.setQueueRunning);
  const toggleSelect = useAudioStore((s) => s.toggleSelect);
  const selectedFileIds = useAudioStore((s) => s.selectedFileIds);
  const playFiles = usePlayerStore((s) => s.playFiles);
  const enqueue = usePlayerStore((s) => s.enqueue);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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

  const allFiles = collectAllFiles(state.folder);

  const fileIds = allFiles.map((f) => f.id);

  const items: { label: string; action: () => void; tauriOnly?: boolean }[] = [
    {
      label: `播放文件夹（${allFiles.length} 个文件）`,
      action: () => {
        onClose();
        if (fileIds.length > 0) playFiles(fileIds);
      },
    },
    {
      label: `添加到播放队列（${allFiles.length} 个文件）`,
      action: () => {
        onClose();
        enqueue(fileIds);
      },
    },
    {
      label: `批量转录（${allFiles.length} 个文件）`,
      action: () => {
        onClose();
        const pending = allFiles
          .filter((f) => f.transcriptionStatus !== "transcribing")
          .map((f) => f.id);
        if (pending.length === 0) return;
        enqueueFiles(pending);
        if (!queueRunning) setQueueRunning(true);
      },
    },
    {
      label: "全选此文件夹",
      action: () => {
        onClose();
        for (const f of allFiles) {
          if (!selectedFileIds.has(f.id)) toggleSelect(f.id);
        }
      },
    },
    {
      label: "重新定位文件夹",
      tauriOnly: true,
      action: async () => {
        onClose();
        try {
          const result = await relocateFolder(state.folder.fullPath);
          if (result) {
            onRelocateResult(result);
          }
        } catch (err) {
          console.error("[路径配准] 配准失败", err);
        }
      },
    },
    {
      label: "在资源管理器中显示",
      tauriOnly: true,
      action: async () => {
        onClose();
        const target = allFiles[0]?.path ?? state.folder.fullPath;
        try {
          const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
          await revealItemInDir(target);
        } catch (err) {
          console.error("[文件夹] 打开资源管理器失败", err);
        }
      },
    },
  ];

  const visibleItems = items.filter((i) => !i.tauriOnly || IS_TAURI);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      <div className="border-b border-border px-3 py-1.5 text-xs text-text-secondary truncate">
        {state.folder.name}
      </div>
      {visibleItems.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-surface-secondary"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
