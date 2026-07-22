import { useSyncExternalStore, type ReactNode } from "react"
import { Columns3, PanelBottom, PanelLeft, PanelRight, PanelTop, PanelsTopLeft, Pin, PinOff, Scan, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ReaderShellControlPort } from "./ReaderShellControlPort"
import type { ReaderShellControlEdge } from "./ReaderShellControlStore"

const EDGES: ReadonlyArray<{ edge: ReaderShellControlEdge; label: string; icon: typeof PanelTop }> = [
  { edge: "top", label: "顶部边栏", icon: PanelTop },
  { edge: "bottom", label: "底部边栏", icon: PanelBottom },
  { edge: "left", label: "左侧边栏", icon: PanelLeft },
  { edge: "right", label: "右侧边栏", icon: PanelRight },
]

const TOPBAR_BUTTON_CLASS = "border border-transparent bg-transparent text-foreground/80 shadow-none"
const TOPBAR_ACTIVE_BUTTON_CLASS = "border-border/45 bg-accent/60 text-accent-foreground"

export function ReaderWindowBar({ control, disabled, mode, readerViewFullscreen = false, onModeChange, onReaderViewFullscreenChange, onOpenSettings, windowControls, part = "all" }: {
  control: ReaderShellControlPort
  disabled?: boolean
  mode: "edges" | "swimlane"
  readerViewFullscreen?: boolean
  onModeChange(mode: "edges" | "swimlane"): void
  onReaderViewFullscreenChange?(): void
  onOpenSettings(): void
  windowControls?: ReactNode
  part?: "all" | "leading" | "trailing"
}) {
  const snapshot = useSyncExternalStore(control.store.subscribe, control.store.getSnapshot, control.store.getSnapshot)
  const topPinned = snapshot.edges.top.pinned
  return (
    <div className="xiranite-app-region-no-drag flex min-w-0 items-stretch" data-reader-window-bar="true" data-reader-topbar-controls={part} data-input-context="shell">
      {part !== "trailing" ? (
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-reader-topbar-cluster="leading">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={TOPBAR_BUTTON_CLASS}
            title={mode === "edges" ? "切换到泳道模式" : "切换到四边栏模式"}
            aria-label={mode === "edges" ? "泳道模式" : "四边栏模式"}
            disabled={disabled}
            onClick={() => onModeChange(mode === "edges" ? "swimlane" : "edges")}
          >
            {mode === "edges" ? <Columns3 /> : <PanelsTopLeft />}
          </Button>
          {mode === "edges" ? <span className="mx-0.5 h-5 w-px bg-border/70" aria-hidden="true" /> : null}
          {mode === "edges" ? EDGES.map(({ edge, label, icon: Icon }) => (
            <Button key={edge} type="button" size="icon-sm" variant="ghost" className={cn(TOPBAR_BUTTON_CLASS, snapshot.edges[edge].open && TOPBAR_ACTIVE_BUTTON_CLASS)} title={label} aria-label={label} aria-pressed={snapshot.edges[edge].open} disabled={disabled} onClick={() => control.requestOpen(edge, !snapshot.edges[edge].open)}><Icon /></Button>
          )) : null}
        </div>
      ) : null}
      {part !== "leading" ? (
        <div className="flex shrink-0 items-stretch" data-reader-topbar-cluster="trailing">
          <div className="flex items-center gap-1 px-1">
            {readerViewFullscreen && onReaderViewFullscreenChange ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className={cn(TOPBAR_BUTTON_CLASS, TOPBAR_ACTIVE_BUTTON_CLASS)}
                title="退出 Reader 视图全屏"
                aria-label="退出 Reader 视图全屏"
                aria-pressed="true"
                data-reader-view-fullscreen-exit="true"
                disabled={disabled}
                onClick={onReaderViewFullscreenChange}
              >
                <Scan />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="ghost" className={cn(TOPBAR_BUTTON_CLASS, topPinned && TOPBAR_ACTIVE_BUTTON_CLASS)} title={topPinned ? "取消固定顶栏" : "固定顶栏"} aria-label={topPinned ? "取消固定顶栏" : "固定顶栏"} aria-pressed={topPinned} disabled={disabled} onClick={() => control.setPinned("top", !topPinned)}>{topPinned ? <PinOff /> : <Pin />}</Button>
            <Button type="button" size="icon-sm" variant="ghost" className={TOPBAR_BUTTON_CLASS} title="打开 NeoView 设置" aria-label="打开 NeoView 设置" disabled={disabled} onClick={onOpenSettings}><Settings2 /></Button>
          </div>
          {windowControls ? <div className="flex shrink-0 items-stretch">{windowControls}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
