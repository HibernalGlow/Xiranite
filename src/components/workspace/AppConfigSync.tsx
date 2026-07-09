import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getAppConfigFromBackend, saveAppConfigToBackend } from "@/backend/configRpcClient"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { getActiveCustomTheme, mirrorAestivusThemeStorage, parseImportedThemeJson, type ThemeMode } from "@/lib/appearance"
import { normalizePersistedBackgroundImageUrl, sanitizePersistedBackgroundImageUrl } from "@/lib/backgroundImage"
import { useTheme } from "@/components/theme-provider"
import { changeLanguage, getCurrentLanguage, type Language } from "@/i18n"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceContext"
import type { OverlayFloatingMetrics, WorkspaceUiPreferences } from "@/store/workspace/types"
import type { AppCustomTheme, AppFontPreset, AppTheme, CardLayout } from "@/types/workspace"

const APP_UI_SECTION = "ui"
const APP_UI_CONFIG_VERSION = 1
const WORKSPACE_UI_STORAGE_KEY = "xiranite-workspace-ui"
const THEME_STORAGE_KEY = "theme"
const AESTIVUS_THEME_NAME_STORAGE_KEY = "theme-name"
const AESTIVUS_THEME_MODE_STORAGE_KEY = "theme-mode"
const AESTIVUS_CUSTOM_THEMES_STORAGE_KEY = "custom-themes"
const I18N_STORAGE_KEY = "i18n.lang"
const MUSIC_DOCK_MODE_STORAGE_KEY = "xiranite.musicDock.mode"
const MUSIC_DOCK_TRACKS_STORAGE_KEY = "xiranite.musicDock.savedTracks"
const MUSIC_DOCK_SOURCE_STORAGE_KEY = "xiranite.musicDock.sourcePath"
const MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY = "xiranite.musicDock.floatingOffset"
const LEGACY_CONFIG_CHANGED_EVENT = "xiranite:legacy-config-changed"

type MusicDockMode = "bottom" | "floating"

interface AppUiConfig {
  version?: number
  workspace?: Partial<WorkspaceUiPreferences>
  appearance?: {
    colorMode?: ThemeMode
  }
  i18n?: {
    language?: Language
  }
  musicDock?: {
    mode?: MusicDockMode
    savedTracks?: unknown[]
    sourcePath?: string
    floatingOffset?: { x: number; y: number }
  }
  migratedFrom?: {
    localStorageKeys?: string[]
    at?: string
  }
}

type BrowserLegacyConfig = Pick<AppUiConfig, "musicDock" | "migratedFrom"> & {
  workspace?: Partial<WorkspaceUiPreferences>
  appearance?: AppUiConfig["appearance"]
  i18n?: AppUiConfig["i18n"]
  hasWorkspaceStore?: boolean
}

const APP_THEMES = new Set<AppTheme>(["spatial", "endfield", "wuling", "onlook", "tori", "conductor", "hilden", "aperture", "noomo", "excalidraw", "astro", "svelte", "bun", "storybook", "supabase", "penpot", "vite"])
const FONT_PRESETS = new Set<AppFontPreset>(["xiranite", "system", "aestivus", "industrial", "display", "editorial", "poster", "terminal", "machina", "sketch", "workshop", "canvas", "serif", "mono"])
const CARD_LAYOUTS = new Set<CardLayout>(["grid", "stack", "split", "focus"])
const BG_MODES = new Set<WorkspaceUiPreferences["bgMode"]>(["grid", "dot-grid", "image", "none"])
const CHROME_POSITIONS = new Set<WorkspaceUiPreferences["chromePosition"]>(["left", "right", "island"])
const CHROME_STYLES = new Set<WorkspaceUiPreferences["chromeStyle"]>(["default", "traffic-light"])
const THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"])
const LANGUAGES = new Set<Language>(["en", "zh"])
const OVERLAY_MODES = new Set<WorkspaceUiPreferences["overlayMode"]>(["docked", "floating"])
const MUSIC_DOCK_MODES = new Set<MusicDockMode>(["bottom", "floating"])

