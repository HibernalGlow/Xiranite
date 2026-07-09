import { useMemo, useState, type ComponentType } from "react"
import { motion } from "motion/react"
import { restartLocalBackend, type LocalBackendControlRestartResult } from "@/backend/localBackendControl"
import { getRuntimeConnectionInfo, type RuntimeConnectionInfo } from "@/backend/runtimeConnectionInfo"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceContext"
import { useTheme } from "@/components/theme-provider"
import { FONT_PRESETS, getActiveCustomTheme, parseImportedThemeJson, THEME_PRESET_DEFAULT_MODE, THEME_PRESET_OPTIONS, type ThemePresetOption } from "@/lib/appearance"
import type { AppTheme } from "@/types/workspace"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Terminal, Paintbrush, Sun, Moon, Monitor, Palette, Languages, Grid, CircleDot, Image, Upload, X, Code2, Server, RefreshCcw, Copy, ExternalLink, Database, HardDrive, Type, PanelRight, ToggleLeft, Circle, Box, PencilLine, Rocket, Flame, PackageOpen, BookOpen, PenTool, Zap, GitBranch, Aperture } from "lucide-react"
import { useTranslation } from "react-i18next"
import { changeLanguage, getCurrentLanguage, type Language, LANGUAGES } from "@/i18n"

const THEME_ICONS: Record<AppTheme, ComponentType<{ className?: string }>> = {
  spatial: Sun,
  endfield: Terminal,
  wuling: Paintbrush,
  onlook: Image,
  tori: Code2,
  conductor: GitBranch,
  hilden: Palette,
  aperture: Aperture,
  noomo: Box,
  excalidraw: PencilLine,
  astro: Rocket,
  svelte: Flame,
  bun: PackageOpen,
  storybook: BookOpen,
  supabase: Database,
  penpot: PenTool,
  vite: Zap,
}

const THEMES: ThemePresetOption[] = THEME_PRESET_OPTIONS
const CUSTOM_THEME_ACTIVE_VALUE = "__custom_theme_active__"

const THEME_SOURCE_KIND_LABEL_KEYS: Record<ThemePresetOption["source"]["kind"], string> = {
  internal: "settings:themeSource.kindInternal",
  "one-page-love": "settings:themeSource.kindOnePageLove",
  awwwards: "settings:themeSource.kindAwwwards",
  "public-site": "settings:themeSource.kindPublicSite",
  "open-source": "settings:themeSource.kindOpenSource",
}

type ColorMode = "system" | "light" | "dark"
type SettingsSection = "appearance" | "background" | "runtime" | "data"

const COLOR_MODES: { key: ColorMode; labelKey: string; descKey: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "system", labelKey: "settings:colorMode.system", descKey: "settings:colorMode.systemDesc", icon: Monitor },
  { key: "light",  labelKey: "settings:colorMode.light",  descKey: "settings:colorMode.lightDesc",  icon: Sun },
  { key: "dark",   labelKey: "settings:colorMode.dark",   descKey: "settings:colorMode.darkDesc",   icon: Moon },
]

function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
      <span className="text-[10px] font-mono tracking-widest text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-xs font-mono text-foreground" title={value}>{value}</span>
    </div>
  )
}

