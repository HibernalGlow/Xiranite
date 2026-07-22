import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Columns3 } from "lucide-react"

import { cn } from "@/lib/utils"
import { SwimlaneBarContent } from "./SwimlaneBarContent"
import type { SwimlaneBarHandlePosition, SwimlaneBarHandleStyle } from "./model"

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
  menu,
  className,
  onSelect,
  onPositionChange,
}: {
  items: readonly SwimlaneNavigatorItem<Id>[]
  activeId: Id
  handleStyle?: SwimlaneBarHandleStyle
  handlePosition?: SwimlaneBarHandlePosition
  position?: { x: number; y: number }
  menu?: ReactNode
  className?: string
  onSelect(id: Id): void
  onPositionChange?(position: { x: number; y: number }): void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession>()
  const cleanupDragRef = useRef<(() => void) | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [livePosition, setLivePosition] = useState<{ left: number; top: number }>()

  useEffect(() => () => cleanupDragRef.current?.(), [])

  useEffect(() => {
    if (!menuOpen) return
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false)
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

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !rootRef.current) return
    const root = rootRef.current
    const host = root.offsetParent instanceof HTMLElement ? root.offsetParent : root.parentElement
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
      pointer.preventDefault()
    }
    const finish = (pointer?: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || pointer && pointer.pointerId !== drag.pointerId) return
      cleanupDragRef.current?.()
      cleanupDragRef.current = undefined
      dragRef.current = undefined
      setLivePosition(undefined)
      if (!drag.moved) return
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

  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuHeight = 206
    const preferredTop = rect.top >= menuHeight + 12 ? rect.top - menuHeight - 6 : rect.bottom + 6
    setMenuPosition({
      left: clamp(rect.right - 224, 6, Math.max(6, window.innerWidth - 230)),
      top: clamp(preferredTop, 6, Math.max(6, window.innerHeight - menuHeight - 6)),
    })
    setMenuOpen(true)
  }

  const menuPortal = menuOpen && menu && typeof document !== "undefined" ? createPortal(
    <div ref={menuRef} role="menu" aria-label="泳道操作栏设置" className="fixed z-[200] grid w-56 gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={menuPosition} onClick={() => setMenuOpen(false)}>
      {menu}
    </div>,
    document.body,
  ) : null

  return (
    <nav
      ref={rootRef}
      aria-label="泳道快速切换"
      data-swimlane-navigator="true"
      className={cn("absolute z-50 flex h-9 w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-hidden rounded-md border border-border/75 bg-background/90 p-1 shadow-lg backdrop-blur-xl", className)}
      style={livePosition ? { left: livePosition.left, top: livePosition.top } : { left: `${position.x}%`, top: `${position.y}%`, transform: "translate(-100%, -100%)" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <SwimlaneBarContent handlePosition={handlePosition} handleStyle={handleStyle} horizontal label="拖动或设置泳道切换栏" menuOpen={menuOpen} onHandlePointerDown={startDrag} onHandleContextMenu={toggleMenu}>
        {items.map(({ id, label, icon: Icon = Columns3 }) => (
          <button key={id} type="button" title={label} aria-label={label} aria-pressed={activeId === id} className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground", activeId === id && "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--border)]")} onClick={() => onSelect(id)}>
            <Icon className="size-3.5" />
            <span className="max-w-28 truncate">{label}</span>
          </button>
        ))}
      </SwimlaneBarContent>
      {menuPortal}
    </nav>
  )
}

export function SwimlaneBarMenuItem({ children, destructive = false, onSelect }: { children: ReactNode; destructive?: boolean; onSelect(): void }) {
  return <button type="button" role="menuitem" className={cn("flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-muted", destructive && "text-destructive")} onClick={onSelect}>{children}</button>
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
