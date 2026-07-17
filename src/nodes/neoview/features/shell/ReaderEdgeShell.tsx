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
export type ReaderEdgeInteraction = "auto" | "fixed-open" | "fixed-closed"

export interface ReaderEdgeSlot {
  render(active: boolean): ReactNode
  preload?(): void
  ariaLabel: string
  open: boolean
  interaction: ReaderEdgeInteraction
  pinned?: boolean
  triggerSize?: number
  showDelayMs?: number
  hideDelayMs?: number
  className?: string
}

export interface ReaderEdgeShellProps {
  children: ReactNode
  edges?: Partial<Record<ReaderEdge, ReaderEdgeSlot>>
  className?: string
  onEdgeOpenRequest?(edge: ReaderEdge, open: boolean, reason: ReaderEdgeOpenReason): void
}

export type ReaderEdgeOpenReason = "trigger" | "leave" | "escape"

const EDGE_ORDER: readonly ReaderEdge[] = ["top", "right", "bottom", "left"]
const DEFAULT_TRIGGER_SIZE = 32
const DEFAULT_HIDE_DELAY = 500

export function ReaderEdgeShell({
  children,
  edges = {},
  className,
  onEdgeOpenRequest,
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
            onOpenRequest={onEdgeOpenRequest}
          />
        ) : null
      })}
    </div>
  )
}

function ReaderEdgeSurface({
  edge,
  slot,
  onOpenRequest,
}: {
  edge: ReaderEdge
  slot: ReaderEdgeSlot
  onOpenRequest?: (edge: ReaderEdge, open: boolean, reason: ReaderEdgeOpenReason) => void
}) {
  const visible = slot.interaction === "fixed-open"
    ? true
    : slot.interaction === "fixed-closed"
      ? false
      : slot.open
  const automatic = slot.interaction === "auto"
  const [mounted, setMounted] = useState(visible)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastPointerRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const composingRef = useRef(false)
  const protectedInteractionRef = useRef(false)
  const visibleRef = useRef(visible)
  const callbackRef = useRef(onOpenRequest)
  visibleRef.current = visible
  callbackRef.current = onOpenRequest

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  useEffect(() => {
    if (visible) clearTimer(showTimerRef)
    else clearTimer(hideTimerRef)
    if (!automatic) {
      clearTimer(showTimerRef)
      clearTimer(hideTimerRef)
    }
  }, [automatic, visible])

  useEffect(() => () => {
    clearTimer(showTimerRef)
    clearTimer(hideTimerRef)
  }, [])

  useEffect(() => {
    if (!visible || !automatic) return
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
  }, [automatic, edge, visible])

  useEffect(() => {
    if (!visible || !automatic) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return
        protectedInteractionRef.current = false
        requestOpen(false, "escape")
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
  }, [automatic, visible])

  function requestOpen(next: boolean, reason: ReaderEdgeOpenReason) {
    clearTimer(next ? hideTimerRef : showTimerRef)
    if (visibleRef.current === next) return
    callbackRef.current?.(edge, next, reason)
  }

  function scheduleShow() {
    clearTimer(hideTimerRef)
    if (!automatic || visibleRef.current || showTimerRef.current !== undefined) return
    slot.preload?.()
    const delay = slot.showDelayMs ?? 0
    if (delay <= 0) {
      requestOpen(true, "trigger")
      return
    }
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = undefined
      requestOpen(true, "trigger")
    }, delay)
  }

  function scheduleHide() {
    clearTimer(showTimerRef)
    if (!automatic || !visibleRef.current || hideTimerRef.current !== undefined || protectedInteractionRef.current || composingRef.current || isInputting()) return
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = undefined
      if (!protectedInteractionRef.current && !composingRef.current && !isInputting() && !hasProtectedFloatingLayer()) requestOpen(false, "leave")
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
      {mounted || visible ? (
        <div
          ref={surfaceRef}
          role="region"
          aria-label={slot.ariaLabel}
          hidden={!visible}
          aria-hidden={!visible || undefined}
          data-reader-edge={edge}
          data-pinned={slot.pinned ? "true" : "false"}
          data-reader-edge-interaction={slot.interaction}
          className={cn(
            "absolute min-h-0 min-w-0 motion-reduce:transition-none",
            edge === "top"
              ? "z-[80]"
              : edge === "left" || edge === "right"
                ? "z-[70] hover:z-[75] focus-within:z-[75]"
                : "z-[60]",
            surfaceClass(edge),
            slot.className,
          )}
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
          {slot.render(visible)}
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
