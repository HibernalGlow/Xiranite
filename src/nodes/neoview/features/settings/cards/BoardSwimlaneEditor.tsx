import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  UniqueIdentifier,
} from "@dnd-kit/core"
import { closestCenter, pointerWithin, rectIntersection } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { GripVertical, LayoutGrid, PanelLeft, RotateCcw, Save, type LucideIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanItemHandle, KanbanOverlay } from "@/components/ui/kanban"
import { LaneCollapseIcon } from "@/components/workspace/lane/LaneCollapseIcon"
import { cn } from "@/lib/utils"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { CARD_DEFINITIONS, PANEL_DEFINITIONS } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

type LaneId = "left" | "right" | "hidden"

interface BoardCard {
  id: string
  title: string
  canHide: boolean
  exclusivePanel: boolean
}

interface BoardPanel {
  id: string
  title: string
  icon: LucideIcon
  canMove: boolean
  canHide: boolean
  acceptsCards: boolean
  cards: BoardCard[]
}

type BoardLanes = Record<LaneId, BoardPanel[]>

const LANES: Array<{ id: LaneId; title: string; hint: string }> = [
  { id: "left", title: "左侧栏", hint: "停靠在阅读器左侧" },
  { id: "right", title: "右侧栏", hint: "停靠在阅读器右侧" },
  { id: "hidden", title: "隐藏", hint: "不显示的面板与卡片" },
]

type DragKind = "panel" | "card"

interface DragState {
  kind: DragKind
  id: string
  title: string
  icon?: LucideIcon
  cardCount?: number
  width?: number
  height?: number
}

/**
 * Unified swimlane board: left / right / hidden lanes.
 * - Panels drag between lanes (and reorder within a lane)
 * - Cards drag between panels (and into hidden as undocked cards)
 * Fuses former "边栏管理" + "卡片管理" into one board.
 */
