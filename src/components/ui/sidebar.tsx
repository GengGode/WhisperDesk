import { useSettingsStore } from "@/stores/settings-store";

interface SidebarProps {
  children: React.ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  const useGpu = useSettingsStore((s) => s.settings.useGpu);
  const setSettings = useSettingsStore((s) => s.setSettings);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-secondary">
      <div className="flex h-14 items-center px-4">
        <h1 className="text-lg font-semibold tracking-tight">WhisperDesk</h1>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">{children}</nav>
      <div className="border-t border-border px-4 py-3">
        <GpuToggle checked={useGpu} onChange={(v) => setSettings({ useGpu: v })} />
      </div>
    </aside>
  );
}

function GpuToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-white/60"
      onClick={() => onChange(!checked)}
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
          {checked ? "CUDA" : "CPU"}
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
