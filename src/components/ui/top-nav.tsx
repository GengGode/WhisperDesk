import type { ThemeMode } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";

type Page = "files" | "transcription" | "editor" | "settings";

interface TopNavProps {
  page: Page;
  onChangePage: (page: Page) => void;
}

const NAV_ITEMS: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  {
    id: "files",
    label: "音频文件",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    ),
  },
  {
    id: "transcription",
    label: "转录",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
        />
      </svg>
    ),
  },
  {
    id: "editor",
    label: "编辑器",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "设置",
    icon: (
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
    ),
  },
];

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "system"];
const THEME_LABELS: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function TopNav({ page, onChangePage }: TopNavProps) {
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
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface-secondary px-4">
      <div className="min-w-0 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">WhisperDesk</h1>
      </div>

      <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = item.id === page;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangePage(item.id)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 text-sm transition-colors ${
                active
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-text-secondary hover:text-text"
              }`}
            >
              <span className="size-4">{item.icon}</span>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle theme={theme} onClick={cycleTheme} />
        <GpuToggle
          checked={useGpu}
          localCudaAvailable={cudaAvailable}
          tooltip={cudaAvailable ? cudaMessage : `${cudaMessage}（本机仅 CPU，远程推理仍可使用 GPU）`}
          onChange={(value) => setSettings({ useGpu: value })}
        />
      </div>
    </header>
  );
}

function ThemeToggle({ theme, onClick }: { theme: ThemeMode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-2 rounded-md px-2.5 text-xs text-text-secondary transition-colors hover:bg-border/40 hover:text-text"
      onClick={onClick}
      title={`当前：${THEME_LABELS[theme]}，点击切换`}
    >
      {theme === "light" && (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 3v1m0 16v1m8.66-13.66l-.71.71M4.05 19.95l-.71.71M21 12h-1M4 12H3m16.66 7.66l-.71-.71M4.05 4.05l-.71-.71M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      )}
      {theme === "dark" && (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
      {theme === "system" && (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      )}
      <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
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
  localCudaAvailable: boolean;
  tooltip: string;
  onChange: (value: boolean) => void;
}) {
  const label = checked ? (localCudaAvailable ? "CUDA" : "GPU（远程）") : "CPU";

  return (
    <button
      type="button"
      className="flex h-9 items-center gap-2 rounded-md px-2.5 text-xs text-text-secondary transition-colors hover:bg-border/40 hover:text-text"
      onClick={() => onChange(!checked)}
      title={tooltip}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zm4-10h2v2h-2V9z"
        />
      </svg>
      <span className="hidden sm:inline">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
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
