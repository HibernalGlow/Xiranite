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
import { Pin, PinOff } from "lucide-react"
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react"
import type { ReaderCardLayoutPatch, ReaderShellConfigDto, ReaderSidebarLayoutPatch } from "../../adapters/reader-http-client"

import { cn } from "@/lib/utils"
import { readerShellMaterialDraft, readerShellMaterialStyle } from "../material/ReaderShellMaterial"
import { CollapsibleReaderCard } from "./CollapsibleReaderCard"
import { InfoPanelActions } from "./InfoPanelActions"
import { useReaderPanelRail, useReaderPanelTab } from "./ReaderPanelDnd"
import {
  availablePanels,
  cardsForPanel,
  lazyReaderCard,
  type LegacyPanelId,
  type ReaderPanelContext,
  type ReaderPanelDefinition,
  type ReaderPanelSide,
} from "./registry"

export function ReaderSidebar({
  side,
  context,
  shell,
  active: edgeActive = true,
  onLayoutCommit,
  onCardLayoutCommit,
}: {
  side: ReaderPanelSide
  context: ReaderPanelContext
  shell?: ReaderShellConfigDto
  active?: boolean
  onLayoutCommit?(patch: ReaderSidebarLayoutPatch): void
  onCardLayoutCommit?(patch: ReaderCardLayoutPatch): void
}) {
  const hasSession = Boolean(context.session)
  const panels = availablePanels(side, shell, hasSession)
  const [activePanel, setActivePanel] = useState<LegacyPanelId>(() => panels[0]?.id ?? (side === "left" ? "pageList" : "info"))
  const [mountedPanels, setMountedPanels] = useState<ReadonlySet<LegacyPanelId>>(() => new Set([activePanel]))
  const active = panels.find((panel) => panel.id === activePanel) ?? panels[0]
  const layout = shell?.sidebars[side]
  const asideRef = useRef<HTMLElement>(null)
  const gestureRef = useRef<SidebarGesture | undefined>(undefined)
  const style = layout && shell ? sidebarStyle(layout, shell, side) : undefined

  return (
    <aside
      ref={asideRef}
      className={cn(
        "relative flex max-h-full overflow-hidden border-border/55 bg-background/94 shadow-[0_0_32px_rgb(0_0_0/0.26)] backdrop-blur-xl",
        side === "left" ? "border-r" : "flex-row-reverse border-l",
      )}
      data-reader-sidebar={side}
      data-reader-edge-chrome={side}
      style={style}
      onClick={handleBlankClick}
      onDoubleClick={handleBlankDoubleClick}
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
      <ReaderPanelIconRail
        side={side}
        panels={panels}
        activePanelId={active?.id}
        pinned={shell?.edges[side].pinned ?? false}
        pinDisabled={context.disabled || !onLayoutCommit}
        onPinnedChange={(pinned) => onLayoutCommit?.({ side, pinned })}
        onActivate={(panelId) => {
          setMountedPanels((current) => current.has(panelId) ? current : new Set(current).add(panelId))
          setActivePanel(panelId)
        }}
      />
      {panels.map((panel) => {
        const panelActive = edgeActive && panel.id === active?.id
        const cards = cardsForPanel(panel.id, shell, hasSession)
        const exclusive = cards.length === 1
        if (!panelActive && !mountedPanels.has(panel.id)) return null
        return (
          <div
            key={panel.id}
            className={cn(
              "min-w-0 flex-1 overscroll-contain",
              exclusive ? "relative flex min-h-0 flex-col overflow-hidden" : "overflow-y-auto",
            )}
            hidden={!panelActive}
            aria-hidden={!panelActive || undefined}
            data-reader-panel={panelActive ? panel.id : undefined}
            data-reader-panel-cache={panel.id}
            data-context-menu={panelActive && panel.id === "info" ? "neoview-info" : undefined}
          >
            {exclusive ? null : <div className="sticky top-0 z-10 flex min-h-11 items-center gap-2 border-b border-border/50 bg-transparent px-3 py-2">
              <span aria-hidden="true">{panel.emoji}</span>
              <h2 className="truncate text-sm font-semibold">{panel.title}</h2>
              {panel.id === "info" ? <InfoPanelActions context={context} /> : null}
              {layout?.height !== "full" && shell?.sidebarInteraction?.showDragHandle ? (
                <button
                  type="button"
                  aria-label={`移动${side === "left" ? "左" : "右"}侧栏`}
                  className="ml-auto cursor-move touch-none rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/70"
                  onPointerDown={(event) => startGesture(event, "move")}
                  onPointerMove={moveGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={cancelGesture}
                >↕</button>
              ) : null}
            </div>}
            {exclusive && layout?.height !== "full" && shell?.sidebarInteraction?.showDragHandle ? (
              <button
                type="button"
                aria-label={`移动${side === "left" ? "左" : "右"}侧栏`}
                className="absolute right-1 top-1 z-20 cursor-move touch-none rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:bg-muted/70 hover:text-muted-foreground"
                onPointerDown={(event) => startGesture(event, "move")}
                onPointerMove={moveGesture}
                onPointerUp={endGesture}
                onPointerCancel={cancelGesture}
              >↕</button>
            ) : null}
            <div className={cn(exclusive ? "flex min-h-0 flex-1" : "grid px-3 pb-3")}>
              {cards.map((card) => {
                const Card = lazyReaderCard(card.id)
                const cardLayout = shell?.cardLayout[card.id]
                return Card ? (
                  <CollapsibleReaderCard
                    key={card.id}
                    title={card.title}
                    icon={card.icon ? <card.icon className="size-3.5" /> : undefined}
                    frameless={exclusive}
                    collapsed={cardLayout ? !cardLayout.expanded : false}
                    height={cardLayout?.height}
                    onCollapsedChange={(collapsed) => onCardLayoutCommit?.({ cardId: card.id, expanded: !collapsed })}
                    onHeightChange={(height) => onCardLayoutCommit?.({ cardId: card.id, height: height ?? null })}
                  >
                    <Suspense fallback={<div className="h-16 animate-pulse rounded bg-muted/60" aria-label={`正在加载${card.title}`} />}>
                      <Card {...context} panelActive={panelActive} />
                    </Suspense>
                  </CollapsibleReaderCard>
                ) : null
              })}
            </div>
          </div>
        )
      })}
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

  function handleBlankClick(event: ReactMouseEvent<HTMLElement>): void {
    if (shell?.sidebarInteraction?.blankAreaCollapseMode !== "single") return
    collapseFromBlankArea(event.target)
  }

  function handleBlankDoubleClick(event: ReactMouseEvent<HTMLElement>): void {
    if (shell?.sidebarInteraction?.blankAreaCollapseMode !== "double") return
    collapseFromBlankArea(event.target)
  }

  function collapseFromBlankArea(target: EventTarget | null): void {
    if (!shell?.sidebarInteraction?.enableBlankAreaCollapse || !context.shellControl) return
    if (target instanceof Element && target.closest(BLANK_AREA_INTERACTIVE_SELECTOR)) return
    context.shellControl.setPinned(side, false)
    context.shellControl.requestOpen(side, false)
  }

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

function ReaderPanelIconRail({
  side,
  panels,
  activePanelId,
  pinned,
  pinDisabled,
  onPinnedChange,
  onActivate,
}: {
  side: ReaderPanelSide
  panels: readonly ReaderPanelDefinition[]
  activePanelId: LegacyPanelId | undefined
  pinned: boolean
  pinDisabled: boolean
  onPinnedChange(pinned: boolean): void
  onActivate(panelId: LegacyPanelId): void
}) {
  const rail = useReaderPanelRail(side, panels)
  return (
    <nav
      ref={rail.setNodeRef}
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-1 bg-muted/20 py-2 transition-colors",
        side === "left" ? "border-r border-border/50" : "border-l border-border/50",
        rail.isOver && "bg-primary/10",
      )}
      aria-label={`${side === "left" ? "左" : "右"}侧面板`}
      data-reader-panel-rail={side}
    >
      <button
        type="button"
        title={pinned ? `取消固定${side === "left" ? "左" : "右"}侧栏` : `固定${side === "left" ? "左" : "右"}侧栏`}
        aria-label={pinned ? `取消固定${side === "left" ? "左" : "右"}侧栏` : `固定${side === "left" ? "左" : "右"}侧栏`}
        aria-pressed={pinned}
        disabled={pinDisabled}
        className={cn(
          "grid size-9 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          pinned ? "bg-primary/90 text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
        onClick={() => onPinnedChange(!pinned)}
      >
        {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
      </button>
      <span className="my-0.5 h-px w-6 shrink-0 bg-border" aria-hidden="true" />
      {rail.sortable(rail.panels.map((panel) => (
        <ReaderPanelIconButton
          key={panel.id}
          panel={panel}
          side={side}
          active={panel.id === activePanelId}
          onActivate={() => onActivate(panel.id)}
        />
      )))}
    </nav>
  )
}

function ReaderPanelIconButton({
  panel,
  side,
  active,
  onActivate,
}: {
  panel: ReaderPanelDefinition
  side: ReaderPanelSide
  active: boolean
  onActivate(): void
}) {
  const sortable = useReaderPanelTab(panel, side)
  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      title={panel.canMove ? `${panel.title}（可拖动）` : panel.title}
      aria-label={panel.title}
      aria-current={active ? "page" : undefined}
      aria-roledescription={panel.canMove ? "可拖动面板" : undefined}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary/90 text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        sortable.dragging && "cursor-grabbing",
      )}
      style={sortable.style}
      onClick={onActivate}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span aria-hidden="true">{panel.emoji}</span>
    </button>
  )
}

const BLANK_AREA_INTERACTIVE_SELECTOR = "button,a,input,textarea,select,label,[role='button'],[role='switch'],[data-menu-button]"

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
    ...readerShellMaterialStyle(readerShellMaterialDraft(shell), "sidebar"),
    width: layout.width,
    maxWidth: "calc(100vw - 2rem)",
    height,
    top: height === "100%" ? 0 : `${(100 - Number.parseFloat(height)) * (layout.verticalAlign / 100)}%`,
    left: side === "left" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    right: side === "right" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
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
