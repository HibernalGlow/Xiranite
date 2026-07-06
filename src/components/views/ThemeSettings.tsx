import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { useTheme } from "@/components/theme-provider"
import type { AppTheme } from "@/types/workspace"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Terminal, Paintbrush, Sun, Moon, Monitor, Palette, Languages, Grid, CircleDot, Image, Upload, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { changeLanguage, getCurrentLanguage, type Language, LANGUAGES } from "@/i18n"

interface ThemeOption {
  key: AppTheme
  labelKey: string
  subtitleKey: string
  descriptionKey: string
  palette: string[]
  paletteLabelKeys: string[]
  icon: React.ComponentType<{ className?: string }>
}

const THEMES: ThemeOption[] = [
  {
    key: "spatial",
    labelKey: "settings:themes.spatial.label",
    subtitleKey: "settings:themes.spatial.subtitle",
    descriptionKey: "settings:themes.spatial.description",
    palette: ["oklch(0.97 0.005 148)", "oklch(0.40 0.12 148)", "oklch(0.88 0.02 148)", "oklch(0.12 0.01 148)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.bg", "settings:texture.paletteLabels.primary", "settings:texture.paletteLabels.border", "settings:texture.paletteLabels.text"],
    icon: Sun,
  },
  {
    key: "endfield",
    labelKey: "settings:themes.endfield.label",
    subtitleKey: "settings:themes.endfield.subtitle",
    descriptionKey: "settings:themes.endfield.description",
    palette: ["oklch(0.13 0.025 216)", "oklch(0.17 0.025 216)", "oklch(0.62 0.18 152)", "oklch(0.90 0.04 148)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.card", "settings:texture.paletteLabels.green", "settings:texture.paletteLabels.text"],
    icon: Terminal,
  },
  {
    key: "wuling",
    labelKey: "settings:themes.wuling.label",
    subtitleKey: "settings:themes.wuling.subtitle",
    descriptionKey: "settings:themes.wuling.description",
    palette: ["oklch(0.12 0.03 55)", "oklch(0.16 0.04 55)", "oklch(0.70 0.16 68)", "oklch(0.93 0.04 80)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.deep", "settings:texture.paletteLabels.surface", "settings:texture.paletteLabels.gold", "settings:texture.paletteLabels.text"],
    icon: Paintbrush,
  },
]

// 每个主题预设的默认颜色模式：spatial 是浅色，endfield/wuling 是深色。
// 切换预设时自动同步颜色模式；用户也可在 Color Mode 区域单独覆盖。
const PRESET_DEFAULT_MODE: Record<AppTheme, "light" | "dark"> = {
  spatial: "light",
  endfield: "dark",
  wuling: "dark",
}

type ColorMode = "system" | "light" | "dark"

const COLOR_MODES: { key: ColorMode; labelKey: string; descKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "system", labelKey: "settings:colorMode.system", descKey: "settings:colorMode.systemDesc", icon: Monitor },
  { key: "light",  labelKey: "settings:colorMode.light",  descKey: "settings:colorMode.lightDesc",  icon: Sun },
  { key: "dark",   labelKey: "settings:colorMode.dark",   descKey: "settings:colorMode.darkDesc",   icon: Moon },
]

