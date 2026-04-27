import { create } from "zustand";
import type { AppSettings } from "@/lib/types";

const STORAGE_KEY = "whisperdesk.settings";

const defaultSettings: AppSettings = {
  modelName: "base",
  language: "zh",
  threads: 4,
  useGpu: true,
  remoteUrl: "",
  inferenceServerEnabled: false,
  inferenceServerPort: 3000,
};

interface SettingsState {
  settings: AppSettings;
  setSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

function loadInitialSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: loadInitialSettings(),
  setSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ settings: next });
  },
  resetSettings: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultSettings));
    set({ settings: defaultSettings });
  },
}));
