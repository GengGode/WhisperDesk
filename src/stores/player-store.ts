import { create } from "zustand";
import type { PlayMode } from "@/lib/types";
import { audioEngine } from "@/lib/audio-engine";
import { getAudioUrl } from "@/lib/tauri";
import { useAudioStore } from "@/stores/audio-store";

const PLAYER_STORAGE_KEY = "whisperdesk.player";

interface PlayerPersisted {
  volume: number;
  muted: boolean;
  playMode: PlayMode;
}

function loadPersisted(): PlayerPersisted {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (!raw) {
      return { volume: 100, muted: false, playMode: "sequential" };
    }
    const parsed = JSON.parse(raw) as Partial<PlayerPersisted>;
    return {
      volume: typeof parsed.volume === "number" ? Math.min(100, Math.max(0, parsed.volume)) : 100,
      muted: Boolean(parsed.muted),
      playMode: parsed.playMode ?? "sequential",
    };
  } catch {
    return { volume: 100, muted: false, playMode: "sequential" };
  }
}

function savePersisted(data: PlayerPersisted) {
  try {
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 忽略存储失败 */
  }
}

const persisted = loadPersisted();

function resolveFileUrl(fileId: string): string | null {
  const file = useAudioStore.getState().files.find((f) => f.id === fileId);
  if (!file) return null;
  return getAudioUrl(fileId, file.path);
}

function pickShuffleIndex(queue: string[], currentIndex: number): number {
  if (queue.length <= 1) return 0;
  let next = currentIndex;
  while (next === currentIndex) {
    next = Math.floor(Math.random() * queue.length);
  }
  return next;
}

interface PlayerState {
  queue: string[];
  currentIndex: number;
  status: "idle" | "playing" | "paused";
  currentTime: number;
  duration: number;
  playMode: PlayMode;
  volume: number;
  muted: boolean;
  desktopLyricsVisible: boolean;
  error: string | null;

  /** 初始化 AudioEngine 回调（App 启动时调用一次） */
  initEngine: () => void;
  playFile: (fileId: string) => void;
  playFiles: (fileIds: string[], startIndex?: number) => void;
  enqueue: (fileIds: string[]) => void;
  playNextAfterCurrent: (fileIds: string[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  next: () => void;
  previous: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setPlayMode: (mode: PlayMode) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setDesktopLyricsVisible: (visible: boolean) => void;
  toggleDesktopLyrics: () => void;
  /** 确保当前播放指定文件（用于编辑器联动） */
  ensureFile: (fileId: string) => void;
}

function loadAndPlay(fileId: string, autoplay = true) {
  const url = resolveFileUrl(fileId);
  if (!url) return;
  audioEngine.load(url);
  audioEngine.setVolume(
    usePlayerStore.getState().volume,
    usePlayerStore.getState().muted,
  );
  if (autoplay) {
    void audioEngine.play().catch((err) => {
      usePlayerStore.setState({ error: String(err), status: "paused" });
    });
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  status: "idle",
  currentTime: 0,
  duration: 0,
  playMode: persisted.playMode,
  volume: persisted.volume,
  muted: persisted.muted,
  desktopLyricsVisible: false,
  error: null,

  initEngine: () => {
    audioEngine.setCallbacks({
      onTimeUpdate: (time) => set({ currentTime: time }),
      onDurationChange: (duration) => set({ duration }),
      onPlay: () => set({ status: "playing", error: null }),
      onPause: () =>
        set((state) => ({
          status: state.currentIndex >= 0 ? "paused" : "idle",
        })),
      onEnded: () => {
        get().next();
      },
      onError: (message) => set({ error: message, status: "paused" }),
    });
    audioEngine.setVolume(get().volume, get().muted);
  },

  playFile: (fileId) => {
    set({ queue: [fileId], currentIndex: 0, error: null });
    loadAndPlay(fileId);
  },

  playFiles: (fileIds, startIndex = 0) => {
    if (fileIds.length === 0) return;
    const idx = Math.min(Math.max(0, startIndex), fileIds.length - 1);
    set({ queue: [...fileIds], currentIndex: idx, error: null });
    loadAndPlay(fileIds[idx]);
  },

  enqueue: (fileIds) => {
    if (fileIds.length === 0) return;
    set((state) => {
      const existing = new Set(state.queue);
      const toAdd = fileIds.filter((id) => !existing.has(id));
      return { queue: [...state.queue, ...toAdd] };
    });
  },

  playNextAfterCurrent: (fileIds) => {
    if (fileIds.length === 0) return;
    set((state) => {
      const insertAt = state.currentIndex >= 0 ? state.currentIndex + 1 : state.queue.length;
      const nextQueue = [...state.queue];
      for (let i = fileIds.length - 1; i >= 0; i--) {
        const id = fileIds[i];
        if (!nextQueue.includes(id)) {
          nextQueue.splice(insertAt, 0, id);
        }
      }
      return { queue: nextQueue };
    });
  },

  removeFromQueue: (index) => {
    set((state) => {
      if (index < 0 || index >= state.queue.length) return state;
      const nextQueue = state.queue.filter((_, i) => i !== index);
      let nextIndex = state.currentIndex;
      if (index < state.currentIndex) {
        nextIndex -= 1;
      } else if (index === state.currentIndex) {
        if (nextQueue.length === 0) {
          audioEngine.pause();
          return {
            queue: [],
            currentIndex: -1,
            status: "idle" as const,
            currentTime: 0,
            duration: 0,
          };
        }
        nextIndex = Math.min(nextIndex, nextQueue.length - 1);
        loadAndPlay(nextQueue[nextIndex]);
      }
      return { queue: nextQueue, currentIndex: nextIndex };
    });
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.queue.length ||
        toIndex >= state.queue.length
      ) {
        return state;
      }
      const nextQueue = [...state.queue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, moved);

      let nextIndex = state.currentIndex;
      if (state.currentIndex === fromIndex) {
        nextIndex = toIndex;
      } else if (fromIndex < state.currentIndex && toIndex >= state.currentIndex) {
        nextIndex -= 1;
      } else if (fromIndex > state.currentIndex && toIndex <= state.currentIndex) {
        nextIndex += 1;
      }
      return { queue: nextQueue, currentIndex: nextIndex };
    });
  },

