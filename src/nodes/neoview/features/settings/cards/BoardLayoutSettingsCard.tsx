/**
 * Unified board layout settings: left / right / hidden swimlanes.
 * Replaces the separate sidebar-management + panel-layout cards.
 */
import { Columns3, LayoutGrid, PanelsTopLeft, RotateCcw } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SwimlaneInteractionSettings as SharedSwimlaneInteractionSettings } from "@/components/workspace/swimlane/SwimlaneInteractionSettings"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import type { ReaderWorkspacePatch } from "../../workspace/ReaderWorkspaceLayout"
import { SettingsCardShell } from "../SettingsCardShell"

const BoardSwimlaneEditor = lazy(() => import("./BoardSwimlaneEditor"))
type RevealZones = NonNullable<ReaderShellConfigDto["workspace"]>["swimlane"]["edgeRevealZones"]
type RevealEdge = keyof RevealZones
type RevealCorner = "nw" | "ne" | "sw" | "se"
const REVEAL_EDGES = ["left", "right", "top", "bottom"] as const satisfies readonly RevealEdge[]
const REVEAL_EDGE_META: Record<RevealEdge, { label: string; color: string }> = {
  left: { label: "左侧", color: "border-cyan-400 bg-cyan-400/20" },
  right: { label: "右侧", color: "border-amber-400 bg-amber-400/20" },
  top: { label: "上栏", color: "border-emerald-400 bg-emerald-400/20" },
  bottom: { label: "下栏", color: "border-fuchsia-400 bg-fuchsia-400/20" },
}
type RevealDrag =
  | { mode: "draw"; pointerId: number; edge: RevealEdge; startX: number; startY: number; startClientX: number; startClientY: number; moved: boolean }
  | { mode: "resize"; pointerId: number; edge: RevealEdge; corner: RevealCorner; initial: RevealZones[RevealEdge] }
const DEFAULT_REVEAL_ZONES: RevealZones = {
  left: { x: 0, y: 10, width: 1, height: 80 },
  right: { x: 99, y: 10, width: 1, height: 80 },
  top: { x: 10, y: 0, width: 80, height: 1 },
  bottom: { x: 10, y: 99, width: 80, height: 1 },
}

export function BoardLayoutSettingsCard({
  shell,
  onSave,
  onWorkspace,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  onWorkspace?(patch: ReaderWorkspacePatch): void
}) {
  const [activeTab, setActiveTab] = useState("swimlane")
  if (!shell.workspace || !onWorkspace) {
    return <Suspense fallback={null}><BoardSwimlaneEditor key={shell.revision ?? 0} shell={shell} onSave={onSave} /></Suspense>
  }
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full gap-0">
      <SettingsCardShell
        id="swimlane-layout"
        title="泳道与布局"
        icon={Columns3}
        className="[&>header]:items-center"
        actions={
          <TabsList variant="default" layout="fit" aria-label="泳道与布局分区" className="h-8">
            <TabsTrigger value="swimlane" className="h-7 gap-1 px-2.5 text-xs"><Columns3 className="size-3.5" />泳道</TabsTrigger>
            <TabsTrigger value="board" className="h-7 gap-1 px-2.5 text-xs"><LayoutGrid className="size-3.5" />布局看板</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="swimlane" className="mt-0 grid gap-5 outline-none">
          <SwimlaneWorkspaceSettings shell={shell} onWorkspace={onWorkspace} />
          <SwimlaneInteractionSettings shell={shell} onWorkspace={onWorkspace} />
        </TabsContent>
        <TabsContent value="board" className="mt-0 outline-none">
          <Suspense fallback={null}><BoardSwimlaneEditor key={shell.revision ?? 0} shell={shell} onSave={onSave} embedded /></Suspense>
        </TabsContent>
      </SettingsCardShell>
    </Tabs>
  )
}

export function SettingsBoardLayoutCard({ shell, onSave, onWorkspace }: ReaderSettingsCardContext) {
  if (!shell || !onSave) return null
  return <BoardLayoutSettingsCard shell={shell} onSave={onSave} onWorkspace={onWorkspace} />
}

export default function DockedBoardLayoutSettingsCard({ shell, onBoardLayout }: ReaderPanelContext) {
  if (!shell || !onBoardLayout) return null
  return <BoardLayoutSettingsCard shell={shell} onSave={onBoardLayout} />
}

