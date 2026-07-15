/**
 * @migrated-from src/lib/components/layout/MainLayout.svelte
 * @source-hash sha256:6d7539a648dd4e0b96f714723e61ec71b8afdae91521427e3b501b756b68f303
 * @migrated-from src/lib/components/layout/HoverWrapper.svelte
 * @source-hash sha256:5d0e6929622519e0b179067398aa0900c9a8b97def1bb53ef783590744b4d158
 * @features panels-toolbar-shell,card-windows-tabs
 * @migration-status adapted
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type ReaderEdge = "top" | "right" | "bottom" | "left"

export interface ReaderEdgeSlot {
  render(): ReactNode
  preload?(): void
  ariaLabel: string
  pinned?: boolean
  initialVisible?: boolean
  triggerSize?: number
  showDelayMs?: number
  hideDelayMs?: number
  className?: string
}

export interface ReaderEdgeShellProps {
  children: ReactNode
  edges?: Partial<Record<ReaderEdge, ReaderEdgeSlot>>
  className?: string
  onEdgeVisibilityChange?(edge: ReaderEdge, visible: boolean): void
}

const EDGE_ORDER: readonly ReaderEdge[] = ["top", "right", "bottom", "left"]
const DEFAULT_TRIGGER_SIZE = 32
const DEFAULT_HIDE_DELAY = 500

export function ReaderEdgeShell({
  children,
  edges = {},
  className,
  onEdgeVisibilityChange,
}: ReaderEdgeShellProps) {
  return (
    <div className={cn("relative isolate h-full min-h-0 w-full overflow-hidden", className)} data-testid="neoview-reader-edge-shell">
      <div className="absolute inset-0 min-h-0 overflow-hidden" data-reader-viewport="true">
        {children}
      </div>
      {EDGE_ORDER.map((edge) => {
        const slot = edges[edge]
        return slot ? (
          <ReaderEdgeSurface
            key={edge}
            edge={edge}
            slot={slot}
            onVisibilityChange={onEdgeVisibilityChange}
          />
        ) : null
      })}
    </div>
  )
}

function ReaderEdgeSurface({
  edge,
  slot,
  onVisibilityChange,
}: {
  edge: ReaderEdge
  slot: ReaderEdgeSlot
  onVisibilityChange?: (edge: ReaderEdge, visible: boolean) => void
}) {
  const pinned = slot.pinned ?? false
  const [visible, setVisible] = useState(() => pinned || (slot.initialVisible ?? false))
  const surfaceRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastPointerRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const composingRef = useRef(false)
  const protectedInteractionRef = useRef(false)
  const visibleRef = useRef(visible)
  const callbackRef = useRef(onVisibilityChange)
  visibleRef.current = visible
  callbackRef.current = onVisibilityChange

  useEffect(() => {
    const next = pinned || (slot.initialVisible ?? false)
    if (visibleRef.current === next) return
    visibleRef.current = next
    setVisible(next)
    callbackRef.current?.(edge, next)
  }, [edge, pinned, slot.initialVisible])

  useEffect(() => () => {
    clearTimer(showTimerRef)
    clearTimer(hideTimerRef)
  }, [])

  useEffect(() => {
    if (!visible || pinned) return
    const handlePointerMove = (event: PointerEvent) => {
      const previous = lastPointerRef.current
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      const surface = surfaceRef.current
      if (!surface || protectedInteractionRef.current || composingRef.current || isInputting() || isProtectedFloatingElement(document.elementFromPoint(event.clientX, event.clientY))) {
        clearTimer(hideTimerRef)
        return
      }
      const target = document.elementFromPoint(event.clientX, event.clientY)
      if (target && surface.contains(target)) {
        clearTimer(hideTimerRef)
        return
      }
      if (previous && movingTowardEdge(edge, event.clientX - previous.x, event.clientY - previous.y)) {
        clearTimer(hideTimerRef)
        return
      }
      if (outsideRetractLine(edge, surface.getBoundingClientRect(), event.clientX, event.clientY)) scheduleHide()
      else clearTimer(hideTimerRef)
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    return () => window.removeEventListener("pointermove", handlePointerMove)
  }, [edge, pinned, visible])

  useEffect(() => {
    if (!visible || pinned) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        protectedInteractionRef.current = false
        commitVisible(false)
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!protectedInteractionRef.current) return
      const target = event.target
      if (target instanceof Element && isProtectedFloatingElement(target)) return
      protectedInteractionRef.current = false
      if (!(target instanceof Node) || !surfaceRef.current?.contains(target)) scheduleHide()
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("pointerdown", handlePointerDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [pinned, visible])

  function commitVisible(next: boolean) {
    clearTimer(next ? hideTimerRef : showTimerRef)
    if (visibleRef.current === next) return
    visibleRef.current = next
    setVisible(next)
    callbackRef.current?.(edge, next)
  }

  function scheduleShow() {
    clearTimer(hideTimerRef)
    if (pinned || visibleRef.current || showTimerRef.current !== undefined) return
    slot.preload?.()
    const delay = slot.showDelayMs ?? 0
    if (delay <= 0) {
      commitVisible(true)
      return
    }
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = undefined
      commitVisible(true)
    }, delay)
  }

  function scheduleHide() {
    clearTimer(showTimerRef)
    if (pinned || !visibleRef.current || hideTimerRef.current !== undefined || protectedInteractionRef.current || composingRef.current || isInputting()) return
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = undefined
      if (!protectedInteractionRef.current && !composingRef.current && !isInputting() && !hasProtectedFloatingLayer()) commitVisible(false)
    }, slot.hideDelayMs ?? DEFAULT_HIDE_DELAY)
  }

  function handleSurfaceLeave(event: ReactPointerEvent<HTMLDivElement>) {
    const related = event.relatedTarget
    if (related instanceof Element && isProtectedFloatingElement(related)) {
      clearTimer(hideTimerRef)
      return
    }
    scheduleHide()
  }

  const triggerSize = Math.max(1, slot.triggerSize ?? DEFAULT_TRIGGER_SIZE)
  return (
    <>
      <div
        aria-hidden="true"
        data-reader-edge-trigger={edge}
        className={cn("absolute z-40", triggerClass(edge))}
        style={triggerStyle(edge, triggerSize)}
        onPointerEnter={scheduleShow}
        onPointerLeave={() => {
          if (!visibleRef.current) clearTimer(showTimerRef)
        }}
      />
      {visible ? (
        <div
          ref={surfaceRef}
          role="region"
          aria-label={slot.ariaLabel}
          data-reader-edge={edge}
          data-pinned={pinned ? "true" : "false"}
          className={cn("absolute z-50 min-h-0 min-w-0", surfaceClass(edge), slot.className)}
          onPointerEnter={() => clearTimer(hideTimerRef)}
          onPointerLeave={handleSurfaceLeave}
          onFocusCapture={() => clearTimer(hideTimerRef)}
          onBlurCapture={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) scheduleHide()
          }}
          onCompositionStart={() => {
            composingRef.current = true
            clearTimer(hideTimerRef)
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onContextMenu={() => {
            protectedInteractionRef.current = true
            clearTimer(hideTimerRef)
          }}
        >
          {slot.render()}
        </div>
      ) : null}
    </>
  )
}

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | undefined }): void {
  if (ref.current === undefined) return
  clearTimeout(ref.current)
  ref.current = undefined
}

function triggerClass(edge: ReaderEdge): string {
  if (edge === "top") return "inset-x-0 top-0"
  if (edge === "bottom") return "inset-x-0 bottom-0"
  if (edge === "left") return "inset-y-0 left-0"
  return "inset-y-0 right-0"
}

function surfaceClass(edge: ReaderEdge): string {
  if (edge === "top") return "inset-x-0 top-0"
  if (edge === "bottom") return "inset-x-0 bottom-0"
  if (edge === "left") return "inset-y-0 left-0"
  return "inset-y-0 right-0"
}

function triggerStyle(edge: ReaderEdge, size: number): React.CSSProperties {
  return edge === "top" || edge === "bottom" ? { height: size } : { width: size }
}

function movingTowardEdge(edge: ReaderEdge, deltaX: number, deltaY: number): boolean {
  if (edge === "left") return deltaX < -1
  if (edge === "right") return deltaX > 1
  if (edge === "top") return deltaY < -1
  return deltaY > 1
}

function outsideRetractLine(edge: ReaderEdge, rect: DOMRect, x: number, y: number): boolean {
  if (edge === "left") return x > rect.right + 10
  if (edge === "right") return x < rect.left - 10
  if (edge === "top") return y > rect.bottom + 10
  return y < rect.top - 10
}

function isInputting(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable
}

const FLOATING_SELECTOR = [
  '[role="tooltip"]',
  '[role="popover"]',
  '[role="menu"]',
  '[data-radix-popper-content-wrapper]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
].join(",")

function isProtectedFloatingElement(element: Element | null): boolean {
  if (!element) return false
  if (element.matches(FLOATING_SELECTOR) || element.closest(FLOATING_SELECTOR)) return true
  const style = window.getComputedStyle(element)
  return style.position === "fixed" && Number.parseInt(style.zIndex, 10) >= 50
}

function hasProtectedFloatingLayer(): boolean {
  return document.querySelector(FLOATING_SELECTOR) !== null
}
