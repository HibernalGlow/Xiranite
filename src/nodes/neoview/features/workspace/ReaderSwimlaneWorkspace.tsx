import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { AlertTriangle, BookOpen, Columns3, Ellipsis, GripVertical, Maximize2, Minimize2, PanelLeft, PanelRight, PanelsTopLeft, RotateCcw, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { LaneCollapseIcon } from "@/components/workspace/lane/LaneCollapseIcon"
import { LaneResizer } from "@/components/workspace/lane/LaneResizer"
import { adjacentSwimlane, effectiveSwimlaneWidth } from "@/components/workspace/swimlane/model"
import { cn } from "@/lib/utils"
import type { ReaderShellConfigDto, ReaderSwimlaneId } from "../../adapters/reader-http-client"
import {
  MAX_READER_WIDTH_RATIO,
  MIN_READER_WIDTH_RATIO,
  fitReaderSwimlanesToViewport,
  readerLaneWidth,
  reorderedReaderLanes,
  type ReaderWorkspaceConfig,
  type ReaderWorkspacePatch,
} from "./ReaderWorkspaceLayout"
import { ReaderLaneNavigator } from "./ReaderLaneNavigator"

const DEFAULT_LANE_LABELS: Record<string, string> = {
  left: "左侧面板",
  reader: "阅读器",
  right: "右侧面板",
}
const COLLAPSED_WIDTH = 44
const READER_RETURN_EDGE = 44
const MIN_EDGE_DWELL_MS = 100
const MIN_EDGE_RESTORE_MS = 320
const DEFAULT_LANE_WIDTHS: Record<string, number> = { left: 320, reader: 960, right: 280 }

interface ReaderSwimlaneWorkspaceProps {
  shell: ReaderShellConfigDto
  workspace: ReaderWorkspaceConfig
  reader: ReactNode
  left: ReactNode
  right: ReactNode
  disabled?: boolean
  onWorkspaceChange(patch: ReaderWorkspacePatch): void
  onOpenSettings?(): void
}

interface PanGesture {
  pointerId: number
  startX: number
  startScrollLeft: number
  moved: boolean
}

export function ReaderSwimlaneWorkspace({
  shell,
  workspace,
  reader,
  left,
  right,
  disabled = false,
  onWorkspaceChange,
  onOpenSettings,
}: ReaderSwimlaneWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef<Partial<Record<ReaderSwimlaneId, HTMLElement | null>>>({})
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === "undefined" ? 960 : Math.max(1, window.innerWidth))
  const liveWidthsRef = useRef<Record<ReaderSwimlaneId, number>>(Object.fromEntries(
    workspace.swimlane.laneOrder.map((laneId) => [
      laneId,
      laneId === "reader" ? readerLaneWidth(viewportWidth, workspace.swimlane.readerWidthRatio) : workspace.swimlane.lanes[laneId]?.width ?? 320,
    ]),
  ))
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const readerFocusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const panGestureRef = useRef<PanGesture | undefined>(undefined)
  const readerRestorePointerRef = useRef<number | undefined>(undefined)
  const [previewLane, setPreviewLane] = useState<ReaderSwimlaneId>()
  const [draggedLane, setDraggedLane] = useState<ReaderSwimlaneId>()
  const [laneNavigatorTitleHost, setLaneNavigatorTitleHost] = useState<HTMLElement | null>(null)
  const swimlane = workspace.swimlane
  const soloLaneId = swimlane.soloLaneId ?? (swimlane.readerSolo ? "reader" : undefined)
  const revealTriggersEnabled = soloLaneId !== undefined && swimlane.activeLane === soloLaneId && previewLane === undefined
  const readerNormalWidth = readerLaneWidth(viewportWidth, swimlane.readerWidthRatio)

  useEffect(() => {
    liveWidthsRef.current = Object.fromEntries(swimlane.laneOrder.map((laneId) => [
      laneId,
      laneId === "reader" ? readerNormalWidth : swimlane.lanes[laneId]?.width ?? 320,
    ]))
  }, [readerNormalWidth, swimlane.laneOrder, swimlane.lanes])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => setViewportWidth(Math.max(1, viewport.clientWidth || window.innerWidth))
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => scrollLaneIntoView(swimlane.activeLane, "focus"))
    return () => cancelAnimationFrame(frame)
  }, [soloLaneId, swimlane.activeLane, swimlane.laneOrder.join(":"), viewportWidth])

  useEffect(() => () => {
    clearTimer(revealTimerRef)
    clearTimer(restoreTimerRef)
    clearTimer(readerFocusTimerRef)
  }, [])

  function activateLane(laneId: ReaderSwimlaneId): void {
    clearTimer(revealTimerRef)
    clearTimer(restoreTimerRef)
    clearTimer(readerFocusTimerRef)
    setPreviewLane(undefined)
    if (swimlane.activeLane !== laneId || (swimlane.soloLaneId && swimlane.soloLaneId !== laneId)) {
      onWorkspaceChange({
        activeLane: laneId,
        ...(laneId === "reader" && swimlane.readerSoloOnFocus && !swimlane.readerSolo ? { readerSolo: true } : {}),
        ...(swimlane.soloLaneId && swimlane.soloLaneId !== laneId ? { soloLaneId: null } : {}),
      })
    }
    scrollLaneIntoView(laneId, "focus")
  }

  function scheduleReveal(edge: "left" | "right"): void {
    if (disabled || !soloLaneId || panGestureRef.current || readerRestorePointerRef.current !== undefined) return
    const laneId = adjacentSwimlane(swimlane.laneOrder, soloLaneId, edge)
    if (!laneId) return
    clearTimer(restoreTimerRef)
    if (previewLane === laneId || revealTimerRef.current !== undefined) return
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = undefined
      setPreviewLane(laneId)
      scrollLaneIntoView(laneId, "preview")
    }, Math.max(MIN_EDGE_DWELL_MS, swimlane.edgeRevealDelayMs))
  }

  function schedulePreviewRestore(): void {
    clearTimer(revealTimerRef)
    if (!previewLane || !soloLaneId || restoreTimerRef.current !== undefined) return
    restoreTimerRef.current = setTimeout(() => {
      restoreTimerRef.current = undefined
      setPreviewLane(undefined)
      scrollLaneIntoView(soloLaneId, "focus")
    }, Math.max(MIN_EDGE_RESTORE_MS, shell.hideDelayMs))
  }

  function cancelPreviewRestore(): void {
    clearTimer(restoreTimerRef)
  }

  function scheduleReaderFocus(): void {
    if (
      disabled ||
      swimlane.activeLane === "reader" ||
      (!swimlane.readerSolo && !swimlane.readerSoloOnFocus) ||
      !swimlane.readerFocusOnHover ||
      panGestureRef.current ||
      readerRestorePointerRef.current !== undefined ||
      readerFocusTimerRef.current !== undefined
    ) return
    readerFocusTimerRef.current = setTimeout(() => {
      readerFocusTimerRef.current = undefined
      activateLane("reader")
    }, swimlane.readerFocusHoverDelayMs)
  }

  function cancelReaderFocus(): void {
    clearTimer(readerFocusTimerRef)
  }

  function scrollLaneIntoView(laneId: ReaderSwimlaneId, reason: "focus" | "preview"): void {
    const viewport = viewportRef.current
    const lane = laneRefs.current[laneId]
    if (!viewport || !lane) return
    const laneStart = lane.offsetLeft
    const laneWidth = lane.offsetWidth
    const laneEnd = laneStart + laneWidth
    const viewStart = viewport.scrollLeft
    const viewEnd = viewStart + viewport.clientWidth
    let target = viewStart
    if (soloLaneId === laneId && reason === "focus") {
      target = laneStart
    } else if (laneWidth > viewport.clientWidth) {
      const soloLane = soloLaneId ? laneRefs.current[soloLaneId] : undefined
      const soloIndex = soloLaneId ? swimlane.laneOrder.indexOf(soloLaneId) : -1
      const laneIndex = swimlane.laneOrder.indexOf(laneId)
      if (soloLane && laneId !== soloLaneId && laneIndex > soloIndex) target = laneStart - READER_RETURN_EDGE
      else if (soloLane && laneId !== soloLaneId && laneIndex < soloIndex) target = laneEnd - viewport.clientWidth + READER_RETURN_EDGE
      else target = laneStart
    } else if (laneStart < viewStart) {
      target = laneStart
    } else if (laneEnd > viewEnd) {
      target = laneEnd - viewport.clientWidth
    }
    scrollViewport(viewport, Math.max(0, target))
  }

  function resizeLane(laneId: ReaderSwimlaneId, deltaRatio: number): void {
    if (soloLaneId === laneId) return
    const minimum = laneId === "reader" ? viewportWidth * MIN_READER_WIDTH_RATIO : 240
    const maximum = laneId === "reader" ? viewportWidth * MAX_READER_WIDTH_RATIO : 8_192
    const next = clamp(liveWidthsRef.current[laneId] + deltaRatio * 320, minimum, maximum)
    liveWidthsRef.current[laneId] = next
    const lane = laneRefs.current[laneId]
    if (lane) lane.style.width = `${next}px`
  }

  function resizeLaneFromStart(laneId: ReaderSwimlaneId, deltaRatio: number): void {
    resizeLane(laneId, -deltaRatio)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollLeft = Math.max(0, viewport.scrollLeft - deltaRatio * 320)
  }

  function commitLaneWidth(laneId: ReaderSwimlaneId): void {
    const next = Math.round(liveWidthsRef.current[laneId])
    if (laneId === "reader") {
      const readerWidthRatio = clamp(next / viewportWidth, MIN_READER_WIDTH_RATIO, MAX_READER_WIDTH_RATIO)
      if (readerWidthRatio !== swimlane.readerWidthRatio || next !== swimlane.lanes.reader.width) {
        onWorkspaceChange({ readerWidthRatio, lanes: { reader: { width: next } } })
      }
      return
    }
    if (next !== swimlane.lanes[laneId].width) onWorkspaceChange({ lanes: { [laneId]: { width: next } } })
  }

  function fitLanesToViewport(): void {
    clearTimer(revealTimerRef)
    clearTimer(restoreTimerRef)
    clearTimer(readerFocusTimerRef)
    setPreviewLane(undefined)
    const measuredWidth = viewportRef.current?.getBoundingClientRect().width || viewportRef.current?.clientWidth || window.innerWidth
    onWorkspaceChange(fitReaderSwimlanesToViewport(measuredWidth, swimlane))
  }

  function addLane(title: string): void {
    const existing = new Set(swimlane.laneOrder)
    const base = `lane-${Date.now().toString(36)}`
    let laneId = base
    let suffix = 2
    while (existing.has(laneId)) laneId = `${base}-${suffix++}`
    onWorkspaceChange({
      laneOrder: [...swimlane.laneOrder, laneId],
      activeLane: laneId,
      lanes: { [laneId]: { width: 320, collapsed: false, title } },
    })
  }

  function removeLane(laneId: ReaderSwimlaneId): void {
    if (laneId === "left" || laneId === "reader" || laneId === "right") return
    const laneOrder = swimlane.laneOrder.filter((candidate) => candidate !== laneId)
    onWorkspaceChange({ laneOrder, activeLane: swimlane.activeLane === laneId ? "reader" : swimlane.activeLane })
  }

  function commitExplicitLaneWidth(laneId: ReaderSwimlaneId, requestedWidth: number): void {
    const minimum = laneId === "reader" ? viewportWidth * MIN_READER_WIDTH_RATIO : 240
    const maximum = laneId === "reader" ? viewportWidth * MAX_READER_WIDTH_RATIO : 8_192
    const next = Math.round(clamp(requestedWidth, minimum, maximum))
    liveWidthsRef.current[laneId] = next
    if (laneId === "reader") {
      onWorkspaceChange({
        readerWidthRatio: clamp(next / viewportWidth, MIN_READER_WIDTH_RATIO, MAX_READER_WIDTH_RATIO),
        lanes: { reader: { width: next } },
      })
      return
    }
    onWorkspaceChange({ lanes: { [laneId]: { width: next } } })
  }

  function beginPan(event: ReactPointerEvent<HTMLElement>): void {
    if (disabled || event.button !== 0 || event.target instanceof Element && event.target.closest("button,[role='separator'],input,textarea,select,a")) return
    const viewport = viewportRef.current
    if (!viewport) return
    cancelReaderFocus()
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePan(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = panGestureRef.current
    const viewport = viewportRef.current
    if (!gesture || !viewport || gesture.pointerId !== event.pointerId) return
    const delta = event.clientX - gesture.startX
    if (Math.abs(delta) > 6) gesture.moved = true
    if (!gesture.moved) return
    viewport.scrollLeft = gesture.startScrollLeft - delta
    event.preventDefault()
  }

  function endPan(event: ReactPointerEvent<HTMLElement>, laneId: ReaderSwimlaneId): void {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    panGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!gesture.moved) activateLane(laneId)
  }

  function renderLane(laneId: ReaderSwimlaneId): ReactNode {
    const lane = swimlane.lanes[laneId] ?? { width: 320, collapsed: false }
    const active = swimlane.activeLane === laneId
    const solo = soloLaneId === laneId
    const collapsed = lane.collapsed && !solo
    const effectiveWidth = effectiveSwimlaneWidth(
      laneId === "reader" ? readerNormalWidth : lane.width,
      collapsed,
      laneId,
      { laneOrder: swimlane.laneOrder, activeLaneId: swimlane.activeLane, soloLaneId },
      viewportWidth,
      COLLAPSED_WIDTH,
    )
    const content = laneId === "left" ? left : laneId === "right" ? right : laneId === "reader"
      ? reader
      : <div className="grid h-full place-items-center text-muted-foreground/50"><Columns3 className="size-5" /></div>
    return (
      <ReaderSwimlane
        key={laneId}
        laneId={laneId}
        label={lane.title ?? DEFAULT_LANE_LABELS[laneId] ?? laneId}
        hideLabel={(laneId !== "reader" && lane.panelBarMode !== "floating" && lane.panelBarDock === "top") || (laneId === "reader" && swimlane.laneNavigatorDock === "reader-title")}
        active={active}
        collapsed={collapsed}
        width={effectiveWidth}
        solo={solo}
        resizable={!solo}
        dragged={draggedLane === laneId}
        setRef={(node) => { laneRefs.current[laneId] = node }}
        onActivate={() => activateLane(laneId)}
        onSoloChange={() => onWorkspaceChange(solo
          ? (laneId === "reader" ? { readerSolo: false, soloLaneId: null } : { soloLaneId: null })
          : laneId === "reader"
            ? { activeLane: "reader", readerSolo: true, soloLaneId: null, lanes: { reader: { collapsed: false } } }
            : { activeLane: laneId, soloLaneId: laneId, lanes: { [laneId]: { collapsed: false } } })}
        onCollapsedChange={(next) => onWorkspaceChange({ lanes: { [laneId]: { collapsed: next } } })}
        configuredWidth={laneId === "reader" ? readerNormalWidth : lane.width}
        minimumWidth={laneId === "reader" ? Math.round(viewportWidth * MIN_READER_WIDTH_RATIO) : 240}
        maximumWidth={laneId === "reader" ? Math.round(viewportWidth * MAX_READER_WIDTH_RATIO) : 8_192}
        onWidthCommit={(width) => commitExplicitLaneWidth(laneId, width)}
        onResetWidth={() => commitExplicitLaneWidth(laneId, laneId === "reader" ? viewportWidth * 0.5 : DEFAULT_LANE_WIDTHS[laneId] ?? 320)}
        onOpenSettings={laneId === "reader" ? onOpenSettings : undefined}
        setNavigatorTitleHost={laneId === "reader" ? setLaneNavigatorTitleHost : undefined}
        onResize={(deltaRatio) => resizeLane(laneId, deltaRatio)}
        onResizeFromStart={(deltaRatio) => resizeLaneFromStart(laneId, deltaRatio)}
        onResizeEnd={() => commitLaneWidth(laneId)}
        onHeaderPointerDown={beginPan}
        onHeaderPointerMove={movePan}
        onHeaderPointerUp={(event) => endPan(event, laneId)}
        onDragStart={() => setDraggedLane(laneId)}
        onDragEnd={() => setDraggedLane(undefined)}
        onDrop={() => {
          if (!draggedLane || draggedLane === laneId) return
          onWorkspaceChange({ laneOrder: reorderedReaderLanes(swimlane.laneOrder, draggedLane, laneId) })
          setDraggedLane(undefined)
        }}
        onPointerEnter={() => {
          if (previewLane === laneId) cancelPreviewRestore()
          if (laneId === "reader") scheduleReaderFocus()
        }}
        onPointerLeave={() => {
          if (previewLane === laneId) schedulePreviewRestore()
          if (laneId === "reader") cancelReaderFocus()
        }}
        onPanelPointerDown={laneId === "reader" ? undefined : () => activateLane(laneId)}
        onPanelWheel={laneId === "reader" ? undefined : () => activateLane(laneId)}
        onReaderPointerDownCapture={laneId === "reader" ? (event) => {
          cancelReaderFocus()
          if (isReaderShellTarget(event.target)) return
          if (swimlane.activeLane === "reader") return
          readerRestorePointerRef.current = event.pointerId
          event.preventDefault()
          event.stopPropagation()
          activateLane("reader")
        } : undefined}
        onReaderPointerUpCapture={laneId === "reader" ? (event) => {
          if (readerRestorePointerRef.current !== event.pointerId) return
          event.preventDefault()
          event.stopPropagation()
        } : undefined}
        onReaderPointerCancelCapture={laneId === "reader" ? (event) => {
          if (readerRestorePointerRef.current !== event.pointerId) return
          readerRestorePointerRef.current = undefined
          event.stopPropagation()
        } : undefined}
        onReaderClickCapture={laneId === "reader" ? (event) => {
          if (isReaderShellTarget(event.target)) return
          if (readerRestorePointerRef.current === undefined) {
            if (swimlane.activeLane === "reader") return
            event.preventDefault()
            event.stopPropagation()
            activateLane("reader")
            return
          }
          readerRestorePointerRef.current = undefined
          event.preventDefault()
          event.stopPropagation()
        } : undefined}
      >
        {content}
      </ReaderSwimlane>
    )
  }

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-background"
      data-neoview-workspace-mode="swimlane"
      data-reader-swimlane-preview={previewLane}
      data-input-context="shell"
    >
      <div
        ref={viewportRef}
        className="h-full min-h-0 w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-reader-swimlane-viewport="true"
      >
        <div className="flex h-full min-w-max items-stretch" data-reader-swimlane-strip="true">
          {swimlane.laneOrder.map(renderLane)}
        </div>
      </div>
      {revealTriggersEnabled && adjacentSwimlane(swimlane.laneOrder, soloLaneId, "left") ? (
        <div
          aria-hidden="true"
          className="absolute z-40 cursor-w-resize"
          style={revealZoneStyle(swimlane.edgeRevealZones.left)}
          data-reader-swimlane-trigger="left"
          onPointerEnter={() => scheduleReveal("left")}
          onPointerLeave={schedulePreviewRestore}
        />
      ) : null}
      {revealTriggersEnabled && adjacentSwimlane(swimlane.laneOrder, soloLaneId, "right") ? (
        <div
          aria-hidden="true"
          className="absolute z-40 cursor-e-resize"
          style={revealZoneStyle(swimlane.edgeRevealZones.right)}
          data-reader-swimlane-trigger="right"
          onPointerEnter={() => scheduleReveal("right")}
          onPointerLeave={schedulePreviewRestore}
        />
      ) : null}
      {!soloLaneId || swimlane.showLaneNavigatorInReaderSolo ? (
        <ReaderLaneNavigator
          lanes={swimlane.laneOrder.map((laneId) => ({ id: laneId, title: swimlane.lanes[laneId]?.title ?? DEFAULT_LANE_LABELS[laneId] ?? laneId }))}
          activeLane={swimlane.activeLane}
          showInReaderSolo={swimlane.showLaneNavigatorInReaderSolo}
          handleStyle={swimlane.barHandleStyle}
          handlePosition={swimlane.barHandlePosition}
          positionX={swimlane.laneNavigatorPositionX}
          positionY={swimlane.laneNavigatorPositionY}
          dock={swimlane.laneNavigatorDock}
          titleHost={laneNavigatorTitleHost}
          onSelect={activateLane}
          onAdd={addLane}
          onRemove={removeLane}
          onFit={fitLanesToViewport}
          onShowInReaderSoloChange={(enabled) => onWorkspaceChange({ showLaneNavigatorInReaderSolo: enabled })}
          onPositionChange={({ x, y }) => onWorkspaceChange({ laneNavigatorPositionX: x, laneNavigatorPositionY: y })}
          onDockChange={(dock) => onWorkspaceChange({ laneNavigatorDock: dock })}
        />
      ) : null}
    </div>
  )
}

