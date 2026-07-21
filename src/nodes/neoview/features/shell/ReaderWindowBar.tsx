import { useSyncExternalStore, type ReactNode } from "react"
import { Columns3, Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop, PanelsTopLeft, Pin, PinOff, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReaderShellControlPort } from "./ReaderShellControlPort"
import type { ReaderShellControlEdge } from "./ReaderShellControlStore"

const EDGES: ReadonlyArray<{ edge: ReaderShellControlEdge; label: string; icon: typeof PanelTop }> = [
  { edge: "top", label: "顶部边栏", icon: PanelTop },
  { edge: "bottom", label: "底部边栏", icon: PanelBottom },
  { edge: "left", label: "左侧边栏", icon: PanelLeft },
  { edge: "right", label: "右侧边栏", icon: PanelRight },
]

export function ReaderWindowBar({ control, disabled, mode, readerSolo, onModeChange, onReaderSoloChange, onOpenSettings, windowControls, part = "all" }: {
  control: ReaderShellControlPort
  disabled?: boolean
  mode: "edges" | "swimlane"
  readerSolo: boolean
  onModeChange(mode: "edges" | "swimlane"): void
  onReaderSoloChange(enabled: boolean): void
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
          <div className="flex items-center rounded-md border border-border/60 bg-muted/25 p-0.5" role="group" aria-label="NeoView 布局模式">
            <Button type="button" size="icon-sm" variant={mode === "edges" ? "secondary" : "ghost"} title="四边栏模式" aria-label="四边栏模式" aria-pressed={mode === "edges"} disabled={disabled} onClick={() => onModeChange("edges")}><PanelsTopLeft /></Button>
            <Button type="button" size="icon-sm" variant={mode === "swimlane" ? "secondary" : "ghost"} title="泳道模式" aria-label="泳道模式" aria-pressed={mode === "swimlane"} disabled={disabled} onClick={() => onModeChange("swimlane")}><Columns3 /></Button>
          </div>
          {mode === "edges" ? <span className="mx-0.5 h-5 w-px bg-border/70" aria-hidden="true" /> : null}
          {mode === "edges" ? EDGES.map(({ edge, label, icon: Icon }) => (
            <Button key={edge} type="button" size="icon-sm" variant={snapshot.edges[edge].open ? "default" : "outline"} title={label} aria-label={label} aria-pressed={snapshot.edges[edge].open} disabled={disabled} onClick={() => control.requestOpen(edge, !snapshot.edges[edge].open)}><Icon /></Button>
          )) : null}
        </div>
      ) : null}
      {part !== "leading" ? (
        <div className="flex shrink-0 items-stretch" data-reader-topbar-cluster="trailing">
          <div className="flex items-center gap-1 px-1">
            {mode === "swimlane" ? (
              <Button type="button" size="icon-sm" variant={readerSolo ? "default" : "ghost"} title={readerSolo ? "退出 Reader 全屏" : "Reader 全屏"} aria-label={readerSolo ? "退出 Reader 全屏" : "Reader 全屏"} aria-pressed={readerSolo} disabled={disabled} onClick={() => onReaderSoloChange(!readerSolo)}>{readerSolo ? <Minimize2 /> : <Maximize2 />}</Button>
            ) : (
              <Button type="button" size="icon-sm" variant={topPinned ? "default" : "ghost"} title={topPinned ? "取消固定顶栏" : "固定顶栏"} aria-label={topPinned ? "取消固定顶栏" : "固定顶栏"} aria-pressed={topPinned} disabled={disabled} onClick={() => control.setPinned("top", !topPinned)}>{topPinned ? <PinOff /> : <Pin />}</Button>
            )}
            <Button type="button" size="icon-sm" variant="ghost" title="打开 NeoView 设置" aria-label="打开 NeoView 设置" disabled={disabled} onClick={onOpenSettings}><Settings2 /></Button>
          </div>
          {windowControls ? <div className="flex shrink-0 items-stretch">{windowControls}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
