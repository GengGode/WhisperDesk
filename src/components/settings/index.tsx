import { useSettingsStore } from "@/stores/settings-store";
import {
  IS_TAURI,
  deleteModel,
  ensureModel,
  getDashboardStatus,
  getInferenceServerStatus,
  listModels,
  openModelsDir,
  setServerConfig,
  startApiServer,
  stopApiServer,
  startWebServer,
  stopWebServer,
  testRemoteConnection,
} from "@/lib/tauri";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";
import type { DashboardSnapshot, ServerStatus, ThemeMode, TranscriptionBackend, WhisperModel } from "@/lib/types";

const WHISPER_MODEL_NAMES = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"] as const;

const MODEL_DESCRIPTIONS: Record<string, string> = {
  tiny: "~75 MB · 最快，精度最低",
  base: "~142 MB · 较快",
  small: "~466 MB · 平衡",
  medium: "~1.5 GB · 较慢，精度高",
  "large-v3-turbo": "~1.5 GB · 快速，接近最高精度",
  "large-v3": "~2.9 GB · 最慢，精度最高",
  "paraformer-zh": "~220 MB · 中文 CER 1.95%，准确率与体积均衡",
  "sensevoice-zh": "~229 MB · 中文 CER ~3.0%，速度最快（推荐入门）",
  "fireredasr2-zh": "~740 MB · 中文 CER 0.57%，极致准确率",
};

const HUGGINGFACE_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

