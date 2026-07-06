import { useState } from "react"
import { getBackend } from "@/backend/client"
import { cn } from "@/lib/utils"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { useTheme } from "@/components/theme-provider"
import type { ViewMode, CardLayout, AppTheme } from "@/types/workspace"
import {
  Bell, Settings, Search, Grid, SplitSquareVertical, AlignJustify, Target,
  LayoutDashboard, Workflow, Share2, Plus, ChevronDown, Check,
  Sun, Moon, Monitor, Palette, Minus, Square, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"

/** 泳道模式图标 — 与 Lane 内部用同一个 SVG，画泳道外框 + lane 矩形。 */
function LaneModeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 15 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.75 0.75H2.75C1.64543 0.75 0.75 1.64543 0.75 2.75V6.75C0.75 7.85457 1.64543 8.75 2.75 8.75H11.75C12.8546 8.75 13.75 7.85457 13.75 6.75V2.75C13.75 1.64543 12.8546 0.75 11.75 0.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="0.75" y="0.75" width="5" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: "cards",    label: "CARDS",    icon: LayoutDashboard, hint: "卡片布局" },
  { key: "dockview", label: "DOCKVIEW", icon: Share2,         hint: "Dockview 面板" },
  { key: "flow",     label: "FLOW",     icon: Workflow,       hint: "React Flow 节点" },
  { key: "lane",     label: "LANE",     icon: LaneModeIcon,   hint: "泳道模式" },
]

const CARD_LAYOUT_OPTIONS: { key: CardLayout; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: "grid",  label: "GRID",  icon: Grid,                 hint: "auto tile" },
  { key: "stack", label: "STACK", icon: AlignJustify,         hint: "cascade" },
  { key: "split", label: "SPLIT", icon: SplitSquareVertical, hint: "two columns" },
  { key: "focus", label: "FOCUS", icon: Target,              hint: "hero + strip" },
]

// 主题预设与颜色模式默认值同步
const PRESET_DEFAULT_MODE: Record<AppTheme, "light" | "dark"> = {
  spatial: "light",
  endfield: "dark",
  wuling: "dark",
}

const THEME_PRESETS: { key: AppTheme; label: string; swatch: string }[] = [
  { key: "spatial",  label: "Spatial",  swatch: "oklch(0.40 0.12 148)" },
  { key: "endfield", label: "Endfield", swatch: "oklch(0.62 0.18 152)" },
  { key: "wuling",   label: "Wuling",   swatch: "oklch(0.70 0.16 68)" },
]

type ColorMode = "system" | "light" | "dark"
const COLOR_MODES: { key: ColorMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "system", label: "System", icon: Monitor },
  { key: "light",  label: "Light",  icon: Sun },
  { key: "dark",   label: "Dark",   icon: Moon },
]