export function ThemeSettings() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()
  const { theme: colorMode, setTheme: setColorMode } = useTheme()
  const { t } = useTranslation()
  const currentLang = getCurrentLanguage()

  const active = THEMES.find(th => th.key === state.theme) ?? THEMES[0]

  // 切换主题预设时，自动同步颜色模式（用户后续可在 Color Mode 区单独覆盖）
  function selectPreset(key: AppTheme) {
    dispatch(actions.setTheme(key))
    setColorMode(PRESET_DEFAULT_MODE[key])
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-border/60 flex-shrink-0">
        <h1 className="text-3xl font-mono font-black text-foreground tracking-tight">{t("settings:header")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("settings:headerSubtitle")}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column */}
          <div className="space-y-4">
            {/* Active Preset Card */}
            <div className="bg-card border border-border rounded-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <Badge variant="outline" className="font-mono text-[9px] text-primary border-primary/40">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full mr-1.5 inline-block" />
                  {t("settings:activePreset")}
                </Badge>
                <active.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">{t(active.labelKey)}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t(active.descriptionKey)}</p>

              <p className="text-[10px] font-mono text-muted-foreground tracking-widest mb-2">{t("settings:texture.basePalette")}</p>
              <div className="flex rounded-sm overflow-hidden border border-border/40">
                {active.palette.map((color, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 pb-2 pt-3" style={{ background: color }}>
                    <div className="w-full h-8" />
                    <span className="text-[9px] font-mono" style={{ color: i < 2 ? "oklch(0.7 0 0)" : "oklch(0.2 0 0)" }}>
                      {t(active.paletteLabelKeys[i])}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Theme selector */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-2">
              <p className="text-xs font-mono text-muted-foreground tracking-widest mb-3">{t("settings:selectPreset")}</p>
              {THEMES.map(th => {
                const Icon = th.icon
                const isActive = th.key === state.theme
                return (
                  <button
                    key={th.key}
                    onClick={() => selectPreset(th.key)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-sm border transition-all text-left",
                      isActive
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/40 hover:border-border hover:bg-muted/30"
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-sm border flex items-center justify-center", isActive ? "border-primary/40 bg-primary/15" : "border-border/40 bg-muted/40")}>
                      <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{t(th.labelKey)}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/70">{t(th.subtitleKey)}</p>
                    </div>
                    {isActive && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                )
              })}
            </div>

            {/* Color Mode (system / light / dark) — 控制深浅色，独立于主题预设 */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:colorMode.label")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">{t("settings:colorMode.description")}</p>
              <div className="grid grid-cols-3 gap-2">
                {COLOR_MODES.map(m => {
                  const Icon = m.icon
                  const isActive = colorMode === m.key
                  return (
                    <button
                      key={m.key}
                      onClick={() => setColorMode(m.key)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-sm border transition-all",
                        isActive
                          ? "border-primary/50 bg-primary/8"
                          : "border-border/40 hover:border-border hover:bg-muted/30"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-[11px] font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{t(m.labelKey)}</span>
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
            {/* Atmospheric Effects */}
            <div className="bg-card border border-border rounded-sm p-5">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t("settings:atmospheric.title")}</h3>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground">{t("settings:atmospheric.vignette")}</span>
                    <span className="text-sm font-mono text-muted-foreground">{state.vignetteDepth}%</span>
                  </div>
                  <Slider
                    value={[state.vignetteDepth]}
                    onValueChange={([v]) => dispatch(actions.setVignette(v))}
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
                    onValueChange={([v]) => dispatch(actions.setGrainIntensity(v))}
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
                        onCheckedChange={v => dispatch(actions.setActionGlow(v))}
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
                        onCheckedChange={v => dispatch(actions.setCardElevation(v))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Background settings card */}
            <div className="bg-card border border-border rounded-sm p-5 space-y-4">
              <h3 className="text-lg font-semibold text-foreground">{t("settings:background.title")}</h3>

              {/* Background Mode Selector */}
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground tracking-widest">{t("settings:background.mode")}</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: "grid", label: t("settings:background.modes.grid"), icon: Grid },
                    { key: "dot-grid", label: t("settings:background.modes.dot-grid"), icon: CircleDot },
                    { key: "image", label: t("settings:background.modes.image"), icon: Image },
                    { key: "none", label: t("settings:background.modes.none"), icon: Palette },
                  ].map(({ key, label, icon: Icon }) => {
                    const isActive = state.bgMode === key
                    return (
                      <button
                        key={key}
                        onClick={() => dispatch(actions.setBgMode(key as any))}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-3 rounded-sm border transition-all cursor-pointer",
                          isActive
                            ? "border-primary/50 bg-primary/8 text-primary"
                            : "border-border/40 hover:border-border hover:bg-muted/30 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-[10px] font-mono text-center leading-tight">{label}</span>
                      </button>
                    )
                  })}
                </div>
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
                            const dataUrl = event.target?.result as string
                            dispatch(actions.setBgImageUrl(dataUrl))
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
                          onClick={() => dispatch(actions.setBgImageUrl(""))}
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
                      onChange={(e) => dispatch(actions.setBgImageUrl(e.target.value))}
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
                      onValueChange={([v]) => dispatch(actions.setBgOpacity(v))}
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
                      onValueChange={([v]) => dispatch(actions.setBgBlur(v))}
                      min={0} max={30} step={1}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Texture canvas preview */}
            <div className="bg-card border border-border rounded-sm p-5">
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
                <Badge variant={state.grainEnabled ? "default" : "outline"} className="text-[9px] font-mono cursor-pointer" onClick={() => dispatch(actions.setGrain(!state.grainEnabled))}>
                  {t(state.grainEnabled ? "settings:atmospheric.enabled" : "settings:atmospheric.disabled")}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex items-center justify-end gap-3">
          <Button variant="outline" className="font-mono text-xs">{t("settings:texture.resetDefaults")}</Button>
          <Button className="font-mono text-xs btn-primary-glow">{t("settings:texture.applyChanges")}</Button>
        </div>
      </div>
    </div>
  )
}
