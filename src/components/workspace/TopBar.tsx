import { useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { getRuntimeConnectionInfo } from "@/backend/runtimeConnectionInfo"
import { cn } from "@/lib/utils"
import { translateLabel } from "@/lib/i18nLabel"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceContext"
import { activeNodeOperationCount, useNodeOperations } from "@/store/nodeOperations"
import { useWindowControls } from "@/hooks/useWindowControls"
import { useTheme } from "@/components/theme-provider"
import type { ViewMode, CardLayout, AppTheme } from "@/types/workspace"
import { WorkspaceIcon, IconPicker } from "@/components/workspace/WorkspaceIcon"
import {
  Activity, Settings, Search, Grid, SplitSquareVertical, AlignJustify, Target,
  LayoutDashboard, Workflow, Share2, Plus, ChevronDown, Check,
  Sun, Moon, Monitor, Palette, Minus, Square, Minimize2, X,
  CircleDot, Image, Code2, LayoutTemplate, Trash2, Edit3, Smile,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const TITLEBAR_NO_DRAG_SELECTOR = [
  ".xiranite-app-region-no-drag",
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "[role='button']",
].join(",")

function isNoDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(TITLEBAR_NO_DRAG_SELECTOR)
}

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

const VIEW_OPTIONS: { key: ViewMode; labelKey: string; hintKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "cards",    labelKey: "topbar:viewMode.cards",    hintKey: "topbar:viewMode.cardsHint",    icon: LayoutDashboard },
  { key: "dockview", labelKey: "topbar:viewMode.dockview", hintKey: "topbar:viewMode.dockviewHint", icon: Share2 },
  { key: "flow",     labelKey: "topbar:viewMode.flow",     hintKey: "topbar:viewMode.flowHint",     icon: Workflow },
  { key: "lane",     labelKey: "topbar:viewMode.lane",     hintKey: "topbar:viewMode.laneHint",     icon: LaneModeIcon },
  { key: "bento",    labelKey: "topbar:viewMode.bento",    hintKey: "topbar:viewMode.bentoHint",    icon: LayoutTemplate },
]

const CARD_LAYOUT_OPTIONS: { key: CardLayout; labelKey: string; hintKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "grid",  labelKey: "topbar:cardLayout.grid",  hintKey: "topbar:cardLayout.gridHint",  icon: Grid },
  { key: "stack", labelKey: "topbar:cardLayout.stack", hintKey: "topbar:cardLayout.stackHint", icon: AlignJustify },
  { key: "split", labelKey: "topbar:cardLayout.split", hintKey: "topbar:cardLayout.splitHint", icon: SplitSquareVertical },
  { key: "focus", labelKey: "topbar:cardLayout.focus", hintKey: "topbar:cardLayout.focusHint", icon: Target },
]

// 主题预设与颜色模式默认值同步
const PRESET_DEFAULT_MODE: Record<AppTheme, "light" | "dark"> = {
  spatial: "light",
  endfield: "dark",
  wuling: "dark",
}

const THEME_PRESETS: { key: AppTheme; labelKey: string; swatch: string }[] = [
  { key: "spatial",  labelKey: "topbar:theme.spatial",  swatch: "oklch(0.40 0.12 148)" },
  { key: "endfield", labelKey: "topbar:theme.endfield", swatch: "oklch(0.62 0.18 152)" },
  { key: "wuling",   labelKey: "topbar:theme.wuling",   swatch: "oklch(0.70 0.16 68)" },
]

type ColorMode = "system" | "light" | "dark"
const COLOR_MODES: { key: ColorMode; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "system", labelKey: "topbar:theme.system", icon: Monitor },
  { key: "light",  labelKey: "topbar:theme.light",  icon: Sun },
  { key: "dark",   labelKey: "topbar:theme.dark",   icon: Moon },
]

