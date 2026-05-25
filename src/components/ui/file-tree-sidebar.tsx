import { useEffect, useMemo } from "react";
import { buildFileTree, type FolderNode } from "@/lib/file-tree";
import type { AudioFile, TranscriptionStatus } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";

const STATUS_COLOR: Record<TranscriptionStatus, string> = {
  pending: "bg-text-secondary/40",
  transcribing: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

export function FileTreeSidebar() {
  const files = useAudioStore((s) => s.files);
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const expandedFolders = useAudioStore((s) => s.expandedFolders);
  const expandAllFolders = useAudioStore((s) => s.expandAllFolders);

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

    const next = new Set(expandedFolders);
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
  }, [expandAllFolders, expandedFolders, selectedFile]);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-secondary/40">
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
