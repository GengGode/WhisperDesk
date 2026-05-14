import { useEditorStore } from "@/stores/editor-store";
import { useAudioStore } from "@/stores/audio-store";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  IS_TAURI,
  getTranscriptionResults,
  updateTranscriptionResult,
  exportTranscription,
  exportFormats,
  getAudioUrl,
  transcribeAudio,
  analyzeVad,
} from "@/lib/tauri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat, VadConfig, VadSegment } from "@/lib/types";
import { defaultVadConfig } from "@/lib/types";
import { AudioPlayer } from "@/components/audio-player";
import { Waveform } from "./waveform";
import { SubtitleEditor } from "./subtitle-editor";

function formatEditorTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const frac = Math.floor((seconds % 1) * 10);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${frac}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}.${frac}`;
}

export function EditorPanel() {
  const resultId = useEditorStore((s) => s.resultId);
  const audioFileId = useEditorStore((s) => s.audioFileId);
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
  const addResult = useTranscriptionStore((s) => s.addResult);
  const settings = useSettingsStore((s) => s.settings);

  const [currentTime, setCurrentTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  const [seekTime, setSeekTime] = useState(0);
  const seekVersionRef = useRef(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const [showParams, setShowParams] = useState(false);

  // 区间选区与区间转录状态
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [rangeTranscribing, setRangeTranscribing] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // VAD 分析状态（vadConfig 直接读写 settings store，确保推理时使用相同配置）
  const [vadSegments, setVadSegments] = useState<VadSegment[] | null>(null);
  const [vadLoading, setVadLoading] = useState(false);
  const vadConfig = settings.vadConfig;
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setVadConfig = useCallback(
    (updater: VadConfig | ((prev: VadConfig) => VadConfig)) => {
      const next = typeof updater === "function" ? updater(vadConfig) : updater;
      setSettings({ vadConfig: next });
    },
    [vadConfig, setSettings],
  );
  const [showVadPanel, setShowVadPanel] = useState(false);
  const vadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedFile = files.find((f) => f.id === selectedFileId);

  const allResults = useMemo(
    () => (selectedFileId ? allResultsMap.get(selectedFileId) ?? [] : []),
    [selectedFileId, allResultsMap],
  );

  // 切换文件时重置版本索引和选区
  useEffect(() => {
    setActiveResultIndex(0);
    setSelection(null);
    setRangeError(null);
    setVadSegments(null);
  }, [selectedFileId]);

  // VAD 分析：首次展开面板或文件/参数变化时触发（debounce 500ms）
  const runVadAnalysis = useCallback((path: string, config: VadConfig) => {
    if (vadDebounceRef.current) clearTimeout(vadDebounceRef.current);
    vadDebounceRef.current = setTimeout(() => {
      setVadLoading(true);
      analyzeVad(path, config)
        .then(setVadSegments)
        .catch(() => setVadSegments(null))
        .finally(() => setVadLoading(false));
    }, 500);
  }, []);

  useEffect(() => {
    if (!showVadPanel || !selectedFile) return;
    runVadAnalysis(selectedFile.path, vadConfig);
  }, [showVadPanel, selectedFile, vadConfig, runVadAnalysis]);

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

  const handleRangeSelect = useCallback((startTime: number, endTime: number) => {
    setSelection({ start: startTime, end: endTime });
    setRangeError(null);
  }, []);

  const handleRangeTranscribe = useCallback(async () => {
    if (!selection || !selectedFileId || !selectedFile || rangeTranscribing) return;
    const baseResult = allResults[activeResultIndex];
    if (!baseResult) return;

    setRangeTranscribing(true);
    setRangeError(null);
    try {
      const rangeResult = await transcribeAudio({
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
        startSeconds: selection.start,
        endSeconds: selection.end,
      });

      // 合并：保留与选区无重叠的旧分段 + 新转录分段，按时间排序
      const kept = baseResult.segments.filter(
        (s) => s.end <= selection.start || s.start >= selection.end,
      );
      const merged = [...kept, ...rangeResult.segments].sort(
        (a, b) => a.start - b.start,
      );
      const mergedText = merged.map((s) => s.text).join("\n");

      rangeResult.segments = merged;
      rangeResult.text = mergedText;
      rangeResult.duration = baseResult.duration;

      // 后端已保存了仅含区间分段的原始记录，覆盖更新为合并版本
      await updateTranscriptionResult({
        id: rangeResult.id,
        text: mergedText,
        segments: merged,
      });

      addResult(selectedFileId, rangeResult);
      setActiveResultIndex(0);
      setSelection(null);
    } catch (err) {
      setRangeError(String(err));
    } finally {
      setRangeTranscribing(false);
    }
  }, [selection, selectedFileId, selectedFile, rangeTranscribing, settings, addResult, allResults, activeResultIndex]);

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
          {IS_TAURI && exportFormats.map((fmt) => (
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
          src={audioFileId ? getAudioUrl(audioFileId, audioFilePath) : audioFilePath}
          seekTime={seekTime}
          seekVersion={seekVersion}
          onTimeUpdate={handleTimeUpdate}
        />

        <Waveform
          audioPath={audioFilePath}
          fileId={audioFileId ?? undefined}
          currentTime={currentTime}
          duration={selectedFile.duration}
          segments={segments}
          activeSegment={activeSegment}
          selection={selection}
          vadSegments={showVadPanel && vadSegments ? vadSegments : undefined}
          onSeek={handleSeek}
          onRangeSelect={handleRangeSelect}
        />

        {/* VAD 分析面板 */}
        <div className="space-y-2">
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => setShowVadPanel((v) => !v)}
          >
            {showVadPanel ? "收起 VAD 分析" : "VAD 语音检测分析"}
          </button>

          {showVadPanel && (
            <div className="rounded-lg border border-border bg-surface-secondary p-3 space-y-3">
              {vadLoading && (
                <div className="text-xs text-text-secondary animate-pulse">分析中...</div>
              )}

              {vadSegments && !vadLoading && (() => {
                const voiceSegs = vadSegments.filter((s) => s.isVoice);
                const totalVoice = voiceSegs.reduce((sum, s) => sum + s.endSeconds - s.startSeconds, 0);
                const totalDuration = selectedFile?.duration ?? 0;
                const silenceRatio = totalDuration > 0 ? ((1 - totalVoice / totalDuration) * 100) : 0;
                return (
                  <div className="flex gap-4 text-xs text-text-secondary">
                    <span>{voiceSegs.length} 个有声段</span>
                    <span>有声 {totalVoice.toFixed(1)}s</span>
                    <span>静音占比 {silenceRatio.toFixed(0)}%</span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">能量阈值 (dB)</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={-50}
                      max={-10}
                      step={1}
                      value={vadConfig.energyThresholdDb}
                      onChange={(e) =>
                        setVadConfig((c) => ({ ...c, energyThresholdDb: Number(e.target.value) }))
                      }
                      className="h-1 w-20 accent-primary"
                    />
                    <span className="w-8 tabular-nums text-right">{vadConfig.energyThresholdDb}</span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">最小静音 (ms)</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={50}
                      max={2000}
                      step={50}
                      value={vadConfig.minSilenceMs}
                      onChange={(e) =>
                        setVadConfig((c) => ({ ...c, minSilenceMs: Number(e.target.value) }))
                      }
                      className="h-1 w-20 accent-primary"
                    />
                    <span className="w-10 tabular-nums text-right">{vadConfig.minSilenceMs}</span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">最小语音 (ms)</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={50}
                      max={2000}
                      step={50}
                      value={vadConfig.minSpeechMs}
                      onChange={(e) =>
                        setVadConfig((c) => ({ ...c, minSpeechMs: Number(e.target.value) }))
                      }
                      className="h-1 w-20 accent-primary"
                    />
                    <span className="w-10 tabular-nums text-right">{vadConfig.minSpeechMs}</span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">前后缓冲 (ms)</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={0}
                      max={500}
                      step={10}
                      value={vadConfig.paddingMs}
                      onChange={(e) =>
                        setVadConfig((c) => ({ ...c, paddingMs: Number(e.target.value) }))
                      }
                      className="h-1 w-20 accent-primary"
                    />
                    <span className="w-10 tabular-nums text-right">{vadConfig.paddingMs}</span>
                  </div>
                </label>
              </div>

              <button
                className="text-xs text-text-secondary hover:text-primary"
                onClick={() => setVadConfig({ ...defaultVadConfig })}
              >
                恢复默认参数
              </button>
            </div>
          )}
        </div>

        {selection && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 dark:border-red-800 dark:bg-red-950/30">
            <span className="text-xs tabular-nums text-red-700 dark:text-red-300">
              已选择 {formatEditorTime(selection.start)} ~ {formatEditorTime(selection.end)}
              （{(selection.end - selection.start).toFixed(1)}秒）
            </span>
            <button
              disabled={rangeTranscribing}
              className="rounded-md bg-red-600 px-3 py-1 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              onClick={handleRangeTranscribe}
            >
              {rangeTranscribing ? "转录中..." : "重新转录此区间"}
            </button>
            <button
              disabled={rangeTranscribing}
              className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
              onClick={() => setSelection(null)}
            >
              取消
            </button>
            {rangeError && (
              <span className="text-xs text-red-600">{rangeError}</span>
            )}
          </div>
        )}
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
