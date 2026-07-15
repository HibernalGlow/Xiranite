/**
 * @migrated-from src/lib/components/layout/LeftSidebar.svelte
 * @source-hash sha256:3c2fce2245cdca6b6224995c39adc4b6199ddd2c4b714e90a7a7f79767404b46
 * @migrated-from src/lib/components/layout/RightSidebar.svelte
 * @source-hash sha256:b9d05589604ae5dcaf05f4a435278f78e23cc55de7ceb32c3700829f419adf90
 * @migrated-from src/lib/components/layout/PanelTabBar.svelte
 * @source-hash sha256:bbeb9b1630d8239cacd946d68818bad85c4b54e537e8008748df40e99a101fd8
 * @migrated-from src/lib/cards/PanelContainer.svelte
 * @source-hash sha256:8c2dc923d863fd8e7c233964b27ccdef496ad68c3097003fe212e597b0c089a8
 * @features panels-toolbar-shell,card-windows-tabs
 * @migration-status adapted
 */
import { Suspense, useRef, useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import type { ReaderCardLayoutPatch, ReaderShellConfigDto, ReaderSidebarLayoutPatch } from "../../adapters/reader-http-client"

import { cn } from "@/lib/utils"
import { CollapsibleReaderCard } from "./CollapsibleReaderCard"
import {
  availablePanels,
  cardsForPanel,
  lazyReaderCard,
  type LegacyPanelId,
  type ReaderPanelContext,
  type ReaderPanelSide,
} from "./registry"

export function ReaderSidebar({
  side,
  context,
  shell,
  onLayoutCommit,
  onCardLayoutCommit,
}: {
  side: ReaderPanelSide
  context: ReaderPanelContext
  shell?: ReaderShellConfigDto
  onLayoutCommit?(patch: ReaderSidebarLayoutPatch): void
  onCardLayoutCommit?(patch: ReaderCardLayoutPatch): void
}) {
  const panels = availablePanels(side, shell)
  const [activePanel, setActivePanel] = useState<LegacyPanelId>(() => panels[0]?.id ?? (side === "left" ? "pageList" : "info"))
  const active = panels.find((panel) => panel.id === activePanel) ?? panels[0]
  const layout = shell?.sidebars[side]
  const asideRef = useRef<HTMLElement>(null)
  const gestureRef = useRef<SidebarGesture | undefined>(undefined)
  const style = layout && shell ? sidebarStyle(layout, shell, side) : undefined

  return (
    <aside
      ref={asideRef}
      className={cn(
        "relative flex max-h-full overflow-hidden border-border/70 bg-background/92 shadow-xl backdrop-blur-md",
        side === "left" ? "border-r" : "flex-row-reverse border-l",
      )}
      data-reader-sidebar={side}
      style={style}
    >
      <div
        aria-label={`调整${side === "left" ? "左" : "右"}侧栏宽度`}
        role="separator"
        aria-orientation="vertical"
        className={cn("absolute inset-y-0 z-20 w-1.5 cursor-ew-resize touch-none", side === "left" ? "right-0" : "left-0")}
        onPointerDown={(event) => startGesture(event, "width")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={cancelGesture}
      />
      <nav className={cn("flex w-11 shrink-0 flex-col items-center gap-1 py-2", side === "left" ? "border-r" : "border-l")} aria-label={`${side === "left" ? "左" : "右"}侧面板`}>
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            title={panel.title}
            aria-label={panel.title}
            aria-current={panel.id === active?.id ? "page" : undefined}
            className={cn(
              "grid size-8 place-items-center rounded-md text-sm transition-colors",
              panel.id === active?.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setActivePanel(panel.id)}
          >
            <span aria-hidden="true">{panel.emoji}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-2" data-reader-panel={active?.id}>
        <div className="mb-2 flex items-center gap-2 px-1 py-1">
          <span aria-hidden="true">{active?.emoji}</span>
          <h2 className="truncate text-sm font-semibold">{active?.title}</h2>
          {layout?.height !== "full" ? (
            <button
              type="button"
              aria-label={`移动${side === "left" ? "左" : "右"}侧栏`}
              className="ml-auto cursor-move touch-none rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              onPointerDown={(event) => startGesture(event, "move")}
              onPointerMove={moveGesture}
              onPointerUp={endGesture}
              onPointerCancel={cancelGesture}
            >↕</button>
          ) : null}
        </div>
        <div className="grid gap-2">
          {active ? cardsForPanel(active.id, shell).map((card) => {
            const Card = lazyReaderCard(card.id)
            const cardLayout = shell?.cardLayout[card.id]
            return Card ? (
              <CollapsibleReaderCard
                key={card.id}
                title={card.title}
                collapsed={cardLayout ? !cardLayout.expanded : false}
                height={cardLayout?.height}
                onCollapsedChange={(collapsed) => onCardLayoutCommit?.({ cardId: card.id, expanded: !collapsed })}
                onHeightChange={(height) => onCardLayoutCommit?.({ cardId: card.id, height: height ?? null })}
              >
                <Suspense fallback={<div className="h-16 animate-pulse rounded bg-muted/60" aria-label={`正在加载${card.title}`} />}>
                  <Card {...context} />
                </Suspense>
              </CollapsibleReaderCard>
            ) : null
          }) : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`调整${side === "left" ? "左" : "右"}侧栏大小`}
        className={cn("absolute bottom-0 z-30 size-4 cursor-nwse-resize touch-none opacity-0 hover:opacity-100 focus:opacity-100", side === "left" ? "right-0" : "left-0")}
        onPointerDown={(event) => startGesture(event, "corner")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={cancelGesture}
      />
    </aside>
  )

  function startGesture(event: ReactPointerEvent<HTMLElement>, kind: SidebarGesture["kind"]): void {
    if (!layout || !asideRef.current) return
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: layout.width,
      height: layout.height === "full" ? 100 : Number.parseFloat(sidebarHeight(layout)),
      verticalAlign: layout.verticalAlign,
      horizontalPosition: layout.horizontalPosition,
      latest: {},
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic/test pointers are not registered as active by every WebView.
    }
    event.preventDefault()
  }

  function moveGesture(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current
    const aside = asideRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !aside) return
    const widthDelta = (side === "left" ? 1 : -1) * (event.clientX - gesture.startX)
    if (gesture.kind === "width" || gesture.kind === "corner") {
      gesture.latest.width = clamp(gesture.width + widthDelta, 200, 600)
      aside.style.width = `${gesture.latest.width}px`
    }
    if (gesture.kind === "corner") {
      gesture.latest.height = "custom"
      gesture.latest.customHeight = clamp(gesture.height + ((event.clientY - gesture.startY) / Math.max(window.innerHeight, 1)) * 100, 10, 100)
      aside.style.height = `${gesture.latest.customHeight}%`
      aside.style.top = `${(100 - gesture.latest.customHeight) * (gesture.verticalAlign / 100)}%`
    }
    if (gesture.kind === "move") {
      gesture.latest.horizontalPosition = clamp(
        gesture.horizontalPosition + ((event.clientX - gesture.startX) / Math.max(window.innerWidth, 1)) * (side === "left" ? 200 : -200),
        0,
        100,
      )
      gesture.latest.verticalAlign = clamp(
        gesture.verticalAlign + ((event.clientY - gesture.startY) / Math.max(window.innerHeight, 1)) * 200,
        0,
        100,
      )
      aside.style.top = `${(100 - gesture.height) * (gesture.latest.verticalAlign / 100)}%`
      if (side === "left") aside.style.left = `${gesture.latest.horizontalPosition * 0.5}vw`
      else aside.style.right = `${gesture.latest.horizontalPosition * 0.5}vw`
    }
  }

  function endGesture(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (Object.keys(gesture.latest).length) onLayoutCommit?.({ side, ...gesture.latest })
  }

  function cancelGesture(event: ReactPointerEvent<HTMLElement>): void {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (asideRef.current && layout && shell) applySidebarStyle(asideRef.current, sidebarStyle(layout, shell, side))
  }
}

interface SidebarGesture {
  kind: "width" | "corner" | "move"
  pointerId: number
  startX: number
  startY: number
  width: number
  height: number
  verticalAlign: number
  horizontalPosition: number
  latest: Omit<ReaderSidebarLayoutPatch, "side">
}

function sidebarHeight(layout: ReaderShellConfigDto["sidebars"]["left"] | undefined): string {
  if (!layout || layout.height === "full") return "100%"
  if (layout.height === "two-thirds") return "66.6667%"
  if (layout.height === "half") return "50%"
  if (layout.height === "one-third") return "33.3333%"
  return `${layout.customHeight}%`
}

function sidebarStyle(
  layout: ReaderShellConfigDto["sidebars"]["left"],
  shell: ReaderShellConfigDto,
  side: ReaderPanelSide,
): CSSProperties {
  const height = sidebarHeight(layout)
  return {
    width: layout.width,
    maxWidth: "calc(100vw - 2rem)",
    height,
    top: height === "100%" ? 0 : `${(100 - Number.parseFloat(height)) * (layout.verticalAlign / 100)}%`,
    left: side === "left" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    right: side === "right" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    backgroundColor: `color-mix(in oklch, var(--background) ${shell.opacity.sidebar}%, transparent)`,
    backdropFilter: `blur(${shell.blur.sidebar}px)`,
  }
}

function applySidebarStyle(element: HTMLElement, style: CSSProperties): void {
  element.style.width = String(style.width ?? "")
  element.style.maxWidth = String(style.maxWidth ?? "")
  element.style.height = String(style.height ?? "")
  element.style.top = typeof style.top === "number" ? `${style.top}px` : String(style.top ?? "")
  element.style.left = String(style.left ?? "")
  element.style.right = String(style.right ?? "")
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
