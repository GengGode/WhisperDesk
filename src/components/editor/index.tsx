import { useEditorStore } from "@/stores/editor-store";
import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import {
  getTranscriptionResults,
  updateTranscriptionResult,
  exportTranscription,
  exportFormats,
} from "@/lib/tauri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat } from "@/lib/types";
import { AudioPlayer } from "@/components/audio-player";
import { Waveform } from "./waveform";
import { SubtitleEditor } from "./subtitle-editor";

export function EditorPanel() {
  const resultId = useEditorStore((s) => s.resultId);
  const audioFilePath = useEditorStore((s) => s.audioFilePath);
  const audioFileName = useEditorStore((s) => s.audioFileName);
  const segments = useEditorStore((s) => s.segments);
  const isDirty = useEditorStore((s) => s.isDirty);
  const loadResult = useEditorStore((s) => s.loadResult);
  const markSaved = useEditorStore((s) => s.markSaved);

  const selectedFileId = useAudioStore((s) => s.selectedFileId);
  const files = useAudioStore((s) => s.files);
  const allResultsMap = useTranscriptionStore((s) => s.results);
  const setResults = useTranscriptionStore((s) => s.setResults);

  const [currentTime, setCurrentTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  const [seekTime, setSeekTime] = useState(0);
  const seekVersionRef = useRef(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const [showParams, setShowParams] = useState(false);

  const selectedFile = files.find((f) => f.id === selectedFileId);

  const allResults = useMemo(
    () => (selectedFileId ? allResultsMap.get(selectedFileId) ?? [] : []),
    [selectedFileId, allResultsMap],
  );

  // 切换文件时重置版本索引
  useEffect(() => setActiveResultIndex(0), [selectedFileId]);

  // 自动从数据库加载历史结果
  useEffect(() => {
    if (!selectedFileId || !selectedFile) return;
    if (selectedFile.transcriptionStatus !== "completed") return;
    if (allResultsMap.has(selectedFileId)) return;

    void getTranscriptionResults(selectedFileId)
      .then((stored) => {
        if (stored.length > 0) setResults(selectedFileId, stored);
      })
      .catch((err) => setLoadError(String(err)));
  }, [selectedFileId, selectedFile, allResultsMap, setResults]);

  // 加载当前选中版本到编辑器 store
  useEffect(() => {
    if (!selectedFile || allResults.length === 0) return;
    const target = allResults[activeResultIndex];
    if (!target) return;
    if (resultId === target.id) return;
    loadResult(target, selectedFile.path, selectedFile.name);
  }, [selectedFileId, activeResultIndex, allResults, resultId, selectedFile, loadResult]);

  const activeSegment = useMemo(
    () => segments.find((seg) => currentTime >= seg.start && currentTime < seg.end),
    [segments, currentTime],
  );

  const handleSeek = useCallback((time: number) => {
    setSeekTime(time);
    seekVersionRef.current += 1;
    setSeekVersion(seekVersionRef.current);
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSave = useCallback(async () => {
    if (!resultId || saving) return;
    setSaving(true);
    try {
      const text = segments.map((s) => s.text).join("");
      await updateTranscriptionResult({ id: resultId, text, segments });
      markSaved();
      if (selectedFileId) {
        const updated = await getTranscriptionResults(selectedFileId);
        if (updated.length > 0) setResults(selectedFileId, updated);
      }
    } catch (err) {
      console.error("[编辑器] 保存失败", err);
    } finally {
      setSaving(false);
    }
  }, [resultId, saving, segments, markSaved, selectedFileId, setResults]);

  const handleSwitchVersion = useCallback(
    (index: number) => {
      if (index === activeResultIndex) return;
      if (isDirty && !window.confirm("当前有未保存的修改，切换版本将丢失这些修改。是否继续？")) {
        return;
      }
      setActiveResultIndex(index);
    },
    [activeResultIndex, isDirty],
  );

  if (!selectedFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <p className="text-sm">请先在「音频文件」中选择一个文件</p>
      </div>
    );
  }

  if (selectedFile.transcriptionStatus !== "completed") {
    return (
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <p className="text-sm">
          请先在「转录」页面完成音频转录后再进行编辑
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center text-red-500">
        <p className="text-sm">加载失败: {loadError}</p>
      </div>
    );
  }

  if (!resultId || !audioFilePath || segments.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <p className="text-sm">正在加载转录数据...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-medium">{audioFileName}</h2>
          {isDirty && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
              未保存
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!isDirty || saving}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {exportFormats.map((fmt) => (
            <button
              key={fmt}
              className="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface-secondary"
              onClick={() =>
                exportTranscription({
                  resultId: resultId,
                  format: fmt as ExportFormat,
                })
              }
            >
              导出 {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* 固定区域：版本切换、播放器、波形图 */}
      <div className="shrink-0 space-y-3 border-b border-border px-6 py-4">
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
                onClick={() => handleSwitchVersion(i)}
              >
                {r.modelName}{" "}
                <span className="opacity-60">
                  {new Date(r.createdAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            ))}
          </div>
        )}

        {allResults[activeResultIndex]?.paramsJson && (
          <div className="text-xs">
            <button
              className="text-primary hover:underline"
              onClick={() => setShowParams((v) => !v)}
            >
              {showParams ? "收起参数" : "查看转录参数"}
            </button>
            {showParams && (() => {
              try {
                const p = JSON.parse(allResults[activeResultIndex].paramsJson!) as Record<string, unknown>;
                const labels: Record<string, string> = {
                  bestOf: "采样候选数",
                  suppressBlank: "抑制空白",
                  suppressNst: "抑制非语音",
                  noContext: "禁用上下文",
                  entropyThold: "熵阈值",
                  logprobThold: "对数概率阈值",
                  noSpeechThold: "静音检测阈值",
                  temperature: "初始温度",
                  temperatureInc: "温度递增",
                  maxInitialTs: "首时间戳偏移",
                  maxRepeatFilter: "重复过滤阈值",
                };
                return (
                  <div className="mt-1.5 rounded-md border border-border bg-surface-secondary px-3 py-2">
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                      {Object.entries(p).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="text-text-secondary">{labels[k] ?? k}</span>
                          <span className="font-medium tabular-nums">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } catch {
                return null;
              }
            })()}
          </div>
        )}

        <AudioPlayer
          src={audioFilePath}
          seekTime={seekTime}
          seekVersion={seekVersion}
          onTimeUpdate={handleTimeUpdate}
        />

        <Waveform
          audioPath={audioFilePath}
          currentTime={currentTime}
          duration={selectedFile.duration}
          segments={segments}
          activeSegment={activeSegment}
          onSeek={handleSeek}
        />
      </div>

      {/* 可滚动区域：仅字幕编辑 */}
      <div className="flex-1 overflow-y-auto p-6">
        <SubtitleEditor
          currentTime={currentTime}
          onSeek={handleSeek}
        />
      </div>
    </div>
  );
}
