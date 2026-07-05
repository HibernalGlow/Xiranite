import { cn } from "@/lib/utils"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import type { LayoutMode } from "@/types/workspace"
import { Bell, Settings, Search, Grid, Layers, SplitSquareVertical, AlignJustify, Target } from "lucide-react"
import { Button } from "@/components/ui/button"

const LAYOUT_OPTIONS: { key: LayoutMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: "free",  label: "FREE",  icon: Layers,              hint: "drag anywhere" },
  { key: "grid",  label: "GRID",  icon: Grid,                 hint: "auto tile" },
  { key: "stack", label: "STACK", icon: AlignJustify,         hint: "cascade" },
  { key: "split", label: "SPLIT", icon: SplitSquareVertical, hint: "two columns" },
  { key: "focus", label: "FOCUS", icon: Target,              hint: "hero + strip" },
]

export function TopBar() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()

  return (
    <header className="h-12 border-b border-border bg-background flex items-center px-4 gap-4 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 w-56 flex-shrink-0 cursor-pointer" onClick={() => dispatch(actions.setSidebarView("workspaces"))}>
        <span className="font-mono text-sm font-bold text-primary tracking-tight">WULING_CITY_OS</span>
      </div>

      {/* Layout mode selector */}
      <div className="flex items-center gap-1">
        {LAYOUT_OPTIONS.map(({ key, label, icon: Icon, hint }) => (
          <button
            key={key}
            onClick={() => dispatch(actions.setLayout(key))}
            title={hint}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-sm transition-colors border",
              state.layoutMode === key
                ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <button className="flex items-center gap-2 px-3 h-8 rounded border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border transition-colors text-xs font-mono w-48">
        <Search className="h-3.5 w-3.5" />
        <span>SEARCH_REGISTRY...</span>
        <kbd className="ml-auto text-[9px] bg-muted px-1 rounded">⌘K</kbd>
      </button>

      {/* Actions */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => dispatch(actions.setSidebarView("settings"))}
        title="Theme Settings"
      >
        <Settings className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-destructive rounded-full" />
      </Button>

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