export function AppConfigSync() {
  const backendStatus = useLocalBackendStatus()
  const workspaceActions = useWorkspaceActions()
  const workspace = useWorkspaceShallowSelector(selectWorkspaceUiPreferences)
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()
  const colorMode = isThemeMode(theme) ? theme : "system"
  const language = getCurrentLanguage()
  const loadedRef = useRef(false)
  const applyingRef = useRef(false)
  const lastSavedKeyRef = useRef("")
  const migratedFromRef = useRef<AppUiConfig["migratedFrom"] | undefined>(undefined)
  const [legacyVersion, setLegacyVersion] = useState(0)
  const currentRef = useRef({ workspace, colorMode, language })
  const syncActionsRef = useRef({ workspaceActions, setTheme })

  currentRef.current = { workspace, colorMode, language }
  syncActionsRef.current = { workspaceActions, setTheme }

  const backendKey = backendStatus.data?.status === "ready" && backendStatus.data.config
    ? `${backendStatus.data.config.baseUrl}\n${backendStatus.data.config.token ?? ""}`
    : ""

  useEffect(() => {
    if (!backendKey) return

    let cancelled = false
    loadedRef.current = false
    applyingRef.current = false
    lastSavedKeyRef.current = ""

    async function loadAppConfig() {
      try {
        const response = await getAppConfigFromBackend<AppUiConfig>(APP_UI_SECTION)
        if (cancelled) return

        const existing = normalizeAppUiConfig(response.config)
        if (isEmptyAppUiConfig(existing)) {
          const legacy = readBrowserLegacyConfig()
          const workspace = legacy.hasWorkspaceStore
            ? currentRef.current.workspace
            : {
              ...currentRef.current.workspace,
              ...legacy.workspace,
            }
          const migrated = buildAppUiConfig(
            workspace,
            legacy.appearance?.colorMode ?? currentRef.current.colorMode,
            legacy.i18n?.language ?? currentRef.current.language,
            legacy,
            legacy.migratedFrom,
          )
          await saveAppConfigToBackend(APP_UI_SECTION, migrated)
          if (cancelled) return
          applyingRef.current = true
          applyAppUiConfig(
            migrated,
            syncActionsRef.current.workspaceActions,
            syncActionsRef.current.setTheme,
          )
          migratedFromRef.current = migrated.migratedFrom
          lastSavedKeyRef.current = stableStringify(migrated)
          loadedRef.current = true
          queueMicrotask(() => {
            applyingRef.current = false
          })
          return
        }

        migratedFromRef.current = existing.migratedFrom
        applyingRef.current = true
        applyAppUiConfig(
          existing,
          syncActionsRef.current.workspaceActions,
          syncActionsRef.current.setTheme,
        )
        lastSavedKeyRef.current = stableStringify(buildAppUiConfig(
          {
            ...currentRef.current.workspace,
            ...existing.workspace,
          },
          existing.appearance?.colorMode ?? currentRef.current.colorMode,
          existing.i18n?.language ?? currentRef.current.language,
          readBrowserLegacyConfig(),
          migratedFromRef.current,
        ))
        loadedRef.current = true
        queueMicrotask(() => {
          applyingRef.current = false
        })
      } catch (error) {
        console.warn("[config] app.ui sync failed:", error)
      }
    }

    void loadAppConfig()

    return () => {
      cancelled = true
    }
  }, [backendKey])

  useEffect(() => {
    const refreshLegacyConfig = () => {
      setLegacyVersion((version) => version + 1)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key) return
      if (isLegacyConfigStorageKey(event.key)) refreshLegacyConfig()
    }

    window.addEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshLegacyConfig)
    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshLegacyConfig)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  const configKey = useMemo(
    () => stableStringify(buildAppUiConfig(
      workspace,
      colorMode,
      language,
      readBrowserLegacyConfig(),
      migratedFromRef.current,
    )),
    [workspace, colorMode, language, i18n.language, legacyVersion],
  )

  useEffect(() => {
    if (!backendKey || !loadedRef.current || applyingRef.current) return
    if (configKey === lastSavedKeyRef.current) return

    const timer = window.setTimeout(() => {
      const nextConfig = buildAppUiConfig(
        currentRef.current.workspace,
        currentRef.current.colorMode,
        currentRef.current.language,
        readBrowserLegacyConfig(),
        migratedFromRef.current,
      )
      const nextKey = stableStringify(nextConfig)
      if (nextKey === lastSavedKeyRef.current) return

      saveAppConfigToBackend(APP_UI_SECTION, nextConfig)
        .then(() => {
          lastSavedKeyRef.current = nextKey
        })
        .catch((error) => {
          console.warn("[config] app.ui save failed:", error)
        })
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [backendKey, configKey])

  return null
}

function selectWorkspaceUiPreferences(state: WorkspaceUiPreferences): WorkspaceUiPreferences {
  return {
    theme: state.theme,
    customThemes: state.customThemes,
    activeCustomThemeName: state.activeCustomThemeName,
    fontPreset: state.fontPreset,
    cardLayout: state.cardLayout,
    overlayMode: state.overlayMode,
    overlayWidth: state.overlayWidth,
    overlayFloatingMetrics: state.overlayFloatingMetrics,
    grainEnabled: state.grainEnabled,
    vignetteDepth: state.vignetteDepth,
    grainIntensity: state.grainIntensity,
    actionGlow: state.actionGlow,
    cardElevation: state.cardElevation,
    bgMode: state.bgMode,
    bgImageUrl: sanitizePersistedBackgroundImageUrl(state.bgImageUrl),
    bgOpacity: state.bgOpacity,
    bgBlur: state.bgBlur,
    bgCoverTopBar: state.bgCoverTopBar,
    liquidGlassEnabled: state.liquidGlassEnabled,
    liquidGlassOpacity: state.liquidGlassOpacity,
    liquidGlassBlur: state.liquidGlassBlur,
    liquidGlassDisplacement: state.liquidGlassDisplacement,
    chromeVisible: state.chromeVisible,
    chromePosition: state.chromePosition,
    chromeStyle: state.chromeStyle,
    chromeIslandScale: state.chromeIslandScale,
    chromeIslandMotion: state.chromeIslandMotion,
    chromeIslandDelay: state.chromeIslandDelay,
    chromeIslandIdleOffset: state.chromeIslandIdleOffset,
  }
}

function buildAppUiConfig(
  workspace: WorkspaceUiPreferences,
  colorMode: ThemeMode,
  language: Language,
  legacy: Pick<AppUiConfig, "musicDock" | "migratedFrom">,
  migratedFrom?: AppUiConfig["migratedFrom"],
): AppUiConfig {
  return pruneUndefined({
    version: APP_UI_CONFIG_VERSION,
    workspace: sanitizeWorkspaceConfig(workspace),
    appearance: { colorMode },
    i18n: { language },
    musicDock: legacy.musicDock,
    migratedFrom,
  }) as AppUiConfig
}

function applyAppUiConfig(
  config: AppUiConfig,
  workspaceActions: ReturnType<typeof useWorkspaceActions>,
  setTheme: (theme: ThemeMode) => void,
) {
  if (config.workspace) {
    workspaceActions.hydrateUiPreferences(config.workspace)
  }
  if (config.appearance?.colorMode && isThemeMode(config.appearance.colorMode)) {
    setTheme(config.appearance.colorMode)
  }
  if (config.i18n?.language && config.i18n.language !== getCurrentLanguage()) {
    void changeLanguage(config.i18n.language)
  }
  writeBrowserLegacyConfig(config)
}

function normalizeAppUiConfig(value: unknown): AppUiConfig {
  if (!isRecord(value)) return {}
  return pruneUndefined({
    version: typeof value.version === "number" ? value.version : undefined,
    workspace: normalizeWorkspacePreferences(value.workspace),
    appearance: normalizeAppearanceConfig(value.appearance),
    i18n: normalizeI18nConfig(value.i18n),
    musicDock: normalizeMusicDockConfig(value.musicDock),
    migratedFrom: isRecord(value.migratedFrom) ? value.migratedFrom : undefined,
  }) as AppUiConfig
}

function normalizeWorkspacePreferences(value: unknown): Partial<WorkspaceUiPreferences> | undefined {
  if (!isRecord(value)) return undefined
  const next: Partial<WorkspaceUiPreferences> = {}
  if (isOneOf(value.theme, APP_THEMES)) next.theme = value.theme
  if (Array.isArray(value.customThemes)) next.customThemes = value.customThemes.filter(isCustomTheme)
  if (typeof value.activeCustomThemeName === "string" || value.activeCustomThemeName === null) next.activeCustomThemeName = value.activeCustomThemeName
  if (isOneOf(value.fontPreset, FONT_PRESETS)) next.fontPreset = value.fontPreset
  if (isOneOf(value.cardLayout, CARD_LAYOUTS)) next.cardLayout = value.cardLayout
  if (isOneOf(value.overlayMode, OVERLAY_MODES)) next.overlayMode = value.overlayMode
  if (typeof value.overlayWidth === "number") next.overlayWidth = value.overlayWidth
  {
    const overlayFloatingMetrics = normalizeOverlayFloatingMetrics(value.overlayFloatingMetrics)
    if (overlayFloatingMetrics) next.overlayFloatingMetrics = overlayFloatingMetrics
  }
  if (typeof value.grainEnabled === "boolean") next.grainEnabled = value.grainEnabled
  if (typeof value.vignetteDepth === "number") next.vignetteDepth = value.vignetteDepth
  if (typeof value.grainIntensity === "number") next.grainIntensity = value.grainIntensity
  if (typeof value.actionGlow === "boolean") next.actionGlow = value.actionGlow
  if (typeof value.cardElevation === "boolean") next.cardElevation = value.cardElevation
  if (isOneOf(value.bgMode, BG_MODES)) next.bgMode = value.bgMode
  if (typeof value.bgImageUrl === "string") {
    const bgImageUrl = normalizePersistedBackgroundImageUrl(value.bgImageUrl)
    if (bgImageUrl !== undefined) next.bgImageUrl = bgImageUrl
  }
  if (typeof value.bgOpacity === "number") next.bgOpacity = value.bgOpacity
  if (typeof value.bgBlur === "number") next.bgBlur = value.bgBlur
  if (typeof value.bgCoverTopBar === "boolean") next.bgCoverTopBar = value.bgCoverTopBar
  if (typeof value.liquidGlassEnabled === "boolean") next.liquidGlassEnabled = value.liquidGlassEnabled
  if (typeof value.liquidGlassOpacity === "number") next.liquidGlassOpacity = value.liquidGlassOpacity
  if (typeof value.liquidGlassBlur === "number") next.liquidGlassBlur = value.liquidGlassBlur
  if (typeof value.liquidGlassDisplacement === "number") next.liquidGlassDisplacement = value.liquidGlassDisplacement
  if (typeof value.chromeVisible === "boolean") next.chromeVisible = value.chromeVisible
  if (isOneOf(value.chromePosition, CHROME_POSITIONS)) next.chromePosition = value.chromePosition
  if (isOneOf(value.chromeStyle, CHROME_STYLES)) next.chromeStyle = value.chromeStyle
  if (typeof value.chromeIslandScale === "number") next.chromeIslandScale = value.chromeIslandScale
  if (typeof value.chromeIslandMotion === "number") next.chromeIslandMotion = value.chromeIslandMotion
  if (typeof value.chromeIslandDelay === "number") next.chromeIslandDelay = value.chromeIslandDelay
  if (typeof value.chromeIslandIdleOffset === "number") next.chromeIslandIdleOffset = value.chromeIslandIdleOffset
  return Object.keys(next).length ? next : undefined
}

function normalizeAppearanceConfig(value: unknown): AppUiConfig["appearance"] {
  if (!isRecord(value)) return undefined
  return isThemeMode(value.colorMode) ? { colorMode: value.colorMode } : undefined
}

function sanitizeWorkspaceConfig(workspace: WorkspaceUiPreferences): WorkspaceUiPreferences {
  return {
    ...workspace,
    bgImageUrl: sanitizePersistedBackgroundImageUrl(workspace.bgImageUrl),
  }
}

function normalizeI18nConfig(value: unknown): AppUiConfig["i18n"] {
  if (!isRecord(value)) return undefined
  return isOneOf(value.language, LANGUAGES) ? { language: value.language } : undefined
}

function normalizeOverlayFloatingMetrics(value: unknown): OverlayFloatingMetrics | undefined {
  if (!isRecord(value)) return undefined
  const widthRatio = finiteNumber(value.widthRatio)
  const heightRatio = finiteNumber(value.heightRatio)
  const xRatio = finiteNumber(value.xRatio)
  const yRatio = finiteNumber(value.yRatio)
  if (widthRatio === undefined || heightRatio === undefined || xRatio === undefined || yRatio === undefined) {
    return undefined
  }
  return {
    widthRatio: clampRatio(widthRatio),
    heightRatio: clampRatio(heightRatio),
    xRatio: clampRatio(xRatio),
    yRatio: clampRatio(yRatio),
  }
}

function normalizeMusicDockConfig(value: unknown): AppUiConfig["musicDock"] {
  if (!isRecord(value)) return undefined
  const mode = isOneOf(value.mode, MUSIC_DOCK_MODES) ? value.mode : undefined
  const savedTracks = Array.isArray(value.savedTracks) ? value.savedTracks : undefined
  const sourcePath = typeof value.sourcePath === "string" ? value.sourcePath : undefined
  const floatingOffset = isRecord(value.floatingOffset)
    && typeof value.floatingOffset.x === "number"
    && typeof value.floatingOffset.y === "number"
    ? { x: value.floatingOffset.x, y: value.floatingOffset.y }
    : undefined
  return mode || savedTracks || sourcePath || floatingOffset
    ? { mode, savedTracks, sourcePath, floatingOffset }
    : undefined
}

function readBrowserLegacyConfig(): BrowserLegacyConfig {
  if (typeof window === "undefined") return {}
  const keys: string[] = []
  const hasWorkspaceStore = window.localStorage.getItem(WORKSPACE_UI_STORAGE_KEY) !== null
  const musicDock = normalizeMusicDockConfig({
    mode: readLocalStorageValue(MUSIC_DOCK_MODE_STORAGE_KEY, keys),
    savedTracks: parseJson(readLocalStorageValue(MUSIC_DOCK_TRACKS_STORAGE_KEY, keys)),
    sourcePath: readLocalStorageValue(MUSIC_DOCK_SOURCE_STORAGE_KEY, keys),
    floatingOffset: parseJson(readLocalStorageValue(MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY, keys)),
  })
  const appearance = normalizeAppearanceConfig({
    colorMode: readLocalStorageValue(THEME_STORAGE_KEY, keys) ?? readLocalStorageValue(AESTIVUS_THEME_MODE_STORAGE_KEY, keys),
  })
  const i18n = normalizeI18nConfig({
    language: readLocalStorageValue(I18N_STORAGE_KEY, keys),
  })
  const workspace = hasWorkspaceStore ? undefined : readAestivusThemeWorkspace(keys)

  for (const key of [
    WORKSPACE_UI_STORAGE_KEY,
    AESTIVUS_THEME_NAME_STORAGE_KEY,
  ]) {
    if (window.localStorage.getItem(key) !== null) keys.push(key)
  }

  return pruneUndefined({
    workspace,
    appearance,
    i18n,
    musicDock,
    hasWorkspaceStore,
    migratedFrom: keys.length ? { localStorageKeys: [...new Set(keys)], at: new Date().toISOString() } : undefined,
  }) as BrowserLegacyConfig
}

function readAestivusThemeWorkspace(foundKeys: string[]): Partial<WorkspaceUiPreferences> | undefined {
  const themeName = readLocalStorageValue(AESTIVUS_THEME_NAME_STORAGE_KEY, foundKeys)
  const customThemeText = readLocalStorageValue(AESTIVUS_CUSTOM_THEMES_STORAGE_KEY, foundKeys)
  const workspace: Partial<WorkspaceUiPreferences> = {}

  const presetTheme = appThemeFromAestivusName(themeName)
  if (presetTheme) workspace.theme = presetTheme

  if (customThemeText) {
    try {
      const customThemes = parseImportedThemeJson(customThemeText)
      if (customThemes.length > 0) {
        workspace.customThemes = customThemes
        if (themeName && customThemes.some((theme) => theme.name === themeName)) {
          workspace.activeCustomThemeName = themeName
        }
      }
    } catch {
      // Ignore invalid legacy theme payloads; migratedFrom still records the source key.
    }
  }

  return Object.keys(workspace).length ? workspace : undefined
}

function appThemeFromAestivusName(name: string | null): AppTheme | undefined {
  if (name === "Default") return "spatial"
  if (name === "Endfield") return "endfield"
  if (name === "Wuling") return "wuling"
  if (name === "Onlook") return "onlook"
  if (name === "Tori") return "tori"
  if (name === "Conductor") return "conductor"
  if (name === "Hilden & Kaira") return "hilden"
  if (name === "Project Aperture") return "aperture"
  if (name === "Noomo") return "noomo"
  if (name === "Excalidraw") return "excalidraw"
  if (name === "Astro") return "astro"
  if (name === "Svelte") return "svelte"
  if (name === "Bun") return "bun"
  if (name === "Storybook") return "storybook"
  if (name === "Supabase") return "supabase"
  if (name === "Penpot") return "penpot"
  if (name === "Vite") return "vite"
  return undefined
}

function writeBrowserLegacyConfig(config: AppUiConfig) {
  if (typeof window === "undefined") return

  if (config.appearance?.colorMode) {
    window.localStorage.setItem(THEME_STORAGE_KEY, config.appearance.colorMode)
    window.localStorage.setItem(AESTIVUS_THEME_MODE_STORAGE_KEY, config.appearance.colorMode)
  }
  if (config.i18n?.language) {
    window.localStorage.setItem(I18N_STORAGE_KEY, config.i18n.language)
  }
  if (config.workspace) {
    const activeTheme = getActiveCustomTheme(config.workspace.customThemes ?? [], config.workspace.activeCustomThemeName ?? null)
    if (config.workspace.theme) {
      mirrorAestivusThemeStorage(
        config.workspace.theme,
        config.appearance?.colorMode ?? "system",
        config.workspace.customThemes ?? [],
        activeTheme,
      )
    }
  }
  if (config.musicDock?.mode) window.localStorage.setItem(MUSIC_DOCK_MODE_STORAGE_KEY, config.musicDock.mode)
  if (config.musicDock?.savedTracks) window.localStorage.setItem(MUSIC_DOCK_TRACKS_STORAGE_KEY, JSON.stringify(config.musicDock.savedTracks))
  if (config.musicDock?.sourcePath) window.localStorage.setItem(MUSIC_DOCK_SOURCE_STORAGE_KEY, config.musicDock.sourcePath)
  if (config.musicDock?.floatingOffset) window.localStorage.setItem(MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY, JSON.stringify(config.musicDock.floatingOffset))
  dispatchLegacyConfigChanged()
}

function readLocalStorageValue(key: string, foundKeys: string[]): string | null {
  const value = window.localStorage.getItem(key)
  if (value !== null) foundKeys.push(key)
  return value
}

function isEmptyAppUiConfig(config: AppUiConfig): boolean {
  return !config.workspace && !config.appearance && !config.i18n && !config.musicDock
}

function isLegacyConfigStorageKey(key: string): boolean {
  return LEGACY_CONFIG_STORAGE_KEYS.has(key)
}

function isCustomTheme(value: unknown): value is AppCustomTheme {
  if (!isRecord(value) || typeof value.name !== "string" || !isRecord(value.cssVars)) return false
  return isRecord(value.cssVars.light)
}

function isThemeMode(value: unknown): value is ThemeMode {
  return isOneOf(value, THEME_MODES)
}

function isOneOf<T extends string>(value: unknown, set: Set<T>): value is T {
  return typeof value === "string" && set.has(value as T)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function clampRatio(value: number, min = 0): number {
  return Math.min(1, Math.max(min, value))
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function pruneUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneUndefined)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, pruneUndefined(entryValue)]),
  )
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value))
}

function dispatchLegacyConfigChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEGACY_CONFIG_CHANGED_EVENT))
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  )
}

const LEGACY_CONFIG_STORAGE_KEYS = new Set([
  WORKSPACE_UI_STORAGE_KEY,
  THEME_STORAGE_KEY,
  AESTIVUS_THEME_NAME_STORAGE_KEY,
  AESTIVUS_THEME_MODE_STORAGE_KEY,
  AESTIVUS_CUSTOM_THEMES_STORAGE_KEY,
  I18N_STORAGE_KEY,
  MUSIC_DOCK_MODE_STORAGE_KEY,
  MUSIC_DOCK_TRACKS_STORAGE_KEY,
  MUSIC_DOCK_SOURCE_STORAGE_KEY,
  MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY,
])
