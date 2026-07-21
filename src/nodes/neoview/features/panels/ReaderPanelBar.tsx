import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { LockKeyhole, LockKeyholeOpen, PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ReaderSwimlaneLaneDto } from "../../adapters/reader-http-client"
import { ReaderBarHandleGlyph, type ReaderBarHandlePosition, type ReaderBarHandleStyle } from "../shell/ReaderBarHandleGlyph"
import type { ReaderPanelSide } from "./registry"

type PanelBarDock = NonNullable<ReaderSwimlaneLaneDto["panelBarDock"]>
type PanelBarPatch = Pick<ReaderSwimlaneLaneDto, "panelBarMode" | "panelBarDock" | "panelBarPositionX" | "panelBarPositionY" | "panelBarConstrained">

const DOCKS: readonly PanelBarDock[] = ["left", "right", "top", "bottom"]
const DOCK_ICONS = { left: PanelLeft, right: PanelRight, top: PanelTop, bottom: PanelBottom } as const
const DOCK_THRESHOLD = 64

export function ReaderPanelBar({ side, lane, children, owner, handleStyle = "grip", handlePosition = "left", setRailRef, onChange }: {
  side: ReaderPanelSide
  lane: ReaderSwimlaneLaneDto
  children: ReactNode
  owner: HTMLElement | null
  handleStyle?: ReaderBarHandleStyle
  handlePosition?: ReaderBarHandlePosition
  setRailRef(node: HTMLElement | null): void
  onChange(patch: Partial<PanelBarPatch>): void
}) {
  const barRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const cleanupDragRef = useRef<(() => void) | undefined>(undefined)
  const dragRef = useRef<DragSession | undefined>(undefined)
  const candidateRef = useRef<PanelBarDock>()
  const [dragging, setDragging] = useState(false)
  const [candidate, setCandidate] = useState<PanelBarDock>()
  const [livePosition, setLivePosition] = useState<{ left: number; top: number }>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [laneHost, setLaneHost] = useState<HTMLElement | null>(null)
  const [titleHost, setTitleHost] = useState<HTMLElement | null>(null)
  const mode = lane.panelBarMode === "floating" ? "floating" : "pinned"
  const dock = normalizeDock(lane.panelBarDock, side)
  const constrained = lane.panelBarConstrained !== false
  const horizontal = dock === "top" || dock === "bottom"
  const titleMounted = mode === "pinned" && dock === "top" && !dragging && titleHost !== null

  useLayoutEffect(() => {
    const nextLaneHost = owner?.closest<HTMLElement>("[data-reader-swimlane]") ?? null
    setLaneHost(nextLaneHost)
    setTitleHost(nextLaneHost?.querySelector<HTMLElement>(`[data-reader-panel-bar-title-slot="${side}"]`) ?? null)
  }, [owner, side])

  useEffect(() => () => cleanupDragRef.current?.(), [])

  useEffect(() => {
    if (!menuOpen) return
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!barRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeFromPointer, true)
    document.addEventListener("keydown", closeFromKeyboard, true)
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer, true)
      document.removeEventListener("keydown", closeFromKeyboard, true)
    }
  }, [menuOpen])

  function setBarRef(node: HTMLElement | null) {
    barRef.current = node
    setRailRef(node)
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const bar = barRef.current
    const host = owner
    if (!bar || !host) return
    cleanupDragRef.current?.()
    const barRect = bar.getBoundingClientRect()
    const bounds = constrained ? host.getBoundingClientRect() : viewportRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - barRect.left,
      offsetY: event.clientY - barRect.top,
      bounds,
      width: barRect.width,
      height: barRect.height,
      left: barRect.left - bounds.left,
      top: barRect.top - bounds.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    }
    candidateRef.current = undefined
    setCandidate(undefined)
    setMenuOpen(false)

    const move = (pointer: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer.pointerId !== drag.pointerId) return
      if (!drag.moved && Math.hypot(pointer.clientX - drag.startClientX, pointer.clientY - drag.startClientY) < 4) return
      if (!drag.moved) {
        drag.moved = true
        setLivePosition({ left: drag.left, top: drag.top })
        setDragging(true)
      }
      const nextBounds = constrained ? host.getBoundingClientRect() : viewportRect()
      drag.bounds = nextBounds
      const left = clamp(pointer.clientX - nextBounds.left - drag.offsetX, 0, Math.max(0, nextBounds.width - drag.width))
      const top = clamp(pointer.clientY - nextBounds.top - drag.offsetY, 0, Math.max(0, nextBounds.height - drag.height))
      drag.left = left
      drag.top = top
      setLivePosition({ left, top })
      const nextCandidate = dockCandidate((laneHost ?? host).getBoundingClientRect(), pointer.clientX, pointer.clientY)
      candidateRef.current = nextCandidate
      setCandidate(nextCandidate)
      pointer.preventDefault()
    }
    const finish = (pointer?: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer && pointer.pointerId !== drag.pointerId) return
      const droppedDock = candidateRef.current
      cleanupDragRef.current?.()
      cleanupDragRef.current = undefined
      dragRef.current = undefined
      setDragging(false)
      setCandidate(undefined)
      setLivePosition(undefined)
      if (!drag.moved) return
      if (droppedDock) {
        onChange({ panelBarMode: "pinned", panelBarDock: droppedDock })
      } else {
        onChange({
          panelBarMode: "floating",
          panelBarPositionX: percent(drag.left + drag.width / 2, drag.bounds.width),
          panelBarPositionY: percent(drag.top + drag.height / 2, drag.bounds.height),
        })
      }
      candidateRef.current = undefined
    }
    const blur = () => finish()
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", finish, true)
      window.removeEventListener("pointercancel", finish, true)
      window.removeEventListener("blur", blur)
    }
    cleanupDragRef.current = cleanup
    window.addEventListener("pointermove", move, { capture: true })
    window.addEventListener("pointerup", finish, { capture: true })
    window.addEventListener("pointercancel", finish, { capture: true })
    window.addEventListener("blur", blur)
    event.preventDefault()
      event.stopPropagation()
  }

  function openSettingsMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 176
    const menuHeight = 72
    const preferredLeft = horizontal ? rect.left : side === "left" ? rect.right + 6 : rect.left - menuWidth - 6
    const preferredTop = horizontal ? rect.bottom + 6 : rect.top
    setMenuPosition({
      left: clamp(preferredLeft, 6, Math.max(6, window.innerWidth - menuWidth - 6)),
      top: clamp(preferredTop, 6, Math.max(6, window.innerHeight - menuHeight - 6)),
    })
    setMenuOpen(true)
  }

  function changeFromMenu(patch: Partial<PanelBarPatch>) {
    setMenuOpen(false)
    onChange(patch)
  }

  const handle = <button
    type="button"
    title="拖动面板操作栏；右键打开固定与范围设置"
    aria-label="拖动或设置面板操作栏"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    data-reader-bar-handle-style={handleStyle}
    data-reader-bar-handle-position={handlePosition}
    className={cn("grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing", handleStyle === "edge" && "w-3")}
    onPointerDown={startDrag}
    onContextMenu={openSettingsMenu}
  >
    <ReaderBarHandleGlyph style={handleStyle} horizontal={horizontal} />
  </button>

  const bar = (
    <nav
      ref={setBarRef}
      aria-label={`${side === "left" ? "左" : "右"}泳道面板操作栏`}
      data-reader-panel-bar={side}
      data-reader-panel-bar-mode={dragging ? "dragging" : mode}
      data-reader-panel-bar-dock={mode === "pinned" && !dragging ? dock : undefined}
      data-reader-panel-bar-constrained={constrained ? "true" : "false"}
      className={cn(
        "relative z-40 flex max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] items-center gap-1 overflow-hidden",
        titleMounted
          ? "h-7 w-full max-w-full flex-row gap-0 bg-transparent p-0 shadow-none [&_[data-reader-panel-bar-tab]]:size-7 [&_[data-reader-panel-bar-tab]]:rounded-sm [&_[data-reader-panel-bar-tab]]:shadow-none"
          : "rounded-md border border-border/70 bg-background/90 p-1 shadow-lg backdrop-blur-xl",
        horizontal ? "flex-row" : "flex-col",
        !titleMounted && (dragging || mode === "floating" ? (constrained ? "absolute" : "fixed z-[120]") : "absolute"),
      )}
      style={barStyle({ dock, dragging, lane, livePosition, mode, titleMounted })}
      onPointerDown={titleMounted ? (event) => event.stopPropagation() : undefined}
    >
      {handlePosition === "left" ? handle : null}
      <div className={cn("flex min-h-0 min-w-0 flex-1 gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", horizontal ? "flex-row overflow-x-auto overflow-y-hidden" : "flex-col overflow-x-hidden overflow-y-auto")}>
        {children}
      </div>
      {handlePosition === "right" ? handle : null}
    </nav>
  )

  const settingsMenu = menuOpen && typeof document !== "undefined" ? createPortal(<div
    ref={menuRef}
    role="menu"
    aria-label="面板操作栏设置"
    className="fixed z-[200] grid w-44 gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
    style={menuPosition}
  >
    <button type="button" role="menuitem" className="flex h-8 items-center gap-2 rounded px-2 text-xs hover:bg-muted" onClick={() => changeFromMenu({ panelBarMode: mode === "pinned" ? "floating" : "pinned", panelBarDock: dock })}>
      {mode === "pinned" ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      {mode === "pinned" ? "改为悬浮" : "固定到当前位置"}
    </button>
    <button type="button" role="menuitemcheckbox" aria-checked={constrained} className="flex h-8 items-center gap-2 rounded px-2 text-xs hover:bg-muted" onClick={() => changeFromMenu({ panelBarConstrained: !constrained })}>
      {constrained ? <LockKeyhole className="size-3.5" /> : <LockKeyholeOpen className="size-3.5" />}
      {constrained ? "限制在本泳道" : "允许移出泳道"}
    </button>
  </div>, document.body) : null

  const renderedBar = titleMounted ? createPortal(bar, titleHost) : bar
  const dockZones = dragging ? <PanelBarDockZones active={candidate} /> : null
  return (
    <>
      {dockZones && laneHost ? createPortal(dockZones, laneHost) : dockZones}
      {!titleMounted && !constrained && (mode === "floating" || dragging) && typeof document !== "undefined" ? createPortal(bar, document.body) : renderedBar}
      {settingsMenu}
    </>
  )
}

