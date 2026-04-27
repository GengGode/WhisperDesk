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
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscriptionStore } from "@/stores/transcription-store";
import type { DashboardSnapshot, ServerStatus, WhisperModel } from "@/lib/types";

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

  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const dashPollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    setServerConfig({
      modelName: settings.modelName,
      threads: settings.threads,
      useGpu: settings.useGpu,
    }).catch(() => {});
  }, [settings.modelName, settings.threads, settings.useGpu]);

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