function SettingsTabs({ value, onChange }: { value: SettingsSection; onChange: (value: SettingsSection) => void }) {
  const { t } = useTranslation()
  const tabs: { key: SettingsSection; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { key: "appearance", label: t("settings:sections.appearance"), icon: Palette },
    { key: "background", label: t("settings:sections.background"), icon: Image },
    { key: "runtime", label: t("settings:sections.runtime"), icon: Server },
    { key: "data", label: t("settings:sections.data"), icon: Database },
  ]

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as SettingsSection)
      }}
      variant="outline"
      size="sm"
      className="mt-3 grid w-full grid-cols-4 gap-1 rounded-md border border-border/50 bg-muted/20 p-1"
      spacing={1}
    >
      {tabs.map(({ key, label, icon: Icon }) => (
        <ToggleGroupItem
          key={key}
          value={key}
          className="h-8 min-w-0 gap-1.5 px-2 text-[11px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function DataSettingsPanel({
  className,
  runtimeInfo,
  backendStatusLabel,
}: {
  className?: string
  runtimeInfo: RuntimeConnectionInfo
  backendStatusLabel: string
}) {
  const { t } = useTranslation()
  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-sm border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-border/50 bg-muted/35">
            <HardDrive className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{t("settings:data.title")}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("settings:data.description")}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <RuntimeRow label={t("settings:data.backendEndpoint")} value={runtimeInfo.backendUrl ?? t("common:unknown")} />
          <RuntimeRow label={t("settings:data.backendStatus")} value={backendStatusLabel} />
          <RuntimeRow label={t("settings:data.token")} value={runtimeInfo.backendTokenConfigured ? t("settings:developerRuntime.configured") : t("settings:developerRuntime.notConfigured")} />
          <RuntimeRow label={t("settings:data.databasePath")} value={t("settings:data.databasePathManaged")} />
        </div>
      </div>

      <div className="rounded-sm border border-border/60 bg-muted/15 p-4">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground">{t("settings:data.nextTitle")}</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("settings:data.nextDescription")}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ThemeSettings() {
  const state = useWorkspaceShallowSelector((workspace) => ({
    theme: workspace.theme,
    customThemes: workspace.customThemes,
    activeCustomThemeName: workspace.activeCustomThemeName,
    fontPreset: workspace.fontPreset,
    vignetteDepth: workspace.vignetteDepth,
    grainIntensity: workspace.grainIntensity,
    actionGlow: workspace.actionGlow,
    cardElevation: workspace.cardElevation,
    bgMode: workspace.bgMode,
    bgImageUrl: workspace.bgImageUrl,
    bgOpacity: workspace.bgOpacity,
    bgBlur: workspace.bgBlur,
    bgCoverTopBar: workspace.bgCoverTopBar,
    grainEnabled: workspace.grainEnabled,
    chromeVisible: workspace.chromeVisible,
    chromePosition: workspace.chromePosition,
    chromeStyle: workspace.chromeStyle,
    chromeIslandScale: workspace.chromeIslandScale,
    chromeIslandMotion: workspace.chromeIslandMotion,
    chromeIslandDelay: workspace.chromeIslandDelay,
    chromeIslandIdleOffset: workspace.chromeIslandIdleOffset,
  }))
  const workspaceActions = useWorkspaceActions()
  const { theme: colorMode, setTheme: setColorMode } = useTheme()
  const { t } = useTranslation()
  const currentLang = getCurrentLanguage()
  const runtimeInfo = getRuntimeConnectionInfo()
  const backendStatus = useLocalBackendStatus()
  const [copiedCommand, setCopiedCommand] = useState<"attach" | "start" | null>(null)
  const [backendRestarting, setBackendRestarting] = useState(false)
  const [backendRestartResult, setBackendRestartResult] = useState<LocalBackendControlRestartResult | null>(null)
  const [section, setSection] = useState<SettingsSection>("appearance")
  const [themeJson, setThemeJson] = useState("")
  const [themeImportError, setThemeImportError] = useState<string | null>(null)

  const active = THEMES.find(th => th.key === state.theme) ?? THEMES[0]
  const ActiveThemeIcon = THEME_ICONS[active.key]
  const activeCustomTheme = getActiveCustomTheme(state.customThemes, state.activeCustomThemeName)
  const activeCustomThemeSwatches = useMemo(() => {
    if (!activeCustomTheme) return []
    const colors = activeCustomTheme.cssVars.light
    return [
      colors.background,
      colors.primary,
      colors.secondary,
      colors.accent,
    ].filter(Boolean)
  }, [activeCustomTheme])
  const activeThemePalette = activeCustomTheme
    ? [
      activeCustomTheme.cssVars.light.background,
      activeCustomTheme.cssVars.light.primary,
      activeCustomTheme.cssVars.light.border,
      activeCustomTheme.cssVars.light.foreground,
    ].filter(Boolean)
    : active.palette
  const activeThemePaletteLabels = activeCustomTheme
    ? ["background", "primary", "border", "foreground"]
    : active.paletteLabelKeys.map((key) => t(key))
  const backendStatusKind = backendStatus.data?.status ?? (backendStatus.isFetching ? "checking" : "unknown")
  const backendStatusLabel = backendStatusKind === "ready"
    ? t("settings:developerRuntime.statusReady")
    : backendStatusKind === "missing-config"
      ? t("settings:developerRuntime.statusMissingConfig")
      : backendStatusKind === "unreachable"
        ? t("settings:developerRuntime.statusUnreachable")
        : backendStatusKind === "checking"
          ? t("settings:developerRuntime.statusChecking")
          : t("common:unknown")

  // 切换主题预设时，自动同步颜色模式（用户后续可在 Color Mode 区单独覆盖）
  function selectPreset(key: AppTheme) {
    workspaceActions.setTheme(key)
    setColorMode(THEME_PRESET_DEFAULT_MODE[key])
  }

  function importThemeJson() {
    try {
      const imported = parseImportedThemeJson(themeJson)
      workspaceActions.setCustomThemes(imported)
      workspaceActions.setActiveCustomThemeName(imported[0]?.name ?? null)
      setThemeJson("")
      setThemeImportError(null)
    } catch (error) {
      setThemeImportError(error instanceof Error ? error.message : t("settings:themeImport.invalidJson", "Invalid theme JSON."))
    }
  }

  function clearImportedTheme() {
    workspaceActions.setCustomThemes([])
    workspaceActions.setActiveCustomThemeName(null)
    setThemeImportError(null)
  }

  async function copyDevCommand(kind: "attach" | "start") {
    const command = kind === "attach" ? runtimeInfo.devAttachCommand : runtimeInfo.devStartCommand
    await navigator.clipboard.writeText(command)
    setCopiedCommand(kind)
    window.setTimeout(() => setCopiedCommand(null), 1200)
  }

  function openFrontendDevUrl() {
    if (!runtimeInfo.frontendDevUrl) return
    window.open(runtimeInfo.frontendDevUrl, "_blank", "noopener,noreferrer")
  }

  function openExternalUrl(url?: string) {
    if (!url) return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  async function restartBackendFromSettings() {
    setBackendRestarting(true)
    setBackendRestartResult(null)
    try {
      const result = await restartLocalBackend()
      setBackendRestartResult(result)
      await backendStatus.refetch()
    } catch (error) {
      setBackendRestartResult({
        restarted: false,
        supported: false,
        source: "none",
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBackendRestarting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{t("settings:title")}</h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("settings:headerSubtitle")}</p>
          </div>
        </div>
        <SettingsTabs value={section} onChange={setSection} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <motion.div
          layout
          className="grid grid-cols-1 gap-4 p-4"
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Left column */}
          <div className={cn("space-y-4", section !== "appearance" && "hidden")}>
            {/* Active Preset Card */}
            <div className="bg-card border border-border rounded-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <Badge variant="outline" className="font-mono text-[9px] text-primary border-primary/40">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full mr-1.5 inline-block" />
                  {t("settings:activeTheme", "ACTIVE THEME")}
                </Badge>
                {activeCustomTheme ? <Palette className="h-4 w-4 text-muted-foreground" /> : <ActiveThemeIcon className="h-4 w-4 text-muted-foreground" />}
              </div>
              <h2 className="mb-2 truncate text-2xl font-semibold text-foreground">{activeCustomTheme?.name ?? t(active.labelKey)}</h2>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                {activeCustomTheme?.description ?? t(active.descriptionKey)}
              </p>

              {!activeCustomTheme && (
                <div className="mb-4 rounded-sm border border-border/45 bg-muted/15 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-sm font-mono text-[9px] uppercase tracking-wider">
                      {t(THEME_SOURCE_KIND_LABEL_KEYS[active.source.kind])}
                    </Badge>
                    <Badge variant="outline" className="rounded-sm font-mono text-[9px] text-muted-foreground">
                      {t("settings:themeSource.evidenceCount", { count: active.source.evidence.length })}
                    </Badge>
                    <div className="ml-auto flex items-center gap-1.5">
                      {(active.source.originalUrl ?? active.source.url) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 rounded-sm px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                          onClick={() => openExternalUrl(active.source.originalUrl ?? active.source.url)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("settings:themeSource.source")}
                        </Button>
                      )}
                      {active.source.repositoryUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 rounded-sm px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                          onClick={() => openExternalUrl(active.source.repositoryUrl)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("settings:themeSource.repo")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] font-mono text-muted-foreground tracking-widest mb-2">{t("settings:texture.basePalette")}</p>
              <div className="flex rounded-sm overflow-hidden border border-border/40">
                {activeThemePalette.map((color, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 pb-2 pt-3" style={{ background: color }}>
                    <div className="w-full h-8" />
                    <span className="text-[9px] font-mono" style={{ color: i < 2 ? "oklch(0.7 0 0)" : "oklch(0.2 0 0)" }}>
                      {activeThemePaletteLabels[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Theme selector */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:selectPreset")}</p>
                <Badge variant="outline" className="shrink-0 rounded-sm font-mono text-[9px] text-muted-foreground">
                  {THEMES.length}
                </Badge>
              </div>
              <Select
                value={activeCustomTheme ? CUSTOM_THEME_ACTIVE_VALUE : state.theme}
                onValueChange={(value) => {
                  if (value !== CUSTOM_THEME_ACTIVE_VALUE) selectPreset(value as AppTheme)
                }}
              >
                <SelectTrigger className="w-full bg-background/60 font-mono text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectGroup>
                    {activeCustomTheme && (
                      <SelectItem value={CUSTOM_THEME_ACTIVE_VALUE}>
                        <Palette className="text-primary" />
                        <span className="min-w-0 truncate">
                          {t("settings:themeImport.activeImported", "Imported theme active")}
                        </span>
                      </SelectItem>
                    )}
                    {THEMES.map((th) => {
                      const Icon = THEME_ICONS[th.key]
                      return (
                        <SelectItem key={th.key} value={th.key}>
                          <Icon className="text-muted-foreground" />
                          <span className="min-w-0 truncate">{t(th.labelKey)}</span>
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className="flex min-w-0 items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-primary/30 bg-primary/10 text-primary">
                  <ActiveThemeIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{t(active.labelKey)}</p>
                  <p className="truncate text-[10px] font-mono text-muted-foreground/70">{t(active.subtitleKey)}</p>
                </div>
                <div className="flex shrink-0 overflow-hidden rounded-sm border border-border/40">
                  {active.palette.slice(0, 4).map((color, index) => (
                    <span key={`${active.key}-${index}`} className="h-5 w-5" style={{ background: color }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Color Mode (system / light / dark) — 控制深浅色，独立于主题预设 */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:colorMode.label")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">{t("settings:colorMode.description")}</p>
              <ToggleGroup
                type="single"
                value={colorMode}
                onValueChange={(value) => {
                  if (value) setColorMode(value as ColorMode)
                }}
                variant="outline"
                size="sm"
                className="grid w-full grid-cols-3 gap-2"
                spacing={2}
              >
                {COLOR_MODES.map(m => {
                  const Icon = m.icon
                  return (
                    <ToggleGroupItem
                      key={m.key}
                      value={m.key}
                      className="h-16 min-w-0 flex-col gap-1.5 px-2 text-muted-foreground data-[state=on]:border-primary/50 data-[state=on]:bg-primary/8 data-[state=on]:text-foreground"
                    >
                      <Icon className="size-4 data-[state=on]:text-primary" />
                      <span className="truncate text-[11px] font-medium">{t(m.labelKey)}</span>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </div>

            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-mono text-muted-foreground tracking-widest">
                      {t("settings:themeImport.label", "IMPORT JSON")}
                    </p>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t("settings:themeImport.description", "Import a tweakcn/aestivus theme object or a theme.json array, then switch between imported themes from a compact library.")}
                  </p>
                </div>
                {activeCustomTheme && (
                  <Badge variant="outline" className="max-w-[11rem] truncate font-mono text-[9px]" title={activeCustomTheme.name}>
                    {activeCustomTheme.name}
                  </Badge>
                )}
              </div>

              <Textarea
                value={themeJson}
                onChange={(event) => {
                  setThemeJson(event.target.value)
                  if (themeImportError) setThemeImportError(null)
                }}
                spellCheck={false}
                placeholder='[{"name":"perpetuity","cssVars":{"light":{"background":"oklch(1 0 0)","primary":"oklch(0.5 0.12 250)"},"dark":{"background":"oklch(0.2 0 0)"}}}]'
                className="min-h-28 resize-y font-mono text-[11px] leading-relaxed"
                aria-invalid={Boolean(themeImportError)}
              />

              {themeImportError && (
                <p className="rounded-sm border border-destructive/25 bg-destructive/8 px-3 py-2 text-[11px] leading-relaxed text-destructive">
                  {themeImportError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={!themeJson.trim()}
                  onClick={importThemeJson}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t("settings:themeImport.import", "Import JSON")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={state.customThemes.length === 0}
                  onClick={clearImportedTheme}
                >
                  <X className="h-3.5 w-3.5" />
                  {t("settings:themeImport.clear", "Clear imported themes")}
                </Button>
              </div>

              {state.customThemes.length > 0 && (
                <div className="rounded-sm border border-border/50 bg-muted/15 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">
                        {activeCustomTheme?.name ?? t("settings:themeImport.noActive", "No imported theme active")}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {t("settings:themeImport.count", { count: state.customThemes.length, defaultValue: "{{count}} imported themes" })}
                      </p>
                    </div>
                    {activeCustomThemeSwatches.length > 0 && (
                      <div className="grid h-7 w-7 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-border/40">
                        {activeCustomThemeSwatches.slice(0, 4).map((color, index) => (
                          <span key={`${activeCustomTheme.name}-${index}`} style={{ background: color }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <Select
                    value={state.activeCustomThemeName ?? "none"}
                    onValueChange={(value) => workspaceActions.setActiveCustomThemeName(value === "none" ? null : value)}
                  >
                    <SelectTrigger className="w-full bg-background/60 font-mono text-xs" size="sm">
                      <SelectValue placeholder={t("settings:themeImport.selectTheme", "Select imported theme")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectGroup>
                        <SelectItem value="none">{t("settings:themeImport.disableImported", "Use preset only")}</SelectItem>
                        {state.customThemes.map((theme) => (
                          <SelectItem key={theme.name} value={theme.name}>{theme.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {activeCustomTheme && (
                    <p className="mt-2 truncate text-[10px] font-mono text-muted-foreground/70">
                      {activeCustomTheme.cssVars.light.primary ?? activeCustomTheme.cssVars.light.background ?? "custom cssVars"}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Type className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:font.label", "FONT")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                {t("settings:font.description", "Switch the global UI font while preserving monospace surfaces and aestivus-compatible font variables.")}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FONT_PRESETS.map((preset) => {
                  const isActive = state.fontPreset === preset.key
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => workspaceActions.setFontPreset(preset.key)}
                      className={cn(
                        "flex min-w-0 items-start gap-3 rounded-sm border p-3 text-left transition-all",
                        isActive
                          ? "border-primary/50 bg-primary/8"
                          : "border-border/40 hover:border-border hover:bg-muted/30",
                      )}
                    >
                      <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-sm border", isActive ? "border-primary/40 bg-primary/15" : "border-border/40 bg-muted/40")}>
                        <Type className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{preset.label}</p>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/75">{preset.description}</p>
                        <p className="mt-2 truncate text-[10px] font-mono text-muted-foreground/60">Aa / 0123</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Language — 界面语言切换 */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:language.label")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">{t("settings:language.description")}</p>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map(l => {
                  const isActive = currentLang === l.key
                  return (
                    <button
                      key={l.key}
                      onClick={() => changeLanguage(l.key as Language)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-3 rounded-sm border transition-all",
                        isActive
                          ? "border-primary/50 bg-primary/8"
                          : "border-border/40 hover:border-border hover:bg-muted/30"
                      )}
                    >
                      <span className={cn("text-sm font-medium", isActive ? "text-primary" : "text-foreground")}>
                        {l.nativeLabel}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">{l.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/70">{t("settings:language.restartHint")}</p>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className={cn("bg-card border border-border rounded-sm p-4 space-y-4", section !== "runtime" && "hidden")}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-sm border border-border/50 bg-muted/35">
                    <Code2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-foreground">{t("settings:developerRuntime.title")}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("settings:developerRuntime.description")}</p>
                  </div>
                </div>
                <Badge variant={runtimeInfo.frontendSource === "vite-dev" ? "default" : "outline"} className="font-mono text-[9px]">
                  {t(`settings:developerRuntime.frontendSource.${runtimeInfo.frontendSource}`)}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <RuntimeRow label={t("settings:developerRuntime.hostRuntime")} value={runtimeInfo.hostRuntime} />
                <RuntimeRow label={t("settings:developerRuntime.frontend")} value={runtimeInfo.frontendDevUrl ?? runtimeInfo.frontendOrigin} />
                <RuntimeRow label={t("settings:developerRuntime.backend")} value={runtimeInfo.backendUrl ?? t("common:unknown")} />
                <RuntimeRow label={t("settings:developerRuntime.token")} value={runtimeInfo.backendTokenConfigured ? t("settings:developerRuntime.configured") : t("settings:developerRuntime.notConfigured")} />
                <RuntimeRow label={t("settings:developerRuntime.status")} value={backendStatusLabel} />
              </div>

              {backendStatus.data?.error && backendStatus.data.status !== "ready" && (
                <div className="rounded-sm border border-destructive/25 bg-destructive/8 px-3 py-2 text-[11px] leading-relaxed text-destructive">
                  {backendStatus.data.error}
                </div>
              )}

              {backendRestartResult && (
                <div className={cn(
                  "rounded-sm border px-3 py-2 text-[11px] leading-relaxed",
                  backendRestartResult.restarted
                    ? "border-primary/25 bg-primary/8 text-foreground"
                    : "border-muted-foreground/25 bg-muted/20 text-muted-foreground",
                )}>
                  {backendRestartResult.message}
                </div>
              )}

              <div className="flex items-start gap-2 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
                <Server className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("settings:developerRuntime.hotSwitchHint")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => window.location.reload()}>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t("settings:developerRuntime.reload")}
                </Button>
                <Button variant="outline" size="sm" className="font-mono text-xs" disabled={backendStatus.isFetching} onClick={() => backendStatus.refetch()}>
                  <Server className="h-3.5 w-3.5" />
                  {backendStatus.isFetching ? t("settings:developerRuntime.statusChecking") : t("settings:developerRuntime.refreshStatus")}
                </Button>
                <Button variant="outline" size="sm" className="font-mono text-xs" disabled={backendRestarting} onClick={restartBackendFromSettings}>
                  <RefreshCcw className={cn("h-3.5 w-3.5", backendRestarting && "animate-spin")} />
                  {backendRestarting ? t("settings:developerRuntime.restartingBackend") : t("settings:developerRuntime.restartBackend")}
                </Button>
                <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => copyDevCommand("attach")}>
                  <Copy className="h-3.5 w-3.5" />
                  {copiedCommand === "attach" ? t("settings:developerRuntime.copied") : t("settings:developerRuntime.copyAttach")}
                </Button>
                <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => copyDevCommand("start")}>
                  <Terminal className="h-3.5 w-3.5" />
                  {copiedCommand === "start" ? t("settings:developerRuntime.copied") : t("settings:developerRuntime.copyStart")}
                </Button>
                <Button variant="outline" size="sm" className="font-mono text-xs" disabled={!runtimeInfo.frontendDevUrl} onClick={openFrontendDevUrl}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("settings:developerRuntime.openFrontend")}
                </Button>
              </div>
            </div>

            {/* Atmospheric Effects */}
            <div className={cn("bg-card border border-border rounded-sm p-4", section !== "appearance" && "hidden")}>
              <h3 className="text-lg font-semibold text-foreground mb-4">{t("settings:atmospheric.title")}</h3>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground">{t("settings:atmospheric.vignette")}</span>
                    <span className="text-sm font-mono text-muted-foreground">{state.vignetteDepth}%</span>
                  </div>
                  <Slider
                    value={[state.vignetteDepth]}
                    onValueChange={([v]) => workspaceActions.setVignette(v)}
                    min={0} max={100} step={1}
                    className="mb-1"
                  />
                  <p className="text-[11px] text-muted-foreground">{t("settings:atmospheric.vignetteDesc")}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground">{t("settings:atmospheric.grain")}</span>
                    <span className="text-sm font-mono text-muted-foreground">{state.grainIntensity}%</span>
                  </div>
                  <Slider
                    value={[state.grainIntensity]}
                    onValueChange={([v]) => workspaceActions.setGrainIntensity(v)}
                    min={0} max={100} step={1}
                  />
                </div>

                <Separator className="opacity-50" />

                <div>
                  <p className="text-[10px] font-mono text-muted-foreground tracking-widest mb-3">{t("settings:atmospheric.ambient")}</p>

                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-sm bg-muted/50 border border-border/40 flex items-center justify-center flex-shrink-0">
                        <div className="w-3.5 h-3.5 border border-current rounded-sm opacity-60" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{t("settings:atmospheric.actionGlow")}</p>
                        <p className="text-[11px] text-muted-foreground">{t("settings:atmospheric.actionGlowDesc")}</p>
                      </div>
                      <Switch
                        checked={state.actionGlow}
                        onCheckedChange={v => workspaceActions.setActionGlow(v)}
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-sm bg-muted/50 border border-border/40 flex items-center justify-center flex-shrink-0">
                        <div className="w-3.5 h-3.5 border-t-2 border-x border-b border-current rounded-sm opacity-60" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{t("settings:atmospheric.cardElevation")}</p>
                        <p className="text-[11px] text-muted-foreground">{t("settings:atmospheric.cardElevationDesc")}</p>
                      </div>
                      <Switch
                        checked={state.cardElevation}
                        onCheckedChange={v => workspaceActions.setCardElevation(v)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Operation Bar (chrome) settings card */}
            <div className={cn("bg-card border border-border rounded-sm p-4 space-y-4", section !== "appearance" && "hidden")}>
              <div className="flex items-start gap-2">
                <PanelRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-foreground">{t("settings:chrome.title")}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("settings:chrome.description")}</p>
                </div>
              </div>

              {/* Visibility toggle */}
              <div className="flex items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
                <ToggleLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{t("settings:chrome.visible")}</p>
                  <p className="text-[11px] text-muted-foreground">{t("settings:chrome.visibleDesc")}</p>
                </div>
                <Switch
                  checked={state.chromeVisible}
                  onCheckedChange={v => workspaceActions.setChromeVisible(v)}
                />
              </div>

              {/* Position — independent of style */}
              <div className={cn("space-y-2 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:chrome.position")}</p>
                <p className="text-[11px] text-muted-foreground -mt-1">{t("settings:chrome.positionDesc")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "left", label: t("settings:chrome.positionLeft"), icon: PanelRight },
                    { key: "island", label: t("settings:chrome.positionIsland"), icon: CircleDot },
                    { key: "right", label: t("settings:chrome.positionRight"), icon: PanelRight },
                  ] as const).map(({ key, label, icon: Icon }) => {
                    const isActive = state.chromePosition === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => workspaceActions.setChromePosition(key)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 p-2.5 rounded-sm border transition-all",
                          isActive
                            ? "border-primary/50 bg-primary/8 text-primary"
                            : "border-border/40 text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground",
                          key === "left" && "[&>svg]:scale-x-[-1]",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-[11px] font-medium">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Separator className="opacity-50" />

              {/* Style — independent of position */}
              <div className={cn("space-y-2 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:chrome.style")}</p>
                <p className="text-[11px] text-muted-foreground -mt-1">{t("settings:chrome.styleDesc")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "default", label: t("settings:chrome.styleDefault"), desc: t("settings:chrome.styleDefaultDesc"), icon: PanelRight },
                    { key: "traffic-light", label: t("settings:chrome.styleTrafficLight"), desc: t("settings:chrome.styleTrafficLightDesc"), icon: Circle },
                  ] as const).map(({ key, label, desc, icon: Icon }) => {
                    const isActive = state.chromeStyle === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => workspaceActions.setChromeStyle(key)}
                        className={cn(
                          "flex min-w-0 items-start gap-2.5 rounded-sm border p-3 text-left transition-all",
                          isActive
                            ? "border-primary/50 bg-primary/8"
                            : "border-border/40 hover:border-border hover:bg-muted/30",
                        )}
                      >
                        <div className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-sm border",
                          isActive ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 bg-muted/40 text-muted-foreground",
                        )}>
                          {key === "traffic-light" ? (
                            <span className="flex items-center gap-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500/80" />
                              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500/80" />
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                            </span>
                          ) : (
                            <Icon className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-xs font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{label}</p>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/75">{desc}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {state.chromePosition === "island" && (
                <>
                  <Separator className="opacity-50" />

                  <div className={cn("space-y-4 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
                    <div>
                      <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:chrome.islandCustom")}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{t("settings:chrome.islandCustomDesc")}</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground font-mono">{t("settings:chrome.islandScale")}</span>
                        <span className="text-xs font-mono text-muted-foreground">{state.chromeIslandScale}%</span>
                      </div>
                      <Slider
                        value={[state.chromeIslandScale]}
                        onValueChange={([v]) => workspaceActions.setChromeIslandScale(v)}
                        min={70}
                        max={120}
                        step={1}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground font-mono">{t("settings:chrome.islandMotion")}</span>
                        <span className="text-xs font-mono text-muted-foreground">{state.chromeIslandMotion}%</span>
                      </div>
                      <Slider
                        value={[state.chromeIslandMotion]}
                        onValueChange={([v]) => workspaceActions.setChromeIslandMotion(v)}
                        min={70}
                        max={150}
                        step={1}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground font-mono">{t("settings:chrome.islandDelay")}</span>
                        <span className="text-xs font-mono text-muted-foreground">{state.chromeIslandDelay}ms</span>
                      </div>
                      <Slider
                        value={[state.chromeIslandDelay]}
                        onValueChange={([v]) => workspaceActions.setChromeIslandDelay(v)}
                        min={0}
                        max={120}
                        step={5}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground font-mono">{t("settings:chrome.islandIdleOffset")}</span>
                        <span className="text-xs font-mono text-muted-foreground">{state.chromeIslandIdleOffset}px</span>
                      </div>
                      <Slider
                        value={[state.chromeIslandIdleOffset]}
                        onValueChange={([v]) => workspaceActions.setChromeIslandIdleOffset(v)}
                        min={-10}
                        max={4}
                        step={1}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Background settings card */}
            <div className={cn("bg-card border border-border rounded-sm p-4 space-y-4", section !== "background" && "hidden")}>
              <h3 className="text-lg font-semibold text-foreground">{t("settings:background.title")}</h3>

              {/* Background Mode Selector */}
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:background.mode")}</p>
                <ToggleGroup
                  type="single"
                  value={state.bgMode}
                  onValueChange={(value) => {
                    if (value) workspaceActions.setBgMode(value as any)
                  }}
                  variant="outline"
                  size="sm"
                  className="grid w-full grid-cols-4 gap-2"
                  spacing={2}
                >
                  {[
                    { key: "grid", label: t("settings:background.modes.grid"), icon: Grid },
                    { key: "dot-grid", label: t("settings:background.modes.dot-grid"), icon: CircleDot },
                    { key: "image", label: t("settings:background.modes.image"), icon: Image },
                    { key: "none", label: t("settings:background.modes.none"), icon: Palette },
                  ].map(({ key, label, icon: Icon }) => (
                    <ToggleGroupItem
                      key={key}
                      value={key}
                      className="h-16 min-w-0 flex-col gap-1.5 px-2 font-mono text-[10px] text-muted-foreground data-[state=on]:border-primary/50 data-[state=on]:bg-primary/8 data-[state=on]:text-primary"
                    >
                      <Icon className="size-4" />
                      <span className="text-center leading-tight">{label}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Image mode config */}
              {state.bgMode === "image" && (
                <div className="space-y-4 pt-2 border-t border-border/40">
                  {/* Upload row */}
                  <div className="space-y-2">
                    <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:background.uploadImage")}</p>
                    <div className="flex gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        id="bg-file-upload"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = (event) => {
                            const dataUrl = event.target?.result
                            if (typeof dataUrl === "string") workspaceActions.setBgImageUrl(dataUrl)
                          }
                          reader.readAsDataURL(file)
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="font-mono text-xs cursor-pointer"
                        onClick={() => document.getElementById("bg-file-upload")?.click()}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        {t("settings:background.chooseFile")}
                      </Button>
                      {state.bgImageUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="font-mono text-xs cursor-pointer hover:text-destructive"
                          onClick={() => workspaceActions.setBgImageUrl("")}
                        >
                          <X className="h-3.5 w-3.5 mr-1.5" />
                          {t("common:clear")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Image URL input */}
                  <div className="space-y-2">
                    <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:background.imageUrl")}</p>
                    <input
                      type="text"
                      value={state.bgImageUrl}
                      onChange={(e) => workspaceActions.setBgImageUrl(e.target.value)}
                      placeholder="https://example.com/bg.jpg"
                      className="w-full px-3 py-1.5 text-xs font-mono rounded border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                    />
                  </div>

                  {/* Opacity slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground font-mono">{t("settings:background.opacity")}</span>
                      <span className="text-xs font-mono text-muted-foreground">{state.bgOpacity}%</span>
                    </div>
                    <Slider
                      value={[state.bgOpacity]}
                      onValueChange={([v]) => workspaceActions.setBgOpacity(v)}
                      min={0} max={100} step={5}
                    />
                  </div>

                  {/* Blur slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground font-mono">{t("settings:background.blur")}</span>
                      <span className="text-xs font-mono text-muted-foreground">{state.bgBlur}px</span>
                    </div>
                    <Slider
                      value={[state.bgBlur]}
                      onValueChange={([v]) => workspaceActions.setBgBlur(v)}
                      min={0} max={30} step={1}
                    />
                  </div>

                  {/* Cover topbar toggle */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs text-foreground font-mono">{t("settings:background.coverTopBar")}</p>
                        <p className="text-[10px] text-muted-foreground">{t("settings:background.coverTopBarHint")}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 rounded-sm border border-border/50 bg-muted/20 p-0.5">
                        <button
                          type="button"
                          onClick={() => workspaceActions.setBgCoverTopBar(false)}
                          className={cn(
                            "px-3 py-1 text-[10px] font-mono rounded-sm transition-colors cursor-pointer",
                            !state.bgCoverTopBar ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >OFF</button>
                        <button
                          type="button"
                          onClick={() => workspaceActions.setBgCoverTopBar(true)}
                          className={cn(
                            "px-3 py-1 text-[10px] font-mono rounded-sm transition-colors cursor-pointer",
                            state.bgCoverTopBar ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >ON</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Texture canvas preview */}
            <div className={cn("bg-card border border-border rounded-sm p-4", section !== "background" && "hidden")}>
              <h3 className="text-lg font-semibold text-foreground mb-4">{t("settings:texture.title")}</h3>
              <div className="ws-canvas-bg rounded border border-border/40 h-28 flex items-center justify-center">
                <div className="bg-card border border-border rounded-sm p-3">
                  <div className="grid grid-cols-3 gap-1">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="w-3 h-3 bg-primary/20 rounded-sm" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest">{t("settings:atmospheric.silkFinish")}</span>
                <Badge variant={state.grainEnabled ? "default" : "outline"} className="text-[9px] font-mono cursor-pointer" onClick={() => workspaceActions.setGrain(!state.grainEnabled)}>
                  {t(state.grainEnabled ? "settings:atmospheric.enabled" : "settings:atmospheric.disabled")}
                </Badge>
              </div>
            </div>
          </div>

          <DataSettingsPanel
            className={section !== "data" ? "hidden" : undefined}
            runtimeInfo={runtimeInfo}
            backendStatusLabel={backendStatusLabel}
          />
        </motion.div>

        <div className={cn("px-4 pb-4 flex items-center justify-end gap-3", section !== "appearance" && "hidden")}>
          <Button variant="outline" className="font-mono text-xs">{t("settings:texture.resetDefaults")}</Button>
          <Button className="font-mono text-xs btn-primary-glow">{t("settings:texture.applyChanges")}</Button>
        </div>
      </div>
    </div>
  )
}
