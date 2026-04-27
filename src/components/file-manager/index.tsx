import { useState, useCallback } from "react";
import type { AudioFile } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";
import { Toolbar } from "./toolbar";
import { FolderTree } from "./folder-tree";
import { ContextMenu, type ContextMenuState } from "./context-menu";
import { ImportDropZone } from "./import-drop-zone";
import { BatchBar } from "./batch-bar";
import { QueueProgress } from "./queue-progress";
import { TagEditor } from "./tag-editor";

export function FileManager() {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [tagEditor, setTagEditor] = useState<{ fileIds: string[]; rect?: DOMRect | null } | null>(null);
  const selectedFileIds = useAudioStore((s) => s.selectedFileIds);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: AudioFile) => {
      e.preventDefault();
      setCtxMenu({ file, x: e.clientX, y: e.clientY });
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

  return (
    <ImportDropZone>
      <Toolbar />
      <div className="flex-1 overflow-y-auto">
        <FolderTree onContextMenu={handleContextMenu} />
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">
        <QueueProgress />
        <BatchBar onOpenTagEditor={handleBatchTag} />
      </div>

      {ctxMenu && (
        <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} onEditTags={handleEditTags} />
      )}

      {tagEditor && (
        <TagEditor
          fileIds={tagEditor.fileIds}
          anchorRect={tagEditor.rect}
          onClose={() => setTagEditor(null)}
        />
      )}
    </ImportDropZone>
  );
}
