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
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pin, PinOff } from "lucide-react"
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react"
import type { ReaderCardLayoutPatch, ReaderShellConfigDto, ReaderSidebarLayoutPatch, ReaderSwimlaneLaneDto } from "../../adapters/reader-http-client"

import { cn } from "@/lib/utils"
import { neoviewDebug } from "../../neoviewDebug"
import { readerShellMaterialDraft, readerShellMaterialStyle } from "../material/ReaderShellMaterial"
import { CollapsibleReaderCard } from "./CollapsibleReaderCard"
import { InfoPanelActions } from "./InfoPanelActions"
import { ReaderPanelBar } from "./ReaderPanelBar"
import { useReaderPanelDropZone, useReaderPanelRail, useReaderPanelTab } from "./ReaderPanelDnd"
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
  presentation = "edge",
  selectedPanelId,
  onSelectedPanelChange,
  onLayoutCommit,
  onCardLayoutCommit,
  onPanelBarChange,
}: {
  side: ReaderPanelSide
  context: ReaderPanelContext
  shell?: ReaderShellConfigDto
  active?: boolean
  presentation?: "edge" | "lane"
  selectedPanelId?: string
  onSelectedPanelChange?(panelId: LegacyPanelId): void
  onLayoutCommit?(patch: ReaderSidebarLayoutPatch): void
  onCardLayoutCommit?(patch: ReaderCardLayoutPatch): void
  onPanelBarChange?(patch: Partial<ReaderSwimlaneLaneDto>): void
}) {
  const hasSession = Boolean(context.session)
  const panels = useMemo(() => availablePanels(side, shell, hasSession), [hasSession, shell, side])
  const panelIds = useMemo(() => panels.map((panel) => panel.id), [panels])
  const [localActivePanel, setLocalActivePanel] = useState<LegacyPanelId>(() => panels[0]?.id ?? (side === "left" ? "pageList" : "info"))
  // Lane presentation used to mount every docked panel on first paint; that is the
  // main freeze source when both swimlane sidebars appear with shell. Keep only the
  // active panel mounted until the user visits another tab.
  const [mountedPanels, setMountedPanels] = useState<ReadonlySet<LegacyPanelId>>(() => {
    const initial = selectedPanelId ?? panels[0]?.id ?? (side === "left" ? "pageList" : "info")
    return new Set(initial ? [initial as LegacyPanelId] : [])
  })
  const activePanel = selectedPanelId ?? localActivePanel
  const active = panels.find((panel) => panel.id === activePanel) ?? panels[0]
  const layout = shell?.sidebars[side]
  const asideRef = useRef<HTMLElement>(null)
  const [asideNode, setAsideNode] = useState<HTMLElement | null>(null)
  const sidebarDropZone = useReaderPanelDropZone(side)
  const setAsideRef = useCallback((node: HTMLElement | null) => {
    asideRef.current = node
    setAsideNode(node)
    sidebarDropZone.setNodeRef(node)
  }, [sidebarDropZone.setNodeRef])
  const gestureRef = useRef<SidebarGesture | undefined>(undefined)
  const style = layout && shell
    ? presentation === "lane"
      ? readerShellMaterialStyle(readerShellMaterialDraft(shell), "sidebar")
      : sidebarStyle(layout, shell, side)
    : undefined

  useEffect(() => {
    const mountedAt = performance.now()
    neoviewDebug("sidebar:mount", {
      side,
      presentation,
      panelCount: panels.length,
      activePanel,
      mountedPanelCount: mountedPanels.size,
    })
    return () => {
      neoviewDebug("sidebar:unmount", {
        side,
        presentation,
        livedMs: Math.round(performance.now() - mountedAt),
      })
    }
    // Mount diagnostics only — panel churn is expected while using the rail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation, side])

  useEffect(() => {
    setMountedPanels((current) => {
      const missing = panelIds.filter((panelId) => !current.has(panelId))
      if (!missing.length) return current
      return new Set([...current, ...missing])
    })
  }, [panelIds])

  return (
    <aside
      ref={setAsideRef}
      className={cn(
        "relative flex max-h-full overflow-hidden border-border/55 bg-background/94 backdrop-blur-xl",
        presentation === "lane" ? "h-full w-full min-w-0 shadow-none" : "shadow-[0_0_32px_rgb(0_0_0/0.26)]",
        side === "left" ? "border-r" : "flex-row-reverse border-l",
        sidebarDropZone.isOver && "ring-2 ring-inset ring-primary/45",
      )}
      data-reader-sidebar={side}
      data-reader-sidebar-presentation={presentation}
      data-reader-edge-chrome={side}
      data-reader-panel-drop-active={sidebarDropZone.isOver ? "true" : undefined}
      style={style}
      onClick={presentation === "edge" ? handleBlankClick : undefined}
      onDoubleClick={presentation === "edge" ? handleBlankDoubleClick : undefined}
    >
      {presentation === "edge" ? <div
        aria-label={`调整${side === "left" ? "左" : "右"}侧栏宽度`}
        role="separator"
        aria-orientation="vertical"
        className={cn("absolute inset-y-0 z-20 w-1.5 cursor-ew-resize touch-none", side === "left" ? "right-0" : "left-0")}
        onPointerDown={(event) => startGesture(event, "width")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={cancelGesture}
      /> : null}
      {presentation === "lane" ? (
        <ReaderLanePanelBar
          owner={asideNode}
          handleStyle={shell?.workspace?.swimlane.barHandleStyle}
          handlePosition={shell?.workspace?.swimlane.barHandlePosition}
          side={side}
          panels={panels}
          activePanelId={active?.id}
          lane={shell?.workspace?.swimlane.lanes[side] ?? fallbackPanelBarLane(side)}
          onChange={(patch) => onPanelBarChange?.(patch)}
          onActivate={activatePanel}
        />
      ) : (
        <ReaderPanelIconRail
          side={side}
          panels={panels}
          activePanelId={active?.id}
          showPin
          pinned={shell?.edges[side].pinned ?? false}
          pinDisabled={context.disabled || !onLayoutCommit}
          onPinnedChange={(pinned) => onLayoutCommit?.({ side, pinned })}
          onActivate={activatePanel}
        />
      )}
      {panels.map((panel) => {
        const panelActive = panel.id === active?.id
        const panelVisible = edgeActive && panelActive
        const cards = cardsForPanel(panel.id, shell, hasSession)
        const exclusive = cards.length === 1 && cards[0]?.exclusivePanel === true
        const PanelIcon = panel.icon
        if (!panelActive && !mountedPanels.has(panel.id)) return null
        return (
          <div
            key={panel.id}
            className={cn(
              "min-h-0 min-w-0 flex-1 overscroll-contain",
              exclusive ? "relative flex h-full w-full basis-full flex-col self-stretch overflow-hidden" : "overflow-y-auto",
              !panelActive && "pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden",
            )}
            style={!panelActive ? { contentVisibility: "hidden", containIntrinsicSize: "auto 100%" } : undefined}
            aria-hidden={!panelVisible || undefined}
            data-reader-panel={panelVisible ? panel.id : undefined}
            data-reader-panel-cache={panel.id}
            data-reader-panel-active={panelActive ? "true" : "false"}
            data-reader-panel-visible={panelVisible ? "true" : "false"}
            data-context-menu={panelVisible && panel.id === "info" ? "neoview-info" : undefined}
          >
            {exclusive ? null : <div className="sticky top-0 z-10 flex min-h-11 items-center gap-2 border-b border-border/50 bg-transparent px-3 py-2">
              <PanelIcon className="size-4 shrink-0" aria-hidden="true" />
              <h2 className="truncate text-sm font-semibold">{panel.title}</h2>
              {panel.id === "info" ? <InfoPanelActions context={context} /> : null}
              {presentation === "edge" && layout?.height !== "full" && shell?.sidebarInteraction?.showDragHandle ? (
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
            {presentation === "edge" && exclusive && layout?.height !== "full" && shell?.sidebarInteraction?.showDragHandle ? (
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
            <div className={cn(exclusive
              ? "flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0 [&>*]:min-w-0 [&>*]:w-full [&>*]:flex-1"
              : "grid gap-2 px-3 py-3")}>
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
                      <Card {...context} panelActive={panelActive} panelVisible={panelVisible} />
                    </Suspense>
                  </CollapsibleReaderCard>
                ) : null
              })}
            </div>
          </div>
        )
      })}
      {presentation === "edge" ? <button
        type="button"
        aria-label={`调整${side === "left" ? "左" : "右"}侧栏大小`}
        className={cn("absolute bottom-0 z-30 size-4 cursor-nwse-resize touch-none opacity-0 hover:opacity-100 focus:opacity-100", side === "left" ? "right-0" : "left-0")}
        onPointerDown={(event) => startGesture(event, "corner")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={cancelGesture}
      /> : null}
    </aside>
  )

  function handleBlankClick(event: ReactMouseEvent<HTMLElement>): void {
    if (shell?.sidebarInteraction?.blankAreaCollapseMode !== "single") return
    collapseFromBlankArea(event.target)
  }

  function activatePanel(panelId: LegacyPanelId): void {
    setMountedPanels((current) => current.has(panelId) ? current : new Set(current).add(panelId))
    setLocalActivePanel(panelId)
    onSelectedPanelChange?.(panelId)
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
      const maxWidth = sidebarMaximumWidth()
      gesture.latest.width = clamp(gesture.width + widthDelta, Math.min(200, maxWidth), maxWidth)
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

function ReaderLanePanelBar({ side, panels, activePanelId, lane, owner, handleStyle, handlePosition, onActivate, onChange }: {
  side: ReaderPanelSide
  panels: readonly ReaderPanelDefinition[]
  activePanelId: LegacyPanelId | undefined
  lane: ReaderSwimlaneLaneDto
  owner: HTMLElement | null
  handleStyle?: "grip" | "groove" | "grab" | "move" | "edge"
  handlePosition?: "left" | "right"
  onActivate(panelId: LegacyPanelId): void
  onChange(patch: Partial<ReaderSwimlaneLaneDto>): void
}) {
  const rail = useReaderPanelRail(side, panels)
  return (
    <ReaderPanelBar side={side} lane={lane} owner={owner} handleStyle={handleStyle} handlePosition={handlePosition} setRailRef={rail.setNodeRef} onChange={onChange}>
      {rail.sortable(rail.panels.map((panel) => (
        <ReaderPanelIconButton key={panel.id} panel={panel} side={side} active={panel.id === activePanelId} onActivate={() => onActivate(panel.id)} />
      )))}
    </ReaderPanelBar>
  )
}

function fallbackPanelBarLane(side: ReaderPanelSide): ReaderSwimlaneLaneDto {
  return {
    width: side === "left" ? 320 : 280,
    collapsed: false,
    panelBarMode: "pinned",
    panelBarDock: side,
    panelBarPositionX: side === "left" ? 8 : 92,
    panelBarPositionY: 50,
    panelBarConstrained: true,
  }
}

function ReaderPanelIconRail({
  side,
  panels,
  activePanelId,
  showPin,
  pinned,
  pinDisabled,
  onPinnedChange,
  onActivate,
}: {
  side: ReaderPanelSide
  panels: readonly ReaderPanelDefinition[]
  activePanelId: LegacyPanelId | undefined
  showPin: boolean
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
      {showPin ? <button
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
      </button> : null}
      {showPin ? <span className="my-0.5 h-px w-6 shrink-0 bg-border" aria-hidden="true" /> : null}
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
  const PanelIcon = panel.icon
  return (
    <button
      ref={sortable.setNodeRef}
      data-reader-panel-bar-tab={panel.id}
      type="button"
      title={panel.canMove ? `${panel.title}（拖动可调整顺序）` : panel.title}
      aria-label={panel.title}
      aria-current={active ? "page" : undefined}
      aria-roledescription={panel.canMove ? "可拖动面板" : undefined}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary/90 text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        panel.canMove && !sortable.dragging && "cursor-pointer",
        sortable.dragging && "cursor-grabbing opacity-40",
      )}
      style={sortable.style}
      // Activate on pointer-up style click only when we did not start a drag.
      onClick={(event) => {
        if (sortable.dragging) {
          event.preventDefault()
          return
        }
        onActivate()
      }}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <PanelIcon className="size-4" aria-hidden="true" />
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
    maxWidth: "50vw",
    height,
    top: height === "100%" ? 0 : `${(100 - Number.parseFloat(height)) * (layout.verticalAlign / 100)}%`,
    left: side === "left" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    right: side === "right" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
  }
}

function sidebarMaximumWidth(): number {
  return Math.min(600, Math.max(0, window.innerWidth / 2))
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
