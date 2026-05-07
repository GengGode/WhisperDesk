import { create } from "zustand";
import type { AppSettings } from "@/lib/types";
import { defaultVadConfig } from "@/lib/types";
import { checkCuda } from "@/lib/tauri";

const STORAGE_KEY = "whisperdesk.settings";

const defaultSettings: AppSettings = {
  theme: "system",
  backend: "sherpa-onnx",
  modelName: "sensevoice-zh",
  language: "zh",
  threads: 4,
  useGpu: true,
  remoteUrl: "",
  inferenceServerEnabled: false,
  inferenceServerPort: 3000,
  silentStart: false,

  bestOf: 5,
  suppressBlank: true,
  suppressNst: true,
  noContext: true,
  entropyThold: 2.4,
  logprobThold: -1.0,
  noSpeechThold: 0.6,
  temperature: 0.0,
  temperatureInc: 0.2,
  maxInitialTs: 1.0,
  maxRepeatFilter: 3,

  enableVad: true,
  vadConfig: { ...defaultVadConfig },
  initialPrompt: "",
  enablePunctuation: true,
  downloadProxy: "",
};

interface SettingsState {
  settings: AppSettings;
  /** 本机 CUDA 是否可用（运行时检测） */
  cudaAvailable: boolean;
  cudaMessage: string;
  /** sherpa-onnx 后端 DLL 是否在运行时可用 */
  sherpaAvailable: boolean;
  sherpaMessage: string;
  setSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
  /** 启动时调用，检测 CUDA 与 sherpa-onnx 可用性 */
  initCuda: () => Promise<void>;
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
  cudaAvailable: false,
  cudaMessage: "",
  sherpaAvailable: true,
  sherpaMessage: "",
  setSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ settings: next });
  },
  resetSettings: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultSettings));
    set({ settings: defaultSettings });
  },
  initCuda: async () => {
    try {
      const info = await checkCuda();
      set({
        cudaAvailable: info.available,
        cudaMessage: info.message,
        sherpaAvailable: info.sherpaAvailable,
        sherpaMessage: info.sherpaMessage ?? "",
      });
      // sherpa-onnx 不可用且当前选择了它，自动回退到 whisper
      if (!info.sherpaAvailable && get().settings.backend === "sherpa-onnx") {
        const next = { ...get().settings, backend: "whisper" as const, modelName: "large-v3-turbo" };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        set({ settings: next });
      }
    } catch {
      set({ cudaAvailable: false, cudaMessage: "CUDA 检测失败", sherpaAvailable: true, sherpaMessage: "" });
    }
  },
}));
