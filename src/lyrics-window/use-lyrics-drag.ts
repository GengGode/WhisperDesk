import { useEffect, useRef } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { saveLyricsWindowPosition } from "@/lib/tauri";

interface DragState {
  active: boolean;
  startScreenX: number;
  startScreenY: number;
  winX: number;
  winY: number;
}

/**
 * 手动拖拽歌词窗口（Windows 透明 WebView2 下 startDragging 不可靠）。
 */
export function useLyricsDrag(enabled: boolean) {
  const dragRef = useRef<DragState>({
    active: false,
    startScreenX: 0,
    startScreenY: 0,
    winX: 0,
    winY: 0,
  });

  const saveCurrentPosition = async () => {
    try {
      const pos = await getCurrentWindow().outerPosition();
      await saveLyricsWindowPosition(pos.x, pos.y);
    } catch {
      /* 忽略 */
    }
  };

  const onMouseDown = async (e: React.MouseEvent) => {
    if (!enabled || e.button !== 0) return;
    e.preventDefault();
    try {
      const pos = await getCurrentWindow().outerPosition();
      dragRef.current = {
        active: true,
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        winX: pos.x,
        winY: pos.y,
      };
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;

      const dx = e.screenX - drag.startScreenX;
      const dy = e.screenY - drag.startScreenY;
      void getCurrentWindow().setPosition(
        new PhysicalPosition(drag.winX + dx, drag.winY + dy),
      );
    };

    const onMouseUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      void saveCurrentPosition();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const onUnload = () => {
      void saveCurrentPosition();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  return { onMouseDown };
}
