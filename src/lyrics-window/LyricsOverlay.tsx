import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { LyricsSettings, LyricsSyncPayload, TranscriptionSegment } from "@/lib/types";
import { defaultLyricsSettings } from "@/lib/types";
import { setLyricsClickThrough, toggleDesktopLyrics } from "@/lib/tauri";
import { useLyricsDrag } from "./use-lyrics-drag";

const LYRICS_STORAGE_KEY = "whisperdesk.lyrics";

function loadLyricsSettings(): LyricsSettings {
  try {
    const raw = localStorage.getItem(LYRICS_STORAGE_KEY);
    if (!raw) return { ...defaultLyricsSettings };
    return { ...defaultLyricsSettings, ...(JSON.parse(raw) as Partial<LyricsSettings>) };
  } catch {
    return { ...defaultLyricsSettings };
  }
}

function saveLyricsSettings(settings: LyricsSettings) {
  try {
    localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 忽略 */
  }
}

function findActiveIndex(segments: TranscriptionSegment[], time: number): number {
  return segments.findIndex((seg) => time >= seg.start && time < seg.end);
}

const THEME_CYCLE: LyricsSettings["theme"][] = ["classic", "light", "dark"];

export function LyricsOverlay() {
  const [sync, setSync] = useState<LyricsSyncPayload>({
    time: 0,
    fileName: "",
    segments: [],
  });
  const [settings, setSettings] = useState<LyricsSettings>(loadLyricsSettings);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void emit("lyrics-ready");
  }, []);

  useEffect(() => {
    const unlisten = listen<LyricsSyncPayload>("lyrics-sync", (event) => {
      setSync(event.payload);
    });
    const unlistenConfig = listen<Partial<LyricsSettings>>("lyrics-config", (event) => {
      setSettings((prev) => {
        const next = { ...prev, ...event.payload };
        saveLyricsSettings(next);
        return next;
      });
    });
    return () => {
      void unlisten.then((off) => off());
      void unlistenConfig.then((off) => off());
    };
  }, []);

  useEffect(() => {
    saveLyricsSettings(settings);
    void setLyricsClickThrough(settings.clickThrough);
  }, [settings]);

  const activeIndex = useMemo(
    () => findActiveIndex(sync.segments, sync.time),
    [sync.segments, sync.time],
  );

  const currentText = useMemo(() => {
    if (!sync.fileName) return "等待播放…";
    if (sync.segments.length === 0) return "暂无字幕（请先完成转录）";
    if (activeIndex >= 0) return sync.segments[activeIndex]?.text ?? "";
    return sync.segments[0]?.text ?? "";
  }, [sync.fileName, sync.segments, activeIndex]);

  const nextText =
    activeIndex >= 0 && activeIndex < sync.segments.length - 1
      ? sync.segments[activeIndex + 1]?.text
      : "";

  const { onMouseDown: onDragMouseDown } = useLyricsDrag(!settings.clickThrough);

  const updateSettings = useCallback((partial: Partial<LyricsSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(settings.theme);
    updateSettings({ theme: THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] });
  };

  const handleClose = async () => {
    setMenu(null);
    await toggleDesktopLyrics();
    await emit("lyrics-window-closed");
  };

  useEffect(() => {
    const onUnload = () => {
      void emit("lyrics-window-closed");
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  return (
    <div
      className={`lyrics-root lyrics-theme-${settings.theme} ${settings.clickThrough ? "locked" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div
        className="lyrics-drag-region"
        onMouseDown={onDragMouseDown}
      >
        {sync.fileName && (
          <div className="lyrics-file-name">{sync.fileName}</div>
        )}
        <div className="lyrics-current" style={{ fontSize: settings.fontSize }}>
          {currentText}
        </div>
        {nextText && (
          <div className="lyrics-next" style={{ fontSize: settings.fontSize * 0.75 }}>
            {nextText}
          </div>
        )}
      </div>

      {menu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 cursor-default"
            style={{ background: "transparent" }}
            onClick={() => setMenu(null)}
          />
          <div
            className="lyrics-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                updateSettings({ fontSize: Math.min(48, settings.fontSize + 2) });
                setMenu(null);
              }}
            >
              增大字体
            </button>
            <button
              type="button"
              onClick={() => {
                updateSettings({ fontSize: Math.max(16, settings.fontSize - 2) });
                setMenu(null);
              }}
            >
              缩小字体
            </button>
            <button
              type="button"
              onClick={() => {
                cycleTheme();
                setMenu(null);
              }}
            >
              切换主题（{settings.theme}）
            </button>
            <button
              type="button"
              onClick={() => {
                updateSettings({ clickThrough: !settings.clickThrough });
                setMenu(null);
              }}
            >
              {settings.clickThrough ? "解锁（可交互）" : "锁定（鼠标穿透）"}
            </button>
            <button type="button" onClick={handleClose}>
              关闭歌词
            </button>
          </div>
        </>
      )}
    </div>
  );
}