interface ReaderSwimlaneProps {
  laneId: ReaderSwimlaneId
  label: string
  hideLabel: boolean
  active: boolean
  collapsed: boolean
  width: number
  configuredWidth: number
  minimumWidth: number
  maximumWidth: number
  solo: boolean
  resizable: boolean
  dragged: boolean
  children: ReactNode
  setRef(node: HTMLElement | null): void
  onActivate(): void
  onSoloChange(): void
  onCollapsedChange?(collapsed: boolean): void
  onWidthCommit(width: number): void
  onResetWidth(): void
  onOpenSettings?(): void
  setNavigatorTitleHost?(node: HTMLElement | null): void
  onResize(deltaRatio: number): void
  onResizeFromStart(deltaRatio: number): void
  onResizeEnd(): void
  onHeaderPointerDown(event: ReactPointerEvent<HTMLElement>): void
  onHeaderPointerMove(event: ReactPointerEvent<HTMLElement>): void
  onHeaderPointerUp(event: ReactPointerEvent<HTMLElement>): void
  onDragStart(): void
  onDragEnd(): void
  onDrop(): void
  onPointerEnter(): void
  onPointerLeave(): void
  onPanelPointerDown?(): void
  onPanelWheel?(): void
  onReaderPointerDownCapture?(event: ReactPointerEvent<HTMLElement>): void
  onReaderPointerUpCapture?(event: ReactPointerEvent<HTMLElement>): void
  onReaderPointerCancelCapture?(event: ReactPointerEvent<HTMLElement>): void
  onReaderClickCapture?(event: ReactPointerEvent<HTMLElement>): void
}

