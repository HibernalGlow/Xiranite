import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeId = "wuling" | "utopia";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tag: string;
  swatch: string[];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "wuling",
    name: "武陵城",
    tag: "终末地 · Endfield Tactical Workspace",
    swatch: ["#f9f9fc", "#286b33", "#1b6d24", "#ba1a1a"],
  },
  {
    id: "utopia",
    name: "乌托邦",
    tag: "Atmospheric Urban Workspace",
    swatch: ["#161311", "#ffb4a5", "#f0bd8b", "#d2c4bb"],
  },
];

interface ThemeApi {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>("wuling");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
