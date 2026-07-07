import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface KanbanCard { id: string; text: string }
interface KanbanColumn { id: string; titleKey: string; cards: KanbanCard[] }
type KanbanDndData =
  | { type: "card"; cardId: string; colId: string }
  | { type: "column"; colId: string }

let kId = 0

export default function KanbanModule() {
  const { t } = useTranslation()
  const [columns, setColumns] = useState<KanbanColumn[]>([
    { id: "backlog", titleKey: "module:kanban.backlog", cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.initScope") }, { id: `k-${++kId}`, text: t("module:kanban.defaultCards.defineRoles") }] },
    { id: "active",  titleKey: "module:kanban.active",  cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.deployGrid") }] },
    { id: "done",    titleKey: "module:kanban.done",    cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.kernelBoot") }] },
  ])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function addCard(colId: string) {
    const text = (drafts[colId] ?? "").trim()
    if (!text) return
    setColumns(cs => cs.map(c => c.id === colId ? { ...c, cards: [...c.cards, { id: `k-${++kId}`, text }] } : c))
    setDrafts(d => ({ ...d, [colId]: "" }))
  }

  function removeCard(colId: string, cardId: string) {
    setColumns(cs => cs.map(c => c.id === colId ? { ...c, cards: c.cards.filter(k => k.id !== cardId) } : c))
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as KanbanDndData | undefined
    const overData = event.over?.data.current as KanbanDndData | undefined
    if (!isCardData(activeData) || !overData) return
    if (isCardData(overData) && activeData.cardId === overData.cardId) return

    setColumns((current) => moveCard(
      current,
      activeData.cardId,
      activeData.colId,
      overData.colId,
      isCardData(overData) ? overData.cardId : null,
      shouldInsertAfter(event),
    ))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-2 h-full overflow-x-auto pb-1">
        {columns.map(col => (
          <KanbanColumnView
            key={col.id}
            col={col}
            draft={drafts[col.id] ?? ""}
            onDraftChange={(value) => setDrafts(d => ({ ...d, [col.id]: value }))}
            onAdd={() => addCard(col.id)}
            onRemove={(cardId) => removeCard(col.id, cardId)}
            translate={t}
          />
        ))}
      </div>
    </DndContext>
  )
}

function KanbanColumnView({
  col,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  translate,
}: {
  col: KanbanColumn
  draft: string
  onDraftChange: (value: string) => void
  onAdd: () => void
  onRemove: (cardId: string) => void
  translate: ReturnType<typeof useTranslation>["t"]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnDndId(col.id),
    data: { type: "column", colId: col.id } satisfies KanbanDndData,
  })

  return (
    <div
      ref={setNodeRef}
      data-kanban-column={col.id}
      className={cn(
        "flex flex-col gap-1 min-w-[140px] flex-1 rounded border p-2 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border/50 bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest">{translate(col.titleKey)}</span>
        <span className="text-[10px] font-mono text-primary bg-primary/10 px-1 rounded">{col.cards.length}</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto">
        <SortableContext items={col.cards.map((card) => cardDndId(card.id))} strategy={verticalListSortingStrategy}>
          {col.cards.map(card => (
            <KanbanCardItem
              key={card.id}
              card={card}
              colId={col.id}
              onRemove={() => onRemove(card.id)}
            />
          ))}
        </SortableContext>
      </div>

      <div className="flex gap-1 mt-1">
        <Input
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onAdd()}
          placeholder={translate("module:kanban.addPlaceholder")}
          className="h-6 text-[11px] font-mono bg-background/60 border-border/40 px-2"
        />
        <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={onAdd}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function KanbanCardItem({
  card,
  colId,
  onRemove,
}: {
  card: KanbanCard
  colId: string
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardDndId(card.id),
    data: { type: "card", cardId: card.id, colId } satisfies KanbanDndData,
  })

  return (
    <div
      ref={setNodeRef}
      data-kanban-card={card.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-start gap-1 bg-card border border-border/50 rounded px-2 py-1.5 text-xs hover:border-primary/40 transition-colors",
        isDragging ? "opacity-50 ring-2 ring-primary/40" : undefined,
      )}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        data-kanban-card-drag-handle="true"
        className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-3 w-3" />
      </span>
      <span className="flex-1 font-mono text-[11px] leading-tight break-words">{card.text}</span>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

function moveCard(
  columns: KanbanColumn[],
  cardId: string,
  fromColId: string,
  toColId: string,
  overCardId: string | null,
  insertAfter: boolean,
): KanbanColumn[] {
  let moved: KanbanCard | undefined
  const withoutMoved = columns.map((column) => {
    if (column.id !== fromColId) return column
    return {
      ...column,
      cards: column.cards.filter((card) => {
        if (card.id !== cardId) return true
        moved = card
        return false
      }),
    }
  })

  if (!moved) return columns
  const movedCard = moved

  return withoutMoved.map((column) => {
    if (column.id !== toColId) return column
    const cards = [...column.cards]
    const overIndex = overCardId ? cards.findIndex((card) => card.id === overCardId) : -1
    const insertIndex = overIndex < 0 ? cards.length : overIndex + (insertAfter ? 1 : 0)
    cards.splice(insertIndex, 0, movedCard)
    return { ...column, cards }
  })
}

function shouldInsertAfter(event: DragEndEvent): boolean {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial
  const overRect = event.over?.rect
  if (!activeRect || !overRect) return false

  const activeCenter = activeRect.top + activeRect.height / 2
  const overCenter = overRect.top + overRect.height / 2
  return activeCenter > overCenter
}

function isCardData(data: KanbanDndData | undefined): data is Extract<KanbanDndData, { type: "card" }> {
  return data?.type === "card"
}

function cardDndId(cardId: string): string {
  return `kanban-card:${cardId}`
}

function columnDndId(colId: string): string {
  return `kanban-column:${colId}`
}
