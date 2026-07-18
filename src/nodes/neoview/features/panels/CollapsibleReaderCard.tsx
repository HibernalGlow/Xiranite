/**
 * @migrated-from src/lib/components/cards/CollapsibleCard.svelte
 * @source-hash sha256:517de356df45c43dc30c31f9b4bd2ef63a32dfc60cdf41063ab1bb062aa2ff04
 * @features card-windows-tabs
 * @migration-status adapted
 */
import { useRef } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { ChevronDown, ChevronUp, GripHorizontal, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CollapsibleReaderCard({
  title,
  icon,
  collapsed = false,
  height,
  frameless = false,
  children,
  onCollapsedChange,
  onHeightChange,
}: {
  title: string
  icon?: ReactNode
  collapsed?: boolean
  height?: number
  frameless?: boolean
  children: ReactNode
  onCollapsedChange?(collapsed: boolean): void
  onHeightChange?(height?: number): void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<CardHeightGesture | undefined>(undefined)

  return (
    <section
      className={cn(
        "overflow-hidden border-b border-border/50 bg-transparent last:border-b-0",
        frameless && "flex min-h-0 flex-1 flex-col border-b-0",
      )}
      data-reader-card={title}
      data-reader-card-chrome={frameless ? "none" : "default"}
    >
      {frameless ? null : <header className="flex min-h-10 items-center justify-between gap-2 px-1 py-1.5">
        <h3 className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium">
          {icon ? <span className="shrink-0 text-muted-foreground" aria-hidden="true">{icon}</span> : null}
          <span className="truncate">{title}</span>
        </h3>
        <div className="flex items-center gap-0.5">
          {height === undefined ? null : (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title="恢复自动高度"
              aria-label={`重置${title}高度`}
              onClick={resetHeight}
            >
              <RotateCcw />
            </Button>
          )}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={collapsed ? `展开${title}` : `折叠${title}`}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange?.(!collapsed)}
          >
            {collapsed ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </div>
      </header>}
      {collapsed && !frameless ? null : (
        <>
          <div
            ref={contentRef}
            className={cn(
              "overflow-auto px-1 pb-3 pt-1",
              frameless && "relative flex min-h-0 flex-1 flex-col overflow-hidden p-0",
            )}
            data-reader-card-content={title}
            style={{ height: frameless ? undefined : height }}
          >
            {children}
          </div>
          {frameless ? null : <button
            type="button"
            className="grid h-2 w-full touch-none cursor-ns-resize place-items-center text-muted-foreground/45 hover:bg-muted/50 hover:text-muted-foreground focus-visible:bg-muted/50 focus-visible:text-muted-foreground"
            aria-label={`调整${title}高度`}
            onPointerDown={startHeightGesture}
            onPointerMove={moveHeightGesture}
            onPointerUp={endHeightGesture}
            onPointerCancel={cancelHeightGesture}
            onDoubleClick={resetHeight}
          >
            <GripHorizontal className="size-3" aria-hidden="true" />
          </button>}
        </>
      )}
    </section>
  )

  function startHeightGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    const content = contentRef.current
    if (!content) return
    const renderedHeight = content.getBoundingClientRect().height || content.offsetHeight || height || MIN_CARD_HEIGHT
    gestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: renderedHeight,
      latestHeight: renderedHeight,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic/test pointers are not registered as active by every WebView.
    }
    event.preventDefault()
  }

  function moveHeightGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = gestureRef.current
    const content = contentRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !content) return
    gesture.latestHeight = clamp(Math.round(gesture.startHeight + event.clientY - gesture.startY), MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)
    gesture.moved = true
    content.style.height = `${gesture.latestHeight}px`
  }

  function endHeightGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (gesture.moved) onHeightChange?.(gesture.latestHeight)
  }

  function cancelHeightGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    restoreConfiguredHeight()
  }

  function resetHeight(): void {
    gestureRef.current = undefined
    if (contentRef.current) contentRef.current.style.height = ""
    onHeightChange?.(undefined)
  }

  function restoreConfiguredHeight(): void {
    if (contentRef.current) contentRef.current.style.height = height === undefined ? "" : `${height}px`
  }
}

interface CardHeightGesture {
  pointerId: number
  startY: number
  startHeight: number
  latestHeight: number
  moved: boolean
}

const MIN_CARD_HEIGHT = 50
const MAX_CARD_HEIGHT = 4_096

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
