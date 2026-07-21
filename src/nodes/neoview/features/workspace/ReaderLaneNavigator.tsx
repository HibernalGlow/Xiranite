import { useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { BookOpen, Columns3, PanelLeft, PanelRight, Pin, PinOff, Plus, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ReaderSwimlaneId } from "../../adapters/reader-http-client"
import { ReaderBarHandleGlyph, type ReaderBarHandlePosition, type ReaderBarHandleStyle } from "../shell/ReaderBarHandleGlyph"

type OpenPanel = "add" | "menu" | undefined

export function ReaderLaneNavigator({
  lanes,
  activeLane,
  showInReaderSolo,
  handleStyle = "grip",
  handlePosition = "left",
  positionX = 92,
  positionY = 96,
  dock = "floating",
  titleHost,
  onSelect,
  onAdd,
  onRemove,
  onFit,
  onShowInReaderSoloChange,
  onPositionChange,
  onDockChange,
}: {
  lanes: readonly { id: ReaderSwimlaneId; title: string }[]
  activeLane: ReaderSwimlaneId
  showInReaderSolo: boolean
  handleStyle?: ReaderBarHandleStyle
  handlePosition?: ReaderBarHandlePosition
  positionX?: number
  positionY?: number
  dock?: "floating" | "reader-title"
  titleHost?: HTMLElement | null
  onSelect(laneId: ReaderSwimlaneId): void
  onAdd(title: string): void
  onRemove(laneId: ReaderSwimlaneId): void
  onFit(): void
  onShowInReaderSoloChange(enabled: boolean): void
  onPositionChange?(position: { x: number; y: number }): void
  onDockChange?(dock: "floating" | "reader-title"): void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<NavigatorDrag>()
  const dockCandidateRef = useRef(false)
  const cleanupDragRef = useRef<(() => void) | undefined>(undefined)
  const [openPanel, setOpenPanel] = useState<OpenPanel>()
  const [title, setTitle] = useState("")
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [livePosition, setLivePosition] = useState<{ left: number; top: number }>()
  const [dockCandidate, setDockCandidate] = useState(false)
  const activeIsCustom = activeLane !== "left" && activeLane !== "reader" && activeLane !== "right"
  const titleMounted = dock === "reader-title" && titleHost !== null && titleHost !== undefined && livePosition === undefined

  useEffect(() => () => cleanupDragRef.current?.(), [])

  useEffect(() => {
    if (!openPanel) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpenPanel(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(undefined)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true)
    document.addEventListener("keydown", closeOnEscape, true)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true)
      document.removeEventListener("keydown", closeOnEscape, true)
    }
  }, [openPanel])

  useEffect(() => {
    if (openPanel === "add") inputRef.current?.focus()
  }, [openPanel])

  function submitLane(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = title.trim()
    if (!normalized) return
    onAdd(normalized)
    setTitle("")
    setOpenPanel(undefined)
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !rootRef.current) return
    const root = rootRef.current
    const host = root.closest<HTMLElement>('[data-neoview-workspace-mode="swimlane"]')
    if (!host) return
    const rect = root.getBoundingClientRect()
    const bounds = host.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      left: rect.left - bounds.left,
      top: rect.top - bounds.top,
      width: rect.width,
      height: rect.height,
      bounds,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    }
    dockCandidateRef.current = false
    setDockCandidate(false)
    setOpenPanel(undefined)
    const move = (pointer: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer.pointerId !== drag.pointerId) return
      if (!drag.moved && Math.hypot(pointer.clientX - drag.startX, pointer.clientY - drag.startY) < 4) return
      drag.moved = true
      const nextBounds = host.getBoundingClientRect()
      drag.bounds = nextBounds
      drag.left = clamp(pointer.clientX - nextBounds.left - drag.offsetX, 0, Math.max(0, nextBounds.width - drag.width))
      drag.top = clamp(pointer.clientY - nextBounds.top - drag.offsetY, 0, Math.max(0, nextBounds.height - drag.height))
      setLivePosition({ left: drag.left, top: drag.top })
      const titleRect = titleHost?.closest("header")?.getBoundingClientRect()
      const nextDockCandidate = Boolean(titleRect && pointer.clientX >= titleRect.left && pointer.clientX <= titleRect.right && pointer.clientY >= titleRect.top && pointer.clientY <= titleRect.bottom)
      dockCandidateRef.current = nextDockCandidate
      setDockCandidate(nextDockCandidate)
      pointer.preventDefault()
    }
    const finish = (pointer?: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer && pointer.pointerId !== drag.pointerId) return
      const droppedOnTitle = dockCandidateRef.current
      cleanupDragRef.current?.()
      cleanupDragRef.current = undefined
      dragRef.current = undefined
      setLivePosition(undefined)
      setDockCandidate(false)
      if (!drag.moved) return
      if (droppedOnTitle) {
        onDockChange?.("reader-title")
        return
      }
      onDockChange?.("floating")
      onPositionChange?.({
        x: percent(drag.left + drag.width, drag.bounds.width),
        y: percent(drag.top + drag.height, drag.bounds.height),
      })
    }
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", finish, true)
      window.removeEventListener("pointercancel", finish, true)
      window.removeEventListener("blur", finish)
    }
    cleanupDragRef.current = cleanup
    window.addEventListener("pointermove", move, { capture: true })
    window.addEventListener("pointerup", finish, { capture: true })
    window.addEventListener("pointercancel", finish, { capture: true })
    window.addEventListener("blur", finish)
    event.preventDefault()
    event.stopPropagation()
  }

  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (openPanel) {
      setOpenPanel(undefined)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPosition({
      left: clamp(rect.right - 224, 6, Math.max(6, window.innerWidth - 230)),
      top: clamp(rect.top - 174, 6, Math.max(6, window.innerHeight - 180)),
    })
    setOpenPanel("menu")
  }

  const handle = <button
    type="button"
    title="拖动泳道切换栏；右键打开操作菜单"
    aria-label="拖动或设置泳道切换栏"
    aria-haspopup="menu"
    aria-expanded={Boolean(openPanel)}
    data-reader-bar-handle-style={handleStyle}
    data-reader-bar-handle-position={handlePosition}
    className={cn("grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing", handleStyle === "edge" && "w-3")}
    onPointerDown={startDrag}
    onContextMenu={toggleMenu}
  >
    <ReaderBarHandleGlyph style={handleStyle} horizontal />
  </button>

  const popover = openPanel && typeof document !== "undefined" ? createPortal(
    openPanel === "add" ? <form
      ref={popoverRef as RefObject<HTMLFormElement>}
      aria-label="添加泳道"
      className="fixed z-[200] flex w-64 gap-1 rounded-md border border-border bg-popover p-1 shadow-xl"
      style={menuPosition}
      onSubmit={submitLane}
    >
      <input ref={inputRef} aria-label="泳道名称" maxLength={80} className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
      <button type="submit" aria-label="确认添加泳道" className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" /></button>
    </form> : <div ref={popoverRef as RefObject<HTMLDivElement>} role="menu" aria-label="泳道切换栏设置" className="fixed z-[200] grid w-56 gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={menuPosition}>
      <MenuButton label="添加泳道" onClick={() => setOpenPanel("add")}><Plus className="size-3.5" /></MenuButton>
      <MenuButton label="按当前比例填满视口" onClick={() => { onFit(); setOpenPanel(undefined) }}><Columns3 className="size-3.5" /></MenuButton>
      <MenuButton label={dock === "reader-title" ? "改为悬浮" : "固定到 Reader 标题栏"} onClick={() => { onDockChange?.(dock === "reader-title" ? "floating" : "reader-title"); setOpenPanel(undefined) }}>
        {dock === "reader-title" ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </MenuButton>
      <button type="button" role="menuitemcheckbox" aria-checked={showInReaderSolo} className="flex h-8 w-full items-center justify-between gap-4 rounded px-2 text-xs hover:bg-muted" onClick={() => { onShowInReaderSoloChange(!showInReaderSolo); setOpenPanel(undefined) }}>
        <span>Reader 独占时显示</span><span className="text-primary" aria-hidden="true">{showInReaderSolo ? "✓" : ""}</span>
      </button>
      {activeIsCustom ? <MenuButton label="删除当前泳道" destructive onClick={() => { onRemove(activeLane); setOpenPanel(undefined) }}><Trash2 className="size-3.5" /></MenuButton> : null}
    </div>,
    document.body,
  ) : null

  const root = <div
    ref={rootRef}
    className={cn("z-50 max-w-[calc(100vw-1.5rem)]", titleMounted ? "relative w-full" : "absolute")}
    style={titleMounted ? undefined : livePosition ? { left: livePosition.left, top: livePosition.top } : { left: `${positionX}%`, top: `${positionY}%`, transform: "translate(-100%, -100%)" }}
    data-reader-lane-navigator="true"
    data-reader-lane-navigator-dock={titleMounted ? "reader-title" : "floating"}
    data-reader-lane-navigator-dock-candidate={dockCandidate ? "reader-title" : undefined}
    data-input-context="shell"
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
  >
    <nav aria-label="泳道快速切换" className={cn("flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-hidden", titleMounted ? "h-7 w-full bg-transparent p-0" : "h-9 rounded-md border border-border/75 bg-background/90 p-1 shadow-lg backdrop-blur-xl")}>
      {handlePosition === "left" ? handle : null}
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-reader-lane-navigator-scroll="true">
        {lanes.map(({ id, title: laneTitle }) => {
          const Icon = laneIcon(id)
          return <button key={id} type="button" title={`定位${laneTitle}泳道`} aria-label={`定位${laneTitle}泳道`} aria-pressed={activeLane === id} className={cn("grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground", activeLane === id && "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--border)]")} onClick={() => onSelect(id)}><Icon className="size-3.5" /></button>
        })}
      </div>
      {handlePosition === "right" ? handle : null}
    </nav>
    {popover}
  </div>
  return titleMounted ? createPortal(root, titleHost) : root
}

function MenuButton({ label, destructive, children, onClick }: { label: string; destructive?: boolean; children: ReactNode; onClick(): void }) {
  return <button type="button" role="menuitem" className={cn("flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-muted", destructive && "text-destructive")} onClick={onClick}>{children}{label}</button>
}

function laneIcon(laneId: ReaderSwimlaneId) {
  if (laneId === "left") return PanelLeft
  if (laneId === "reader") return BookOpen
  if (laneId === "right") return PanelRight
  return Columns3
}

function percent(value: number, total: number): number {
  return Math.round(clamp(value / Math.max(1, total) * 100, 0, 100) * 100) / 100
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

interface NavigatorDrag {
  pointerId: number
  offsetX: number
  offsetY: number
  left: number
  top: number
  width: number
  height: number
  bounds: DOMRect
  moved: boolean
  startX: number
  startY: number
}
