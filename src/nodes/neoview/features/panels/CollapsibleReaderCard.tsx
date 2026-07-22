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
import { MagicCard } from "@/components/ui/magic-card"
import { moduleMagicCardProps } from "@/components/ui/module-panel-variants"
import { cn } from "@/lib/utils"
import { useWorkspaceShallowSelector } from "@/store/workspaceStore"
import { ReaderCardChromeProvider } from "./ReaderCardChromeContext"

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
  const magicAppearance = useWorkspaceShallowSelector((state) => state.moduleMagicCard)
  const contentRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<CardHeightGesture | undefined>(undefined)

  const card = (
    <section
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-transparent shadow-none",
        "[[data-module-panel-style=solid]_&]:shadow-sm",
        "[[data-module-panel-style=outline]_&]:bg-transparent",
        "[[data-module-panel-style=flat]_&]:rounded-none [[data-module-panel-style=flat]_&]:border-x-0 [[data-module-panel-style=flat]_&]:bg-transparent",
        // Exclusive panels must fill the rail height/width; flex-1 alone is not enough without h/w-full.
        frameless && "h-full min-h-0 w-full flex-1 rounded-none border-0",
      )}
      data-reader-card={title}
      data-reader-card-chrome={frameless ? "none" : "default"}
    >
      {frameless ? null : <header
        data-slot="reader-card-title"
        className={cn(
          "flex min-h-9 items-center justify-between gap-2 px-2.5 py-1.5",
          "[[data-module-title-style=legend]_&]:mx-2.5 [[data-module-title-style=legend]_&]:mt-2 [[data-module-title-style=legend]_&]:min-h-6 [[data-module-title-style=legend]_&]:w-fit [[data-module-title-style=legend]_&]:max-w-[calc(100%-1.25rem)] [[data-module-title-style=legend]_&]:rounded-md [[data-module-title-style=legend]_&]:border [[data-module-title-style=legend]_&]:bg-card/90 [[data-module-title-style=legend]_&]:px-1.5 [[data-module-title-style=legend]_&]:py-0",
          "[[data-module-title-style=bar]_&]:border-b [[data-module-title-style=bar]_&]:bg-muted/40",
          "[[data-module-title-style=minimal]_&]:min-h-7 [[data-module-title-style=minimal]_&]:px-2.5 [[data-module-title-style=minimal]_&]:py-0.5",
        )}
      >
        <h3 className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold">
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
          <ReaderCardChromeProvider value>
          <div
            ref={contentRef}
            className={cn(
              "overflow-auto px-2.5 pb-3 pt-1.5",
              "[[data-module-title-style=inline]_&]:pt-0",
              "[[data-module-panel-style=flat]_&]:px-0",
              frameless && "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden p-0",
            )}
            data-reader-card-content={title}
            style={{ height: frameless ? undefined : height }}
          >
            {children}
          </div>
          </ReaderCardChromeProvider>
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

  return (
    <MagicCard
      {...moduleMagicCardProps(magicAppearance)}
      className={cn(
        "neoview-card-magic min-w-0 rounded-xl",
        "[[data-module-card-effect=plain]_&]:!bg-card [[data-module-card-effect=plain]_&]:!shadow-none",
        "[[data-module-card-effect=plain]_&_[data-slot=magic-card-gradient]]:hidden",
        "[[data-module-card-effect=plain]_&_[data-slot=magic-card-orb]]:hidden",
        "[[data-module-panel-style=solid]_&_[data-slot=magic-card-surface]]:bg-card",
        "[[data-module-panel-style=outline]_&_[data-slot=magic-card-surface]]:bg-transparent",
        "[[data-module-panel-style=flat]_&_[data-slot=magic-card-surface]]:bg-transparent",
        frameless && "flex h-full min-h-0 w-full flex-1 rounded-none border-0 !bg-transparent [&_[data-slot=magic-card-gradient]]:hidden [&_[data-slot=magic-card-orb]]:hidden [&_[data-slot=magic-card-surface]]:hidden",
      )}
    >
      {card}
    </MagicCard>
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