function PanelBarDockZones({ active }: { active?: PanelBarDock }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-reader-panel-bar-dock-zones="true">
      {DOCKS.map((dock) => {
        const Icon = DOCK_ICONS[dock]
        return (
          <div key={dock} data-reader-panel-bar-dropzone={dock} data-active={active === dock ? "true" : "false"} className={cn("absolute grid place-items-center border-primary/40 bg-primary/10 text-primary transition-colors", dropZoneClass(dock), active === dock && "border-2 bg-primary/25")}>
            <Icon className="size-4" />
          </div>
        )
      })}
    </div>
  )
}

function barStyle({ dock, dragging, lane, livePosition, mode, titleMounted }: {
  dock: PanelBarDock
  dragging: boolean
  lane: ReaderSwimlaneLaneDto
  livePosition?: { left: number; top: number }
  mode: "pinned" | "floating"
  titleMounted: boolean
}): CSSProperties | undefined {
  if (titleMounted) return undefined
  if (dragging && livePosition) return { left: livePosition.left, top: livePosition.top }
  if (mode === "floating") {
    return {
      left: `${lane.panelBarPositionX ?? 50}%`,
      top: `${lane.panelBarPositionY ?? 50}%`,
      transform: "translate(-50%, -50%)",
    }
  }
  if (dock === "left") return { left: 4, top: "50%", transform: "translateY(-50%)" }
  if (dock === "right") return { right: 4, top: "50%", transform: "translateY(-50%)" }
  if (dock === "top") return { left: "50%", top: 4, transform: "translateX(-50%)" }
  return { bottom: 4, left: "50%", transform: "translateX(-50%)" }
}

