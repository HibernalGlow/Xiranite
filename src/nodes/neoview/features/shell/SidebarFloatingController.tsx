/**
 * @migrated-from src/lib/stackview/layers/SidebarControlLayer.svelte
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { GripVertical, Lock, PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react"
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import type { ReaderShellEdge, ReaderShellLockMode } from "../../adapters/reader-http-client"
import type { ReaderShellControlPort } from "./ReaderShellControlPort"

export interface SidebarFloatingControllerProps {
  position: { x: number; y: number }
  edges: Record<ReaderShellEdge, { open: boolean; lockMode: ReaderShellLockMode }>
  disabled?: boolean
  onOpenChange(edge: ReaderShellEdge, open: boolean): void
  onLockCycle(edge: ReaderShellEdge): void
  onLockModeChange(edge: ReaderShellEdge, lockMode: ReaderShellLockMode): void
  onPositionCommit(position: { x: number; y: number }): void
}

const EDGES: readonly ReaderShellEdge[] = ["top", "bottom", "left", "right"]
const LABELS: Record<ReaderShellEdge, string> = { top: "顶部", right: "右侧", bottom: "底部", left: "左侧" }

export function SidebarFloatingController({
  position,
  edges,
  disabled = false,
  onOpenChange,
  onLockCycle,
  onLockModeChange,
  onPositionCommit,
}: SidebarFloatingControllerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number }>()

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const clampCurrent = () => {
      const next = clampPosition(root, position)
      root.style.left = `${next.x}px`
      root.style.top = `${next.y}px`
    }
    clampCurrent()
    const observer = new ResizeObserver(clampCurrent)
    observer.observe(root)
    if (root.parentElement) observer.observe(root.parentElement)
    window.addEventListener("resize", clampCurrent)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", clampCurrent)
    }
  }, [position])

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root || drag.pointerId !== event.pointerId) return
    const parent = root.offsetParent instanceof HTMLElement ? root.offsetParent.getBoundingClientRect() : { left: 0, top: 0 }
    const next = clampPosition(root, {
      x: drag.left - parent.left + event.clientX - drag.startX,
      y: drag.top - parent.top + event.clientY - drag.startY,
    })
    root.style.left = `${next.x}px`
    root.style.top = `${next.y}px`
  }

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (commit) onPositionCommit(clampPosition(root, readPosition(root)))
    else {
      const next = clampPosition(root, position)
      root.style.left = `${next.x}px`
      root.style.top = `${next.y}px`
    }
  }

  function moveWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const delta = event.shiftKey ? 32 : 8
    let next = position
    if (event.key === "ArrowLeft") next = { ...position, x: position.x - delta }
    else if (event.key === "ArrowRight") next = { ...position, x: position.x + delta }
    else if (event.key === "ArrowUp") next = { ...position, y: position.y - delta }
    else if (event.key === "ArrowDown") next = { ...position, y: position.y + delta }
    else if (event.key === "Home") next = { x: 100, y: 100 }
    else return
    event.preventDefault()
    const root = rootRef.current
    if (root) onPositionCommit(clampPosition(root, next))
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="侧栏控制器"
      data-layer="SidebarControlLayer"
      data-layer-id="sidebar-control"
      className="pointer-events-auto absolute z-[85] flex items-center gap-0.5 rounded border border-border/70 bg-background/85 p-1 shadow-lg backdrop-blur-md"
      style={{ left: position.x, top: position.y }}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 cursor-move touch-none"
        aria-label="拖动侧栏控制器"
        title="拖动侧栏控制器"
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, false)}
        onKeyDown={moveWithKeyboard}
      >
        <GripVertical className="size-3.5" />
      </Button>
      {EDGES.map((edge) => (
        <FloatingEdgeControl
          key={edge}
          edge={edge}
          open={edges[edge].open}
          lockMode={edges[edge].lockMode}
          disabled={disabled}
          onOpenChange={onOpenChange}
          onLockCycle={onLockCycle}
          onLockModeChange={onLockModeChange}
        />
      ))}
    </div>
  )
}

export default function ConnectedSidebarFloatingController({ control, disabled = false }: {
  control: ReaderShellControlPort
  disabled?: boolean
}) {
  const snapshot = useSyncExternalStore(control.store.subscribe, control.store.getSnapshot, control.store.getSnapshot)
  return (
    <SidebarFloatingController
      position={snapshot.floating.position}
      edges={snapshot.edges}
      disabled={disabled}
      onOpenChange={control.requestOpen}
      onLockCycle={control.cycleLock}
      onLockModeChange={control.setLock}
      onPositionCommit={(position) => control.setFloating({ position })}
    />
  )
}

function FloatingEdgeControl({ edge, open, lockMode, disabled, onOpenChange, onLockCycle, onLockModeChange }: {
  edge: ReaderShellEdge
  open: boolean
  lockMode: ReaderShellLockMode
  disabled: boolean
  onOpenChange(edge: ReaderShellEdge, open: boolean): void
  onLockCycle(edge: ReaderShellEdge): void
  onLockModeChange(edge: ReaderShellEdge, lockMode: ReaderShellLockMode): void
}) {
  const Icon = edge === "top" ? PanelTop : edge === "bottom" ? PanelBottom : edge === "left" ? PanelLeft : PanelRight
  const state = lockMode === "locked-open" ? "锁定展开" : lockMode === "locked-hidden" ? "锁定隐藏" : open ? "展开" : "隐藏"
  return (
    <div className="flex items-center">
      <Button
        type="button"
        size="icon"
        variant={lockMode === "locked-open" ? "default" : lockMode === "locked-hidden" ? "destructive" : open ? "secondary" : "ghost"}
        className="size-7"
        aria-label={`${LABELS[edge]}边栏：${state}`}
        aria-pressed={open}
        title={`${LABELS[edge]}边栏：${state}`}
        disabled={disabled}
        onClick={() => onOpenChange(edge, !open)}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!disabled) onLockCycle(edge)
        }}
      >
        <Icon className="size-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className="size-5" aria-label={`${LABELS[edge]}边锁定模式`} disabled={disabled}>
            <Lock className="size-2.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-28">
          <DropdownMenuRadioGroup value={lockMode} onValueChange={(value) => onLockModeChange(edge, value as ReaderShellLockMode)}>
            <DropdownMenuRadioItem value="auto">自动</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="locked-open">锁定展开</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="locked-hidden">锁定隐藏</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function readPosition(root: HTMLElement): { x: number; y: number } {
  return { x: Number.parseFloat(root.style.left) || 0, y: Number.parseFloat(root.style.top) || 0 }
}

function clampPosition(root: HTMLElement, position: { x: number; y: number }): { x: number; y: number } {
  const parent = root.offsetParent instanceof HTMLElement ? root.offsetParent : root.parentElement
  const width = parent?.clientWidth ?? window.innerWidth
  const height = parent?.clientHeight ?? window.innerHeight
  return {
    x: Math.round(Math.min(Math.max(0, position.x), Math.max(0, width - root.offsetWidth))),
    y: Math.round(Math.min(Math.max(0, position.y), Math.max(0, height - root.offsetHeight))),
  }
}