  clearQueue: () => {
    audioEngine.pause();
    set({
      queue: [],
      currentIndex: -1,
      status: "idle",
      currentTime: 0,
      duration: 0,
      error: null,
    });
  },

  next: () => {
    const { queue, currentIndex, playMode } = get();
    if (queue.length === 0 || currentIndex < 0) return;

    if (playMode === "loop-one") {
      get().seek(0);
      void audioEngine.play();
      return;
    }

    let nextIndex = currentIndex + 1;
    if (playMode === "shuffle") {
      nextIndex = pickShuffleIndex(queue, currentIndex);
    } else if (nextIndex >= queue.length) {
      if (playMode === "loop-all") {
        nextIndex = 0;
      } else {
        set({ status: "idle", currentTime: 0 });
        return;
      }
    }

    set({ currentIndex: nextIndex, error: null });
    loadAndPlay(queue[nextIndex]);
  },

  previous: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0 || currentIndex < 0) return;

    if (get().currentTime > 3) {
      get().seek(0);
      return;
    }

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
    set({ currentIndex: prevIndex, error: null });
    loadAndPlay(queue[prevIndex]);
  },

  togglePlay: () => {
    const { currentIndex, queue, status } = get();
    if (currentIndex < 0 && queue.length > 0) {
      set({ currentIndex: 0 });
      loadAndPlay(queue[0]);
      return;
    }
    if (currentIndex < 0) return;

    if (status === "playing") {
      audioEngine.pause();
    } else {
      void audioEngine.play().catch((err) => {
        set({ error: String(err) });
      });
    }
  },

  seek: (time) => {
    audioEngine.seek(time);
    set({ currentTime: time });
  },

  setPlayMode: (mode) => {
    set({ playMode: mode });
    savePersisted({
      volume: get().volume,
      muted: get().muted,
      playMode: mode,
    });
  },

  setVolume: (vol) => {
    const clamped = Math.min(100, Math.max(0, Math.round(vol)));
    const muted = get().muted;
    audioEngine.setVolume(clamped, muted && clamped > 0 ? false : muted);
    set({
      volume: clamped,
      muted: clamped > 0 ? false : muted,
    });
    savePersisted({
      volume: clamped,
      muted: clamped > 0 ? false : muted,
      playMode: get().playMode,
    });
  },

  toggleMute: () => {
    const { volume, muted } = get();
    const nextMuted = !muted;
    audioEngine.setVolume(volume, nextMuted);
    set({ muted: nextMuted });
    savePersisted({
      volume,
      muted: nextMuted,
      playMode: get().playMode,
    });
  },

  setDesktopLyricsVisible: (visible) => set({ desktopLyricsVisible: visible }),

  toggleDesktopLyrics: () =>
    set((state) => ({ desktopLyricsVisible: !state.desktopLyricsVisible })),

  ensureFile: (fileId) => {
    const { queue, currentIndex } = get();
    if (currentIndex >= 0 && queue[currentIndex] === fileId) return;

    const existingIndex = queue.indexOf(fileId);
    if (existingIndex >= 0) {
      set({ currentIndex: existingIndex, error: null });
      loadAndPlay(fileId, false);
      return;
    }

    set({
      queue: [fileId, ...queue],
      currentIndex: 0,
      error: null,
    });
    loadAndPlay(fileId, false);
  },
}));