export function BoardSwimlaneEditor({
  shell,
  onSave,
  embedded = false,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  embedded?: boolean
}) {
  const [lanes, setLanes] = useState<BoardLanes>(() => createBoardLanes(shell))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState<DragState>()
  const [collapsedLanes, setCollapsedLanes] = useState<Record<LaneId, boolean>>({ left: false, right: false, hidden: false })
  const dragInitialLanesRef = useRef<BoardLanes>()
  // Only re-sync the draft when the board itself changes. Depending on the whole
  // `shell` object reset the kanban whenever workspace auto-fit / material wrote
  // a new shell identity — wiping in-progress left/right moves and thrashing render.
  const boardSyncKey = `${shell.revision ?? 0}\0${JSON.stringify(shell.panelLayout)}\0${JSON.stringify(shell.cardLayout)}`

  useEffect(() => {
    if (saving) return
    setLanes((current) => {
      const next = createBoardLanes(shell)
      // Avoid re-render thrash when the board payload is unchanged.
      return boardLanesEqual(current, next) ? current : next
    })
    // shell is read when boardSyncKey changes (revision / panel / card layout).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional board-only sync
  }, [boardSyncKey, saving])

  const panelColumns = useMemo<Record<UniqueIdentifier, BoardPanel[]>>(() => ({
    left: lanes.left,
    right: lanes.right,
    hidden: lanes.hidden,
  }), [lanes])
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeId = String(args.active.id)
    if (findPanelLocation(lanes, activeId)) {
      const panelTargets = new Set<string>([
        ...LANES.map((lane) => lane.id),
        ...LANES.flatMap((lane) => lanes[lane.id].map((panel) => panel.id)),
      ])
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) =>
          String(container.id) !== activeId && panelTargets.has(String(container.id)),
        ),
      })
    }

    const targets = pointerWithin(args).filter((target) => String(target.id) !== activeId)
    const cardTarget = targets.find((target) => findCardLocation(lanes, String(target.id)))
    if (cardTarget) return [cardTarget]
    const panelTarget = targets.find((target) => findPanelLocation(lanes, String(target.id)))
    if (panelTarget) return [panelTarget]

    const intersections = rectIntersection(args).filter((target) => String(target.id) !== activeId)
    const intersectedCard = intersections.find((target) => findCardLocation(lanes, String(target.id)))
    if (intersectedCard) return [intersectedCard]
    return intersections
  }, [lanes])

  async function save() {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onSave(createBoardPatch(shell, lanes))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setError(undefined)
    setLanes(createBoardLanes(shell, true))
  }

  function onDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id)
    const panelLocation = findPanelLocation(lanes, activeId)
    const panel = panelLocation ? lanes[panelLocation.lane][panelLocation.index] : undefined
    const cardLocation = panel ? undefined : findCardLocation(lanes, activeId)
    const card = cardLocation ? lanes[cardLocation.lane][cardLocation.panelIndex]?.cards[cardLocation.index] : undefined
    const kind: DragKind | undefined = panel ? "panel" : card ? "card" : undefined
    const title = panel?.title ?? card?.title ?? activeId
    if (kind === "panel" || kind === "card") {
      dragInitialLanesRef.current = cloneLanes(lanes)
      setDrag({
        kind,
        id: activeId,
        title,
        icon: panel?.icon,
        cardCount: panel?.cards.length,
        width: event.active.rect.current.initial?.width,
        height: event.active.rect.current.initial?.height,
      })
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDrag(undefined)
    const initialLanes = dragInitialLanesRef.current
    dragInitialLanesRef.current = undefined
    if (!over) {
      if (initialLanes) setLanes(initialLanes)
      return
    }
    const activeId = String(active.id)
    const base = initialLanes ?? lanes
    setLanes(applyBoardDrop(base, activeId, String(over.id)))
  }

  function onDragCancel() {
    setDrag(undefined)
    const initialLanes = dragInitialLanesRef.current
    dragInitialLanesRef.current = undefined
    if (initialLanes) setLanes(initialLanes)
  }

  const actions = <>
    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={reset}><RotateCcw />重置草稿</Button>
    <Button type="button" size="sm" disabled={saving} onClick={() => void save()}><Save />保存布局</Button>
  </>
  const content = <>
      <Kanban
        value={panelColumns}
        getItemValue={(panel) => panel.id}
        // Keep the rendered board stable while dnd-kit measures collision
        // targets. Placement is applied once in onDragEnd.
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <KanbanBoard
          className={cn(
            "h-[min(68vh,720px)] w-full min-w-0 gap-0 overflow-x-auto overflow-y-hidden rounded-md border",
            saving && "pointer-events-none opacity-60",
          )}
          data-neoview-board-swimlanes="true"
        >
          {LANES.map((lane) => (
            <LaneColumn
              key={lane.id}
              lane={lane}
              panels={lanes[lane.id]}
              collapsed={collapsedLanes[lane.id]}
              onCollapsedChange={(collapsed) => setCollapsedLanes((current) => ({ ...current, [lane.id]: collapsed }))}
              disabled={saving}
            />
          ))}
        </KanbanBoard>
        <KanbanOverlay className="z-[1000]">
          {() => drag ? <BoardDragPreview drag={drag} /> : null}
        </KanbanOverlay>
      </Kanban>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        提示：不可隐藏的卡片不会进「隐藏」泳道；独占卡片不能与其他卡片共用可见面板。
      </p>
  </>
  if (embedded) return <div className="grid gap-3"><div className="flex flex-wrap justify-end gap-2">{actions}</div>{content}</div>
  return (
    <SettingsCardShell
      id="board-layout"
      title="布局看板"
      description="三泳道：左侧栏 / 右侧栏 / 隐藏。拖动面板切换边栏，拖动卡片在面板间分配。"
      icon={LayoutGrid}
      actions={actions}
    >
      {content}
    </SettingsCardShell>
  )
}

