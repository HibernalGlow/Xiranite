import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { AlertTriangle, BookOpen, Columns3, Ellipsis, Maximize2, Minimize2, PanelLeft, PanelRight, PanelsTopLeft, PanelTopClose, PanelTopOpen, RotateCcw, Scan, Settings2 } from "lucide-react"

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
import { LaneResizer } from "@/components/workspace/lane/LaneResizer"
import { SwimlaneCollapseDragButton } from "@/components/workspace/swimlane/SwimlaneCollapseDragButton"
import { adjacentSwimlane, effectiveSwimlaneWidth } from "@/components/workspace/swimlane/model"
import { cn } from "@/lib/utils"
import type { ReaderShellConfigDto, ReaderSwimlaneId } from "../../adapters/reader-http-client"
import {
  MAX_READER_WIDTH_RATIO,
  MAX_SWIMLANE_WIDTH,
  MIN_PANEL_SWIMLANE_WIDTH,
  MIN_READER_SWIMLANE_WIDTH,
  MIN_READER_WIDTH_RATIO,
  DEFAULT_LANE_NAVIGATOR_POSITION,
  fitReaderSwimlanesToViewport,
  isSwimlaneFitNoOp,
  readerLaneWidth,
  reorderedReaderLanes,
  sanitizeSwimlaneWidth,
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
  readerViewFullscreen?: boolean
  onReaderViewFullscreenChange?(): void
  windowChrome?: {
    controls: ReactNode
    onTitlebarDoubleClick?: MouseEventHandler<HTMLElement>
  }
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
  readerViewFullscreen = false,
  onReaderViewFullscreenChange,
  windowChrome,
  onWorkspaceChange,
  onOpenSettings,
}: ReaderSwimlaneWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
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
  const [windowTitleHost, setWindowTitleHost] = useState<HTMLElement | null>(null)
  const swimlane = workspace.swimlane
  const soloLaneId = swimlane.soloLaneId ?? (swimlane.readerSolo ? "reader" : undefined)
  const windowChromeOwnerLaneId = windowChrome && swimlane.windowControlsPlacement !== "titlebar"
    ? resolveWindowChromeOwner(swimlane.windowControlsOwnerLaneId, swimlane.laneOrder, swimlane.lanes, soloLaneId, swimlane.activeLane)
    : undefined
  const revealTriggersEnabled = soloLaneId !== undefined && swimlane.activeLane === soloLaneId && previewLane === undefined
  const readerNormalWidth = readerLaneWidth(viewportWidth, swimlane.readerWidthRatio)
  const autoFitGeometryKey = swimlane.laneOrder.map((laneId) => `${laneId}:${swimlane.lanes[laneId]?.collapsed === true}`).join("|")

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
    if (swimlane.activeLane !== laneId || (soloLaneId && soloLaneId !== laneId)) {
      onWorkspaceChange({
        activeLane: laneId,
        ...(laneId === "reader" && swimlane.readerSoloOnFocus && !swimlane.readerSolo ? { readerSolo: true } : {}),
        ...(swimlane.soloLaneId && swimlane.soloLaneId !== "reader" && swimlane.soloLaneId !== laneId ? { soloLaneId: null } : {}),
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

  function laneWidthBounds(laneId: ReaderSwimlaneId): { minimum: number; maximum: number } {
    if (laneId === "reader") {
      const minimum = Math.max(MIN_READER_SWIMLANE_WIDTH, Math.round(viewportWidth * MIN_READER_WIDTH_RATIO))
      const maximum = Math.max(minimum, Math.min(MAX_SWIMLANE_WIDTH, Math.round(viewportWidth * MAX_READER_WIDTH_RATIO)))
      return { minimum, maximum }
    }
    return { minimum: MIN_PANEL_SWIMLANE_WIDTH, maximum: MAX_SWIMLANE_WIDTH }
  }

  function resolvedLiveWidth(laneId: ReaderSwimlaneId): number {
    const bounds = laneWidthBounds(laneId)
    const fallback = laneId === "reader"
      ? readerNormalWidth
      : swimlane.lanes[laneId]?.width ?? DEFAULT_LANE_WIDTHS[laneId] ?? 320
    return sanitizeSwimlaneWidth(laneId, liveWidthsRef.current[laneId], bounds.minimum, bounds.maximum, fallback)
  }

  function resizeLaneBoundary(leftLaneId: ReaderSwimlaneId, rightLaneId: ReaderSwimlaneId, deltaRatio: number): void {
    if (soloLaneId === leftLaneId || soloLaneId === rightLaneId) return
    const leftWidth = resolvedLiveWidth(leftLaneId)
    const rightWidth = resolvedLiveWidth(rightLaneId)
    const leftBounds = laneWidthBounds(leftLaneId)
    const rightBounds = laneWidthBounds(rightLaneId)
    const delta = clamp(
      deltaRatio * 320,
      Math.max(leftBounds.minimum - leftWidth, rightWidth - rightBounds.maximum),
      Math.min(leftBounds.maximum - leftWidth, rightWidth - rightBounds.minimum),
    )
    if (!delta) return
    const nextLeft = leftWidth + delta
    const nextRight = rightWidth - delta
    liveWidthsRef.current[leftLaneId] = nextLeft
    liveWidthsRef.current[rightLaneId] = nextRight
    const leftLane = laneRefs.current[leftLaneId]
    const rightLane = laneRefs.current[rightLaneId]
    if (leftLane) leftLane.style.width = `${nextLeft}px`
    if (rightLane) rightLane.style.width = `${nextRight}px`
  }

  function commitLaneWidths(laneIds: readonly ReaderSwimlaneId[]): void {
    const widths = Object.fromEntries(laneIds.map((laneId) => [laneId, resolvedLiveWidth(laneId)])) as Record<ReaderSwimlaneId, number>
    if (swimlane.autoFitToViewport) {
      onWorkspaceChange(fitReaderSwimlanesToViewport(viewportWidth, {
        ...swimlane,
        lanes: {
          ...swimlane.lanes,
          ...Object.fromEntries(laneIds.map((laneId) => [laneId, { ...swimlane.lanes[laneId], width: widths[laneId] }])),
        },
        ...(laneIds.includes("reader") ? { readerWidthRatio: clamp(widths.reader / viewportWidth, MIN_READER_WIDTH_RATIO, MAX_READER_WIDTH_RATIO) } : {}),
      }))
      return
    }
    const changedLaneIds = laneIds.filter((laneId) => widths[laneId] !== swimlane.lanes[laneId].width)
    if (!changedLaneIds.length) return
    const lanes = Object.fromEntries(changedLaneIds.map((laneId) => [laneId, { width: widths[laneId] }]))
    onWorkspaceChange({
      ...(changedLaneIds.includes("reader") ? { readerWidthRatio: clamp(widths.reader / viewportWidth, MIN_READER_WIDTH_RATIO, MAX_READER_WIDTH_RATIO) } : {}),
      lanes,
    })
  }

  function fitLanesToViewport(): void {
    clearTimer(revealTimerRef)
    clearTimer(restoreTimerRef)
    clearTimer(readerFocusTimerRef)
    setPreviewLane(undefined)
    const measuredWidth = viewportRef.current?.getBoundingClientRect().width || viewportRef.current?.clientWidth || window.innerWidth
    // One-shot fit expands every lane, so leave Reader solo if needed.
    onWorkspaceChange({ ...fitReaderSwimlanesToViewport(measuredWidth, swimlane), readerSolo: false })
  }

  // Keep latest swimlane/callback in refs so the auto-fit effect only re-runs on
  // primitive geometry changes — not on every parent re-render (commitWorkspace and
  // readerWorkspaceConfig both produce new identities each time).
  const swimlaneRef = useRef(swimlane)
  const onWorkspaceChangeRef = useRef(onWorkspaceChange)
  swimlaneRef.current = swimlane
  onWorkspaceChangeRef.current = onWorkspaceChange

  useEffect(() => {
    const current = swimlaneRef.current
    if (!current.autoFitToViewport || soloLaneId) return
    const patch = fitReaderSwimlanesToViewport(viewportWidth, current)
    // Unconditional commits rewrite shell every cycle → Maximum update depth.
    if (isSwimlaneFitNoOp(current, patch)) return
    onWorkspaceChangeRef.current(patch)
  }, [autoFitGeometryKey, swimlane.autoFitToViewport, soloLaneId, viewportWidth])

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
    onWorkspaceChange({
      laneOrder,
      activeLane: swimlane.activeLane === laneId ? "reader" : swimlane.activeLane,
      ...(swimlane.windowControlsOwnerLaneId === laneId ? { windowControlsOwnerLaneId: laneOrder.at(-1) ?? "right" } : {}),
    })
  }

  function commitExplicitLaneWidth(laneId: ReaderSwimlaneId, requestedWidth: number): void {
    const bounds = laneWidthBounds(laneId)
    const next = sanitizeSwimlaneWidth(laneId, requestedWidth, bounds.minimum, bounds.maximum)
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
    if (!swimlane.manualScrollEnabled || disabled || event.button !== 0 || event.target instanceof Element && event.target.closest("button,[role='separator'],input,textarea,select,a")) return
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
    const laneIndex = swimlane.laneOrder.indexOf(laneId)
    const nextLaneId = swimlane.laneOrder[laneIndex + 1]
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
        hideHeader={laneId === "reader" && readerViewFullscreen}
        flush={laneId === "reader" && readerViewFullscreen}
        active={active}
        collapsed={collapsed}
        width={effectiveWidth}
        solo={solo}
        resizeBoundaryWith={!readerViewFullscreen && nextLaneId && !solo && soloLaneId !== nextLaneId ? nextLaneId : undefined}
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
        minimumWidth={laneWidthBounds(laneId).minimum}
        maximumWidth={laneWidthBounds(laneId).maximum}
        onWidthCommit={(width) => commitExplicitLaneWidth(laneId, width)}
        onResetWidth={() => commitExplicitLaneWidth(laneId, laneId === "reader" ? viewportWidth * 0.5 : DEFAULT_LANE_WIDTHS[laneId] ?? 320)}
        onResetNavigatorPosition={() => onWorkspaceChange({
          laneNavigatorDock: "floating",
          laneNavigatorPositionX: DEFAULT_LANE_NAVIGATOR_POSITION.x,
          laneNavigatorPositionY: DEFAULT_LANE_NAVIGATOR_POSITION.y,
        })}
        onOpenSettings={laneId === "reader" ? onOpenSettings : undefined}
        readerViewFullscreen={laneId === "reader" ? readerViewFullscreen : undefined}
        onReaderViewFullscreenChange={laneId === "reader" ? onReaderViewFullscreenChange : undefined}
        setNavigatorTitleHost={laneId === "reader" ? setLaneNavigatorTitleHost : undefined}
        windowControlsAvailable={windowChrome !== undefined}
        windowControlsOwner={swimlane.windowControlsPlacement !== "titlebar" && swimlane.windowControlsOwnerLaneId === laneId}
        windowControlsInTitlebar={swimlane.windowControlsPlacement === "titlebar"}
        windowControlsExpanded={swimlane.windowControlsExpanded === true}
        onWindowControlsOwnerChange={(owned) => onWorkspaceChange(owned
          ? { windowControlsPlacement: "lane", windowControlsOwnerLaneId: laneId }
          : { windowControlsPlacement: "titlebar" })}
        onWindowControlsExpandedChange={(windowControlsExpanded) => onWorkspaceChange({ windowControlsExpanded })}
        windowDraggable={windowChrome !== undefined}
        windowChrome={windowChrome && laneId === windowChromeOwnerLaneId ? {
          controls: windowChrome.controls,
          expanded: swimlane.windowControlsExpanded === true,
        } : undefined}
        onTitlebarDoubleClick={windowChrome?.onTitlebarDoubleClick}
        onResizeBoundary={nextLaneId ? (deltaRatio) => resizeLaneBoundary(laneId, nextLaneId, deltaRatio) : undefined}
        onResizeEnd={nextLaneId ? () => commitLaneWidths([laneId, nextLaneId]) : undefined}
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
      ref={workspaceRef}
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      data-neoview-workspace-mode="swimlane"
      data-reader-swimlane-preview={previewLane}
      data-input-context="shell"
    >
      {windowChrome && swimlane.windowControlsPlacement === "titlebar" ? <header
        className="xiranite-app-region-drag flex h-7 shrink-0 select-none items-stretch border-b border-border/55 bg-card/70"
        data-reader-window-titlebar="true"
        data-reader-window-drag-region="true"
        onDoubleClick={windowChrome.onTitlebarDoubleClick}
      >
        <div ref={setWindowTitleHost} className="min-w-0 flex-1 overflow-visible" data-reader-window-titlebar-control-slot="true" />
        <div className="xiranite-app-region-no-drag ml-auto flex shrink-0 items-stretch">
          <ReaderSwimlaneWindowChrome controls={windowChrome.controls} expanded={swimlane.windowControlsExpanded === true} />
        </div>
      </header> : null}
      <div
        ref={viewportRef}
        className={cn(
          "min-h-0 w-full flex-1 overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          swimlane.manualScrollEnabled ? "overflow-x-auto" : "overflow-x-hidden",
        )}
        data-reader-swimlane-viewport="true"
        data-scrollbar="hidden"
        data-reader-manual-scroll={swimlane.manualScrollEnabled ? "enabled" : "disabled"}
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
          readerTitleHost={laneNavigatorTitleHost}
          windowTitleHost={windowTitleHost}
          boundsHost={workspaceRef.current}
          onSelect={activateLane}
          onAdd={addLane}
          onRemove={removeLane}
          onFit={fitLanesToViewport}
          autoFit={swimlane.autoFitToViewport}
          onAutoFitChange={(autoFitToViewport) => {
            if (!autoFitToViewport) {
              onWorkspaceChange({ autoFitToViewport })
              return
            }
            const measuredWidth = viewportRef.current?.getBoundingClientRect().width || viewportWidth
            onWorkspaceChange({
              ...fitReaderSwimlanesToViewport(measuredWidth, swimlane),
              autoFitToViewport,
              readerSolo: false,
            })
          }}
          onHandleStyleChange={(barHandleStyle) => onWorkspaceChange({ barHandleStyle })}
          onHandlePositionChange={(barHandlePosition) => onWorkspaceChange({ barHandlePosition })}
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
  hideHeader?: boolean
  flush?: boolean
  active: boolean
  collapsed: boolean
  width: number
  configuredWidth: number
  minimumWidth: number
  maximumWidth: number
  solo: boolean
  resizeBoundaryWith?: ReaderSwimlaneId
  dragged: boolean
  children: ReactNode
  setRef(node: HTMLElement | null): void
  onActivate(): void
  onSoloChange(): void
  onCollapsedChange?(collapsed: boolean): void
  onWidthCommit(width: number): void
  onResetWidth(): void
  onResetNavigatorPosition(): void
  onOpenSettings?(): void
  readerViewFullscreen?: boolean
  onReaderViewFullscreenChange?(): void
  setNavigatorTitleHost?(node: HTMLElement | null): void
  windowControlsAvailable: boolean
  windowControlsOwner: boolean
  windowControlsInTitlebar: boolean
  windowControlsExpanded: boolean
  onWindowControlsOwnerChange(owned: boolean): void
  onWindowControlsExpandedChange(expanded: boolean): void
  windowDraggable: boolean
  windowChrome?: {
    controls: ReactNode
    expanded: boolean
  }
  onTitlebarDoubleClick?: MouseEventHandler<HTMLElement>
  onResizeBoundary?(deltaRatio: number): void
  onResizeEnd?(): void
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
  hideHeader = false,
  flush = false,
  active,
  collapsed,
  width,
  configuredWidth,
  minimumWidth,
  maximumWidth,
  solo,
  resizeBoundaryWith,
  dragged,
  children,
  setRef,
  onActivate,
  onSoloChange,
  onCollapsedChange,
  onWidthCommit,
  onResetWidth,
  onResetNavigatorPosition,
  onOpenSettings,
  readerViewFullscreen,
  onReaderViewFullscreenChange,
  setNavigatorTitleHost,
  windowControlsAvailable,
  windowControlsOwner,
  windowControlsInTitlebar,
  windowControlsExpanded,
  onWindowControlsOwnerChange,
  onWindowControlsExpandedChange,
  windowDraggable,
  windowChrome,
  onTitlebarDoubleClick,
  onResizeBoundary,
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
  if (collapsed) {
    return (
      <section
        ref={setRef}
        style={style}
        className={cn(
          "flex h-full shrink-0 flex-col items-center gap-2 bg-muted/20 px-1 py-2 transition-colors",
          active && "z-10 bg-primary/12 shadow-[inset_0_3px_0_var(--primary)]",
        )}
        data-reader-swimlane={laneId}
        data-reader-swimlane-active={active ? "true" : "false"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <SwimlaneCollapseDragButton collapsed laneLabel={`${label}泳道`} draggable className="size-8" onClick={() => { onCollapsedChange?.(false); onActivate() }} onDragStart={onDragStart} onDragEnd={onDragEnd} />
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
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-card/45 transition-[background-color,box-shadow] duration-150",
        active && !flush && "z-10 bg-card/70 shadow-[inset_0_3px_0_var(--primary),0_8px_24px_rgb(0_0_0/0.14)]",
        flush && "border-0 bg-background outline-none shadow-none",
        dragged && "opacity-55",
      )}
      style={flush ? { ...style, border: 0, boxShadow: "none", outline: "none" } : style}
      data-reader-swimlane={laneId}
      data-reader-view-fullscreen={flush ? "true" : undefined}
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
      // Do not stopPropagation on contextmenu: ContextMenuProvider listens on
      // window, and File Card entry menus (neoview-folder-entry) need the event
      // to bubble. ReaderApp already has data-context-menu-stop for host isolation.
      onContextMenu={laneId === "reader" ? undefined : () => { onPanelPointerDown?.() }}
      onFocusCapture={laneId === "reader" ? undefined : onActivate}
      data-input-context={laneId === "reader" ? "reader" : "panel"}
      tabIndex={laneId === "reader" ? undefined : -1}
    >
      {hideHeader ? null : <header
        className={cn(
          "flex h-8 shrink-0 select-none items-center gap-1.5 border-b border-border/55 px-2 transition-colors",
          windowDraggable && "xiranite-app-region-drag",
          active
            ? "bg-primary/12 text-foreground"
            : laneId === "reader" ? "text-foreground shadow-[inset_0_-1px_0_var(--border)] backdrop-blur-xl" : "bg-muted/25",
        )}
        style={!active && laneId === "reader" ? { background: "color-mix(in oklch, var(--card) 92%, var(--primary))" } : undefined}
        data-reader-swimlane-header={laneId}
        data-reader-window-drag-region={windowDraggable ? "true" : undefined}
        data-reader-window-controls-owner={windowChrome ? laneId : undefined}
        data-reader-swimlane-header-material={!active && laneId === "reader" ? "reader-muted" : active ? "active" : "panel-muted"}
        data-input-context="shell"
        onDoubleClick={windowDraggable ? onTitlebarDoubleClick : undefined}
        onPointerDown={windowDraggable ? undefined : onHeaderPointerDown}
        onPointerMove={windowDraggable ? undefined : onHeaderPointerMove}
        onPointerUp={windowDraggable ? undefined : onHeaderPointerUp}
        onPointerCancel={windowDraggable ? undefined : onHeaderPointerUp}
      >
        <SwimlaneCollapseDragButton collapsed={false} laneLabel={`${label}泳道`} draggable className={cn("xiranite-app-region-no-drag size-6", active && "text-primary")} onClick={onCollapsedChange ? () => onCollapsedChange(true) : undefined} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        {hideLabel ? null : <span className={cn("min-w-0 shrink truncate text-[11px] font-semibold text-muted-foreground", active && "text-foreground")}>{label}</span>}
        {laneId === "reader"
          ? <div ref={setNavigatorTitleHost} className="min-w-0 flex-1 overflow-visible" data-reader-lane-navigator-title-slot="true" />
          : <div className="min-w-0 flex-1 overflow-visible" data-reader-panel-bar-title-slot={laneId} />}
        <div className="xiranite-app-region-no-drag ml-auto flex shrink-0 items-center gap-0.5" data-reader-swimlane-actions={laneId}>
          {laneId === "reader" && onReaderViewFullscreenChange ? (
            <button
              type="button"
              className={cn(
                "relative grid size-6 place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                readerViewFullscreen && "text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-px after:bg-primary",
              )}
              title={readerViewFullscreen ? "退出 Reader 视图全屏" : "Reader 视图全屏"}
              aria-label={readerViewFullscreen ? "退出 Reader 视图全屏" : "Reader 视图全屏"}
              aria-pressed={readerViewFullscreen}
              data-reader-view-fullscreen-control="true"
              onClick={onReaderViewFullscreenChange}
            >
              <Scan className="size-3.5" />
            </button>
          ) : null}
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
            onResetNavigatorPosition={onResetNavigatorPosition}
            onOpenSettings={onOpenSettings}
            windowControlsAvailable={windowControlsAvailable}
            windowControlsOwner={windowControlsOwner}
            windowControlsInTitlebar={windowControlsInTitlebar}
            windowControlsExpanded={windowControlsExpanded}
            onWindowControlsOwnerChange={onWindowControlsOwnerChange}
            onWindowControlsExpandedChange={onWindowControlsExpandedChange}
          />
          {windowChrome ? <ReaderSwimlaneWindowChrome
            controls={windowChrome.controls}
            expanded={windowChrome.expanded}
          /> : null}
        </div>
      </header>}
      <div className="min-h-0 flex-1 overflow-hidden" data-reader-swimlane-content={laneId}>{children}</div>
      {resizeBoundaryWith ? <LaneResizer
        label={`调整${label}与${DEFAULT_LANE_LABELS[resizeBoundaryWith] ?? resizeBoundaryWith}泳道宽度`}
        edge="end"
        className="absolute inset-y-0 right-0 z-30 w-2"
        onResize={onResizeBoundary}
        onResizeEnd={onResizeEnd}
      /> : null}
    </section>
  )
}

function ReaderSwimlaneWindowChrome({ controls, expanded: pinnedExpanded }: {
  controls: ReactNode
  expanded: boolean
}) {
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const expanded = pinnedExpanded || hoverExpanded
  return (
    <div
      className={cn(
        "relative h-7 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
        expanded ? "w-24" : "w-8",
      )}
      data-reader-swimlane-window-chrome="true"
      data-reader-window-controls-expanded={expanded ? "true" : "false"}
      data-reader-window-controls-pinned={pinnedExpanded ? "true" : "false"}
      onPointerEnter={() => setHoverExpanded(true)}
      onPointerLeave={() => setHoverExpanded(false)}
      onFocusCapture={() => setHoverExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHoverExpanded(false)
      }}
    >
      <div className={cn(
        "absolute right-0 top-0 flex h-7 items-stretch",
        !expanded && "[&_[data-window-caption-button]:not([data-window-control-action='close'])]:hidden",
      )}>
        {controls}
      </div>
    </div>
  )
}

function resolveWindowChromeOwner(
  configuredOwnerLaneId: ReaderSwimlaneId | undefined,
  laneOrder: readonly ReaderSwimlaneId[],
  lanes: ReaderWorkspaceConfig["swimlane"]["lanes"],
  soloLaneId: ReaderSwimlaneId | undefined,
  activeLaneId: ReaderSwimlaneId,
): ReaderSwimlaneId | undefined {
  if (soloLaneId && soloLaneId === activeLaneId && soloLaneId !== "reader") return soloLaneId
  if (configuredOwnerLaneId && laneOrder.includes(configuredOwnerLaneId) && lanes[configuredOwnerLaneId]?.collapsed !== true) return configuredOwnerLaneId
  for (let index = laneOrder.length - 1; index >= 0; index--) {
    const laneId = laneOrder[index]
    if (!laneId || lanes[laneId]?.collapsed === true) continue
    if (laneId === "reader" && soloLaneId === "reader") continue
    return laneId
  }
  return laneOrder[laneOrder.length - 1]
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
  onResetNavigatorPosition,
  onOpenSettings,
  windowControlsAvailable,
  windowControlsOwner,
  windowControlsInTitlebar,
  windowControlsExpanded,
  onWindowControlsOwnerChange,
  onWindowControlsExpandedChange,
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
  onResetNavigatorPosition(): void
  onOpenSettings?(): void
  windowControlsAvailable: boolean
  windowControlsOwner: boolean
  windowControlsInTitlebar: boolean
  windowControlsExpanded: boolean
  onWindowControlsOwnerChange(owned: boolean): void
  onWindowControlsExpandedChange(expanded: boolean): void
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
        {windowControlsAvailable ? <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={windowControlsOwner} onCheckedChange={(checked) => onWindowControlsOwnerChange(checked === true)}>窗口控件归属此泳道</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={windowControlsInTitlebar} onCheckedChange={(checked) => onWindowControlsOwnerChange(checked !== true)}>使用顶部窗口标题栏</DropdownMenuCheckboxItem>
          <DropdownMenuItem onSelect={() => onWindowControlsExpandedChange(!windowControlsExpanded)}>
            {windowControlsExpanded ? <PanelTopClose /> : <PanelTopOpen />}
            {windowControlsExpanded ? "收起窗口按钮" : "展开窗口按钮"}
          </DropdownMenuItem>
        </> : null}
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
        <DropdownMenuItem onSelect={onResetNavigatorPosition}><PanelsTopLeft />重置操作栏位置</DropdownMenuItem>
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
