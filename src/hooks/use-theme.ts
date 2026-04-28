import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

const DARK_CLASS = "dark";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle(DARK_CLASS, dark);
}

/**
 * 根据 settings-store 中的 theme 值管理 <html> 上的 dark class。
 * theme === "system" 时自动跟随系统偏好并监听变化。
 */
export function useTheme() {
  const theme = useSettingsStore((s) => s.settings.theme);

  useEffect(() => {
    if (theme === "dark") {
      applyTheme(true);
      return;
    }
    if (theme === "light") {
      applyTheme(false);
      return;
    }

    // system：读取当前偏好并监听变化
    const mql = window.matchMedia(MEDIA_QUERY);
    applyTheme(mql.matches);

    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);
}
