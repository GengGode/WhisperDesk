import { useSettingsStore } from "@/stores/settings-store";
import {
  deleteModel,
  ensureModel,
  getDashboardStatus,
  getInferenceServerStatus,
  listModels,
  openModelsDir,
  setServerConfig,
  startInferenceServer,
  stopInferenceServer,
  testRemoteConnection,
} from "@/lib/tauri";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";
import type { DashboardSnapshot, ServerStatus, ThemeMode, WhisperModel } from "@/lib/types";

const MODEL_NAMES = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"] as const;

const MODEL_DESCRIPTIONS: Record<string, string> = {
  tiny: "~75 MB · 最快，精度最低",
  base: "~142 MB · 较快",
  small: "~466 MB · 平衡",
  medium: "~1.5 GB · 较慢，精度高",
  "large-v3-turbo": "~1.5 GB · 快速，接近最高精度（推荐）",
  "large-v3": "~2.9 GB · 最慢，精度最高",
};

const HUGGINGFACE_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

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
  const modelDownload = useTranscriptionStore((s) => s.modelDownload);

  const [models, setModels] = useState<WhisperModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [serverStatus, setServerStatus] = useState<ServerStatus>({ running: false, port: 0 });
  const [serverLoading, setServerLoading] = useState(false);
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
    }).catch(() => {});
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
    isEnabled().then(setAutoStartEnabled).catch(() => {});
  }, []);

  const handleAutoStartToggle = async (checked: boolean) => {
    try {
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
    pollServerStatus();
    pollRef.current = setInterval(pollServerStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, [pollServerStatus]);

  const handleToggleServer = async () => {
    setServerLoading(true);
    try {
      if (serverStatus.running) {
        await stopInferenceServer();
      } else {
        await startInferenceServer(settings.inferenceServerPort);
      }
      await pollServerStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setServerLoading(false);
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
      await ensureModel(name);
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
          </div>
        </div>

        {/* 转录参数 */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            转录参数
          </h3>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">当前模型</span>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={settings.modelName}
              onChange={(e) => setSettings({ modelName: e.target.value })}
            >
              {MODEL_NAMES.map((name) => {
                const m = models.find((mm) => mm.name === name);
                const suffix = m?.downloaded ? " ✓" : "";
                return (
                  <option key={name} value={name}>
                    {name}
                    {suffix}
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
        </div>

        {/* Whisper 推理参数（高级） */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            推理参数（高级）
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

        {/* 推理服务（供其他设备调用） */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            推理服务（供其他设备调用）
          </h3>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="flex-1 space-y-1">
                <span className="text-sm font-medium">端口</span>
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
                className={`mt-6 shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                  serverStatus.running
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-primary hover:bg-primary-hover"
                } disabled:opacity-50`}
                disabled={serverLoading}
                onClick={handleToggleServer}
              >
                {serverLoading ? "处理中..." : serverStatus.running ? "停止服务" : "启动服务"}
              </button>
            </div>

            <label className="flex items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium">随应用启动</span>
                <p className="text-xs text-text-secondary">开启后每次启动应用时自动开启推理服务</p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={settings.inferenceServerEnabled}
                onChange={(e) => setSettings({ inferenceServerEnabled: e.target.checked })}
              />
            </label>

            <div className="flex items-center gap-2 text-xs">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  serverStatus.running ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              <span className="text-text-secondary">
                {serverStatus.running
                  ? `运行中 :${serverStatus.port}`
                  : "已停止"}
              </span>
            </div>

            <p className="text-xs text-text-secondary">
              开启后其他 WhisperDesk 可通过 <code>http://本机IP:{settings.inferenceServerPort}</code> 调用本机推理
            </p>

            {serverStatus.running && (
              <p className="text-xs text-text-secondary">
                浏览器打开{" "}
                <a
                  className="text-primary underline"
                  href={`http://localhost:${serverStatus.port}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  http://localhost:{serverStatus.port}
                </a>
                {" "}查看完整 Dashboard
              </p>
            )}
          </div>

          {serverStatus.running && dashboard && (
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
                          <span className={`inline-block h-2 w-2 rounded-full ${
                            t.status === "receiving" ? "animate-pulse bg-yellow-500"
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

        {/* 远程推理（使用其他设备的推理服务） */}
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
        </div>

        {/* 模型管理 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-secondary">
              模型管理
            </h3>
            <button
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
            </button>
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

          <div className="divide-y divide-border rounded-lg border border-border">
            {MODEL_NAMES.map((name) => {
              const m = models.find((mm) => mm.name === name);
              const isDownloading = downloading === name;

              return (
                <div
                  key={name}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {name}
                      {m?.downloaded && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          已下载
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary">
                      {MODEL_DESCRIPTIONS[name]}
                      {m?.downloaded && m.size > 0 && (
                        <span className="ml-1">
                          · 实际 {formatBytes(m.size)}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {m?.downloaded ? (
                      <button
                        className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => handleDelete(name)}
                      >
                        删除
                      </button>
                    ) : (
                      <button
                        disabled={isDownloading}
                        className="rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                        onClick={() => handleDownload(name)}
                      >
                        {isDownloading ? "下载中..." : "自动下载"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
                从以下地址下载所需模型文件（推荐用浏览器或下载工具）：
              </li>
            </ol>
            <div className="mt-2 space-y-1">
              {MODEL_NAMES.map((name) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 font-medium text-amber-800">
                    {name}:
                  </span>
                  <code className="min-w-0 flex-1 truncate rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 select-all">
                    {HUGGINGFACE_BASE}/ggml-{name}.bin
                  </code>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-amber-700">
              3. 将下载好的 <code>.bin</code> 文件放入模型目录，文件名保持
              <code>ggml-模型名.bin</code> 格式，然后刷新此页面即可识别
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
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === opt.value
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