function SwimlaneInteractionSettings({ shell, onWorkspace }: {
  shell: ReaderShellConfigDto
  onWorkspace(patch: ReaderWorkspacePatch): void
}) {
  const swimlane = shell.workspace!.swimlane

  return (
    <div className="grid gap-3">
      <SharedSwimlaneInteractionSettings
        value={{ soloOnFocus: swimlane.readerSoloOnFocus, showNavigatorInSolo: swimlane.showLaneNavigatorInReaderSolo, edgeRevealDelayMs: swimlane.edgeRevealDelayMs, focusOnHover: swimlane.readerFocusOnHover, focusDelayMs: swimlane.readerFocusHoverDelayMs, manualScrollEnabled: swimlane.manualScrollEnabled }}
        labels={{ soloOnFocus: "Reader 聚焦时自动独占", showNavigatorInSolo: "Reader 独占时显示泳道切换栏", focusOnHover: "启用 Reader 悬停重新聚焦", focusDelay: "Reader 悬停重新聚焦延迟", manualScrollEnabled: "允许手动横向滚动" }}
        onChange={(patch) => onWorkspace({
          ...(patch.soloOnFocus === undefined ? {} : { readerSoloOnFocus: patch.soloOnFocus }),
          ...(patch.showNavigatorInSolo === undefined ? {} : { showLaneNavigatorInReaderSolo: patch.showNavigatorInSolo }),
          ...(patch.edgeRevealDelayMs === undefined ? {} : { edgeRevealDelayMs: patch.edgeRevealDelayMs }),
          ...(patch.focusOnHover === undefined ? {} : { readerFocusOnHover: patch.focusOnHover }),
          ...(patch.focusDelayMs === undefined ? {} : { readerFocusHoverDelayMs: patch.focusDelayMs }),
          ...(patch.manualScrollEnabled === undefined ? {} : { manualScrollEnabled: patch.manualScrollEnabled }),
        })}
      />
      <RevealZoneEditor
        zones={swimlane.edgeRevealZones ?? DEFAULT_REVEAL_ZONES}
        onChange={(edgeRevealZones) => onWorkspace({ edgeRevealZones })}
      />
    </div>
  )
}

function SwimlaneWorkspaceSettings({ shell, onWorkspace }: {
  shell: ReaderShellConfigDto
  onWorkspace(patch: ReaderWorkspacePatch): void
}) {
  const swimlane = shell.workspace!.swimlane
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <span className="text-sm font-medium">默认启动视图</span>
        <div className="flex w-fit items-center rounded-md border border-border bg-muted/35 p-0.5" role="group" aria-label="默认启动视图">
          <Button type="button" size="sm" variant={shell.workspace!.mode === "edges" ? "default" : "ghost"} aria-pressed={shell.workspace!.mode === "edges"} onClick={() => onWorkspace({ mode: "edges" })}><PanelsTopLeft />四边栏</Button>
          <Button type="button" size="sm" variant={shell.workspace!.mode === "swimlane" ? "default" : "ghost"} aria-pressed={shell.workspace!.mode === "swimlane"} onClick={() => onWorkspace({ mode: "swimlane" })}><Columns3 />泳道</Button>
        </div>
      </div>
    </div>
  )
}