function dockCandidate(rect: DOMRect, x: number, y: number): PanelBarDock | undefined {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined
  const distances: Array<[PanelBarDock, number]> = [
    ["left", x - rect.left],
    ["right", rect.right - x],
    ["top", y - rect.top],
    ["bottom", rect.bottom - y],
  ]
  const [dock, distance] = distances.toSorted((left, right) => left[1] - right[1])[0]!
  return distance <= DOCK_THRESHOLD ? dock : undefined
}

function normalizeDock(value: ReaderSwimlaneLaneDto["panelBarDock"], side: ReaderPanelSide): PanelBarDock {
  return value && DOCKS.includes(value) ? value : side
}

function dropZoneClass(dock: PanelBarDock): string {
  if (dock === "left") return "inset-y-0 left-0 w-14 border-r"
  if (dock === "right") return "inset-y-0 right-0 w-14 border-l"
  if (dock === "top") return "inset-x-14 top-0 h-14 border-b"
  return "inset-x-14 bottom-0 h-14 border-t"
}

function viewportRect(): DOMRect {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight, x: 0, y: 0, toJSON: () => ({}) }
}

function percent(value: number, total: number): number {
  return Math.round(clamp((value / Math.max(1, total)) * 100, 0, 100) * 100) / 100
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

interface DragSession {
  pointerId: number
  offsetX: number
  offsetY: number
  bounds: DOMRect
  width: number
  height: number
  left: number
  top: number
  startClientX: number
  startClientY: number
  moved: boolean
}
