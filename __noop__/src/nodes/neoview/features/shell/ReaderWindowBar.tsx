import { useSyncExternalStore, type ReactNode } from "react"
import { PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReaderShellControlPort } from "./ReaderShellControlPort"
import type { ReaderShellControlEdge } from "./ReaderShellControlStore"

const EDGES: ReadonlyArray<{ edge: ReaderShellControlEdge; label: string; icon: typeof PanelTop }> = [
  { edge: "top", label: "顶部边栏", icon: PanelTop },
  { edge: "bottom", label: "底部边栏", icon: PanelBottom },
  { edge: "left", label: "左侧边栏", icon: PanelLeft },
  { edge: "right", label: "右侧边栏", icon: PanelRight },
]

export function ReaderWindowBar({ control, disabled, onOpenSettings, windowControls }: {
  control: ReaderShellControlPort
  disabled?: boolean
  onOpenSettings(): void
  windowControls: ReactNode
}) {
  const snapshot = useSyncExternalStore(control.store.subscribe, control.store.getSnapshot, control.store.getSnapshot)
  const topPinned = snapshot.edges.top.pinned
  return (
    <div className="grid min-h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-border/45 px-2" data-reader-window-bar="true">
      <div className="xiranite-app-region-no-drag flex items-center gap-1 justify-self-start">
        {EDGES.map(({ edge, label, icon: Icon }) => (
          <Button key={edge} type="button" size="icon-sm" variant={snapshot.edges[edge].open ? "default" : "outline"} aria-label={label} aria-pressed={snapshot.edges[edge].open} disabled={disabled} onClick={() => control.requestOpen(edge, !snapshot.edges[edge].open)}><Icon /></Button>
        ))}
      </div>
      <div className="xiranite-app-region-no-drag flex items-center gap-1 justify-self-center">
        <Button type="button" size="icon-sm" variant={topPinned ? "default" : "ghost"} aria-label={topPinned ? "取消固定顶栏" : "固定顶栏"} aria-pressed={topPinned} disabled={disabled} onClick={() => control.setPinned("top", !topPinned)}>{topPinned ? <PinOff /> : <Pin />}</Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="打开 NeoView 设置" disabled={disabled} onClick={onOpenSettings}><Settings2 /></Button>
      </div>
      <div className="xiranite-app-region-no-drag flex items-center justify-self-end">{windowControls}</div>
    </div>
  )
}
