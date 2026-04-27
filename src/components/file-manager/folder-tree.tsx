import { useMemo } from "react";
import type { AudioFile } from "@/lib/types";
import { useAudioStore, type SortField } from "@/stores/audio-store";
import { buildFileTree, isFlat, type FolderNode } from "@/lib/file-tree";
import { FileItem } from "./file-item";
import { FileGrid } from "./file-grid";

interface FolderTreeProps {
  onContextMenu: (e: React.MouseEvent, file: AudioFile) => void;
}

export function FolderTree({ onContextMenu }: FolderTreeProps) {
  const files = useAudioStore((s) => s.files);
  const searchQuery = useAudioStore((s) => s.searchQuery);
  const sortField = useAudioStore((s) => s.sortField);
  const sortOrder = useAudioStore((s) => s.sortOrder);
  const statusFilter = useAudioStore((s) => s.statusFilter);
  const tagFilter = useAudioStore((s) => s.tagFilter);
  const starFilter = useAudioStore((s) => s.starFilter);
  const viewMode = useAudioStore((s) => s.viewMode);

  const filtered = useMemo(() => {
    let list = files;

    if (statusFilter !== "all") {
      list = list.filter((f) => f.transcriptionStatus === statusFilter);
    }
    if (starFilter) {
      list = list.filter((f) => f.starred);
    }
    if (tagFilter) {
      list = list.filter((f) => f.tags.includes(tagFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }

    list = [...list].sort((a, b) => {
      const cmp = compareByField(a, b, sortField);
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return list;
  }, [files, searchQuery, sortField, sortOrder, statusFilter, tagFilter, starFilter]);

  const visibleIds = useMemo(() => filtered.map((f) => f.id), [filtered]);
  const tree = useMemo(() => buildFileTree(filtered), [filtered]);
  const flat = isFlat(tree);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-text-secondary">
        <svg className="size-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        {files.length === 0 ? (
          <>
            <p className="text-sm">暂无音频文件</p>
            <p className="text-xs">点击「导入」添加音频，或将文件拖拽到此处</p>
          </>
        ) : (
          <p className="text-sm">没有匹配的文件</p>
        )}
      </div>
    );
  }

  // 网格视图：不分文件夹层级
  if (viewMode === "grid") {
    return <FileGrid files={filtered} visibleIds={visibleIds} onContextMenu={onContextMenu} />;
  }

  // 列表视图
  if (flat) {
    return (
      <div className="space-y-0.5 p-2">
        {tree.files.map((file) => (
          <FileItem key={file.id} file={file} visibleIds={visibleIds} onContextMenu={onContextMenu} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-2">
      {tree.children.map((child) => (
        <FolderNodeView key={child.fullPath} node={child} depth={0} visibleIds={visibleIds} onContextMenu={onContextMenu} />
      ))}
      {tree.files.length > 0 && (
        <div className="space-y-0.5">
          {tree.files.map((file) => (
            <FileItem key={file.id} file={file} visibleIds={visibleIds} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNodeView({
  node,
  depth,
  visibleIds,
  onContextMenu,
}: {
  node: FolderNode;
  depth: number;
  visibleIds: string[];
  onContextMenu: (e: React.MouseEvent, file: AudioFile) => void;
}) {
  const expandedFolders = useAudioStore((s) => s.expandedFolders);
  const toggleFolder = useAudioStore((s) => s.toggleFolder);
  const expanded = expandedFolders.has(node.fullPath);

  return (
    <div>
      <button
        onClick={() => toggleFolder(node.fullPath)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-secondary"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <svg
          className={`size-3.5 shrink-0 text-text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg className="size-4 shrink-0 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="truncate font-medium">{node.name}</span>
        <span className="ml-auto shrink-0 text-xs text-text-secondary">{node.totalFiles}</span>
      </button>

      {expanded && (
        <div>
          {node.children.map((child) => (
            <FolderNodeView key={child.fullPath} node={child} depth={depth + 1} visibleIds={visibleIds} onContextMenu={onContextMenu} />
          ))}
          <div className="space-y-0.5" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
            {node.files.map((file) => (
              <FileItem key={file.id} file={file} visibleIds={visibleIds} onContextMenu={onContextMenu} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function compareByField(a: AudioFile, b: AudioFile, field: SortField): number {
  switch (field) {
    case "name":
      return a.name.localeCompare(b.name);
    case "duration":
      return a.duration - b.duration;
    case "size":
      return a.size - b.size;
    case "createdAt":
      return a.createdAt.localeCompare(b.createdAt);
  }
}
