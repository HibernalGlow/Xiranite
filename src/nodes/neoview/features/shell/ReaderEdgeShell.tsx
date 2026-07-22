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

export interface ReaderEdgeTriggerRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ReaderEdgeSlot {
  render(active: boolean): ReactNode
  preload?(): void
  ariaLabel: string
  open: boolean
  interaction: ReaderEdgeInteraction
  pinned?: boolean
  triggerSize?: number
  triggerRect?: ReaderEdgeTriggerRect
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
const EXIT_TRANSITION_MS = 160
type ReaderEdgePresentation = "visible" | "exiting" | "hidden"

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
  const [presentation, setPresentation] = useState<ReaderEdgePresentation>(visible ? "visible" : "hidden")
  const triggerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastPointerRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const composingRef = useRef(false)
  const protectedInteractionRef = useRef(false)
  const visibleRef = useRef(visible)
  const callbackRef = useRef(onOpenRequest)
  visibleRef.current = visible
  callbackRef.current = onOpenRequest

  useEffect(() => {
    clearTimer(exitTimerRef)
    if (visible) {
      setMounted(true)
      setPresentation("visible")
      return
    }
    if (!mounted) return
    setPresentation("exiting")
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = undefined
      setPresentation("hidden")
    }, EXIT_TRANSITION_MS)
    return () => clearTimer(exitTimerRef)
  }, [mounted, visible])

  useEffect(() => {
    if (visible) clearTimer(showTimerRef)
    else clearTimer(hideTimerRef)
    if (!automatic) {
      clearTimer(showTimerRef)
      clearTimer(hideTimerRef)
    }
  }, [automatic, visible])

  useEffect(() => {
    if (!automatic || visible) return
    const handlePointerMove = (event: PointerEvent) => {
      const trigger = triggerRef.current
      if (!trigger || !containsPoint(trigger.getBoundingClientRect(), event.clientX, event.clientY)) {
        clearTimer(showTimerRef)
        return
      }
      scheduleShow()
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    return () => window.removeEventListener("pointermove", handlePointerMove)
  }, [automatic, visible])

  useEffect(() => () => {
    clearTimer(showTimerRef)
    clearTimer(hideTimerRef)
    clearTimer(exitTimerRef)
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
      const target = event.target
      if (target instanceof Element && isProtectedFloatingElement(target)) {
        protectedInteractionRef.current = true
        clearTimer(hideTimerRef)
        return
      }
      if (!protectedInteractionRef.current) return
      protectedInteractionRef.current = false
      if (!(target instanceof Node) || !surfaceRef.current?.contains(target)) scheduleHide()
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (!protectedInteractionRef.current) return
      protectedInteractionRef.current = false
      const surface = surfaceRef.current
      const target = document.elementFromPoint(event.clientX, event.clientY)
      if (!surface || !target || !surface.contains(target)) scheduleHide()
    }
    const clearTransientProtection = () => {
      // Native window minimize/blur can happen before pointerup reaches the
      // surface. Do not let that abandoned gesture become a permanent pin.
      protectedInteractionRef.current = false
      clearTimer(hideTimerRef)
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener("pointerup", handlePointerEnd, true)
    window.addEventListener("pointercancel", handlePointerEnd, true)
    window.addEventListener("blur", clearTransientProtection)
    document.addEventListener("visibilitychange", clearTransientProtection)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener("pointerup", handlePointerEnd, true)
      window.removeEventListener("pointercancel", handlePointerEnd, true)
      window.removeEventListener("blur", clearTransientProtection)
      document.removeEventListener("visibilitychange", clearTransientProtection)
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
    if (!automatic || !visibleRef.current || hideTimerRef.current !== undefined || protectedInteractionRef.current || composingRef.current || isInputting() || hasProtectedFloatingLayer()) return
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = undefined
      if (!protectedInteractionRef.current && !composingRef.current && !isInputting() && !hasProtectedFloatingLayer()) requestOpen(false, "leave")
    }, slot.hideDelayMs ?? DEFAULT_HIDE_DELAY)
  }

  function handleSurfaceLeave(event: ReactPointerEvent<HTMLDivElement>) {
    const related = event.relatedTarget
    if (hasProtectedFloatingLayer() || (related instanceof Element && isProtectedFloatingElement(related))) {
      clearTimer(hideTimerRef)
      return
    }
    scheduleHide()
  }

  const triggerSize = Math.max(1, slot.triggerSize ?? DEFAULT_TRIGGER_SIZE)
  const presented = presentation !== "hidden"
  return (
    <>
      <div
        ref={triggerRef}
        aria-hidden="true"
        data-reader-edge-trigger={edge}
        className={cn("absolute z-40", slot.triggerRect ? undefined : triggerClass(edge))}
        style={slot.triggerRect ? triggerRectStyle(slot.triggerRect) : triggerStyle(edge, triggerSize)}
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
          aria-hidden={!visible || undefined}
          data-reader-edge={edge}
          data-reader-edge-visible={visible ? "true" : "false"}
          data-reader-edge-presentation={presentation}
          data-input-context="shell"
          data-pinned={slot.pinned ? "true" : "false"}
          data-reader-edge-interaction={slot.interaction}
          className={cn(
            "absolute min-h-0 min-w-0 transform-gpu transition-transform duration-150 ease-out will-change-transform motion-reduce:transition-none",
            edge === "top" || edge === "bottom" ? "z-[80]" : "z-[60]",
            !visible && "pointer-events-none",
            presentation === "hidden" && "invisible",
            edgeTransformClass(edge, presentation === "visible"),
            surfaceClass(edge),
            slot.className,
          )}
          onPointerEnter={() => clearTimer(hideTimerRef)}
          onPointerLeave={handleSurfaceLeave}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (!automatic) return
            protectedInteractionRef.current = true
            clearTimer(hideTimerRef)
          }}
          onPointerUp={(event) => {
            event.stopPropagation()
            // A completed card click/drag must not keep an auto edge pinned.
            protectedInteractionRef.current = false
          }}
          onPointerCancel={(event) => event.stopPropagation()}
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
          {slot.render(presented)}
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

function edgeTransformClass(edge: ReaderEdge, visible: boolean): string {
  if (visible) return "translate-x-0 translate-y-0"
  if (edge === "top") return "-translate-y-full"
  if (edge === "bottom") return "translate-y-full"
  if (edge === "left") return "-translate-x-full"
  return "translate-x-full"
}

function triggerStyle(edge: ReaderEdge, size: number): React.CSSProperties {
  return edge === "top" || edge === "bottom" ? { height: size } : { width: size }
}

function triggerRectStyle(rect: ReaderEdgeTriggerRect): React.CSSProperties {
  const x = clampPercent(rect.x)
  const y = clampPercent(rect.y)
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${clamp(rect.width, 1, 100 - x)}%`,
    height: `${clamp(rect.height, 1, 100 - y)}%`,
  }
}

function clampPercent(value: number): number {
  return clamp(value, 0, 99)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
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

function containsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
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
  return element.matches(FLOATING_SELECTOR) || element.closest(FLOATING_SELECTOR) !== null
}

function hasProtectedFloatingLayer(): boolean {
  return [...document.querySelectorAll<HTMLElement>(FLOATING_SELECTOR)].some((element) => {
    if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.closest('[data-state="closed"]')) return false
    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false
    return element.getClientRects().length > 0 || style.position === "fixed" || style.position === "absolute"
  })
}
