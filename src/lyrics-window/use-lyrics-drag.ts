import { useCallback, useRef } from "react";
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
 * 使用 Pointer Events + setPointerCapture 实现歌词窗口拖拽。
 * 相比旧方案（全局 mousemove），指针捕获保证鼠标移出窗口时事件不丢失。
 */
export function useLyricsDrag(enabled: boolean) {
  const dragRef = useRef<DragState>({
    active: false,
    startScreenX: 0,
    startScreenY: 0,
    winX: 0,
    winY: 0,
  });

  const onPointerDown = useCallback(
    async (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      e.preventDefault();

      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      // 同步捕获坐标，避免 await 后合成事件状态不可靠
      const screenX = e.screenX;
      const screenY = e.screenY;

      try {
        const pos = await getCurrentWindow().outerPosition();
        dragRef.current = {
          active: true,
          startScreenX: screenX,
          startScreenY: screenY,
          winX: pos.x,
          winY: pos.y,
        };
      } catch {
        el.releasePointerCapture(e.pointerId);
      }
    },
    [enabled],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active) return;

    const scale = window.devicePixelRatio || 1;
    const dx = (e.screenX - drag.startScreenX) * scale;
    const dy = (e.screenY - drag.startScreenY) * scale;
    void getCurrentWindow().setPosition(
      new PhysicalPosition(drag.winX + dx, drag.winY + dy),
    );
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;

    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }

    void (async () => {
      try {
        const pos = await getCurrentWindow().outerPosition();
        await saveLyricsWindowPosition(pos.x, pos.y);
      } catch {
        /* 忽略 */
      }
    })();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}