function ReaderSwimlane({
  laneId,
  label,
  hideLabel,
  active,
  collapsed,
  width,
  configuredWidth,
  minimumWidth,
  maximumWidth,
  solo,
  resizable,
  dragged,
  children,
  setRef,
  onActivate,
  onSoloChange,
  onCollapsedChange,
  onWidthCommit,
  onResetWidth,
  onOpenSettings,
  setNavigatorTitleHost,
  onResize,
  onResizeFromStart,
  onResizeEnd,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onDragStart,
  onDragEnd,
  onDrop,
  onPointerEnter,
  onPointerLeave,
  onPanelPointerDown,
  onPanelWheel,
  onReaderPointerDownCapture,
  onReaderPointerUpCapture,
  onReaderPointerCancelCapture,
  onReaderClickCapture,
}: ReaderSwimlaneProps) {
  const Icon = laneId === "left" ? PanelLeft : laneId === "right" ? PanelRight : laneId === "reader" ? BookOpen : Columns3
  const style = { width } satisfies CSSProperties
  const hideHeader = laneId === "reader" && solo
  if (collapsed) {
    return (
      <section
        ref={setRef}
        style={style}
        className={cn(
          "flex h-full shrink-0 flex-col items-center gap-2 border-r border-border/55 bg-muted/20 px-1 py-2 transition-colors",
          active && "z-10 bg-primary/12 ring-1 ring-inset ring-primary/55 shadow-[inset_3px_0_0_var(--primary)]",
        )}
        data-reader-swimlane={laneId}
        data-reader-swimlane-active={active ? "true" : "false"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <button
          type="button"
          draggable
          className="grid size-8 cursor-grab place-items-center text-muted-foreground hover:text-foreground hover:[&_[data-lane-handle-default]]:hidden hover:[&_[data-lane-handle-drag]]:block active:cursor-grabbing"
          aria-label={`展开${label}泳道；按住可拖动`}
          onClick={() => { onCollapsedChange?.(false); onActivate() }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <span data-lane-handle-default><LaneCollapseIcon collapsed /></span>
          <GripVertical data-lane-handle-drag className="hidden size-3.5" />
        </button>
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[10px] font-medium text-muted-foreground" style={{ writingMode: "vertical-rl" }}>{label}</span>
      </section>
    )
  }
  const stopPanelPointer = (event: ReactPointerEvent<HTMLElement>) => {
    onPanelPointerDown?.()
    event.stopPropagation()
  }
  const stopPanelWheel = (event: ReactWheelEvent<HTMLElement>) => {
    onPanelWheel?.()
    event.stopPropagation()
  }
  return (
    <section
      ref={setRef}
      style={style}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r border-border/55 bg-card/45 transition-[background-color,box-shadow] duration-150",
        active && "z-10 bg-card/70 ring-1 ring-inset ring-primary/55 shadow-[inset_0_3px_0_var(--primary),0_8px_24px_rgb(0_0_0/0.14)]",
        dragged && "opacity-55",
      )}
      data-reader-swimlane={laneId}
      data-reader-swimlane-active={active ? "true" : "false"}
      data-reader-swimlane-solo={solo ? "true" : undefined}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDownCapture={onReaderPointerDownCapture}
      onPointerUpCapture={onReaderPointerUpCapture}
      onPointerCancelCapture={onReaderPointerCancelCapture}
      onClickCapture={onReaderClickCapture}
      onPointerDown={laneId === "reader" ? undefined : stopPanelPointer}
      onPointerUp={laneId === "reader" ? undefined : (event) => event.stopPropagation()}
      onPointerCancel={laneId === "reader" ? undefined : (event) => event.stopPropagation()}
      onWheel={laneId === "reader" ? undefined : stopPanelWheel}
      onContextMenu={laneId === "reader" ? undefined : (event) => event.stopPropagation()}
      onFocusCapture={laneId === "reader" ? undefined : onActivate}
      data-input-context={laneId === "reader" ? "reader" : "panel"}
      tabIndex={laneId === "reader" ? undefined : -1}
    >
      {hideHeader ? null : <header
        className={cn(
          "flex h-8 shrink-0 select-none items-center gap-1.5 border-b border-border/45 px-2",
          active
            ? "bg-primary/12 text-foreground"
            : laneId === "reader" ? "bg-black/80 text-white" : "bg-muted/25",
        )}
        data-reader-swimlane-header={laneId}
        data-input-context="shell"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <button
          type="button"
          draggable
          className={cn("grid size-6 shrink-0 cursor-grab place-items-center text-muted-foreground hover:text-foreground hover:[&_[data-lane-handle-default]]:hidden hover:[&_[data-lane-handle-drag]]:block active:cursor-grabbing", active && "text-primary")}
          aria-label={onCollapsedChange ? `折叠${label}泳道；按住可拖动` : `拖动${label}泳道`}
          onClick={onCollapsedChange ? () => onCollapsedChange(true) : undefined}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <span data-lane-handle-default>{onCollapsedChange ? <LaneCollapseIcon collapsed={false} /> : <Icon className="size-3.5 opacity-70" aria-hidden="true" />}</span>
          <GripVertical data-lane-handle-drag className="hidden size-3.5" />
        </button>
        {hideLabel ? null : <span className={cn("min-w-0 shrink truncate text-[11px] font-semibold text-muted-foreground", active && "text-foreground")}>{label}</span>}
        {laneId === "reader"
          ? <div ref={setNavigatorTitleHost} className="min-w-0 flex-1 overflow-visible" data-reader-lane-navigator-title-slot="true" />
          : <div className="min-w-0 flex-1 overflow-visible" data-reader-panel-bar-title-slot={laneId} />}
        <div className="ml-auto flex shrink-0 items-center gap-0.5" data-reader-swimlane-actions={laneId}>
          {solo ? <span className="mr-1 size-1.5 rounded-full bg-primary" title={`${label}全屏已开启`} /> : null}
          <ReaderLaneMoreMenu
            laneId={laneId}
            label={label}
            width={configuredWidth}
            minimumWidth={minimumWidth}
            maximumWidth={maximumWidth}
            collapsed={collapsed}
            solo={solo}
            onSoloChange={onSoloChange}
            onCollapsedChange={onCollapsedChange}
            onWidthCommit={onWidthCommit}
            onResetWidth={onResetWidth}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </header>}
      <div className="min-h-0 flex-1 overflow-hidden" data-reader-swimlane-content={laneId}>{children}</div>
      {resizable ? (
        <>
          <LaneResizer
            label={`从左侧调整${label}泳道宽度`}
            edge="start"
            className="absolute inset-y-0 left-0 z-30 w-2"
            onResize={onResizeFromStart}
            onResizeEnd={onResizeEnd}
          />
          <LaneResizer
            label={`从右侧调整${label}泳道宽度`}
            edge="end"
            className="absolute inset-y-0 right-0 z-30 w-2"
            onResize={onResize}
            onResizeEnd={onResizeEnd}
          />
        </>
      ) : null}
    </section>
  )
}

