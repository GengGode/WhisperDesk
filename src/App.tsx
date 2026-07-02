import { useEffect, useState } from "react";
import { FileTreeSidebar } from "@/components/ui/file-tree-sidebar";
import { TopNav } from "@/components/ui/top-nav";
import { FileManager } from "@/components/file-manager";
import { LogsPanel } from "@/components/logs";
import { TranscriptionPanel } from "@/components/transcription";
import { EditorPanel } from "@/components/editor";
import { SettingsPanel } from "@/components/settings";
import {
  IS_TAURI,
  listAudioFiles,
  listAllTags,
  listenModelDownloadProgress,
  listenTranscriptionPartial,
  listenTranscriptionProgress,
  listenWhisperLog,
  startApiServer,
  startWebServer,
  toggleDesktopLyrics,
} from "@/lib/tauri";
import { emit, listen } from "@tauri-apps/api/event";
import { useAudioStore } from "@/stores/audio-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { useTranscriptionQueue } from "@/hooks/use-transcription-queue";
import { useTheme } from "@/hooks/use-theme";
import { useLyricsSync } from "@/hooks/use-lyrics-sync";
import { PlayerBar } from "@/components/player-bar";
import { usePlayerStore } from "@/stores/player-store";

type Page = "files" | "transcription" | "editor" | "logs" | "settings";

function App() {
  const [page, setPage] = useState<Page>("files");
  const setFiles = useAudioStore((s) => s.setFiles);
  const setAllTags = useAudioStore((s) => s.setAllTags);
  const appendLiveSegments = useTranscriptionStore((s) => s.appendLiveSegments);
  const setActiveTask = useTranscriptionStore((s) => s.setActiveTask);
  const setModelDownload = useTranscriptionStore((s) => s.setModelDownload);
  const addLog = useTranscriptionStore((s) => s.addLog);
  const initCuda = useSettingsStore((s) => s.initCuda);
  const showFileTree = page !== "files" && page !== "settings";

  const initEngine = usePlayerStore((s) => s.initEngine);

  useTheme();
  useTranscriptionQueue();
  useLyricsSync();

  useEffect(() => {
    initEngine();
  }, [initEngine]);

  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = listen("lyrics-window-closed", () => {
      usePlayerStore.getState().setDesktopLyricsVisible(false);
    });
    const unlistenSettings = listen<{ fontSize?: number; theme?: string }>(
      "lyrics-settings-changed",
      (event) => {
        const p = event.payload;
        const patch: Record<string, unknown> = {};
        if (typeof p.fontSize === "number") patch.lyricsFontSize = p.fontSize;
        if (p.theme) patch.lyricsTheme = p.theme;
        if (Object.keys(patch).length > 0) {
          useSettingsStore.getState().setSettings(patch);
        }
      },
    );
    const unlistenPlayerAction = listen<{ action: string; time?: number }>(
      "lyrics-player-action",
      (event) => {
        const store = usePlayerStore.getState();
        switch (event.payload.action) {
          case "toggle":
            store.togglePlay();
            break;
          case "next":
            store.next();
            break;
          case "previous":
            store.previous();
            break;
          case "seek":
            if (typeof event.payload.time === "number") {
              store.seek(event.payload.time);
            }
            break;
        }
      },
    );
    return () => {
      void unlisten.then((off) => off());
      void unlistenSettings.then((off) => off());
      void unlistenPlayerAction.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (IS_TAURI) {
      const { silentStart, apiAutoStart, webAutoStart, inferenceServerPort, webPort } =
        useSettingsStore.getState().settings;
      if (!silentStart) {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().show(),
        );
      }
      if (apiAutoStart) {
        console.log("[App] 自动启动 API 服务，端口:", inferenceServerPort);
        startApiServer(inferenceServerPort).catch((err) =>
          console.error("[App] API 服务启动失败", err),
        );
      }
      if (webAutoStart) {
        console.log("[App] 自动启动 Web 界面，端口:", webPort);
        startWebServer(webPort, inferenceServerPort).catch((err) =>
          console.warn("[App] Web 前端启动失败:", err),
        );
      }

      const { lyricsAutoStart, lyricsFontSize, lyricsTheme } =
        useSettingsStore.getState().settings;
      if (lyricsAutoStart) {
        toggleDesktopLyrics()
          .then((visible) => {
            usePlayerStore.getState().setDesktopLyricsVisible(visible);
            if (visible) {
              void emit("lyrics-config", {
                fontSize: lyricsFontSize,
                theme: lyricsTheme,
              });
            }
          })
          .catch((err) => console.warn("[App] 桌面歌词启动失败:", err));
      }
    }

    console.log("[App] 初始化：检测 CUDA");
    void initCuda();

    console.log("[App] 初始化：加载音频列表");
    void listAudioFiles()
      .then((files) => {
        console.log("[App] 音频列表加载完成", files.length, "个文件");
        setFiles(files);
      })
      .catch((err) => console.error("[App] 加载音频列表失败", err));

    void listAllTags()
      .then((tags) => setAllTags(tags))
      .catch((err) => console.error("[App] 加载标签列表失败", err));

    const unlistenProgress = listenTranscriptionProgress((payload) => {
      console.log("[事件] 转录进度", payload);
      setActiveTask(payload.progress >= 1 ? null : payload);
    });
    const unlistenPartial = listenTranscriptionPartial((payload) => {
      appendLiveSegments(payload.audioFileId, payload.segments);
    });
    const unlistenModel = listenModelDownloadProgress((payload) => {
      console.log("[事件] 模型下载进度", payload);
      setModelDownload(payload.progress >= 1 ? null : payload);
    });
    const unlistenLog = listenWhisperLog((payload) => {
      addLog(payload.message);
    });

    return () => {
      void unlistenProgress.then((off) => off());
      void unlistenPartial.then((off) => off());
      void unlistenModel.then((off) => off());
      void unlistenLog.then((off) => off());
    };
  }, [appendLiveSegments, initCuda, addLog, setActiveTask, setFiles, setModelDownload, setAllTags]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopNav page={page} onChangePage={setPage} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showFileTree && <FileTreeSidebar />}
        <main className="flex min-w-0 flex-1 overflow-hidden">
          {page === "files" && <FileManager />}
          {page === "transcription" && <TranscriptionPanel />}
          {page === "editor" && <EditorPanel />}
          {page === "logs" && <LogsPanel />}
          {page === "settings" && <SettingsPanel />}
        </main>
      </div>
      <PlayerBar />
    </div>
  );
}

export default App;
