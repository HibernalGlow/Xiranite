import type { AppCustomTheme, AppFontPreset, AppTheme } from "@/types/workspace"

export type ThemePresetMode = "light" | "dark"

export type ThemeStyleFamily =
  | "spatial-product"
  | "tactical-console"
  | "jade-industrial"

export type ThemeDensity = "compact" | "balanced" | "comfortable"
export type ThemeRadiusProfile = "soft" | "technical" | "hard"
export type ThemeBorderTreatment = "subtle" | "outlined" | "brutalist"
export type ThemeMotionStyle = "soft" | "mechanical" | "cinematic"
export type ThemeSurfaceTreatment = "flat" | "tonal" | "glass" | "media-led"
export type ThemeDepthModel = "none" | "shadow" | "glow" | "layered"
export type ThemeNodeInteriorMode = "inherit" | "dense-controls" | "ledger-panels"

export interface ThemeStyleProfile {
  family: ThemeStyleFamily
  density: ThemeDensity
  radius: ThemeRadiusProfile
  border: ThemeBorderTreatment
  motion: ThemeMotionStyle
  surface: ThemeSurfaceTreatment
  depth: ThemeDepthModel
  nodeInterior: ThemeNodeInteriorMode
  referenceAxis: string[]
}

export interface ThemeDesignRecipe {
  /**
   * Store-applicable appearance settings only.
   * Higher-level website imitation axes live in THEME_STYLE_PROFILES.
   */
  fontPreset: AppFontPreset
  bgMode: "grid" | "dot-grid" | "image" | "none"
  bgOpacity?: number
  bgBlur?: number
  bgCoverTopBar?: boolean
  grainEnabled?: boolean
  vignetteDepth?: number
  grainIntensity?: number
  actionGlow?: boolean
  cardElevation?: boolean
  chromePosition?: "left" | "right" | "island"
  chromeStyle?: "default" | "traffic-light"
}

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

export const THEME_PRESET_DEFAULT_MODE: Record<AppTheme, ThemePresetMode> = {
  spatial: "light",
  endfield: "dark",
  wuling: "light",
}

export const THEME_DESIGN_RECIPES: Record<AppTheme, ThemeDesignRecipe> = {
  spatial: {
    fontPreset: "xiranite",
    bgMode: "dot-grid",
    grainEnabled: true,
    vignetteDepth: 40,
    grainIntensity: 15,
    actionGlow: true,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "default",
  },
  endfield: {
    fontPreset: "mono",
    bgMode: "grid",
    grainEnabled: true,
    vignetteDepth: 48,
    grainIntensity: 12,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "left",
    chromeStyle: "traffic-light",
  },
  wuling: {
    fontPreset: "industrial",
    bgMode: "grid",
    bgCoverTopBar: false,
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "default",
  },
}

export const THEME_STYLE_PROFILES: Record<AppTheme, ThemeStyleProfile> = {
  spatial: {
    family: "spatial-product",
    density: "comfortable",
    radius: "soft",
    border: "subtle",
    motion: "soft",
    surface: "tonal",
    depth: "layered",
    nodeInterior: "inherit",
    referenceAxis: ["quiet SaaS workspace", "soft data surfaces", "balanced scanning"],
  },
  endfield: {
    family: "tactical-console",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "flat",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["operational console", "futuristic dashboard", "dark luminous UI"],
  },
  wuling: {
    family: "jade-industrial",
    density: "balanced",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "tonal",
    depth: "none",
    nodeInterior: "ledger-panels",
    referenceAxis: ["jade industrial", "ledger tables", "hard outlined utility panels"],
  },
}

const THEME_ROOT_CLASSES: Record<AppTheme, string> = {
  spatial: "theme-spatial",
  endfield: "theme-endfield",
  wuling: "theme-wuling",
}

let customThemeKeys = new Set<string>()

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
    key: "industrial",
    label: "Industrial",
    description: "Hanken Grotesk UI with JetBrains Mono labels for jade industrial workspaces.",
    sans: "\"Hanken Grotesk\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
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

export function applyThemePreset(theme: AppTheme): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  root.dataset.appTheme = theme
  root.classList.remove(...Object.values(THEME_ROOT_CLASSES))
  root.classList.add(THEME_ROOT_CLASSES[theme])
}