function LaneColumn({
  lane,
  panels,
  collapsed,
  onCollapsedChange,
  disabled,
}: {
  lane: (typeof LANES)[number]
  panels: BoardPanel[]
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  disabled: boolean
}) {
  if (collapsed) {
    return (
      <KanbanColumn
        value={lane.id}
        className="h-full w-12 min-w-12 flex-none items-center gap-2 rounded-none border-0 border-r bg-muted/20 px-1 py-3 hover:bg-muted/40"
        data-neoview-board-lane={lane.id}
        data-neoview-board-lane-collapsed="true"
      >
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`展开${lane.title}`}
          onClick={() => onCollapsedChange(false)}
        >
          <LaneCollapseIcon collapsed />
        </button>
        <span
          className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {lane.title}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{panels.length}</span>
      </KanbanColumn>
    )
  }

  return (
    <KanbanColumn
      value={lane.id}
      className={cn(
        "h-full w-80 flex-none gap-0 rounded-none border-0 border-r bg-card/35 p-0 last:border-r-0",
        lane.id === "hidden" && "bg-muted/20",
      )}
      data-neoview-board-lane={lane.id}
    >
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/40 bg-muted/30 px-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`折叠${lane.title}`}
          onClick={() => onCollapsedChange(true)}
        >
          <LaneCollapseIcon collapsed={false} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[11px] font-mono font-semibold uppercase tracking-widest">{lane.title}</h3>
        </div>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground" title={lane.hint}>{panels.length}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {panels.map((panel) => (
          <SortablePanel key={panel.id} panel={panel} disabled={disabled || !panel.canMove} />
        ))}
        {panels.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-md border border-dashed px-2 py-8 text-center text-[11px] text-muted-foreground">
            拖入面板
          </div>
        ) : null}
      </div>
    </KanbanColumn>
  )
}

function SortablePanel({
  panel,
  disabled,
}: {
  panel: BoardPanel
  disabled: boolean
}) {
  const cardIds = panel.cards.map((card) => card.id)
  const exclusive = panel.cards.find((card) => card.exclusivePanel)
  const PanelIcon = panel.icon
  return (
    <KanbanItem
      value={panel.id}
      className="relative z-0 h-auto flex-none overflow-visible rounded-md border bg-card p-0 shadow-sm data-dragging:z-20"
      data-neoview-board-panel={panel.id}
    >
      <header className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <KanbanItemHandle
          className="touch-none text-muted-foreground disabled:opacity-40"
          aria-label={`拖动面板 ${panel.title}`}
          disabled={disabled}
          data-kind="panel"
          data-title={panel.title}
        >
          <GripVertical className="size-3.5" />
        </KanbanItemHandle>
        <span className="grid size-6 place-items-center rounded bg-muted" aria-hidden="true"><PanelIcon className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{panel.title}</div>
          <div className="truncate text-[10px] uppercase text-muted-foreground">{panel.id}</div>
        </div>
        {exclusive ? <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px] font-normal">独占面板</Badge> : null}
        <span className="text-[10px] tabular-nums text-muted-foreground">{panel.cards.length}</span>
      </header>
      <div className="flex h-auto flex-col gap-1 p-1.5" data-panel-drop-zone={panel.id}>
        {panel.acceptsCards ? (
          <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
            {panel.cards.map((card) => (
              <SortableCard key={card.id} card={card} panelId={panel.id} disabled={disabled} />
            ))}
            {panel.cards.length === 0 ? (
              <div className="rounded border border-dashed px-2 py-3 text-center text-[10px] text-muted-foreground">
                拖入卡片
              </div>
            ) : null}
          </SortableContext>
        ) : (
          <div className="px-1 py-2 text-[10px] text-muted-foreground">此面板不接受卡片</div>
        )}
      </div>
    </KanbanItem>
  )
}

