import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from "@dnd-kit/core"
import { closestCenter, pointerWithin, rectIntersection } from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, LayoutGrid, RotateCcw, Save } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanItemHandle, KanbanOverlay } from "@/components/ui/kanban"
import { cn } from "@/lib/utils"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { CARD_DEFINITIONS, PANEL_DEFINITIONS } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

type LaneId = "left" | "right" | "hidden"

interface BoardCard {
  id: string
  title: string
  canHide: boolean
}

interface BoardPanel {
  id: string
  title: string
  emoji: string
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
  emoji?: string
  cardCount?: number
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
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
}) {
  const [lanes, setLanes] = useState<BoardLanes>(() => createBoardLanes(shell))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState<DragState>()

  useEffect(() => setLanes(createBoardLanes(shell)), [shell])

  const panelIds = useMemo(
    () => ({
      left: lanes.left.map((panel) => panel.id),
      right: lanes.right.map((panel) => panel.id),
      hidden: lanes.hidden.map((panel) => panel.id),
    }),
    [lanes],
  )
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
    if (targets.length) return targets
    return rectIntersection(args).filter((target) => String(target.id) !== activeId)
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
      setDrag({
        kind,
        id: activeId,
        title,
        emoji: panel?.emoji,
        cardCount: panel?.cards.length,
      })
    }
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const kind = active.data.current?.kind as DragKind | undefined
    if (kind !== "card") return
    const activeId = String(active.id)
    const overId = String(over.id)
    event.activatorEvent.preventDefault()
    setLanes((current) => moveCardOver(current, activeId, overId))
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDrag(undefined)
    if (!over) return
    const kind = active.data.current?.kind as DragKind | undefined
    const activeId = String(active.id)
    const overId = String(over.id)
    if (kind === "panel") {
      return
    }
    if (kind === "card") {
      // Card ordering is updated during drag-over. Finalizing against a
      // panel's full-height drop zone would append an untouched card to the
      // bottom merely because the pointer was released over its own panel.
      event.activatorEvent.preventDefault()
    }
  }

  function onPanelColumnsChange(columns: Record<UniqueIdentifier, BoardPanel[]>) {
    setLanes((current) => acceptPanelColumns(current, columns))
  }

  return (
    <SettingsCardShell
      id="board-layout"
      title="布局看板"
      description="三泳道：左侧栏 / 右侧栏 / 隐藏。拖动面板切换边栏，拖动卡片在面板间分配。"
      icon={LayoutGrid}
      actions={
        <>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={reset}><RotateCcw />重置草稿</Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}><Save />保存布局</Button>
        </>
      }
    >
      <Kanban
        value={panelColumns}
        getItemValue={(panel) => panel.id}
        onValueChange={onPanelColumnsChange}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(undefined)}
      >
        <KanbanBoard
          className={cn("!grid h-auto grid-cols-1 gap-3 md:grid-cols-3", saving && "pointer-events-none opacity-60")}
          data-neoview-board-swimlanes="true"
        >
          {LANES.map((lane) => (
            <LaneColumn
              key={lane.id}
              lane={lane}
              panels={lanes[lane.id]}
              panelIds={panelIds[lane.id]}
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
        提示：不可隐藏的卡片不会进「隐藏」泳道；不接受卡片的面板（如文件夹）只作为面板位存在。
      </p>
    </SettingsCardShell>
  )
}

function LaneColumn({
  lane,
  panels,
  panelIds,
  disabled,
}: {
  lane: (typeof LANES)[number]
  panels: BoardPanel[]
  panelIds: string[]
  disabled: boolean
}) {
  return (
    <KanbanColumn
      value={lane.id}
      className="flex min-h-64 flex-col gap-2 rounded-lg border bg-muted/20 p-2"
      data-neoview-board-lane={lane.id}
    >
      <header className="px-1 pb-1">
        <h3 className="text-sm font-semibold">{lane.title}</h3>
        <p className="text-[10px] text-muted-foreground">{lane.hint}</p>
        <p className="text-[10px] tabular-nums text-muted-foreground">{panels.length} 个面板</p>
      </header>
      <SortableContext items={panelIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {panels.map((panel) => (
            <SortablePanel key={panel.id} panel={panel} laneId={lane.id} disabled={disabled || !panel.canMove} />
          ))}
          {panels.length === 0 ? (
            <div className="grid flex-1 place-items-center rounded-md border border-dashed px-2 py-8 text-center text-[11px] text-muted-foreground">
              拖入面板
            </div>
          ) : null}
        </div>
      </SortableContext>
    </KanbanColumn>
  )
}

function SortablePanel({
  panel,
  laneId,
  disabled,
}: {
  panel: BoardPanel
  laneId: LaneId
  disabled: boolean
}) {
  const cardIds = panel.cards.map((card) => card.id)
  return (
    <KanbanItem
      value={panel.id}
      className="overflow-hidden rounded-md border bg-card p-0 shadow-sm"
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
        <span className="grid size-6 place-items-center rounded bg-muted text-xs" aria-hidden="true">{panel.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{panel.title}</div>
          <div className="truncate text-[10px] uppercase text-muted-foreground">{panel.id}</div>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">{panel.cards.length}</span>
      </header>
      <div className="space-y-1 p-1.5" data-panel-drop-zone={panel.id}>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
    data: { kind: "card", panelId, title: card.title, canHide: card.canHide },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1.5 rounded border bg-background px-2 py-1.5 text-[11px]",
        isDragging && "opacity-40",
      )}
      data-neoview-board-card={card.id}
    >
      <button
        type="button"
        className="touch-none text-muted-foreground"
        aria-label={`拖动卡片 ${card.title}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <span className="min-w-0 flex-1 truncate">{card.title}</span>
    </div>
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
        emoji: definition.emoji,
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
    const card: BoardCard = { id: definition.id, title: definition.title, canHide: definition.canHide }
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
        .map(({ id, title, canHide }) => ({ id, title, canHide }))
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
      // Panel in hidden lane: its cards stay on that panel but undocked.
      return panel.cards.map((card, order) => ({
        cardId: card.id,
        panelId: panel.id,
        visible: false,
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

function acceptPanelColumns(lanes: BoardLanes, columns: Record<UniqueIdentifier, BoardPanel[]>): BoardLanes {
  const next: BoardLanes = {
    left: columns.left ?? [],
    right: columns.right ?? [],
    hidden: columns.hidden ?? [],
  }
  for (const lane of LANES) {
    for (const panel of next[lane.id]) {
      const previous = findPanelLocation(lanes, panel.id)
      if (lane.id === "hidden" && !panel.canHide && previous?.lane !== "hidden") return lanes
      if (!panel.canMove && previous?.lane !== lane.id) return lanes
    }
  }
  return next
}

function moveCardOver(lanes: BoardLanes, cardId: string, overId: string): BoardLanes {
  const from = findCardLocation(lanes, cardId)
  if (!from) return lanes
  const target = resolveCardTarget(lanes, overId)
  if (!target) return lanes
  if (from.panelId === target.panelId && from.index === target.index) return lanes
  const card = lanes[from.lane][from.panelIndex]?.cards[from.index]
  if (!card) return lanes
  if (overId === from.panelId || overId === panelDropId(from.panelId)) return lanes
  if (target.lane === "hidden" && !card.canHide) return lanes
  const host = lanes[target.lane][target.panelIndex]
  if (!host?.acceptsCards && target.lane !== "hidden") return lanes

  const next = cloneLanes(lanes)
  const fromPanel = next[from.lane][from.panelIndex]
  const toPanel = next[target.lane][target.panelIndex]
  if (!fromPanel || !toPanel) return lanes
  const [moved] = fromPanel.cards.splice(from.index, 1)
  if (!moved) return lanes
  const insertAt = from.panelId === target.panelId && from.index < target.index ? target.index - 1 : target.index
  toPanel.cards.splice(Math.max(0, insertAt), 0, moved)
  return next
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

function panelDropId(panelId: string): string {
  return `panel-drop:${panelId}`
}

function BoardDragPreview({ drag }: { drag: DragState }) {
  if (drag.kind === "panel") {
    return (
      <article className="w-64 overflow-hidden rounded-md border border-primary/40 bg-card shadow-2xl" data-neoview-drag-preview="panel">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <span className="grid size-6 place-items-center rounded bg-muted text-xs" aria-hidden="true">
            {drag.emoji ?? "#"}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{drag.title}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{drag.cardCount ?? 0}</span>
        </header>
        <div className="h-16 bg-muted/20" aria-hidden="true" />
      </article>
    )
  }

  return (
    <div className="flex w-56 items-center gap-2 rounded border border-primary/40 bg-background px-3 py-2 text-[11px] shadow-2xl" data-neoview-drag-preview="card">
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{drag.title}</span>
    </div>
  )
}

export default BoardSwimlaneEditor
