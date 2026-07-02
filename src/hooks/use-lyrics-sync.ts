import { useCallback, useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { IS_TAURI, getTranscriptionResults } from "@/lib/tauri";
import type { LyricsSyncPayload } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";
import { usePlayerStore } from "@/stores/player-store";
import { useTranscriptionStore } from "@/stores/transcription-store";

const SYNC_INTERVAL_MS = 200;

/**
 * 主窗口向歌词窗口推送播放进度与字幕分段。
 */
export function useLyricsSync() {
  const desktopLyricsVisible = usePlayerStore((s) => s.desktopLyricsVisible);
  const setResults = useTranscriptionStore((s) => s.setResults);

  const buildPayload = useCallback((): LyricsSyncPayload => {
    const { currentIndex, queue, currentTime } = usePlayerStore.getState();
    const files = useAudioStore.getState().files;
    const results = useTranscriptionStore.getState().results;

    if (currentIndex < 0) {
      return { time: 0, fileName: "", segments: [] };
    }

    const fileId = queue[currentIndex];
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return { time: currentTime, fileName: "", segments: [] };
    }

    const fileResults = results.get(fileId) ?? [];
    const segments = fileResults[0]?.segments ?? [];

    return {
      time: currentTime,
      fileName: file.name,
      segments,
    };
  }, []);

  const pushSync = useCallback(() => {
    void emit("lyrics-sync", buildPayload());
  }, [buildPayload]);

  /** 歌词窗口可见时定时推送；暂停时 currentTime 不变也能持续同步 */
  useEffect(() => {
    if (!IS_TAURI || !desktopLyricsVisible) return;

    pushSync();
    const id = setInterval(pushSync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [desktopLyricsVisible, pushSync]);

  /** 歌词窗口就绪时立即推送一次 */
  useEffect(() => {
    if (!IS_TAURI) return;

    const unlisten = listen("lyrics-ready", () => {
      if (!usePlayerStore.getState().desktopLyricsVisible) return;
      pushSync();
    });

    return () => {
      void unlisten.then((off) => off());
    };
  }, [pushSync]);

  /** 若内存中无转录结果，后台加载后触发同步 */
  useEffect(() => {
    if (!IS_TAURI || !desktopLyricsVisible) return;

    const { currentIndex, queue } = usePlayerStore.getState();
    if (currentIndex < 0) return;

    const fileId = queue[currentIndex];
    const file = useAudioStore.getState().files.find((f) => f.id === fileId);
    if (!file || file.transcriptionStatus !== "completed") return;
    if (useTranscriptionStore.getState().results.has(fileId)) return;

    void getTranscriptionResults(fileId)
      .then((stored) => {
        if (stored.length > 0) {
          setResults(fileId, stored);
          pushSync();
        }
      })
      .catch(() => {
        /* 忽略加载失败 */
      });
  }, [desktopLyricsVisible, pushSync, setResults]);
}
