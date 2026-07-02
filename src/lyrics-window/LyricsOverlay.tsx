import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { LyricsBackdropEffect, LyricsSettings, LyricsSyncPayload, LyricsSyncState, TranscriptionSegment } from "@/lib/types";
import { defaultLyricsSettings } from "@/lib/types";
import { setLyricsClickThrough, setLyricsBackdrop, toggleDesktopLyrics } from "@/lib/tauri";
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
const BACKDROP_CYCLE: LyricsBackdropEffect[] = ["none", "blur", "acrylic", "mica"];
const BACKDROP_LABELS: Record<LyricsBackdropEffect, string> = {
  none: "无",
  blur: "模糊",
  acrylic: "亚克力",
  mica: "云母",
};

function backdropColor(theme: LyricsSettings["theme"], opacity: number): [number, number, number, number] {
  const alpha = Math.round((opacity / 100) * 255);
  switch (theme) {
    case "light":
      return [255, 255, 255, alpha];
    case "dark":
      return [15, 23, 42, alpha];
    default:
      return [0, 0, 0, alpha];
  }
}

export function LyricsOverlay() {
  const [sync, setSync] = useState<LyricsSyncState>({
    time: 0,
    fileName: "",
    segments: [],
  });
  const [settings, setSettings] = useState<LyricsSettings>(loadLyricsSettings);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void emit("lyrics-ready");
  }, []);

  useEffect(() => {
    const unlisten = listen<LyricsSyncPayload>("lyrics-sync", (event) => {
      const p = event.payload;
      setSync((prev) => ({
        time: p.time,
        fileName: p.fileName ?? prev.fileName,
        segments: p.segments ?? prev.segments,
      }));
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
    void emit("lyrics-settings-changed", settings);
  }, [settings]);

  // 毛玻璃效果单独同步到原生窗口
  useEffect(() => {
    const color = backdropColor(settings.theme, settings.bgOpacity);
    void setLyricsBackdrop(settings.backdropEffect, color);
  }, [settings.backdropEffect, settings.theme, settings.bgOpacity]);

  const adjustedTime = sync.time + settings.timeOffset;

  const activeIndex = useMemo(
    () => findActiveIndex(sync.segments, adjustedTime),
    [sync.segments, adjustedTime],
  );

  // 滚动模式：当前行滚动到居中
  useEffect(() => {
    if (settings.displayMode !== "scroll" || activeIndex < 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const activeEl = container.querySelector(`[data-idx="${activeIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex, settings.displayMode]);

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

  const { onPointerDown, onPointerMove, onPointerUp } = useLyricsDrag(!settings.clickThrough);

  const updateSettings = useCallback((partial: Partial<LyricsSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(settings.theme);
    updateSettings({ theme: THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] });
  };

  const cycleBackdrop = () => {
    const idx = BACKDROP_CYCLE.indexOf(settings.backdropEffect);
    updateSettings({ backdropEffect: BACKDROP_CYCLE[(idx + 1) % BACKDROP_CYCLE.length] });
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

  const [hovered, setHovered] = useState(false);

  const handlePlayerAction = (action: string) => {
    void emit("lyrics-player-action", { action });
  };

  const isScroll = settings.displayMode === "scroll";
  const hasGlass = settings.backdropEffect !== "none";

  return (
    <div
      className={`lyrics-root lyrics-theme-${settings.theme} ${settings.clickThrough ? "locked" : ""} ${hasGlass ? "glass" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="lyrics-drag-region"
        style={{
          background: hasGlass
            ? "rgba(0, 0, 0, 0.01)"
            : `rgba(0, 0, 0, ${Math.max(0.01, settings.bgOpacity / 100)})`,
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {sync.fileName && (
          <div className="lyrics-file-name">{sync.fileName}</div>
        )}

        {isScroll ? (
          <div className="lyrics-scroll-container" ref={scrollContainerRef}>
            {sync.segments.length === 0 ? (
              <div className="lyrics-current" style={{ fontSize: settings.fontSize }}>
                {!sync.fileName ? "等待播放…" : "暂无字幕（请先完成转录）"}
              </div>
            ) : (
              sync.segments.map((seg, i) => (
                <div
                  key={`${seg.start}-${i}`}
                  data-idx={i}
                  className={`lyrics-scroll-line ${i === activeIndex ? "active" : ""}`}
                  style={{
                    fontSize: i === activeIndex ? settings.fontSize : settings.fontSize * 0.75,
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void emit("lyrics-player-action", {
                      action: "seek",
                      time: seg.start,
                    });
                  }}
                >
                  {seg.text}
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div key={`cur-${activeIndex}`} className="lyrics-current" style={{ fontSize: settings.fontSize }}>
              {currentText}
            </div>
            {nextText && (
              <div key={`nxt-${activeIndex}`} className="lyrics-next" style={{ fontSize: settings.fontSize * 0.75 }}>
                {nextText}
              </div>
            )}
          </>
        )}
      </div>

      {hovered && !settings.clickThrough && !menu && (
        <div className="lyrics-toolbar">
          <button type="button" onClick={() => handlePlayerAction("previous")} title="上一首">
            ⏮
          </button>
          <button type="button" onClick={() => handlePlayerAction("toggle")} title="播放/暂停">
            ⏯
          </button>
          <button type="button" onClick={() => handlePlayerAction("next")} title="下一首">
            ⏭
          </button>
        </div>
      )}

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
                cycleBackdrop();
                setMenu(null);
              }}
            >
              毛玻璃效果（{BACKDROP_LABELS[settings.backdropEffect]}）
            </button>
            <button
              type="button"
              onClick={() => {
                updateSettings({
                  displayMode: isScroll ? "dual-line" : "scroll",
                });
                setMenu(null);
              }}
            >
              {isScroll ? "切换为双行模式" : "切换为滚动模式"}
            </button>
            <button
              type="button"
              onClick={() =>
                updateSettings({ bgOpacity: Math.min(100, settings.bgOpacity + 10) })
              }
            >
              {hasGlass ? "增加玻璃浓度" : "增加背景不透明度"}（{settings.bgOpacity}%）
            </button>
            <button
              type="button"
              onClick={() =>
                updateSettings({ bgOpacity: Math.max(0, settings.bgOpacity - 10) })
              }
            >
              {hasGlass ? "降低玻璃浓度" : "降低背景不透明度"}
            </button>
            <div className="lyrics-menu-separator" />
            <button
              type="button"
              onClick={() => updateSettings({ timeOffset: settings.timeOffset + 0.5 })}
            >
              歌词延后 +0.5s（当前 {settings.timeOffset.toFixed(1)}s）
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ timeOffset: settings.timeOffset - 0.5 })}
            >
              歌词提前 -0.5s
            </button>
            {settings.timeOffset !== 0 && (
              <button
                type="button"
                onClick={() => updateSettings({ timeOffset: 0 })}
              >
                重置偏移
              </button>
            )}
            <div className="lyrics-menu-separator" />
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