export function TopBar() {
  const state = useWorkspaceShallowSelector((workspace) => ({
    viewMode: workspace.viewMode,
    cardLayout: workspace.cardLayout,
    workspaces: workspace.workspaces,
    activeWorkspaceId: workspace.activeWorkspaceId,
    theme: workspace.theme,
    bgMode: workspace.bgMode,
  }))
  const workspaceActions = useWorkspaceActions()
  const { t } = useTranslation()
  const { theme: colorMode, setTheme: setColorMode } = useTheme()
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [iconPickerWsId, setIconPickerWsId] = useState<string | null>(null)
  const runtimeInfo = getRuntimeConnectionInfo()
  const activeOperations = useNodeOperations((store) => activeNodeOperationCount(store.operations))
  const { capabilities, controlMain, controlMainPending } = useWindowControls()
  const showWindowControls = capabilities?.nativeWindowControls === true

  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)

  // 切换预设时自动同步颜色模式
  function selectPreset(key: AppTheme) {
    workspaceActions.setTheme(key)
    setColorMode(PRESET_DEFAULT_MODE[key])
  }

  async function controlMainWindow(action: "minimize" | "maximize" | "close") {
    const result = await controlMain(action)
    if (!result.success) console.info(`[window] ${result.message}`)
    if (result.success && result.state) setIsMaximized(result.state === "maximized")
  }

  function handleTitleBarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (!showWindowControls) return
    if (isNoDragTarget(event.target)) return

    event.preventDefault()
    void controlMainWindow("maximize")
  }

  return (
    <header
      onDoubleClick={handleTitleBarDoubleClick}
      className={cn(
        "xiranite-app-region-drag",
        "flex h-12 min-w-0 flex-shrink-0 select-none items-center gap-3 border-b border-border bg-background px-4",
      )}
    >
      {/* ── 品牌 + 工作区切换入口 ── */}
      <div className="xiranite-app-region-no-drag relative flex-shrink-0">
        <button
          onClick={() => setWsMenuOpen(o => !o)}
          title={activeWorkspace ? `${t("topbar:workspace.current")}: ${translateLabel(activeWorkspace.label, t)}` : t("topbar:workspace.new")}
          className="flex h-10 items-center gap-2 rounded px-1 hover:bg-muted/40 transition-colors"
        >
          {activeWorkspace?.icon ? (
            <WorkspaceIcon icon={activeWorkspace.icon} size="sm" />
          ) : null}
          <div className="min-w-0 text-left">
            <div className="font-mono text-sm font-bold text-primary tracking-tight leading-none">{t("common:appName")}</div>
            <div className="font-mono text-[9px] text-muted-foreground/60 leading-none mt-0.5">{t("common:version", { version: "0.5.0" })}</div>
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
        </button>

        {wsMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => { setWsMenuOpen(false); setRenamingId(null) }} />
            <div className="absolute left-0 top-full mt-1 w-72 rounded-md border border-border bg-card shadow-lg z-40 overflow-hidden">
              {/* 当前工作区 */}
              {activeWorkspace ? (
                <div className="border-b border-border/60 px-3 py-2">
                  <p className="text-[9px] font-mono text-muted-foreground tracking-widest mb-1">{t("topbar:workspace.current")}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-5 flex-shrink-0 grid place-items-center">
                      {activeWorkspace.icon ? <WorkspaceIcon icon={activeWorkspace.icon} size="sm" /> : null}
                    </div>
                    {renamingId === activeWorkspace.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renameValue.trim()) {
                            workspaceActions.renameWorkspace(activeWorkspace.id, renameValue.trim())
                            setRenamingId(null)
                          }
                          if (e.key === "Escape") setRenamingId(null)
                        }}
                        onBlur={() => setRenamingId(null)}
                        className="h-6 flex-1 rounded border border-primary/50 bg-background px-1.5 text-xs font-mono"
                      />
                    ) : (
                      <span className="flex-1 truncate text-xs font-mono text-foreground">{translateLabel(activeWorkspace.label, t)}</span>
                    )}
                  </div>
                </div>
              ) : null}

              {/* 工作区列表 */}
              <div className="py-1 max-h-60 overflow-auto">
                {state.workspaces.map(ws => (
                  <div
                    key={ws.id}
                    data-workspace-id={ws.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 w-full text-left text-xs font-mono hover:bg-muted/60 transition-colors group",
                      ws.id === state.activeWorkspaceId && "bg-primary/5 text-primary"
                    )}
                  >
                    <button
                      onClick={() => {
                        workspaceActions.setActiveWorkspace(ws.id)
                        setWsMenuOpen(false)
                      }}
                      className="flex flex-1 items-center gap-2 min-w-0"
                    >
                      <div className="w-5 flex-shrink-0 grid place-items-center">
                        {ws.icon ? <WorkspaceIcon icon={ws.icon} size="sm" /> : null}
                      </div>
                      <span className="flex-1 truncate">{translateLabel(ws.label, t)}</span>
                      {ws.id === state.activeWorkspaceId && <Check className="h-3 w-3 flex-shrink-0" />}
                    </button>
                    {/* 操作按钮（hover 显示） */}
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title={t("topbar:workspace.setIcon")}
                        onClick={(e) => { e.stopPropagation(); setIconPickerWsId(ws.id) }}
                        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Smile className="h-3 w-3" />
                      </button>
                      <button
                        title={t("topbar:workspace.rename")}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(ws.id)
                          setRenameValue(translateLabel(ws.label, t))
                        }}
                        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                      {state.workspaces.length > 1 ? (
                        <button
                          title={t("topbar:workspace.delete")}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (ws.id === state.activeWorkspaceId) {
                              const rest = state.workspaces.filter(w => w.id !== ws.id)
                              if (rest.length > 0) workspaceActions.setActiveWorkspace(rest[0].id)
                            }
                            workspaceActions.removeWorkspace(ws.id)
                          }}
                          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {/* 操作区 */}
              <div className="border-t border-border/60 p-1">
                <button
                  onClick={() => { workspaceActions.addWorkspace(); setWsMenuOpen(false) }}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left text-xs font-mono text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {t("topbar:workspace.new")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── ViewMode 切换：cards / dockview / flow 三种主形态 ── */}
      <div className="xiranite-app-region-no-drag flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-3">
        {VIEW_OPTIONS.map(({ key, labelKey, hintKey, icon: Icon }) => (
          <button
            key={key}
            data-view-mode={key}
            onClick={() => workspaceActions.setViewMode(key)}
            title={`${t(labelKey)}: ${t(hintKey)}`}
            aria-label={`${t(labelKey)}: ${t(hintKey)}`}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-sm border transition-colors",
              state.viewMode === key
                ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* ── Cards 子布局：仅 viewMode === "cards" 时显示 ── */}
      {state.viewMode === "cards" && (
        <div className="xiranite-app-region-no-drag flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-3">
          {CARD_LAYOUT_OPTIONS.map(({ key, labelKey, hintKey, icon: Icon }) => (
            <button
              key={key}
              data-card-layout={key}
              onClick={() => workspaceActions.setCardLayout(key)}
              title={`${t(labelKey)}: ${t(hintKey)}`}
              aria-label={`${t(labelKey)}: ${t(hintKey)}`}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-sm border transition-colors",
                state.cardLayout === key
                  ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search (装饰) */}
      <button className="xiranite-app-region-no-drag hidden h-8 w-48 items-center gap-2 rounded border border-border/60 bg-muted/30 px-3 text-xs font-mono text-muted-foreground transition-colors hover:border-border hover:text-foreground xl:flex">
        <Search className="h-3.5 w-3.5" />
        <span>{t("topbar:search")}</span>
        <kbd className="ml-auto text-[9px] bg-muted px-1 rounded">⌘K</kbd>
      </button>

      {/* ── 弹出层入口（取代侧栏）── */}
      <div className="xiranite-app-region-no-drag flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative hidden h-8 w-8 text-muted-foreground hover:text-foreground sm:inline-flex",
            runtimeInfo.frontendSource === "vite-dev" && "text-primary hover:text-primary",
          )}
          onClick={() => workspaceActions.setOverlay("settings")}
          title={t(runtimeInfo.frontendSource === "vite-dev" ? "topbar:devRuntime.vite" : "topbar:devRuntime.packaged")}
          aria-label={t(runtimeInfo.frontendSource === "vite-dev" ? "topbar:devRuntime.vite" : "topbar:devRuntime.packaged")}
        >
          <Code2 className="h-4 w-4" />
          <span
            className={cn(
              "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
              runtimeInfo.frontendSource === "vite-dev" ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs font-mono text-muted-foreground hover:text-foreground"
          onClick={() => workspaceActions.setOverlay("registry")}
          title={t("overlay:registry")}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t("topbar:registry")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => workspaceActions.setOverlay("operations")}
          title={t("topbar:operations")}
          aria-label={t("topbar:operations")}
        >
          <Activity className="h-4 w-4" />
          {activeOperations > 0 && (
            <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-mono leading-none text-destructive-foreground">
              {activeOperations > 9 ? "9+" : activeOperations}
            </span>
          )}
        </Button>

        {/* ── 主题快速切换下拉 ── */}
        <div className="relative">
          <button
            onClick={() => setThemeMenuOpen(o => !o)}
            title={t("topbar:theme.label")}
            className="flex items-center gap-1.5 h-8 px-2 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border/60"
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden xl:inline uppercase tracking-widest text-[10px]">
              {THEME_PRESETS.find(p => p.key === state.theme) ? t(THEME_PRESETS.find(p => p.key === state.theme)!.labelKey) : t("topbar:theme.label")}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {themeMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-card shadow-lg z-40 overflow-hidden">
                {/* 主题预设 */}
                <div className="p-2">
                  <p className="px-2 py-1 text-[9px] font-mono text-muted-foreground tracking-widest">{t("topbar:theme.preset")}</p>
                  {THEME_PRESETS.map(p => {
                    const isActive = p.key === state.theme
                    return (
                      <button
                        key={p.key}
                        onClick={() => selectPreset(p.key)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-xs transition-colors",
                          isActive ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground"
                        )}
                      >
                        <span
                          className="w-3 h-3 rounded-sm border border-border/60 flex-shrink-0"
                          style={{ background: p.swatch }}
                        />
                        <span className="flex-1">{t(p.labelKey)}</span>
                        {isActive && <Check className="h-3 w-3" />}
                      </button>
                    )
                  })}
                </div>

                {/* 颜色模式 */}
                <div className="border-t border-border/60 p-2">
                  <p className="px-2 py-1 text-[9px] font-mono text-muted-foreground tracking-widest">{t("topbar:theme.colorMode")}</p>
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
                          <span className="text-[10px] font-mono">{t(m.labelKey)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 背景模式 */}
                <div className="border-t border-border/60 p-2">
                  <p className="px-2 py-1 text-[9px] font-mono text-muted-foreground tracking-widest">{t("settings:background.mode")}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { key: "grid", icon: Grid },
                      { key: "dot-grid", icon: CircleDot },
                      { key: "image", icon: Image },
                      { key: "none", icon: Palette },
                    ].map(m => {
                      const Icon = m.icon
                      const isActive = state.bgMode === m.key
                      return (
                        <button
                          key={m.key}
                          onClick={() => workspaceActions.setBgMode(m.key as any)}
                          className={cn(
                            "flex flex-col items-center gap-1 py-1.5 rounded-sm border transition-all cursor-pointer",
                            isActive
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border/40 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[8px] font-mono text-center truncate max-w-full px-0.5">
                            {t(`settings:background.modes.${m.key}`)}
                          </span>
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
                      workspaceActions.setOverlay("settings")
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-left text-xs font-mono text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    {t("topbar:theme.openSettings")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showWindowControls && (
        <div className="xiranite-app-region-no-drag flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-2">
          <button
            title={t("common:minimize")}
            aria-label={t("common:minimize")}
            disabled={controlMainPending}
            onClick={() => controlMainWindow("minimize")}
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            title={t("common:maximize")}
            aria-label={t("common:maximize")}
            disabled={controlMainPending}
            onClick={() => controlMainWindow("maximize")}
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            title={t("common:close")}
            aria-label={t("common:close")}
            disabled={controlMainPending}
            onClick={() => controlMainWindow("close")}
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {iconPickerWsId ? (
        <IconPicker
          currentIcon={state.workspaces.find(w => w.id === iconPickerWsId)?.icon}
          onSet={(icon) => workspaceActions.setWorkspaceIcon(iconPickerWsId, icon)}
          onClose={() => setIconPickerWsId(null)}
        />
      ) : null}

    </header>
  )
}
