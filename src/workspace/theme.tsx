import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export type ThemeId = "spatial" | "endfield" | "wuling";
export type ColorMode = "dark" | "light" | "system";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tag: string;
  swatch: string[];
  swatchLabels: string[];
  description: string;
  defaultMode: ColorMode;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "spatial",
    name: "Spatial Studio",
    tag: "空间工作室 · Light Interface",
    swatch: ["oklch(0.97 0.005 148)", "oklch(0.40 0.12 148)", "oklch(0.88 0.02 148)", "oklch(0.12 0.01 148)"],
    swatchLabels: ["BG", "Primary", "Border", "Text"],
    description: "Clean light interface with forest green accents. Precision-focused, minimal cognitive load.",
    defaultMode: "light",
  },
  {
    id: "endfield",
    name: "Endfield Tactical",
    tag: "终末地 · Dark Slate + Green",
    swatch: ["oklch(0.13 0.025 216)", "oklch(0.17 0.025 216)", "oklch(0.62 0.18 152)", "oklch(0.90 0.04 148)"],
    swatchLabels: ["Void", "Card", "Green", "Text"],
    description: "HUD-like, data-dense technical interface. Deep slate with vibrant Endfield Green highlights.",
    defaultMode: "dark",
  },
  {
    id: "wuling",
    name: "武陵城 Wuling City",
    tag: "明日方舟终末地 · Warm Gold",
    swatch: ["oklch(0.12 0.03 55)", "oklch(0.16 0.04 55)", "oklch(0.70 0.16 68)", "oklch(0.93 0.04 80)"],
    swatchLabels: ["Deep", "Surface", "Gold", "Text"],
    description: "Ancient city meeting cyberpunk — gold accents against deep ochre darkness.",
    defaultMode: "dark",
  },
];

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function disableTransitions() {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  );
  document.head.appendChild(style);
  return () => {
    window.getComputedStyle(document.body);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove());
    });
  };
}

interface ThemeApi {
  theme: ThemeId;
  colorMode: ColorMode;
  isDark: boolean;
  setTheme: (id: ThemeId) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleDarkLight: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem("xiranite-theme");
    return (stored === "spatial" || stored === "endfield" || stored === "wuling") ? stored : "spatial";
  });

  const [colorMode, setColorModeState] = useState<ColorMode>(() => {
    const stored = localStorage.getItem("xiranite-color-mode");
    return (stored === "dark" || stored === "light" || stored === "system") ? stored : "system";
  });

  const isDark = colorMode === "system" ? getSystemDark() : colorMode === "dark";

  const applyTheme = useCallback((themeId: ThemeId, dark: boolean) => {
    const restore = disableTransitions();
    const root = document.documentElement;
    root.setAttribute("data-theme", themeId);
    root.classList.remove("dark", "light");
    root.classList.add(dark ? "dark" : "light");
    restore();
  }, []);

  useEffect(() => {
    applyTheme(theme, isDark);
  }, [theme, isDark, applyTheme]);

  useEffect(() => {
    if (colorMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(theme, getSystemDark());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [colorMode, theme, applyTheme]);

  // 'D' keyboard shortcut to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key.toLowerCase() !== "d") return;
      setColorModeState((prev) => {
        const next = prev === "dark" ? "light" : prev === "light" ? "dark" : getSystemDark() ? "light" : "dark";
        localStorage.setItem("xiranite-color-mode", next);
        return next;
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    localStorage.setItem("xiranite-theme", id);
    setThemeState(id);
  }, []);

  const setColorMode = useCallback((mode: ColorMode) => {
    localStorage.setItem("xiranite-color-mode", mode);
    setColorModeState(mode);
  }, []);

  const toggleDarkLight = useCallback(() => {
    setColorModeState((prev) => {
      const next = prev === "dark" ? "light" : prev === "light" ? "dark" : getSystemDark() ? "light" : "dark";
      localStorage.setItem("xiranite-color-mode", next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, colorMode, isDark, setTheme, setColorMode, toggleDarkLight }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
