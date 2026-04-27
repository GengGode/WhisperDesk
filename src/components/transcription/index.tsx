import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  abortTranscription,
  exportFormats,
  exportTranscription,
  getTranscriptionResults,
  transcribeAudio,
} from "@/lib/tauri";
import { AudioPlayer } from "@/components/audio-player";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFormat } from "@/lib/types";

export function TranscriptionPanel() {
  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const files = useAudioStore((s) => s.files);
  const updateFile = useAudioStore((s) => s.updateFile);
  const activeTask = useTranscriptionStore((s) => s.activeTask);
  const setActiveTask = useTranscriptionStore((s) => s.setActiveTask);
  const results = useTranscriptionStore((s) => s.results);
  const addResult = useTranscriptionStore((s) => s.addResult);
  const setResults = useTranscriptionStore((s) => s.setResults);
  const settings = useSettingsStore((s) => s.settings);
  const modelDownload = useTranscriptionStore((s) => s.modelDownload);
  const logs = useTranscriptionStore((s) => s.logs);
  const clearLogs = useTranscriptionStore((s) => s.clearLogs);
  const [error, setError] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [showLogs, setShowLogs] = useState(true);

  const [seekTime, setSeekTime] = useState(0);
  const seekVersionRef = useRef(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const selectedFile = files.find((f) => f.id === selectedFileId);
  const allResults = selectedFileId ? results.get(selectedFileId) ?? [] : [];
  const result = allResults[activeResultIndex];

  useEffect(() => setActiveResultIndex(0), [selectedFileId]);

  useEffect(() => {
    if (
      !selectedFileId ||
      results.has(selectedFileId) ||
      selectedFile?.transcriptionStatus !== "completed"
    )
      return;

    getTranscriptionResults(selectedFileId).then((stored) => {
      if (stored.length > 0) setResults(selectedFileId, stored);
    });
  }, [selectedFileId, selectedFile?.transcriptionStatus, results, setResults]);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, showLogs]);

  const handleSeekToSegment = useCallback((index: number) => {
    if (!result) return;
    const seg = result.segments[index];
    if (!seg) return;
    setSeekTime(seg.start);
    seekVersionRef.current += 1;
    setSeekVersion(seekVersionRef.current);
  }, [result]);

  if (!selectedFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <p className="text-sm">选择一个音频文件以查看转录结果</p>
      </div>
    );
  }

  const isTranscribing =
    activeTask?.audioFileId === selectedFileId;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div>
          <h2 className="text-base font-medium">{selectedFile.name}</h2>
          <p className="text-xs text-text-secondary">
            {selectedFile.format.toUpperCase()} · {selectedFile.channels}声道 ·{" "}
            {selectedFile.sampleRate}Hz
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settings.remoteUrl && (
            <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              远程推理
            </span>
          )}
          {isTranscribing ? (
            <button
              className="rounded-lg bg-red-500 px-4 py-1.5 text-sm text-white transition-colors hover:bg-red-600"
              onClick={() => void abortTranscription()}
            >
              停止
            </button>
          ) : (
            <button
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
              onClick={async () => {
                if (!selectedFileId) return;
                clearLogs();
                updateFile(selectedFileId, {
                  transcriptionStatus: "transcribing",
                });
                try {
                  const payload = await transcribeAudio({
                    audioFileId: selectedFileId,
                    audioPath: selectedFile.path,
                    modelName: settings.modelName,
                    language: settings.language,
                    threads: settings.threads,
                    useGpu: settings.useGpu,
                    remoteUrl: settings.remoteUrl || undefined,
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
                  });
                  addResult(selectedFileId, payload);
                  setActiveResultIndex(0);
                  updateFile(selectedFileId, {
                    transcriptionStatus: "completed",
                  });
                } catch (err) {
                  const msg = String(err);
                  const aborted = msg.includes("中止");
                  setActiveTask(null);
                  updateFile(selectedFileId, {
                    transcriptionStatus: aborted ? "pending" : "failed",
                  });
                  if (!aborted) setError(msg);
                }
              }}
            >
              开始转录
            </button>
          )}
        </div>
      </header>

      {/* 固定区域：提示、播放器、进度条 */}
      <div className="shrink-0 space-y-4 border-b border-border px-6 py-4">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <div className="mb-1 font-medium">转录出错</div>
            <pre className="whitespace-pre-wrap break-all text-xs">{error}</pre>
            <button
              className="mt-2 text-xs underline"
              onClick={() => setError(null)}
            >
              关闭
            </button>
          </div>
        )}

        {modelDownload && (
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span>下载模型 {modelDownload.modelName}</span>
              <span>{Math.round(modelDownload.progress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${modelDownload.progress * 100}%` }}
              />
            </div>
          </div>
        )}

        <AudioPlayer
          src={selectedFile.path}
          seekTime={seekTime}
          seekVersion={seekVersion}
          onTimeUpdate={() => {}}
        />

        {isTranscribing && activeTask && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span className="flex items-center gap-1.5">
                <PhaseIndicator phase={activeTask.phase} />
                {phaseLabel(activeTask.phase, activeTask.currentSegment)}
              </span>
              {(activeTask.phase === "local" || activeTask.phase === "remote_transcribing") && (
                <span>{Math.round(activeTask.progress * 100)}%</span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              {activeTask.phase === "remote_connecting" || activeTask.phase === "remote_uploading" ? (
                <div className="h-full w-full animate-pulse rounded-full bg-blue-400/60" />
              ) : (
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${activeTask.progress * 100}%` }}
                />
              )}
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-secondary">
            <button
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              onClick={() => setShowLogs((v) => !v)}
            >
              <span className="font-medium">
                引擎日志 ({logs.length})
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="hover:text-red-500"
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearLogs();
                  }}
                >
                  清空
                </span>
                <svg
                  className={`h-3 w-3 transition-transform ${showLogs ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </span>
            </button>
            {showLogs && (
              <div className="max-h-40 overflow-y-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed">
                {logs.map((log, i) => (
                  <div key={i} className="whitespace-pre-wrap text-text-secondary">
                    <span className="select-none text-text-secondary/40">
                      {new Date(log.timestamp).toLocaleTimeString("zh-CN")}
                    </span>{" "}
                    {log.message}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 可滚动区域：仅字幕部分 */}
      <div className="flex-1 overflow-y-auto p-6">
        {allResults.length > 0 ? (
          <div className="space-y-3">
            {allResults.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {allResults.map((r, i) => (
                  <button
                    key={r.id}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      i === activeResultIndex
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-text-secondary hover:bg-surface-secondary"
                    }`}
                    onClick={() => setActiveResultIndex(i)}
                  >
                    {r.modelName}{" "}
                    <span className="opacity-60">
                      {new Date(r.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {result && (
              <>
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span>模型: {result.modelName}</span>
                  <span>·</span>
                  <span>{result.segments.length} 段</span>
                  <span className="flex-1" />
                  {exportFormats.map((format) => (
                    <button
                      key={format}
                      className="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface-secondary"
                      onClick={async () => {
                        await exportTranscription({
                          resultId: result.id,
                          format: format as ExportFormat,
                        });
                      }}
                    >
                      导出 {format.toUpperCase()}
                    </button>
                  ))}
                </div>
                {result.segments.map((seg, i) => (
                  <button
                    key={i}
                    className="group flex w-full gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-secondary"
                    onClick={() => handleSeekToSegment(i)}
                  >
                    <span className="shrink-0 pt-0.5 text-xs tabular-nums text-text-secondary">
                      {formatTime(seg.start)}
                    </span>
                    <p className="text-sm leading-relaxed">{seg.text}</p>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : (
          !isTranscribing && (
            <p className="text-center text-sm text-text-secondary">
              点击「开始转录」将音频转为文字
            </p>
          )
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function phaseLabel(
  phase?: string,
  currentSegment?: string,
): string {
  switch (phase) {
    case "remote_connecting":
      return "正在连接远程服务器...";
    case "remote_uploading":
      return currentSegment || "正在上传音频文件...";
    case "remote_transcribing":
      return currentSegment || "远程转录中...";
    case "complete":
      return "转录完成";
    case "local":
      return currentSegment || "本地转录中...";
    default:
      return currentSegment || "转录进度";
  }
}

function PhaseIndicator({ phase }: { phase?: string }) {
  const isRemote = phase?.startsWith("remote_");
  if (!phase) return null;

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        phase === "complete"
          ? "bg-green-500"
          : isRemote
            ? "animate-pulse bg-blue-500"
            : "animate-pulse bg-primary"
      }`}
    />
  );
}
