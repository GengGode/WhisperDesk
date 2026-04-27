import { useState, useCallback } from "react";
import type { AudioFile } from "@/lib/types";
import { Toolbar } from "./toolbar";
import { FolderTree } from "./folder-tree";
import { ContextMenu, type ContextMenuState } from "./context-menu";
import { ImportDropZone } from "./import-drop-zone";

export function FileManager() {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: AudioFile) => {
      e.preventDefault();
      setCtxMenu({ file, x: e.clientX, y: e.clientY });
    },
    [],
  );

  return (
    <ImportDropZone>
      <Toolbar />
      <div className="flex-1 overflow-y-auto">
        <FolderTree onContextMenu={handleContextMenu} />
      </div>
      {ctxMenu && (
        <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </ImportDropZone>
  );
}
