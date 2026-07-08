import type { AppFontPreset, AppTheme } from "@/types/workspace"

export type ThemeMode = "system" | "light" | "dark"

export interface FontPresetOption {
  key: AppFontPreset
  label: string
  description: string
  sans: string
  mono: string
}

export const AESTIVUS_THEME_NAME_BY_PRESET: Record<AppTheme, string> = {
  spatial: "Default",
  endfield: "Endfield",
  wuling: "Wuling",
}

export const FONT_PRESETS: FontPresetOption[] = [
  {
    key: "xiranite",
    label: "Xiranite",
    description: "Inter UI with JetBrains Mono code surfaces.",
    sans: "\"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "system",
    label: "System",
    description: "Native platform UI fonts with stable monospace fallback.",
    sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    mono: "ui-monospace, \"Cascadia Mono\", \"Segoe UI Mono\", monospace",
  },
  {
    key: "aestivus",
    label: "Aestivus",
    description: "LXGW WenKai style text with JetBrains Mono for technical fields.",
    sans: "\"LXGW WenKai Screen\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "serif",
    label: "Serif",
    description: "Reading-friendly serif text while keeping code monospace.",
    sans: "ui-serif, Georgia, Cambria, \"Times New Roman\", serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "mono",
    label: "Mono UI",
    description: "Monospace everywhere for dense operational workspaces.",
    sans: "\"JetBrains Mono\", ui-monospace, monospace",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
]

export function getFontPresetOption(fontPreset: AppFontPreset): FontPresetOption {
  return FONT_PRESETS.find((preset) => preset.key === fontPreset) ?? FONT_PRESETS[0]
}

export function applyFontPreset(fontPreset: AppFontPreset): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  const preset = getFontPresetOption(fontPreset)
  root.dataset.fontPreset = preset.key
  root.style.setProperty("--font-app-sans", preset.sans)
  root.style.setProperty("--font-app-mono", preset.mono)

  if (preset.key === "xiranite") {
    root.removeAttribute("data-custom-font")
    root.style.removeProperty("--font-custom-sans")
    root.style.removeProperty("--font-custom-mono")
    return
  }

  root.setAttribute("data-custom-font", "enabled")
  root.style.setProperty("--font-custom-sans", preset.sans)
  root.style.setProperty("--font-custom-mono", preset.mono)
}

export function mirrorAestivusThemeStorage(theme: AppTheme, mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return

  localStorage.setItem("theme-name", AESTIVUS_THEME_NAME_BY_PRESET[theme])
  localStorage.setItem("theme-mode", mode)
}