export function TopBar() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()
  const { theme: colorMode, setTheme: setColorMode } = useTheme()
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)

  // 切换预设时自动同步颜色模式
  function selectPreset(key: AppTheme) {
    dispatch(actions.setTheme(key))
    setColorMode(PRESET_DEFAULT_MODE[key])
  }

  async function controlMainWindow(action: "minimize" | "maximize" | "close") {
    const backend = await getBackend()
    const result = await backend.windows.controlMain(action)
    if (!result.success) console.info(`[window] ${result.message}`)
  }

  return (
    <header className="h-12 border-b border-border bg-background flex items-center px-4 gap-4 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-mono text-sm font-bold text-primary tracking-tight">XIRANITE</span>
        <span className="font-mono text-[9px] text-muted-foreground/60 hidden sm:inline">v0.5.0</span>
      </div>

      {/* ── ViewMode 切换：cards / dockview / flow 三种主形态 ── */}
      <div className="flex items-center gap-1 border-l border-border/60 pl-3">
        {VIEW_OPTIONS.map(({ key, label, icon: Icon, hint }) => (
          <button
            key={key}
            onClick={() => dispatch(actions.setViewMode(key))}
            title={hint}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-sm transition-colors border",
              state.viewMode === key
                ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Cards 子布局：仅 viewMode === "cards" 时显示 ── */}
      {state.viewMode === "cards" && (
        <div className="flex items-center gap-1 border-l border-border/60 pl-3">
          {CARD_LAYOUT_OPTIONS.map(({ key, label, icon: Icon, hint }) => (
            <button
              key={key}
              onClick={() => dispatch(actions.setCardLayout(key))}
              title={hint}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono rounded-sm transition-colors border",
                state.cardLayout === key
                  ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Workspace 选择器（顶栏中部） ── */}
      <div className="relative">
        <button
          onClick={() => setWsMenuOpen(o => !o)}
          className="flex items-center gap-2 px-3 h-8 rounded border border-border/60 bg-muted/30 hover:bg-muted/60 text-xs font-mono min-w-[180px]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="flex-1 text-left truncate">
            {state.workspaces.find(w => w.id === state.activeWorkspaceId)?.label ?? "—"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {wsMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setWsMenuOpen(false)} />
            <div className="absolute left-0 top-full mt-1 w-72 rounded-md border border-border bg-card shadow-lg z-40 overflow-hidden">
              <div className="py-1 max-h-80 overflow-auto">
                {state.workspaces.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      dispatch(actions.setActiveWorkspace(ws.id))
                      setWsMenuOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 w-full text-left text-xs font-mono hover:bg-muted/60 transition-colors",
                      ws.id === state.activeWorkspaceId && "bg-primary/5 text-primary"
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", ws.id === state.activeWorkspaceId ? "bg-primary" : "bg-muted-foreground/40")} />
                    <span className="flex-1 truncate">{ws.label}</span>
                    {ws.id === state.activeWorkspaceId && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-border/60 p-1">
                <button
                  onClick={() => { dispatch(actions.addWorkspace()); setWsMenuOpen(false) }}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left text-xs font-mono text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  NEW WORKSPACE
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search (装饰) */}
      <button className="hidden md:flex items-center gap-2 px-3 h-8 rounded border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border transition-colors text-xs font-mono w-48">
        <Search className="h-3.5 w-3.5" />
        <span>SEARCH...</span>
        <kbd className="ml-auto text-[9px] bg-muted px-1 rounded">⌘K</kbd>
      </button>

      {/* ── 弹出层入口（取代侧栏）── */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs font-mono text-muted-foreground hover:text-foreground"
          onClick={() => dispatch(actions.setOverlay("registry"))}
          title="Module Registry"
        >
          <Plus className="h-3.5 w-3.5" />
          REGISTRY
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => dispatch(actions.setOverlay("deployment"))}
          title="Deployment Hub"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-destructive rounded-full" />
        </Button>

        {/* ── 主题快速切换下拉 ── */}
        <div className="relative">
          <button
            onClick={() => setThemeMenuOpen(o => !o)}
            title="Theme"
            className="flex items-center gap-1.5 h-8 px-2 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border/60"
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden sm:inline uppercase tracking-widest text-[10px]">
              {THEME_PRESETS.find(t => t.key === state.theme)?.label ?? "Theme"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {themeMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-card shadow-lg z-40 overflow-hidden">
                {/* 主题预设 */}
                <div className="p-2">
                  <p className="px-2 py-1 text-[9px] font-mono text-muted-foreground tracking-widest">THEME PRESET</p>
                  {THEME_PRESETS.map(t => {
                    const isActive = t.key === state.theme
                    return (
                      <button
                        key={t.key}
                        onClick={() => selectPreset(t.key)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-xs transition-colors",
                          isActive ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground"
                        )}
                      >
                        <span
                          className="w-3 h-3 rounded-sm border border-border/60 flex-shrink-0"
                          style={{ background: t.swatch }}
                        />
                        <span className="flex-1">{t.label}</span>
                        {isActive && <Check className="h-3 w-3" />}
                      </button>
                    )
                  })}
                </div>

                {/* 颜色模式 */}
                <div className="border-t border-border/60 p-2">
                  <p className="px-2 py-1 text-[9px] font-mono text-muted-foreground tracking-widest">COLOR MODE</p>
                  <div className="grid grid-cols-3 gap-1">
                    {COLOR_MODES.map(m => {
                      const Icon = m.icon
                      const isActive = colorMode === m.key
                      return (
                        <button
                          key={m.key}
                          onClick={() => setColorMode(m.key)}
                          className={cn(
                            "flex flex-col items-center gap-1 py-2 rounded-sm border transition-all",
                            isActive
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border/40 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-mono">{m.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 完整设置入口 */}
                <div className="border-t border-border/60 p-1">
                  <button
                    onClick={() => {
                      setThemeMenuOpen(false)
                      dispatch(actions.setOverlay("settings"))
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-left text-xs font-mono text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    OPEN THEME SETTINGS
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 border-l border-border/60 pl-2">
        <button
          title="Minimize"
          aria-label="Minimize"
          onClick={() => controlMainWindow("minimize")}
          className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          title="Maximize"
          aria-label="Maximize"
          onClick={() => controlMainWindow("maximize")}
          className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          title="Close"
          aria-label="Close"
          onClick={() => controlMainWindow("close")}
          className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Avatar */}
      <div className="w-8 h-8 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all">
        <img
          src="/images/AP1WRLvshv4nlPBl6aRZZfGYMND5CAh8yAZ95K2KcoQYLTSWy9D-sEfixRCznEuUs1CsS5dVNaqd5MrTkq8di-8jybVA6_4ZunFzhfUcoV7MQ8I8FNLH1S_RjOVDJVxisq5upAYoR3lSTX84aPRdTVz3zS5DqUrlV-u9vp6EXQmxTvz473TultUc7_YuXmwSE0X6hZmd2YkeXGuA_G7T3sj36ol0dskhLJfG4eM6mizz9nVc124Zmc4TLz_JyjU=s2560"
          alt="operator"
          className="w-full h-full object-cover"
        />
      </div>
    </header>
  )
}
