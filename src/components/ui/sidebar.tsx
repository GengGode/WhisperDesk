import { useSettingsStore } from "@/stores/settings-store";
import type { ThemeMode } from "@/lib/types";

interface SidebarProps {
  children: React.ReactNode;
}

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "system"];

export function Sidebar({ children }: SidebarProps) {
  const useGpu = useSettingsStore((s) => s.settings.useGpu);
  const theme = useSettingsStore((s) => s.settings.theme);
  const cudaAvailable = useSettingsStore((s) => s.cudaAvailable);
  const cudaMessage = useSettingsStore((s) => s.cudaMessage);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setSettings({ theme: next });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-secondary">
      <div className="flex h-14 items-center px-4">
        <h1 className="text-lg font-semibold tracking-tight">WhisperDesk</h1>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">{children}</nav>
      <div className="border-t border-border px-4 py-3 space-y-1">
        <ThemeToggle theme={theme} onClick={cycleTheme} />
        <GpuToggle
          checked={useGpu}
          localCudaAvailable={cudaAvailable}
          tooltip={cudaAvailable ? cudaMessage : `${cudaMessage}（本机仅 CPU，远程推理仍可使用 GPU）`}
          onChange={(v) => setSettings({ useGpu: v })}
        />
      </div>
    </aside>
  );
}

const THEME_LABELS: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function ThemeToggle({ theme, onClick }: { theme: ThemeMode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-border/40"
      onClick={onClick}
      title={`当前：${THEME_LABELS[theme]}，点击切换`}
    >
      <div className="flex items-center gap-2">
        {theme === "light" && (
          <svg className="h-4 w-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 3v1m0 16v1m8.66-13.66l-.71.71M4.05 19.95l-.71.71M21 12h-1M4 12H3m16.66 7.66l-.71-.71M4.05 4.05l-.71-.71M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        )}
        {theme === "dark" && (
          <svg className="h-4 w-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
        {theme === "system" && (
          <svg className="h-4 w-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
        <span className="text-xs font-medium text-text-secondary">
          {THEME_LABELS[theme]}
        </span>
      </div>
    </button>
  );
}

function GpuToggle({
  checked,
  localCudaAvailable,
  tooltip,
  onChange,
}: {
  checked: boolean;
  /** 本机 CUDA 是否可用（仅用于显示提示，不阻止切换） */
  localCudaAvailable: boolean;
  tooltip: string;
  onChange: (v: boolean) => void;
}) {
  const label = checked
    ? localCudaAvailable ? "CUDA" : "GPU（远程）"
    : "CPU";

  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-white/60"
      onClick={() => onChange(!checked)}
      title={tooltip}
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 text-text-secondary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zm4-10h2v2h-2V9z"
          />
        </svg>
        <span className="text-xs font-medium text-text-secondary">
          {label}
        </span>
      </div>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
          checked ? "bg-primary" : "bg-border"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
