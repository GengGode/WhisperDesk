import { useEffect, useRef } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";
import { useAudioStore } from "@/stores/audio-store";
import { useSettingsStore } from "@/stores/settings-store";
import { transcribeAudio } from "@/lib/tauri";

/**
 * 监听转录队列状态，依次执行转录任务。
 * 在 App 级组件中调用一次即可。
 */
export function useTranscriptionQueue() {
  const runningRef = useRef(false);

  const queue = useTranscriptionStore((s) => s.queue);
  const queueRunning = useTranscriptionStore((s) => s.queueRunning);
  const queueIndex = useTranscriptionStore((s) => s.queueIndex);
  const advanceQueue = useTranscriptionStore((s) => s.advanceQueue);
  const clearQueue = useTranscriptionStore((s) => s.clearQueue);
  const addResult = useTranscriptionStore((s) => s.addResult);
  const setActiveTask = useTranscriptionStore((s) => s.setActiveTask);
  const clearLogs = useTranscriptionStore((s) => s.clearLogs);

  const files = useAudioStore((s) => s.files);
  const updateFile = useAudioStore((s) => s.updateFile);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    if (!queueRunning || runningRef.current) return;
    if (queueIndex >= queue.length) {
      clearQueue();
      return;
    }

    const fileId = queue[queueIndex];
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      advanceQueue();
      return;
    }

    runningRef.current = true;
    clearLogs();
    updateFile(fileId, { transcriptionStatus: "transcribing" });

    transcribeAudio({
      audioFileId: fileId,
      audioPath: file.path,
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
      enableVad: settings.enableVad,
      vadConfig: settings.vadConfig,
      initialPrompt: settings.initialPrompt || undefined,
    })
      .then((result) => {
        addResult(fileId, result);
        updateFile(fileId, { transcriptionStatus: "completed" });
      })
      .catch((err) => {
        const msg = String(err);
        const aborted = msg.includes("中止");
        setActiveTask(null);
        updateFile(fileId, {
          transcriptionStatus: aborted ? "pending" : "failed",
        });
        if (aborted) {
          clearQueue();
          runningRef.current = false;
          return;
        }
      })
      .finally(() => {
        runningRef.current = false;
        advanceQueue();
      });
  }, [
    queueRunning, queueIndex, queue, files, settings,
    advanceQueue, clearQueue, addResult, updateFile,
    setActiveTask, clearLogs,
  ]);
}
