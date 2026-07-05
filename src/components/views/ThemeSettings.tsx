import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import type { AppTheme } from "@/types/workspace"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Terminal, Paintbrush, Sun } from "lucide-react"

interface ThemeOption {
  key: AppTheme
  label: string
  subtitle: string
  description: string
  palette: string[]
  paletteLabels: string[]
  icon: React.ComponentType<{ className?: string }>
}

const THEMES: ThemeOption[] = [
  {
    key: "spatial",
    label: "Spatial Studio",
    subtitle: "Active Preset",
    description: "A clean light interface with forest green accents. Precision-focused, minimal cognitive load.",
    palette: ["oklch(0.97 0.005 148)", "oklch(0.40 0.12 148)", "oklch(0.88 0.02 148)", "oklch(0.12 0.01 148)"],
    paletteLabels: ["BG", "Primary", "Border", "Text"],
    icon: Sun,
  },
  {
    key: "endfield",
    label: "Endfield Tactical",
    subtitle: "Dark Preset",
    description: "A HUD-like, data-dense technical interface. Features deep slate foundations with vibrant Endfield Green highlights for precise operational contrast.",
    palette: ["oklch(0.13 0.025 216)", "oklch(0.17 0.025 216)", "oklch(0.62 0.18 152)", "oklch(0.90 0.04 148)"],
    paletteLabels: ["Void", "Card", "Green", "Text"],
    icon: Terminal,
  },
  {
    key: "wuling",
    label: "武陵城 Wuling City",
    subtitle: "Arknights Endfield",
    description: "Warm amber foundations inspired by 明日方舟终末地 武陵城. Ancient city meeting cyberpunk — gold accents against deep ochre darkness.",
    palette: ["oklch(0.12 0.03 55)", "oklch(0.16 0.04 55)", "oklch(0.70 0.16 68)", "oklch(0.93 0.04 80)"],
    paletteLabels: ["Deep", "Surface", "Gold", "Text"],
    icon: Paintbrush,
  },
]

export function ThemeSettings() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()

  const active = THEMES.find(t => t.key === state.theme) ?? THEMES[0]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-border/60 flex-shrink-0">
        <h1 className="text-3xl font-mono font-black text-foreground tracking-tight">Theme &amp; Aesthetics</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure the visual identity and atmospheric depth of your workspace.</p>
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
                  ACTIVE PRESET
                </Badge>
                <active.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">{active.label}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{active.description}</p>

              <p className="text-[10px] font-mono text-muted-foreground tracking-widest mb-2">BASE PALETTE</p>
              <div className="flex rounded-sm overflow-hidden border border-border/40">
                {active.palette.map((color, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 pb-2 pt-3" style={{ background: color }}>
                    <div className="w-full h-8" />
                    <span className="text-[9px] font-mono" style={{ color: i < 2 ? "oklch(0.7 0 0)" : "oklch(0.2 0 0)" }}>
                      {active.paletteLabels[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Theme selector */}
            <div className="bg-card border border-border rounded-sm p-4 space-y-2">
              <p className="text-xs font-mono text-muted-foreground tracking-widest mb-3">SELECT THEME</p>
              {THEMES.map(t => {
                const Icon = t.icon
                const isActive = t.key === state.theme
                return (
                  <button
                    key={t.key}
                    onClick={() => dispatch(actions.setTheme(t.key))}
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
                      <p className={cn("text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{t.label}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/70">{t.subtitle}</p>
                    </div>
                    {isActive && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Atmospheric Effects */}
            <div className="bg-card border border-border rounded-sm p-5">
              <h3 className="text-lg font-semibold text-foreground mb-4">Atmospheric Effects</h3>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground">Vignette Depth</span>
                    <span className="text-sm font-mono text-muted-foreground">{state.vignetteDepth}%</span>
                  </div>
                  <Slider
                    value={[state.vignetteDepth]}
                    onValueChange={([v]) => dispatch(actions.setVignette(v))}
                    min={0} max={100} step={1}
                    className="mb-1"
                  />
                  <p className="text-[11px] text-muted-foreground">Controls the peripheral darkness of the workspace canvas.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground">Grain Texture Intensity</span>
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
                  <p className="text-[10px] font-mono text-muted-foreground tracking-widest mb-3">AMBIENT LIGHTING</p>

                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-sm bg-muted/50 border border-border/40 flex items-center justify-center flex-shrink-0">
                        <div className="w-3.5 h-3.5 border border-current rounded-sm opacity-60" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">Action Glow</p>
                        <p className="text-[11px] text-muted-foreground">Soft colored aura behind primary buttons</p>
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
                        <p className="text-sm font-medium text-foreground">Card Elevation Highlights</p>
                        <p className="text-[11px] text-muted-foreground">Subtle top-border shine on elevated surfaces</p>
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

            {/* Texture canvas preview */}
            <div className="bg-card border border-border rounded-sm p-5">
              <h3 className="text-lg font-semibold text-foreground mb-4">Texture Canvas</h3>
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
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest">SILK-FINISH NOISE</span>
                <Badge variant={state.grainEnabled ? "default" : "outline"} className="text-[9px] font-mono cursor-pointer" onClick={() => dispatch(actions.setGrain(!state.grainEnabled))}>
                  {state.grainEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex items-center justify-end gap-3">
          <Button variant="outline" className="font-mono text-xs">RESET DEFAULTS</Button>
          <Button className="font-mono text-xs btn-primary-glow">APPLY CHANGES</Button>
        </div>
      </div>
    </div>
  )
}
