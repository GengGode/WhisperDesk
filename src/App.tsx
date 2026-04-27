import { useEffect, useState } from "react";
import { Sidebar } from "@/components/ui/sidebar";
import { SidebarItem } from "@/components/ui/sidebar-item";
import { FileManager } from "@/components/file-manager";
import { TranscriptionPanel } from "@/components/transcription";
import { EditorPanel } from "@/components/editor";
import { SettingsPanel } from "@/components/settings";
import {
  listAudioFiles,
  listenModelDownloadProgress,
  listenTranscriptionProgress,
  listenWhisperLog,
} from "@/lib/tauri";
import { useAudioStore } from "@/stores/audio-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTranscriptionStore } from "@/stores/transcription-store";

type Page = "files" | "transcription" | "editor" | "settings";

function App() {
  const [page, setPage] = useState<Page>("files");
  const setFiles = useAudioStore((s) => s.setFiles);
  const setActiveTask = useTranscriptionStore((s) => s.setActiveTask);
  const setModelDownload = useTranscriptionStore((s) => s.setModelDownload);
  const addLog = useTranscriptionStore((s) => s.addLog);
  const initCuda = useSettingsStore((s) => s.initCuda);

  useEffect(() => {
    console.log("[App] 初始化：检测 CUDA");
    void initCuda();

    console.log("[App] 初始化：加载音频列表");
    void listAudioFiles()
      .then((files) => {
        console.log("[App] 音频列表加载完成", files.length, "个文件");
        setFiles(files);
      })
      .catch((err) => console.error("[App] 加载音频列表失败", err));

    const unlistenProgress = listenTranscriptionProgress((payload) => {
      console.log("[事件] 转录进度", payload);
      setActiveTask(payload.progress >= 1 ? null : payload);
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
      void unlistenModel.then((off) => off());
      void unlistenLog.then((off) => off());
    };
  }, [initCuda, addLog, setActiveTask, setFiles, setModelDownload]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar>
        <SidebarItem
          label="音频文件"
          active={page === "files"}
          onClick={() => setPage("files")}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          }
        />
        <SidebarItem
          label="转录"
          active={page === "transcription"}
          onClick={() => setPage("transcription")}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
              />
            </svg>
          }
        />
        <SidebarItem
          label="编辑器"
          active={page === "editor"}
          onClick={() => setPage("editor")}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          }
        />
        <SidebarItem
          label="设置"
          active={page === "settings"}
          onClick={() => setPage("settings")}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          }
        />
      </Sidebar>

      <main className="flex flex-1 overflow-hidden">
        {page === "files" && <FileManager />}
        {page === "transcription" && <TranscriptionPanel />}
        {page === "editor" && <EditorPanel />}
        {page === "settings" && <SettingsPanel />}
      </main>
    </div>
  );
}

export default App;
