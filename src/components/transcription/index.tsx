import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "@/components/audio-player";
import { ArticleView } from "@/components/editor/article-view";
import { Waveform } from "@/components/editor/waveform";
import {
  abortTranscription,
  getAudioUrl,
  getTranscriptionResults,
  transcribeAudio,
} from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";

const WAVEFORM_STORAGE_KEY = "whisperdesk.transcriptionShowWaveform";

function readStoredShowWaveform(): boolean {
  try {
    return localStorage.getItem(WAVEFORM_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function TranscriptionPanel() {
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const files = useAudioStore((s) => s.files);
  const updateFile = useAudioStore((s) => s.updateFile);
  const activeTask = useTranscriptionStore((s) => s.activeTask);
  const setActiveTask = useTranscriptionStore((s) => s.setActiveTask);
  const results = useTranscriptionStore((s) => s.results);
  const liveSegmentsByFile = useTranscriptionStore((s) => s.liveSegmentsByFile);
  const addResult = useTranscriptionStore((s) => s.addResult);
  const setResults = useTranscriptionStore((s) => s.setResults);
  const clearLiveSegments = useTranscriptionStore((s) => s.clearLiveSegments);
  const settings = useSettingsStore((s) => s.settings);

  const [error, setError] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [seekTime, setSeekTime] = useState(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showWaveform, setShowWaveform] = useState(readStoredShowWaveform);
  const seekVersionRef = useRef(0);

  const selectedFile = files.find((file) => file.id === selectedFileId);
  const allResults = selectedFileId ? results.get(selectedFileId) ?? [] : [];
  const liveSegments = selectedFileId ? liveSegmentsByFile.get(selectedFileId) ?? [] : [];
  const currentResult = allResults[activeResultIndex];

  const isCurrentFileTranscribing = activeTask?.audioFileId === selectedFileId;
  const hasOtherActiveTask = Boolean(activeTask && activeTask.audioFileId !== selectedFileId);

  const displaySegments = useMemo(() => {
    if (isCurrentFileTranscribing) {
      return liveSegments;
    }
    return currentResult?.segments ?? [];
  }, [currentResult?.segments, isCurrentFileTranscribing, liveSegments]);

  useEffect(() => {
    setActiveResultIndex(0);
    setError(null);
  }, [selectedFileId]);

  useEffect(() => {
    if (
      !selectedFileId ||
      results.has(selectedFileId) ||
      selectedFile?.transcriptionStatus !== "completed"
    ) {
      return;
    }

    void getTranscriptionResults(selectedFileId).then((stored) => {
      if (stored.length > 0) {
        setResults(selectedFileId, stored);
      }
    });
  }, [results, selectedFileId, selectedFile?.transcriptionStatus, setResults]);

  const handleSeek = useCallback((time: number) => {
    setSeekTime(time);
    seekVersionRef.current += 1;
    setSeekVersion(seekVersionRef.current);
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSeekToSegment = useCallback(
    (index: number) => {
      const segment = displaySegments[index];
      if (!segment) return;
      handleSeek(segment.start);
    },
    [displaySegments, handleSeek],
  );

  const handleStartTranscription = useCallback(async () => {
    if (!selectedFileId || !selectedFile || hasOtherActiveTask) return;

    clearLiveSegments(selectedFileId);
    setError(null);
    updateFile(selectedFileId, { transcriptionStatus: "transcribing" });

    try {
      const payload = await transcribeAudio({
        audioFileId: selectedFileId,
        audioPath: selectedFile.path,
        modelName: settings.modelName,
        language: settings.language,
        threads: settings.threads,
        useGpu: settings.useGpu,
        remoteUrl: settings.remoteUrl || undefined,
        backend: settings.backend,
        bestOf: settings.bestOf,
        suppressBlank: settings.suppressBlank,
        suppressNst: settings.suppressNst,
        noContext: settings.noContext,
        entropyThold: settings.entropyThold,
        logprobThold: settings.logprobThold,
        noSpeechThold: settings.noSpeechThold,
        temperature: settings.temperature,
        temperatureInc: settings.temperatureInc,
        maxInitialTs: settings.maxInitialTs,
        maxRepeatFilter: settings.maxRepeatFilter,
        enableVad: settings.enableVad,
        vadConfig: settings.vadConfig,
        initialPrompt: settings.initialPrompt || undefined,
        enablePunctuation: settings.enablePunctuation,
      });
      addResult(selectedFileId, payload);
      setActiveResultIndex(0);
      updateFile(selectedFileId, { transcriptionStatus: "completed" });
    } catch (err) {
      const message = String(err);
      const aborted = message.includes("中止");
      clearLiveSegments(selectedFileId);
      setActiveTask(null);
      updateFile(selectedFileId, {
        transcriptionStatus: aborted ? "pending" : "failed",
      });
      if (!aborted) {
        setError(message);
      }
    }
  }, [
    addResult,
    clearLiveSegments,
    hasOtherActiveTask,
    selectedFile,
    selectedFileId,
    setActiveTask,
    settings,
    updateFile,
  ]);

  if (!selectedFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <p className="text-sm">选择一个音频文件开始转录</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div>
          <h2 className="text-base font-medium">{selectedFile.name}</h2>
          <p className="text-xs text-text-secondary">
            {selectedFile.format.toUpperCase()} · {selectedFile.channels} 声道 · {selectedFile.sampleRate} Hz
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary select-none">
            <input
              type="checkbox"
              className="accent-primary"
              checked={showWaveform}
              onChange={(e) => {
                const next = e.target.checked;
                setShowWaveform(next);
                try {
                  localStorage.setItem(WAVEFORM_STORAGE_KEY, String(next));
                } catch {
                  /* 忽略存储失败 */
                }
              }}
            />
            显示波形图
          </label>
          {isCurrentFileTranscribing ? (
            <button
              type="button"
              className="rounded-lg bg-red-500 px-4 py-1.5 text-sm text-white transition-colors hover:bg-red-600"
              onClick={() => void abortTranscription()}
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleStartTranscription()}
              disabled={hasOtherActiveTask}
              title={hasOtherActiveTask ? "已有其他文件正在转录，请先等待当前任务结束" : undefined}
            >
              开始转录
            </button>
          )}
        </div>
      </header>

      <div className="shrink-0 space-y-4 border-b border-border px-6 py-4">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <div className="mb-1 font-medium">转录失败</div>
            <pre className="whitespace-pre-wrap break-all text-xs">{error}</pre>
            <button
              type="button"
              className="mt-2 text-xs underline"
              onClick={() => setError(null)}
            >
              关闭
            </button>
          </div>
        )}

        <AudioPlayer
          src={getAudioUrl(selectedFile.id, selectedFile.path)}
          seekTime={seekTime}
          seekVersion={seekVersion}
          onTimeUpdate={handleTimeUpdate}
        />

        {showWaveform && (
          <Waveform
            audioPath={selectedFile.path}
            fileId={selectedFile.id}
            currentTime={currentTime}
            duration={selectedFile.duration}
            segments={displaySegments}
            onSeek={handleSeek}
          />
        )}

        {isCurrentFileTranscribing && activeTask && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>{progressLabel(activeTask.phase)}</span>
              <span>{Math.round(activeTask.progress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(0, Math.min(100, activeTask.progress * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {allResults.length > 1 && !isCurrentFileTranscribing && (
          <div className="border-b border-border px-6 py-3">
            <div className="flex flex-wrap gap-1.5">
              {allResults.map((result, index) => (
                <button
                  key={result.id}
                  type="button"
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    index === activeResultIndex
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:bg-surface-secondary"
                  }`}
                  onClick={() => setActiveResultIndex(index)}
                >
                  {result.modelName}{" "}
                  <span className="opacity-60">
                    {new Date(result.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {displaySegments.length > 0 ? (
          <ArticleView
            segments={displaySegments}
            activeIndex={displaySegments.findIndex(
              (segment) => currentTime >= segment.start && currentTime < segment.end,
            )}
            onSeekToSegment={handleSeekToSegment}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-secondary">
            {isCurrentFileTranscribing
              ? "正在等待转录内容写入..."
              : "点击“开始转录”后，文章内容会在这里实时显示。"}
          </div>
        )}
      </div>
    </div>
  );
}

function progressLabel(phase?: string): string {
  switch (phase) {
    case "remote_connecting":
      return "正在连接远程服务";
    case "remote_uploading":
      return "正在上传音频";
    case "remote_transcribing":
      return "正在远程转录";
    case "local":
      return "正在转录";
    default:
      return "正在处理当前文件";
  }
}