export function applyCustomTheme(customTheme: AppCustomTheme | null, mode: ThemeMode): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  for (const key of customThemeKeys) {
    root.style.removeProperty(`--${key}`)
  }
  customThemeKeys = new Set()

  if (!customTheme) {
    root.removeAttribute("data-custom-theme")
    root.removeAttribute("data-custom-theme-name")
    return
  }

  const isDark = mode === "dark" || (mode === "system" && root.classList.contains("dark"))
  const selectedVars = isDark ? (customTheme.cssVars.dark ?? customTheme.cssVars.light) : customTheme.cssVars.light
  const cssVars = {
    ...(customTheme.cssVars.theme ?? {}),
    ...selectedVars,
  }

  root.setAttribute("data-custom-theme", "enabled")
  root.dataset.customThemeName = customTheme.name
  for (const [key, value] of Object.entries(cssVars)) {
    const cssVarName = normalizeCssVarName(key)
    if (!cssVarName) continue
    root.style.setProperty(`--${cssVarName}`, value)
    customThemeKeys.add(cssVarName)
  }
}

export function parseImportedThemeJson(jsonString: string): AppCustomTheme[] {
  const parsed = JSON.parse(jsonString) as unknown

  if (Array.isArray(parsed)) {
    const themes: AppCustomTheme[] = []
    for (const item of parsed) {
      const theme = parseThemeRecord(item)
      if (theme) themes.push(theme)
    }
    if (themes.length > 0) return dedupeThemesByName(themes)
    throw new Error("Theme JSON array must include at least one valid theme.")
  }

  const theme = parseThemeRecord(parsed)
  if (theme) return [theme]

  throw new Error("Theme JSON must include cssVars.light or colors.light.")
}

function parseThemeRecord(value: unknown): AppCustomTheme | null {
  if (!isRecord(value)) return null

  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Imported"
  const description = typeof value.description === "string" ? value.description : undefined

  if (isRecord(value.cssVars)) {
    const light = stringRecord(value.cssVars.light)
    if (!light) return null

    return {
      name,
      description,
      cssVars: {
        theme: stringRecord(value.cssVars.theme) ?? undefined,
        light,
        dark: stringRecord(value.cssVars.dark) ?? undefined,
      },
    }
  }

  if (isRecord(value.colors)) {
    const light = stringRecord(value.colors.light)
    if (!light) return null

    return {
      name,
      description,
      cssVars: {
        light,
        dark: stringRecord(value.colors.dark) ?? undefined,
      },
    }
  }

  return null
}

export function mirrorAestivusThemeStorage(theme: AppTheme, mode: ThemeMode, customThemes: AppCustomTheme[] = [], activeTheme?: AppCustomTheme | null): void {
  if (typeof localStorage === "undefined") return

  localStorage.setItem("theme-name", activeTheme?.name ?? AESTIVUS_THEME_NAME_BY_PRESET[theme])
  localStorage.setItem("theme-mode", mode)

  if (customThemes.length > 0) {
    const aestivusThemes = customThemes.map((customTheme) => ({
      name: customTheme.name,
      description: customTheme.description ?? "Imported theme",
      colors: {
        light: customTheme.cssVars.light,
        dark: customTheme.cssVars.dark ?? customTheme.cssVars.light,
      },
    }))
    localStorage.setItem("custom-themes", JSON.stringify(aestivusThemes))
  } else {
    localStorage.removeItem("custom-themes")
  }
}

export function getActiveCustomTheme(customThemes: AppCustomTheme[], activeThemeName: string | null): AppCustomTheme | null {
  if (!activeThemeName) return null
  return customThemes.find((theme) => theme.name === activeThemeName) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [normalizeCssVarName(key), entryValue] as const)
    .filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function normalizeCssVarName(key: string): string {
  return key.trim().replace(/^--/, "")
}

function dedupeThemesByName(themes: AppCustomTheme[]): AppCustomTheme[] {
  const map = new Map<string, AppCustomTheme>()
  for (const theme of themes) {
    map.set(theme.name, theme)
  }
  return [...map.values()]
}