function ReaderLaneMoreMenu({
  laneId,
  label,
  width,
  minimumWidth,
  maximumWidth,
  collapsed,
  solo,
  onSoloChange,
  onCollapsedChange,
  onWidthCommit,
  onResetWidth,
  onOpenSettings,
}: {
  laneId: ReaderSwimlaneId
  label: string
  width: number
  minimumWidth: number
  maximumWidth: number
  collapsed: boolean
  solo: boolean
  onSoloChange(): void
  onCollapsedChange?(collapsed: boolean): void
  onWidthCommit(width: number): void
  onResetWidth(): void
  onOpenSettings?(): void
}) {
  const [widthDraft, setWidthDraft] = useState(() => String(Math.round(width)))

  useEffect(() => setWidthDraft(String(Math.round(width))), [width])

  function commitWidth(): void {
    const parsed = Number(widthDraft)
    const next = Number.isFinite(parsed) ? Math.round(clamp(parsed, minimumWidth, maximumWidth)) : Math.round(width)
    setWidthDraft(String(next))
    if (next !== Math.round(width)) onWidthCommit(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" aria-label={`${label}更多设置`}>
          <Ellipsis className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-reader-lane-menu={laneId} onPointerDown={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}设置</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onSoloChange}>
          {solo ? <Minimize2 /> : <Maximize2 />}
          {solo ? "退出全屏" : "当前泳道全屏"}
        </DropdownMenuItem>
        {laneId === "reader" && onOpenSettings ? <DropdownMenuItem onSelect={onOpenSettings}><Settings2 />打开 NeoView 设置</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="grid gap-1.5 font-normal">
          <span className="text-xs text-muted-foreground">常规宽度</span>
          <div className="flex items-center gap-2">
            <Input
              aria-label={`${label}宽度`}
              className="h-8 tabular-nums"
              type="number"
              min={minimumWidth}
              max={maximumWidth}
              value={widthDraft}
              onChange={(event) => setWidthDraft(event.currentTarget.value)}
              onBlur={commitWidth}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
                if (event.key === "Escape") setWidthDraft(String(Math.round(width)))
              }}
            />
            <span className="text-xs text-muted-foreground">px</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onResetWidth}><RotateCcw />恢复默认宽度</DropdownMenuItem>
        {onCollapsedChange ? <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={collapsed} onCheckedChange={(checked) => onCollapsedChange(checked === true)}>折叠泳道</DropdownMenuCheckboxItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | undefined }): void {
  if (ref.current === undefined) return
  clearTimeout(ref.current)
  ref.current = undefined
}

function scrollViewport(viewport: HTMLElement, left: number): void {
  if (typeof viewport.scrollTo === "function") viewport.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" })
  else viewport.scrollLeft = left
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

function isReaderShellTarget(target: EventTarget | null): boolean {
  return target instanceof Element && (
    target.closest("[data-reader-lane-menu]") !== null ||
    target.closest('[data-reader-swimlane="reader"] [data-input-context="shell"]') !== null
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function revealZoneStyle(zone: ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"]["left"]): CSSProperties {
  return {
    left: `${zone.x}%`,
    top: `${zone.y}%`,
    width: `${zone.width}%`,
    height: `${zone.height}%`,
  }
}

export class ReaderSwimlaneErrorBoundary extends Component<{
  children: ReactNode
  resetKey: string
  onReturnToEdges(): void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[neoview-swimlane] workspace render failed", error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid h-full place-items-center bg-background p-6 text-center" role="alert" data-reader-swimlane-error="true">
        <div className="grid max-w-sm justify-items-center gap-3">
          <AlertTriangle className="size-7 text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">泳道工作区无法显示。</p>
          <Button type="button" variant="outline" onClick={this.props.onReturnToEdges}><PanelsTopLeft />返回四边栏</Button>
        </div>
      </div>
    )
  }
}
