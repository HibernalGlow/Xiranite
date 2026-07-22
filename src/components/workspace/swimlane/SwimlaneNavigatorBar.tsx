import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Columns3 } from "lucide-react"

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { SwimlaneBarContent } from "./SwimlaneBarContent"
import type { SwimlaneBarHandlePosition, SwimlaneBarHandleStyle, SwimlaneNavigatorDock } from "./model"

export interface SwimlaneNavigatorItem<Id extends string = string> {
  id: Id
  label: string
  icon?: ComponentType<{ className?: string }>
}

export function SwimlaneNavigatorBar<Id extends string>({
  items,
  activeId,
  handleStyle = "grip",
  handlePosition = "left",
  position = { x: 92, y: 94 },
  dock = "floating",
  titleHost,
  boundsHost,
  menu,
  className,
  compactItems = false,
  menuAriaLabel = "泳道操作栏设置",
  onSelect,
  onPositionChange,
  onDockChange,
}: {
  items: readonly SwimlaneNavigatorItem<Id>[]
  activeId: Id
  handleStyle?: SwimlaneBarHandleStyle
  handlePosition?: SwimlaneBarHandlePosition
  position?: { x: number; y: number }
  dock?: SwimlaneNavigatorDock
  titleHost?: HTMLElement | null
  boundsHost?: HTMLElement | null
  menu?: ReactNode
  className?: string
  compactItems?: boolean
  menuAriaLabel?: string
  onSelect(id: Id): void
  onPositionChange?(position: { x: number; y: number }): void
  onDockChange?(dock: SwimlaneNavigatorDock): void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const dragRef = useRef<DragSession>()
  const dockCandidateRef = useRef(false)
  const cleanupDragRef = useRef<(() => void) | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [livePosition, setLivePosition] = useState<{ left: number; top: number }>()
  const [dockCandidate, setDockCandidate] = useState(false)
  const titleMounted = dock === "title" && titleHost != null && livePosition === undefined

  useEffect(() => () => cleanupDragRef.current?.(), [])

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !rootRef.current) return
    const root = rootRef.current
    const host = boundsHost ?? (root.offsetParent instanceof HTMLElement ? root.offsetParent : root.parentElement)
    if (!host) return
    cleanupDragRef.current?.()
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
    setMenuOpen(false)
    const move = (pointer: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer.pointerId !== drag.pointerId) return
      if (!drag.moved && Math.hypot(pointer.clientX - drag.startX, pointer.clientY - drag.startY) < 4) return
      drag.moved = true
      drag.bounds = host.getBoundingClientRect()
      drag.left = clamp(pointer.clientX - drag.bounds.left - drag.offsetX, 0, Math.max(0, drag.bounds.width - drag.width))
      drag.top = clamp(pointer.clientY - drag.bounds.top - drag.offsetY, 0, Math.max(0, drag.bounds.height - drag.height))
      setLivePosition({ left: drag.left, top: drag.top })
      const titleRect = (titleHost?.closest("header") ?? titleHost)?.getBoundingClientRect()
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
        onDockChange?.("title")
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

  function closeMenuFromSecondContextClick(event: React.MouseEvent<HTMLElement>) {
    if (!menuOpen) return
    event.preventDefault()
    event.stopPropagation()
    setMenuOpen(false)
  }

  const root = (
    <ContextMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <nav
        ref={rootRef}
        aria-label="泳道快速切换"
        data-swimlane-navigator="true"
        data-swimlane-navigator-dock={titleMounted ? "title" : "floating"}
        data-swimlane-navigator-dock-candidate={dockCandidate ? "title" : undefined}
        data-reader-lane-navigator="true"
        data-reader-lane-navigator-dock={titleMounted ? "reader-title" : "floating"}
        data-reader-lane-navigator-dock-candidate={dockCandidate ? "reader-title" : undefined}
        className={cn(
          "z-50 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-hidden",
          titleMounted ? "relative h-7 w-full max-w-full bg-transparent" : "absolute h-9 rounded-md border border-border/75 bg-background/90 p-1 shadow-lg backdrop-blur-xl",
          className,
        )}
        style={titleMounted ? undefined : livePosition ? { left: livePosition.left, top: livePosition.top } : { left: `${position.x}%`, top: `${position.y}%`, transform: "translate(-100%, -100%)" }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <SwimlaneBarContent
          handlePosition={handlePosition}
          handleStyle={handleStyle}
          horizontal
          label="拖动或设置泳道切换栏"
          menuOpen={menuOpen}
          onHandlePointerDown={startDrag}
          renderHandle={(handle) => <ContextMenuTrigger asChild onContextMenu={closeMenuFromSecondContextClick}>{handle}</ContextMenuTrigger>}
        >
          {items.map(({ id, label, icon: Icon = Columns3 }) => (
            <button key={id} type="button" title={label} aria-label={label} aria-pressed={activeId === id} className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground", compactItems && "w-7 justify-center px-0", activeId === id && "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--border)]")} onClick={() => onSelect(id)}>
              <Icon className="size-3.5" />
              {compactItems ? null : <span className="max-w-28 truncate">{label}</span>}
            </button>
          ))}
        </SwimlaneBarContent>
      </nav>
      {menu ? <ContextMenuContent aria-label={menuAriaLabel} className="w-56">{menu}</ContextMenuContent> : null}
    </ContextMenu>
  )
  return titleMounted ? createPortal(root, titleHost) : root
}

export function SwimlaneBarMenuItem({ children, destructive = false, onSelect }: { children: ReactNode; destructive?: boolean; onSelect(): void }) {
  return <ContextMenuItem variant={destructive ? "destructive" : "default"} onSelect={onSelect}>{children}</ContextMenuItem>
}

function percent(value: number, total: number): number {
  return Math.round(clamp(value / Math.max(1, total) * 100, 0, 100) * 100) / 100
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

interface DragSession {
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