function RevealZoneEditor({ zones, onChange }: { zones: RevealZones; onChange(zones: RevealZones): void }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<RevealDrag>()
  const zonesRef = useRef(zones)
  const [selected, setSelected] = useState<RevealEdge>("left")
  const [horizontalLinked, setHorizontalLinked] = useState(true)
  const [verticalLinked, setVerticalLinked] = useState(true)
  const [draft, setDraft] = useState(zones)
  const zoneSignature = REVEAL_EDGES.map((edge) => {
    const zone = zones[edge]
    return `${zone.x}:${zone.y}:${zone.width}:${zone.height}`
  }).join("|")

  useEffect(() => {
    const next = cloneZones(zones)
    zonesRef.current = next
    setDraft(next)
  }, [zoneSignature])

  function update(next: RevealZones) {
    zonesRef.current = next
    setDraft(next)
  }

  function updateZone(edge: RevealEdge, zone: RevealZones[RevealEdge]) {
    const next = { ...zonesRef.current, [edge]: zone }
    if ((edge === "left" || edge === "right") && horizontalLinked) {
      next[edge === "left" ? "right" : "left"] = mirrorZone(zone, "horizontal")
    }
    if ((edge === "top" || edge === "bottom") && verticalLinked) {
      next[edge === "top" ? "bottom" : "top"] = mirrorZone(zone, "vertical")
    }
    update(next)
  }

  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clampPercent((event.clientX - rect.left) / Math.max(1, rect.width) * 100),
      y: clampPercent((event.clientY - rect.top) / Math.max(1, rect.height) * 100),
    }
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const start = point(event)
    dragRef.current = {
      mode: "draw",
      pointerId: event.pointerId,
      edge: selected,
      startX: start.x,
      startY: start.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function beginResize(edge: RevealEdge, corner: RevealCorner, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    setSelected(edge)
    dragRef.current = { mode: "resize", pointerId: event.pointerId, edge, corner, initial: { ...zonesRef.current[edge] } }
    canvasRef.current?.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function moveDraw(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const current = point(event)
    if (drag.mode === "draw") {
      if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) return
      drag.moved = true
      const x = Math.min(drag.startX, current.x)
      const y = Math.min(drag.startY, current.y)
      updateZone(drag.edge, {
        x,
        y,
        width: Math.max(1, Math.abs(current.x - drag.startX)),
        height: Math.max(1, Math.abs(current.y - drag.startY)),
      })
      return
    }
    updateZone(drag.edge, resizedZone(drag.initial, drag.corner, current.x, current.y))
  }

  function endDraw(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.mode === "draw" && !drag.moved) return
    onChange(zonesRef.current)
  }

  function updateField(field: "x" | "y" | "width" | "height", value: number) {
    const zone = draft[selected]
    const maximum = field === "width" ? 100 - zone.x : field === "height" ? 100 - zone.y : 99
    const minimum = field === "width" || field === "height" ? 1 : 0
    const nextValue = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : zone[field]
    const nextZone = { ...zone, [field]: nextValue }
    if (field === "x") nextZone.width = Math.min(nextZone.width, 100 - nextValue)
    if (field === "y") nextZone.height = Math.min(nextZone.height, 100 - nextValue)
    updateZone(selected, nextZone)
  }

  return (
    <div className="grid gap-3 border-t border-border/55 pt-3" data-reader-reveal-zone-editor="true">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-muted/35 p-0.5" role="group" aria-label="悬停唤出区">
            {REVEAL_EDGES.map((edge) => (
              <Button key={edge} type="button" size="sm" variant={selected === edge ? "default" : "ghost"} aria-pressed={selected === edge} onClick={() => setSelected(edge)}>
                <span className={`size-2 rounded-sm ${REVEAL_EDGE_META[edge].color}`} />{REVEAL_EDGE_META[edge].label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={horizontalLinked} onChange={(event) => setHorizontalLinked(event.currentTarget.checked)} />左右联动</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={verticalLinked} onChange={(event) => setVerticalLinked(event.currentTarget.checked)} />上下联动</label>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" title="重置悬停唤出区" aria-label="重置悬停唤出区" onClick={() => { const next = cloneZones(DEFAULT_REVEAL_ZONES); update(next); onChange(next) }}><RotateCcw /></Button>
      </div>
      <div
        ref={canvasRef}
        className="relative aspect-video min-h-36 w-full touch-none overflow-hidden rounded-md border border-border bg-muted/25 shadow-inner"
        aria-label="悬停唤出区画布"
        onPointerDown={beginDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-border/50" />
        {REVEAL_EDGES.map((edge) => <RevealZone key={edge} edge={edge} zone={draft[edge]} selected={selected === edge} onResizeStart={beginResize} />)}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field} className="grid gap-1 text-[11px] text-muted-foreground">
            <span>{field === "width" ? "宽" : field === "height" ? "高" : field.toUpperCase()}</span>
            <input
              type="number"
              min={field === "width" || field === "height" ? 1 : 0}
              max={100}
              step={0.5}
              aria-label={`${REVEAL_EDGE_META[selected].label}唤出区${field}`}
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft[selected][field]}
              onChange={(event) => updateField(field, Number(event.currentTarget.value))}
              onBlur={() => onChange(zonesRef.current)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function RevealZone({ edge, zone, selected, onResizeStart }: {
  edge: RevealEdge
  zone: RevealZones[RevealEdge]
  selected: boolean
  onResizeStart(edge: RevealEdge, corner: RevealCorner, event: ReactPointerEvent<HTMLButtonElement>): void
}) {
  return <div
    className={`pointer-events-none absolute border-2 ${REVEAL_EDGE_META[edge].color} ${selected ? "z-10 shadow-[0_0_0_2px_var(--background)]" : "opacity-70"}`}
    data-reader-reveal-zone={edge}
    style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
  >
    {selected ? (["nw", "ne", "sw", "se"] as const).map((corner) => (
      <button
        key={corner}
        type="button"
        aria-label={`调整${REVEAL_EDGE_META[edge].label}唤出区${corner}角`}
        className={`pointer-events-auto absolute size-3 rounded-sm border border-background bg-primary shadow ${corner.includes("n") ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"} ${corner.includes("w") ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
        onPointerDown={(event) => onResizeStart(edge, corner, event)}
      />
    )) : null}
  </div>
}

function cloneZones(zones: RevealZones): RevealZones {
  return {
    left: { ...zones.left },
    right: { ...zones.right },
    top: { ...zones.top },
    bottom: { ...zones.bottom },
  }
}

function mirrorZone(zone: RevealZones[RevealEdge], axis: "horizontal" | "vertical"): RevealZones[RevealEdge] {
  return axis === "horizontal"
    ? { ...zone, x: Math.max(0, 100 - zone.x - zone.width) }
    : { ...zone, y: Math.max(0, 100 - zone.y - zone.height) }
}

function resizedZone(zone: RevealZones[RevealEdge], corner: RevealCorner, pointerX: number, pointerY: number): RevealZones[RevealEdge] {
  const right = zone.x + zone.width
  const bottom = zone.y + zone.height
  const x = corner.includes("w") ? Math.min(pointerX, right - 1) : zone.x
  const y = corner.includes("n") ? Math.min(pointerY, bottom - 1) : zone.y
  const nextRight = corner.includes("e") ? Math.max(pointerX, zone.x + 1) : right
  const nextBottom = corner.includes("s") ? Math.max(pointerY, zone.y + 1) : bottom
  return {
    x: clampPercent(x),
    y: clampPercent(y),
    width: Math.max(1, Math.min(100 - x, nextRight - x)),
    height: Math.max(1, Math.min(100 - y, nextBottom - y)),
  }
}

function clampPercent(value: number): number {
  return Math.round(Math.min(99, Math.max(0, value)) * 10) / 10
}
