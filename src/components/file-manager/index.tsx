import { useState, useCallback } from "react";
import type { AudioFile, RelocateResult } from "@/lib/types";
import type { FolderNode } from "@/lib/file-tree";
import { useAudioStore } from "@/stores/audio-store";
import { listAudioFiles } from "@/lib/tauri";
import { Toolbar } from "./toolbar";
import { FolderTree } from "./folder-tree";
import { ContextMenu, type ContextMenuState, FolderContextMenu, type FolderContextMenuState } from "./context-menu";
import { ImportDropZone } from "./import-drop-zone";
import { BatchBar } from "./batch-bar";
import { QueueProgress } from "./queue-progress";
import { TagEditor } from "./tag-editor";
import { RelocateDialog } from "./relocate-dialog";

export function FileManager() {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [folderCtxMenu, setFolderCtxMenu] = useState<FolderContextMenuState | null>(null);
  const [tagEditor, setTagEditor] = useState<{ fileIds: string[]; rect?: DOMRect | null } | null>(null);
  const [relocateResult, setRelocateResult] = useState<RelocateResult | null>(null);
  const selectedFileIds = useAudioStore((s) => s.selectedFileIds);
  const setFiles = useAudioStore((s) => s.setFiles);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: AudioFile) => {
      e.preventDefault();
      setFolderCtxMenu(null);
      setCtxMenu({ file, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: FolderNode) => {
      e.preventDefault();
      setCtxMenu(null);
      setFolderCtxMenu({ folder, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleEditTags = useCallback(
    (file: AudioFile, rect: DOMRect) => {
      setTagEditor({ fileIds: [file.id], rect });
    },
    [],
  );

  const handleBatchTag = useCallback(() => {
    const ids = Array.from(selectedFileIds);
    if (ids.length === 0) return;
    setTagEditor({ fileIds: ids, rect: null });
  }, [selectedFileIds]);

  const handleRelocateConfirm = useCallback(async () => {
    setRelocateResult(null);
    try {
      const files = await listAudioFiles();
      setFiles(files);
    } catch (err) {
      console.error("[路径配准] 刷新文件列表失败", err);
    }
  }, [setFiles]);

  return (
    <ImportDropZone>
      <Toolbar />
      <div className="flex-1 overflow-y-auto">
        <FolderTree onContextMenu={handleContextMenu} onFolderContextMenu={handleFolderContextMenu} />
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">
        <QueueProgress />
        <BatchBar onOpenTagEditor={handleBatchTag} />
      </div>

      {ctxMenu && (
        <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} onEditTags={handleEditTags} />
      )}

      {folderCtxMenu && (
        <FolderContextMenu
          state={folderCtxMenu}
          onClose={() => setFolderCtxMenu(null)}
          onRelocateResult={setRelocateResult}
        />
      )}

      {tagEditor && (
        <TagEditor
          fileIds={tagEditor.fileIds}
          anchorRect={tagEditor.rect}
          onClose={() => setTagEditor(null)}
        />
      )}
      {relocateResult && (
        <RelocateDialog
          result={relocateResult}
          onConfirm={handleRelocateConfirm}
          onClose={() => setRelocateResult(null)}
        />
      )}
    </ImportDropZone>
  );
}