const SHERPA_MODEL_URLS: { name: string; url: string }[] = [
  { name: "paraformer-zh", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2024-03-09.tar.bz2" },
  { name: "sensevoice-zh", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2" },
  { name: "fireredasr2-zh", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2" },
];

const PUNCT_MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2";

const BACKEND_LABELS: Record<TranscriptionBackend, string> = {
  "whisper": "Whisper（多语言通用）",
  "sherpa-onnx": "sherpa-onnx（中文专项，推荐）",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export function SettingsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const sherpaAvailable = useSettingsStore((s) => s.sherpaAvailable);
  const sherpaMessage = useSettingsStore((s) => s.sherpaMessage);
  const modelDownload = useTranscriptionStore((s) => s.modelDownload);

  const [models, setModels] = useState<WhisperModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [serverStatus, setServerStatus] = useState<ServerStatus>({ running: false, port: 0, webRunning: false, webPort: 0 });
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [remoteTestResult, setRemoteTestResult] = useState<string | null>(null);
  const [remoteTesting, setRemoteTesting] = useState(false);

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const dashPollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    setServerConfig({
      modelName: settings.modelName,
      threads: settings.threads,
      useGpu: settings.useGpu,
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
      initialPrompt: settings.initialPrompt,
    }).catch(() => { });
  }, [
    settings.modelName, settings.threads, settings.useGpu,
    settings.bestOf, settings.suppressBlank, settings.suppressNst,
    settings.noContext, settings.entropyThold, settings.logprobThold,
    settings.noSpeechThold, settings.temperature, settings.temperatureInc,
    settings.maxInitialTs, settings.maxRepeatFilter,
    settings.enableVad, settings.initialPrompt,
  ]);

  useEffect(() => {
    if (!serverStatus.running) {
      setDashboard(null);
      clearInterval(dashPollRef.current);
      return;
    }
    const poll = async () => {
      try { setDashboard(await getDashboardStatus()); } catch { /* ignore */ }
    };
    poll();
    dashPollRef.current = setInterval(poll, 2000);
    return () => clearInterval(dashPollRef.current);
  }, [serverStatus.running]);

  useEffect(() => {
    if (!IS_TAURI) return;
    import("@tauri-apps/plugin-autostart").then(({ isEnabled }) =>
      isEnabled().then(setAutoStartEnabled).catch(() => { })
    );
  }, []);

  const handleAutoStartToggle = async (checked: boolean) => {
    if (!IS_TAURI) return;
    try {
      const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
      if (checked) await enable(); else await disable();
      setAutoStartEnabled(await isEnabled());
    } catch (e) {
      setError(String(e));
    }
  };

  const refreshModels = useCallback(async () => {
    try {
      const list = await listModels();
      setModels(list);
    } catch (e) {
      console.error("[设置] 加载模型列表失败", e);
    }
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const pollServerStatus = useCallback(async () => {
    try {
      const s = await getInferenceServerStatus();
      setServerStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    pollServerStatus();
    pollRef.current = setInterval(pollServerStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, [pollServerStatus]);

  const [apiLoading, setApiLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [webWarning, setWebWarning] = useState<string | null>(null);

  const handleToggleApi = async () => {
    setApiLoading(true);
    try {
      if (serverStatus.running) {
        await stopApiServer();
      } else {
        await startApiServer(settings.inferenceServerPort);
      }
      await pollServerStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setApiLoading(false);
    }
  };

  const handleToggleWeb = async () => {
    setWebLoading(true);
    setWebWarning(null);
    try {
      if (serverStatus.webRunning) {
        await stopWebServer();
      } else {
        await startWebServer(settings.webPort, settings.inferenceServerPort);
      }
      await pollServerStatus();
    } catch (e) {
      setWebWarning(String(e));
    } finally {
      setWebLoading(false);
    }
  };

  const handleTestRemote = async () => {
    if (!settings.remoteUrl) return;
    setRemoteTesting(true);
    setRemoteTestResult(null);
    try {
      const info = await testRemoteConnection(settings.remoteUrl);
      setRemoteTestResult(`连接成功 — GPU: ${info.gpu ? "可用" : "不可用"}`);
    } catch (e) {
      setRemoteTestResult(`连接失败: ${String(e)}`);
    } finally {
      setRemoteTesting(false);
    }
  };

  const handleDownload = async (name: string) => {
    setError(null);
    setDownloading(name);
    try {
      await ensureModel(name, settings.downloadProxy || undefined);
      await refreshModels();
    } catch (e) {
      setError(`下载模型 ${name} 失败: ${String(e)}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteModel(name);
      await refreshModels();
    } catch (e) {
      setError(`删除模型 ${name} 失败: ${String(e)}`);
    }
  };

  return (
    <section className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h2 className="text-base font-medium">设置</h2>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-secondary"
          onClick={resetSettings}
        >
          恢复默认
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* 通用 */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">通用</h3>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium">外观主题</span>
                <p className="text-xs text-text-secondary">选择应用的显示主题</p>
              </div>
              <ThemeSelector
                value={settings.theme}
                onChange={(t) => setSettings({ theme: t })}
              />
            </div>

            {IS_TAURI && <>
              <label className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">开机自启</span>
                  <p className="text-xs text-text-secondary">系统启动时自动运行 WhisperDesk</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary"
                  checked={autoStartEnabled}
                  onChange={(e) => handleAutoStartToggle(e.target.checked)}
                />
              </label>

              <label className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">静默启动</span>
                  <p className="text-xs text-text-secondary">启动时最小化到系统托盘，不显示主窗口</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary"
                  checked={settings.silentStart}
                  onChange={(e) => setSettings({ silentStart: e.target.checked })}
                />
              </label>
            </>}
          </div>
        </div>

        {/* 转录参数 */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            转录参数
          </h3>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">转录后端</span>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={settings.backend}
              onChange={(e) => {
                const backend = e.target.value as TranscriptionBackend;
                const backendModels = models.filter((m) => m.backend === backend);
                const firstModel = backendModels[0]?.name ?? "";
                setSettings({ backend, modelName: firstModel });
              }}
            >
              {(["sherpa-onnx", "whisper"] as TranscriptionBackend[]).map((b) => (
                <option
                  key={b}
                  value={b}
                  disabled={b === "sherpa-onnx" && !sherpaAvailable}
                >
                  {BACKEND_LABELS[b]}{b === "sherpa-onnx" && !sherpaAvailable ? "（不可用）" : ""}
                </option>
              ))}
            </select>
            {!sherpaAvailable && (
              <p className="text-xs text-amber-500">
                {sherpaMessage || "sherpa-onnx 运行时 DLL 缺失，该后端不可用"}
              </p>
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">当前模型</span>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={settings.modelName}
              onChange={(e) => setSettings({ modelName: e.target.value })}
            >
              {models
                .filter((m) => m.backend === settings.backend)
                .map((m) => {
                  const suffix = m.downloaded ? " ✓" : "";
                  const cerTag = m.cer ? ` [CER ${m.cer}]` : "";
                  return (
                    <option key={m.name} value={m.name}>
                      {m.name}{cerTag}{suffix}
                    </option>
                  );
                })}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">语言</span>
            <input
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              placeholder="auto / zh / en ..."
              value={settings.language}
              onChange={(e) => setSettings({ language: e.target.value })}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">线程数</span>
            <input
              type="number"
              min={1}
              max={16}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={settings.threads}
              onChange={(e) =>
                setSettings({
                  threads: Math.max(
                    1,
                    Math.min(16, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">标点恢复</span>
              <p className="text-xs text-text-secondary">
                对无标点的模型输出自动补充中英文标点（FireRedASR2 等），首次使用时自动下载标点模型（约 72 MB）
              </p>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-primary"
              checked={settings.enablePunctuation}
              onChange={(e) => setSettings({ enablePunctuation: e.target.checked })}
            />
          </label>
        </div>

        {/* Whisper 推理参数（高级）—— 仅 Whisper 后端使用 */}
        {settings.backend === "whisper" && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-secondary">
              Whisper 推理参数（高级）
            </h3>

            <div className="rounded-lg border border-border p-4 space-y-4">
              {/* 开关类参数 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <label className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">抑制空白</span>
                    <p className="text-xs text-text-secondary">抑制空白 token 输出</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={settings.suppressBlank}
                    onChange={(e) => setSettings({ suppressBlank: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">抑制非语音</span>
                    <p className="text-xs text-text-secondary">过滤笑声、音乐等非语音 token</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={settings.suppressNst}
                    onChange={(e) => setSettings({ suppressNst: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">禁用上下文</span>
                    <p className="text-xs text-text-secondary">防止前段幻觉传播到后续分段</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={settings.noContext}
                    onChange={(e) => setSettings({ noContext: e.target.checked })}
                  />
                </label>
              </div>

              {/* 数值类参数 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <label className="block space-y-1">
                  <span className="text-sm font-medium">采样候选数</span>
                  <p className="text-xs text-text-secondary">Greedy 采样 best_of，越大越准但更慢</p>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.bestOf}
                    onChange={(e) => setSettings({ bestOf: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 5))) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">初始温度</span>
                  <p className="text-xs text-text-secondary">解码温度，0 = 确定性输出</p>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.temperature}
                    onChange={(e) => setSettings({ temperature: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">温度递增</span>
                  <p className="text-xs text-text-secondary">解码失败时温度递增步长</p>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.temperatureInc}
                    onChange={(e) => setSettings({ temperatureInc: Math.max(0, Math.min(1, Number(e.target.value) || 0.2)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">熵阈值</span>
                  <p className="text-xs text-text-secondary">输出熵过高时触发温度回退重试</p>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.entropyThold}
                    onChange={(e) => setSettings({ entropyThold: Math.max(0, Math.min(5, Number(e.target.value) || 2.4)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">对数概率阈值</span>
                  <p className="text-xs text-text-secondary">平均对数概率过低时触发重试</p>
                  <input
                    type="number"
                    min={-5}
                    max={0}
                    step={0.1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.logprobThold}
                    onChange={(e) => setSettings({ logprobThold: Math.max(-5, Math.min(0, Number(e.target.value) || -1)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">静音检测阈值</span>
                  <p className="text-xs text-text-secondary">无语音概率超过此值判定为静音</p>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.noSpeechThold}
                    onChange={(e) => setSettings({ noSpeechThold: Math.max(0, Math.min(1, Number(e.target.value) || 0.6)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">首时间戳偏移</span>
                  <p className="text-xs text-text-secondary">首个时间戳最大偏移（秒）</p>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.maxInitialTs}
                    onChange={(e) => setSettings({ maxInitialTs: Math.max(0, Math.min(5, Number(e.target.value) || 1)) })}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">重复过滤阈值</span>
                  <p className="text-xs text-text-secondary">连续相同文本超过此数量将被裁剪，0 = 不过滤</p>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings.maxRepeatFilter}
                    onChange={(e) => setSettings({ maxRepeatFilter: Math.max(0, Math.min(20, Math.round(e.target.value === '' ? 3 : Number(e.target.value)))) })}
                  />
                </label>
              </div>

              <p className="text-xs text-text-secondary">
                以上参数用于抑制 Whisper 模型幻觉（重复输出无关文本），通常保持默认即可。
              </p>
            </div>
          </div>
        )}

        {/* Web 服务 — 两种模式均可见 */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            Web 服务
          </h3>

          <div className="rounded-lg border border-border p-4 space-y-4">
            {IS_TAURI ? (
              <>
                {/* 后台 API 服务 */}
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${serverStatus.running ? "bg-green-500" : "bg-gray-400"}`} />
                  <label className="flex-1 space-y-1">
                    <span className="text-sm font-medium">后台 API 端口</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      value={settings.inferenceServerPort}
                      onChange={(e) =>
                        setSettings({ inferenceServerPort: Math.max(1024, Math.min(65535, Number(e.target.value) || 3000)) })
                      }
                      disabled={serverStatus.running}
                    />
                  </label>
                  <button
                    className={`mt-6 shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${serverStatus.running
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-primary hover:bg-primary-hover"
                      } disabled:opacity-50`}
                    disabled={apiLoading}
                    onClick={handleToggleApi}
                  >
                    {apiLoading ? "处理中..." : serverStatus.running ? "停止" : "启动"}
                  </button>
                </div>

                {/* Web 前端服务 */}
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${serverStatus.webRunning ? "bg-green-500" : "bg-gray-400"}`} />
                  <label className="flex-1 space-y-1">
                    <span className="text-sm font-medium">Web 前端端口</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      value={settings.webPort}
                      onChange={(e) =>
                        setSettings({ webPort: Math.max(1024, Math.min(65535, Number(e.target.value) || 8080)) })
                      }
                      disabled={serverStatus.webRunning}
                    />
                  </label>
                  <button
                    className={`mt-6 shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${serverStatus.webRunning
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-primary hover:bg-primary-hover"
                      } disabled:opacity-50`}
                    disabled={webLoading}
                    onClick={handleToggleWeb}
                  >
                    {webLoading ? "处理中..." : serverStatus.webRunning ? "停止" : "启动"}
                  </button>
                </div>

                {webWarning && (
                  <p className="text-xs text-amber-500">⚠ {webWarning}</p>
                )}

                <label className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">启动后自动开启 API 服务</span>
                    <p className="text-xs text-text-secondary">每次启动应用时自动开启后台 API 推理服务</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={settings.apiAutoStart}
                    onChange={(e) => setSettings({ apiAutoStart: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">启动后自动开启 Web 界面</span>
                    <p className="text-xs text-text-secondary">每次启动应用时自动开启 Web 前端，提供浏览器远程访问</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={settings.webAutoStart}
                    onChange={(e) => setSettings({ webAutoStart: e.target.checked })}
                  />
                </label>

                <p className="text-xs text-text-secondary">
                  后台 API 提供推理接口和文件管理。Web 前端提供浏览器可访问的远程界面。
                </p>

                {serverStatus.webRunning && (
                  <p className="text-xs text-text-secondary">
                    浏览器打开{" "}
                    <a
                      className="text-primary underline"
                      href={`http://localhost:${serverStatus.webPort}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      http://localhost:{serverStatus.webPort}
                    </a>
                    {" "}即可远程使用
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-text-secondary">
                    已连接 — Web: {window.location.host}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">
                  当前通过 Web 远程访问，部分桌面端功能（导入文件、导出、文件管理器操作）不可用。
                </p>
              </>
            )}
          </div>

          {IS_TAURI && serverStatus.running && dashboard && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">服务状态</span>
                <span className="text-xs text-text-secondary">
                  GPU: {dashboard.gpu ? "可用" : "不可用"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-2.5 text-center">
                  <div className="text-lg font-bold text-blue-500">{dashboard.activeTasks.length}</div>
                  <div className="text-[10px] text-text-secondary">活跃任务</div>
                </div>
                <div className="rounded-md border border-border p-2.5 text-center">
                  <div className="text-lg font-bold text-green-500">{dashboard.completedTasks.length}</div>
                  <div className="text-[10px] text-text-secondary">已完成</div>
                </div>
              </div>

              {dashboard.activeTasks.length > 0 && (
                <div className="space-y-2">
                  {dashboard.activeTasks.map((t) => (
                    <div key={t.id} className="rounded-md border border-border bg-surface p-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${t.status === "receiving" ? "animate-pulse bg-yellow-500"
                            : "animate-pulse bg-blue-500"
                            }`} />
                          {t.status === "receiving" ? "接收中" : "转录中"}
                        </span>
                        <span className="text-text-secondary">
                          {t.clientIp} · {t.modelName}
                        </span>
                      </div>
                      {t.status === "transcribing" && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${t.progress * 100}%` }}
                          />
                        </div>
                      )}
                      <div className="mt-1 text-text-secondary">{t.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 远程推理（使用其他设备的推理服务） — 仅桌面端显示 */}
        {IS_TAURI &&
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            远程推理（使用其他设备的推理服务）
          </h3>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">服务器地址</span>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  placeholder="http://192.168.1.100:3000"
                  value={settings.remoteUrl}
                  onChange={(e) => setSettings({ remoteUrl: e.target.value })}
                />
                <button
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-secondary disabled:opacity-50"
                  disabled={remoteTesting || !settings.remoteUrl}
                  onClick={handleTestRemote}
                >
                  {remoteTesting ? "测试中..." : "测试连接"}
                </button>
              </div>
            </label>

            {remoteTestResult && (
              <p className={`text-xs ${remoteTestResult.startsWith("连接成功") ? "text-green-600" : "text-red-600"}`}>
                {remoteTestResult}
              </p>
            )}

            <p className="text-xs text-text-secondary">
              配置后转录将通过远程服务器执行，留空则使用本机推理
            </p>
          </div>
        </div>}

        {/* 模型管理 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-secondary">
              模型管理
            </h3>
            {IS_TAURI && <button
              className="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface-secondary"
              onClick={async () => {
                try {
                  await openModelsDir();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              打开模型目录
            </button>}
          </div>

          {/* 下载代理 */}
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              下载代理
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
                placeholder="http://127.0.0.1:1080 或 socks5://127.0.0.1:1080"
                value={settings.downloadProxy}
                onChange={(e) => setSettings({ downloadProxy: e.target.value })}
              />
              {settings.downloadProxy && (
                <button
                  className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary hover:bg-surface"
                  onClick={() => setSettings({ downloadProxy: "" })}
                >
                  清除
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">
              下载模型时使用的网络代理，支持 http / https / socks5 协议，留空则直连
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <pre className="whitespace-pre-wrap break-all text-xs">
                {error}
              </pre>
              <button
                className="mt-1 text-xs underline"
                onClick={() => setError(null)}
              >
                关闭
              </button>
            </div>
          )}

          {/* 下载进度 */}
          {downloading && modelDownload && (
            <div className="rounded-lg border border-border bg-surface-secondary p-3">
              <div className="mb-1 flex justify-between text-xs text-text-secondary">
                <span>
                  正在下载 {modelDownload.modelName}
                </span>
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

          {/* sherpa-onnx 模型（中文专项） */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-secondary">sherpa-onnx（中文专项）</h4>
            <div className="divide-y divide-border rounded-lg border border-border">
              {models
                .filter((m) => m.backend === "sherpa-onnx")
                .map((m) => {
                  const isDownloading = downloading === m.name;
                  return (
                    <div
                      key={m.name}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {m.name}
                          {m.cer && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              CER {m.cer}
                            </span>
                          )}
                          {m.downloaded && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                              已下载
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary">
                          {MODEL_DESCRIPTIONS[m.name] || m.modelType || ""}
                          {m.downloaded && m.size > 0 && (
                            <span className="ml-1">
                              · 实际 {formatBytes(m.size)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {m.downloaded ? (
                          <button
                            className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(m.name)}
                          >
                            删除
                          </button>
                        ) : (
                          <button
                            disabled={isDownloading}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            onClick={() => handleDownload(m.name)}
                          >
                            {isDownloading ? "下载中..." : "下载"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* 标点恢复模型 */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-secondary">标点恢复（后处理）</h4>
            <div className="divide-y divide-border rounded-lg border border-border">
              {models
                .filter((m) => (m.backend as string) === "punctuation")
                .map((m) => {
                  const isDownloading = downloading === m.name;
                  return (
                    <div
                      key={m.name}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {m.name}
                          {m.downloaded && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                              已下载
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary">
                          CT-Transformer 中英文标点恢复 · ~72 MB（int8 量化）
                          {m.downloaded && m.size > 0 && (
                            <span className="ml-1">
                              · 实际 {formatBytes(m.size)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {m.downloaded ? (
                          <button
                            className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(m.name)}
                          >
                            删除
                          </button>
                        ) : (
                          <button
                            disabled={isDownloading}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            onClick={() => handleDownload(m.name)}
                          >
                            {isDownloading ? "下载中..." : "下载"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className="text-xs text-text-secondary">
              启用「标点恢复」后，首次转录时会自动下载此模型。也可提前手动下载。
            </p>
          </div>

          {/* Whisper 模型 */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-secondary">Whisper（多语言通用）</h4>
            <div className="divide-y divide-border rounded-lg border border-border">
              {models
                .filter((m) => m.backend === "whisper")
                .map((m) => {
                  const isDownloading = downloading === m.name;
                  return (
                    <div
                      key={m.name}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {m.name}
                          {m.downloaded && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                              已下载
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary">
                          {MODEL_DESCRIPTIONS[m.name] || ""}
                          {m.downloaded && m.size > 0 && (
                            <span className="ml-1">
                              · 实际 {formatBytes(m.size)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {m.downloaded ? (
                          <button
                            className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(m.name)}
                          >
                            删除
                          </button>
                        ) : (
                          <button
                            disabled={isDownloading}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            onClick={() => handleDownload(m.name)}
                          >
                            {isDownloading ? "下载中..." : "下载"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* 手动下载说明 */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="mb-2 font-medium text-amber-800">
              手动下载说明
            </p>
            <ol className="list-inside list-decimal space-y-1 text-xs text-amber-700">
              <li>
                点击上方「打开模型目录」按钮打开存放目录
              </li>
              <li>
                Whisper 模型从 HuggingFace 下载 <code>.bin</code> 文件；sherpa-onnx 模型从 GitHub Releases 下载 <code>.tar.bz2</code> 压缩包
              </li>
            </ol>
            <p className="mt-2 mb-1 text-xs font-medium text-amber-800">Whisper（多语言通用）：</p>
            <div className="space-y-1">
              {WHISPER_MODEL_NAMES.map((name) => (
                <div key={name} className="flex items-start gap-2 text-xs">
                  <span className="w-20 shrink-0 font-medium text-amber-800">
                    {name}:
                  </span>
                  <code className="min-w-0 flex-1 break-all rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 select-all">
                    {HUGGINGFACE_BASE}/ggml-{name}.bin
                  </code>
                </div>
              ))}
            </div>
            <p className="mt-2 mb-1 text-xs font-medium text-amber-800">sherpa-onnx（中文专项）：</p>
            <div className="space-y-1">
              {SHERPA_MODEL_URLS.map((m) => (
                <div key={m.name} className="flex items-start gap-2 text-xs">
                  <span className="w-20 shrink-0 font-medium text-amber-800">
                    {m.name}:
                  </span>
                  <code className="min-w-0 flex-1 break-all rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 select-all">
                    {m.url}
                  </code>
                </div>
              ))}
            </div>
            <p className="mt-2 mb-1 text-xs font-medium text-amber-800">标点恢复（后处理）：</p>
            <div className="flex items-start gap-2 text-xs">
              <span className="w-20 shrink-0 font-medium text-amber-800">
                punct-zh-en:
              </span>
              <code className="min-w-0 flex-1 break-all rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 select-all">
                {PUNCT_MODEL_URL}
              </code>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              3. Whisper 模型放入模型目录，保持 <code>ggml-模型名.bin</code> 格式；sherpa-onnx / 标点模型解压到对应子目录
            </p>
            <button
              className="mt-3 rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100"
              onClick={refreshModels}
            >
              刷新模型列表
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "系统" },
];

function ThemeSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (t: ThemeMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-surface p-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${value === opt.value
            ? "bg-primary text-white"
            : "text-text-secondary hover:text-text"
            }`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
