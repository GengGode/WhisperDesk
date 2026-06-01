import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFileTree, type FolderNode } from "@/lib/file-tree";
import type { AudioFile, TranscriptionStatus } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";

const STATUS_COLOR: Record<TranscriptionStatus, string> = {
  pending: "bg-text-secondary/40",
  transcribing: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const SIDEBAR_WIDTH_STORAGE_KEY = "whisperdesk.fileTreeSidebar.width";
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 560;

function loadInitialWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return SIDEBAR_DEFAULT_WIDTH;
    return clampWidth(parsed);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function clampWidth(width: number): number {
  if (width < SIDEBAR_MIN_WIDTH) return SIDEBAR_MIN_WIDTH;
  if (width > SIDEBAR_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;
  return width;
}

export function FileTreeSidebar() {
  const files = useAudioStore((s) => s.files);
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const expandedFolders = useAudioStore((s) => s.expandedFolders);
  const expandAllFolders = useAudioStore((s) => s.expandAllFolders);

  const [width, setWidth] = useState<number>(loadInitialWidth);
  const [resizing, setResizing] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;

    const handleMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      setWidth(clampWidth(drag.startWidth + delta));
    };

    const handleUp = () => {
      dragStateRef.current = null;
      setResizing(false);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    // 拖拽期间禁用文本选中与切换全局光标
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [resizing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // 忽略持久化失败
    }
  }, [width]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startWidth: width };
      setResizing(true);
    },
    [width],
  );

  const handleResizeDoubleClick = useCallback(() => {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
  }, []);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [files],
  );
  const tree = useMemo(() => buildFileTree(sortedFiles), [sortedFiles]);
  const selectedFile = useMemo(
    () => sortedFiles.find((file) => file.id === selectedFileId) ?? null,
    [selectedFileId, sortedFiles],
  );

  useEffect(() => {
    if (!selectedFile) return;
    const folderPaths = getAncestorPaths(selectedFile.path);
    if (folderPaths.length === 0) return;

    // 通过 getState() 读取最新状态，避免 expandedFolders 变化导致
    // 本 effect 重复执行，阻止用户手动折叠文件夹
    const currentExpanded = useAudioStore.getState().expandedFolders;
    const next = new Set(currentExpanded);
    let changed = false;
    for (const folderPath of folderPaths) {
      if (!next.has(folderPath)) {
        next.add(folderPath);
        changed = true;
      }
    }
    if (changed) {
      expandAllFolders(Array.from(next));
    }
    // expandedFolders 不在依赖中，确保只在 selectedFile 变化时自动展开
  }, [expandAllFolders, selectedFile]);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-surface-secondary/40"
      style={{ width: `${width}px` }}
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-sm font-medium">文件树</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {files.length > 0 ? `${files.length} 个文件` : "暂无音频文件"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-secondary">
            导入音频后会在这里显示
          </div>
        ) : (
          <div className="space-y-0.5">
            {tree.children.map((child) => (
              <FolderTreeNode key={child.fullPath} node={child} depth={0} />
            ))}
            {tree.files.map((file) => (
              <SidebarFileItem key={file.id} file={file} depth={0} />
            ))}
          </div>
        )}
      </div>

      {/* 右侧拖拽手柄：拖动调整宽度，双击恢复默认 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件树宽度"
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
        className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize select-none"
      >
        <div
          className={`mx-auto h-full w-px transition-colors ${
            resizing ? "bg-primary" : "bg-transparent group-hover:bg-primary/60"
          }`}
        />
      </div>
    </aside>
  );
}

function FolderTreeNode({ node, depth }: { node: FolderNode; depth: number }) {
  const expandedFolders = useAudioStore((s) => s.expandedFolders);
  const toggleFolder = useAudioStore((s) => s.toggleFolder);
  const expanded = expandedFolders.has(node.fullPath);

  return (
    <div>
      <button
        type="button"
        onClick={() => toggleFolder(node.fullPath)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={node.fullPath}
      >
        <svg
          className={`size-3.5 shrink-0 text-text-secondary transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg
          className="size-4 shrink-0 text-text-secondary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 text-[10px] text-text-secondary">{node.totalFiles}</span>
      </button>

      {expanded && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <FolderTreeNode key={child.fullPath} node={child} depth={depth + 1} />
          ))}
          {node.files.map((file) => (
            <SidebarFileItem key={file.id} file={file} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarFileItem({ file, depth }: { file: AudioFile; depth: number }) {
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const selectFile = useAudioStore((s) => s.selectFile);
  const active = selectedFileId === file.id;

  return (
    <button
      type="button"
      onClick={() => selectFile(file.id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-text-secondary hover:bg-surface hover:text-text"
      }`}
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
      title={file.path}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${STATUS_COLOR[file.transcriptionStatus]} ${
          file.transcriptionStatus === "transcribing" ? "animate-pulse" : ""
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
    </button>
  );
}

function getAncestorPaths(filePath: string): string[] {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  if (segments.length <= 1) return [];

  const parentSegments = segments.slice(0, -1);
  const paths: string[] = [];
  for (let i = 1; i <= parentSegments.length; i += 1) {
    paths.push(parentSegments.slice(0, i).join("/"));
  }
  return paths;
}
