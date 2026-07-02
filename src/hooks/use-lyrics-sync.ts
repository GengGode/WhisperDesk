import { useCallback, useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { IS_TAURI, getTranscriptionResults } from "@/lib/tauri";
import type { LyricsSyncPayload } from "@/lib/types";
import { useAudioStore } from "@/stores/audio-store";
import { usePlayerStore } from "@/stores/player-store";
import { useTranscriptionStore } from "@/stores/transcription-store";

const SYNC_INTERVAL_MS = 200;

/**
 * 主窗口向歌词窗口推送播放进度与字幕分段。
 *
 * 优化策略：
 *   - 切歌 / 首次同步 / 转录结果加载后 → 推送完整载荷（time + fileName + segments）
 *   - 正常播放中 → 仅推送 { time }，避免每 200ms 发送大量 segments 数据
 */
export function useLyricsSync() {
  const desktopLyricsVisible = usePlayerStore((s) => s.desktopLyricsVisible);
  const setResults = useTranscriptionStore((s) => s.setResults);

  const lastSyncedFileIdRef = useRef<string | null>(null);
  const forceFullRef = useRef(true);

  const buildFullPayload = useCallback((): LyricsSyncPayload => {
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

    return { time: currentTime, fileName: file.name, segments };
  }, []);

  const pushSync = useCallback(() => {
    const { currentIndex, queue, currentTime } = usePlayerStore.getState();
    const fileId = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;

    const needFull = forceFullRef.current || fileId !== lastSyncedFileIdRef.current;

    if (needFull) {
      forceFullRef.current = false;
      lastSyncedFileIdRef.current = fileId;
      void emit("lyrics-sync", buildFullPayload());
    } else {
      void emit("lyrics-sync", { time: currentTime } satisfies LyricsSyncPayload);
    }
  }, [buildFullPayload]);

  /** 强制下次推送发送完整载荷 */
  const requestFullSync = useCallback(() => {
    forceFullRef.current = true;
    pushSync();
  }, [pushSync]);

  useEffect(() => {
    if (!IS_TAURI || !desktopLyricsVisible) return;

    forceFullRef.current = true;
    lastSyncedFileIdRef.current = null;
    pushSync();
    const id = setInterval(pushSync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [desktopLyricsVisible, pushSync]);

  useEffect(() => {
    if (!IS_TAURI) return;

    const unlisten = listen("lyrics-ready", () => {
      if (!usePlayerStore.getState().desktopLyricsVisible) return;
      requestFullSync();
    });

    return () => {
      void unlisten.then((off) => off());
    };
  }, [requestFullSync]);

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
          requestFullSync();
        }
      })
      .catch(() => {
        /* 忽略加载失败 */
      });
  }, [desktopLyricsVisible, requestFullSync, setResults]);
}