function SortableCard({
  card,
  panelId,
  disabled,
}: {
  card: BoardCard
  panelId: string
  disabled: boolean
}) {
  return (
    <KanbanItem
      value={card.id}
      className="relative z-0 flex h-auto min-h-8 flex-none items-center gap-1.5 rounded border bg-background px-2 py-1.5 text-[11px] data-dragging:z-30"
      data-neoview-board-card={card.id}
      data-neoview-board-card-panel={panelId}
    >
      <KanbanItemHandle
        className="touch-none text-muted-foreground"
        aria-label={`拖动卡片 ${card.title}`}
        disabled={disabled}
      >
        <GripVertical className="size-3" />
      </KanbanItemHandle>
      <span className="min-w-0 flex-1 truncate">{card.title}</span>
      {card.exclusivePanel ? <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[9px] font-normal">独占面板</Badge> : null}
    </KanbanItem>
  )
}

export function createBoardLanes(shell: ReaderShellConfigDto, defaults = false): BoardLanes {
  const lanes: BoardLanes = { left: [], right: [], hidden: [] }
  const panels = PANEL_DEFINITIONS.map((definition) => {
    const layout = shell.panelLayout[definition.id]
    const visible = defaults ? definition.defaultVisible : (layout?.visible ?? definition.defaultVisible)
    const position = defaults ? definition.defaultSide : (layout?.position ?? definition.defaultSide)
    const order = defaults ? definition.defaultOrder : (layout?.order ?? definition.defaultOrder)
    const lane: LaneId = !visible || (position !== "left" && position !== "right")
      ? "hidden"
      : position
    return {
      lane,
      order,
      panel: {
        id: definition.id,
        title: definition.title,
        icon: definition.icon,
        canMove: definition.canMove,
        canHide: definition.canHide,
        acceptsCards: definition.acceptsCards && (definition.defaultSide === "left" || definition.defaultSide === "right"),
        cards: [] as BoardCard[],
      } satisfies BoardPanel,
    }
  }).toSorted((left, right) => left.order - right.order || left.panel.id.localeCompare(right.panel.id))

  for (const entry of panels) lanes[entry.lane].push(entry.panel)

  const panelById = new Map(panels.map((entry) => [entry.panel.id, entry.panel]))
  const hiddenPanel = lanes.hidden[0]
  for (const definition of CARD_DEFINITIONS) {
    const config = shell.cardLayout[definition.id]
    const visible = defaults
      ? (definition.defaultSidebarVisible ?? definition.defaultVisible ?? true)
      : (config?.visible ?? definition.defaultSidebarVisible ?? true)
    const panelId = defaults
      ? definition.defaultPanel
      : (config?.panelId ?? definition.defaultPanel)
    const order = defaults ? 0 : (config?.order ?? 0)
    const card: BoardCard = {
      id: definition.id,
      title: definition.title,
      canHide: definition.canHide,
      exclusivePanel: definition.exclusivePanel,
    }
    if (!visible) {
      // Keep undocked cards on their home panel if it is already in the hidden lane;
      // otherwise attach to a synthetic bucket via the first hidden host panel or panel itself.
      const host = panelById.get(panelId) ?? hiddenPanel
      if (host) host.cards.push(Object.assign(card, { __order: order }) as BoardCard & { __order?: number })
      continue
    }
    const host = panelById.get(panelId)
    if (host) host.cards.push(Object.assign(card, { __order: order }) as BoardCard & { __order?: number })
  }

  for (const lane of Object.values(lanes)) {
    for (const panel of lane) {
      panel.cards = panel.cards
        .toSorted((left, right) => ((left as BoardCard & { __order?: number }).__order ?? 0) - ((right as BoardCard & { __order?: number }).__order ?? 0))
        .map(({ id, title, canHide, exclusivePanel }) => ({ id, title, canHide, exclusivePanel }))
    }
  }
  return lanes
}

export function createBoardPatch(shell: ReaderShellConfigDto, lanes: BoardLanes): ReaderBoardLayoutPatch {
  const panels = LANES.flatMap((lane) => lanes[lane.id].map((panel, order) => ({
    id: panel.id,
    visible: lane.id !== "hidden",
    order,
    position: (lane.id === "hidden"
      ? (PANEL_DEFINITIONS.find((definition) => definition.id === panel.id)?.defaultSide ?? "left")
      : lane.id) as "left" | "right" | "bottom" | "floating",
  })))

  const cards = LANES.flatMap((lane) => lanes[lane.id].flatMap((panel) => {
    if (lane.id === "hidden") {
      // Host panel is undocked. Only hide cards that allow it — required cards
      // (playlist-main, folder-main, …) keep visible:true (default playlist panel).
      return panel.cards.map((card, order) => ({
        cardId: card.id,
        panelId: panel.id,
        visible: !card.canHide,
        order,
      }))
    }
    return panel.cards.map((card, order) => ({
      cardId: card.id,
      panelId: panel.id,
      visible: true,
      order,
    }))
  }))

  // Preserve any shell cards not present in the board (defensive).
  const included = new Set(cards.map((card) => card.cardId))
  for (const [cardId, value] of Object.entries(shell.cardLayout)) {
    if (!included.has(cardId)) {
      cards.push({ cardId, panelId: value.panelId, visible: value.visible, order: value.order })
    }
  }

  return {
    expectedRevision: shell.revision ?? 0,
    board: { panels, cards },
  }
}

export function applyBoardDrop(lanes: BoardLanes, activeId: string, overId: string): BoardLanes {
  const next = findCardLocation(lanes, activeId)
    ? moveCardToTarget(lanes, activeId, overId)
    : findPanelLocation(lanes, activeId)
      ? movePanelToTarget(lanes, activeId, overId)
      : lanes
  return boardLanesEqual(lanes, next) ? lanes : next
}

function boardLanesEqual(left: BoardLanes, right: BoardLanes): boolean {
  for (const lane of LANES) {
    const leftPanels = left[lane.id]
    const rightPanels = right[lane.id]
    if (leftPanels.length !== rightPanels.length) return false
    for (let index = 0; index < leftPanels.length; index += 1) {
      const a = leftPanels[index]!
      const b = rightPanels[index]!
      if (a.id !== b.id || a.cards.length !== b.cards.length) return false
      for (let cardIndex = 0; cardIndex < a.cards.length; cardIndex += 1) {
        if (a.cards[cardIndex]!.id !== b.cards[cardIndex]!.id) return false
      }
    }
  }
  return true
}

function moveCardToTarget(lanes: BoardLanes, cardId: string, overId: string): BoardLanes {
  const from = findCardLocation(lanes, cardId)
  if (!from) return lanes
  const target = resolveCardTarget(lanes, overId)
  if (!target) return lanes
  if (from.panelId === target.panelId && from.index === target.index) return lanes
  if (!cardTargetAccepts(lanes, cardId, overId)) return lanes

  const next = cloneLanes(lanes)
  const fromPanel = next[from.lane][from.panelIndex]
  const toPanel = next[target.lane][target.panelIndex]
  if (!fromPanel || !toPanel) return lanes
  const [moved] = fromPanel.cards.splice(from.index, 1)
  if (!moved) return lanes
  const insertAt = from.panelId === target.panelId && from.index < target.index ? target.index - 1 : target.index
  toPanel.cards.splice(Math.max(0, Math.min(insertAt, toPanel.cards.length)), 0, moved)
  return next
}

function movePanelToTarget(lanes: BoardLanes, panelId: string, overId: string): BoardLanes {
  const from = findPanelLocation(lanes, panelId)
  if (!from) return lanes
  const targetLane = resolvePanelLane(lanes, overId)
  if (!targetLane) return lanes
  const panel = lanes[from.lane][from.index]
  if (!panel || !panel.canMove || (targetLane === "hidden" && !panel.canHide)) return lanes
  const overPanel = findPanelLocation(lanes, overId)
  let insertAt = overPanel?.lane === targetLane ? overPanel.index : lanes[targetLane].length
  if (from.lane === targetLane) {
    if (from.index === insertAt) return lanes
    if (from.index < insertAt) insertAt -= 1
  }
  const next = cloneLanes(lanes)
  const [moved] = next[from.lane].splice(from.index, 1)
  if (!moved) return lanes
  next[targetLane].splice(Math.max(0, Math.min(insertAt, next[targetLane].length)), 0, moved)
  return next
}

function resolvePanelLane(lanes: BoardLanes, overId: string): LaneId | undefined {
  if (overId === "left" || overId === "right" || overId === "hidden") return overId
  return findPanelLocation(lanes, overId)?.lane
}

function cardTargetAccepts(lanes: BoardLanes, cardId: string, overId: string): boolean {
  const from = findCardLocation(lanes, cardId)
  const target = resolveCardTarget(lanes, overId)
  if (!from || !target) return false
  const card = lanes[from.lane][from.panelIndex]?.cards[from.index]
  const host = lanes[target.lane][target.panelIndex]
  if (!card || !host) return false
  if (target.lane === "hidden") return card.canHide
  if (!host.acceptsCards) return false
  if (from.panelId === target.panelId) return true
  if (card.exclusivePanel) return host.cards.length === 0
  return !host.cards.some((candidate) => candidate.exclusivePanel)
}

function findPanelLocation(lanes: BoardLanes, panelId: string): { lane: LaneId; index: number } | undefined {
  for (const lane of LANES) {
    const index = lanes[lane.id].findIndex((panel) => panel.id === panelId)
    if (index >= 0) return { lane: lane.id, index }
  }
  return undefined
}

function findCardLocation(lanes: BoardLanes, cardId: string): { lane: LaneId; panelIndex: number; panelId: string; index: number } | undefined {
  for (const lane of LANES) {
    for (let panelIndex = 0; panelIndex < lanes[lane.id].length; panelIndex += 1) {
      const panel = lanes[lane.id][panelIndex]!
      const index = panel.cards.findIndex((card) => card.id === cardId)
      if (index >= 0) return { lane: lane.id, panelIndex, panelId: panel.id, index }
    }
  }
  return undefined
}

function resolveCardTarget(lanes: BoardLanes, overId: string): { lane: LaneId; panelIndex: number; panelId: string; index: number } | undefined {
  if (overId.startsWith("panel-drop:")) {
    const panelId = overId.slice("panel-drop:".length)
    const location = findPanelLocation(lanes, panelId)
    if (!location) return undefined
    const panel = lanes[location.lane][location.index]
    if (!panel) return undefined
    return { lane: location.lane, panelIndex: location.index, panelId, index: panel.cards.length }
  }
  if (overId.startsWith("lane:")) {
    // Dropping a card on empty lane body: attach to last panel in that lane if any.
    const lane = overId.slice(5) as LaneId
    const panels = lanes[lane]
    const last = panels[panels.length - 1]
    if (!last) return undefined
    return { lane, panelIndex: panels.length - 1, panelId: last.id, index: last.cards.length }
  }
  const asCard = findCardLocation(lanes, overId)
  if (asCard) return asCard
  const asPanel = findPanelLocation(lanes, overId)
  if (!asPanel) return undefined
  const panel = lanes[asPanel.lane][asPanel.index]
  if (!panel) return undefined
  return { lane: asPanel.lane, panelIndex: asPanel.index, panelId: panel.id, index: panel.cards.length }
}

function cloneLanes(lanes: BoardLanes): BoardLanes {
  return {
    left: lanes.left.map((panel) => ({ ...panel, cards: [...panel.cards] })),
    right: lanes.right.map((panel) => ({ ...panel, cards: [...panel.cards] })),
    hidden: lanes.hidden.map((panel) => ({ ...panel, cards: [...panel.cards] })),
  }
}

function BoardDragPreview({ drag }: { drag: DragState }) {
  if (drag.kind === "panel") {
    const PanelIcon = drag.icon ?? PanelLeft
    return (
      <article
        className="w-80 overflow-hidden rounded-md border border-primary/40 bg-card shadow-2xl"
        data-neoview-drag-preview="panel"
        style={{ width: drag.width, minHeight: drag.height }}
      >
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <span className="grid size-6 place-items-center rounded bg-muted" aria-hidden="true"><PanelIcon className="size-3.5" /></span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{drag.title}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{drag.cardCount ?? 0}</span>
        </header>
        <div className="min-h-12 bg-muted/20" aria-hidden="true" />
      </article>
    )
  }

  return (
    <div
      className="flex w-72 items-center gap-2 rounded border border-primary/40 bg-background px-3 py-2 text-[11px] shadow-2xl"
      data-neoview-drag-preview="card"
      style={{ width: drag.width, minHeight: drag.height }}
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{drag.title}</span>
    </div>
  )
}

export default BoardSwimlaneEditor
