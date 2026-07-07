import { useState } from "react"
import { useTranslation } from "react-i18next"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
  type UniqueIdentifier,
} from "@/components/ui/kanban"

interface KanbanCard {
  id: string
  text: string
}
interface KanbanColumnData {
  id: string
  titleKey: string
  cards: KanbanCard[]
}

let kId = 0

export default function KanbanModule() {
  const { t } = useTranslation()
  const [columns, setColumns] = useState<KanbanColumnData[]>([
    {
      id: "backlog",
      titleKey: "module:kanban.backlog",
      cards: [
        { id: `k-${++kId}`, text: t("module:kanban.defaultCards.initScope") },
        { id: `k-${++kId}`, text: t("module:kanban.defaultCards.defineRoles") },
      ],
    },
    {
      id: "active",
      titleKey: "module:kanban.active",
      cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.deployGrid") }],
    },
    {
      id: "done",
      titleKey: "module:kanban.done",
      cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.kernelBoot") }],
    },
  ])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // 转换为 DiceUI Kanban 需要的 Record<UniqueIdentifier, T[]> 格式
  const value = columns.reduce(
    (acc, col) => {
      acc[col.id] = col.cards
      return acc
    },
    {} as Record<UniqueIdentifier, KanbanCard[]>,
  )

  function handleValueChange(next: Record<UniqueIdentifier, KanbanCard[]>) {
    setColumns(prev =>
      prev
        .map(col => ({
          ...col,
          cards: next[col.id] ?? [],
        }))
        // 按 next 的 key 顺序重排列
        .sort((a, b) => Object.keys(next).indexOf(a.id) - Object.keys(next).indexOf(b.id)),
    )
  }

  function addCard(colId: string) {
    const text = (drafts[colId] ?? "").trim()
    if (!text) return
    setColumns(cs =>
      cs.map(c =>
        c.id === colId
          ? { ...c, cards: [...c.cards, { id: `k-${++kId}`, text }] }
          : c,
      ),
    )
    setDrafts(d => ({ ...d, [colId]: "" }))
  }

  function removeCard(colId: string, cardId: string) {
    setColumns(cs =>
      cs.map(c =>
        c.id === colId ? { ...c, cards: c.cards.filter(k => k.id !== cardId) } : c,
      ),
    )
  }

  return (
    <Kanban
      value={value}
      onValueChange={handleValueChange}
      getItemValue={item => item.id}
    >
      <KanbanBoard className="flex gap-2 h-full overflow-x-auto pb-1">
        {columns.map(col => (
          <KanbanColumn
            key={col.id}
            value={col.id}
            className="flex flex-col gap-1 min-w-[140px] flex-1 rounded border border-border/50 bg-muted/20 p-2"
          >
            <div className="flex items-center justify-between mb-1">
              <KanbanColumnHandle className="flex items-center gap-1 text-[10px] font-mono font-bold text-muted-foreground tracking-widest cursor-grab active:cursor-grabbing">
                <GripVertical className="h-3 w-3" />
                {t(col.titleKey)}
              </KanbanColumnHandle>
              <span className="text-[10px] font-mono text-primary bg-primary/10 px-1 rounded">
                {col.cards.length}
              </span>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto">
              {col.cards.map(card => (
                <KanbanItem
                  key={card.id}
                  value={card.id}
                  className="group flex items-start gap-1 bg-card border border-border/50 rounded px-2 py-1.5 text-xs hover:border-primary/40 transition-colors"
                >
                  <KanbanItemHandle className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                    <GripVertical className="h-3 w-3" />
                  </KanbanItemHandle>
                  <span className="flex-1 font-mono text-[11px] leading-tight break-words">
                    {card.text}
                  </span>
                  <button
                    onClick={() => removeCard(col.id, card.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </KanbanItem>
              ))}
            </div>

            <div className="flex gap-1 mt-1">
              <Input
                value={drafts[col.id] ?? ""}
                onChange={e => setDrafts(d => ({ ...d, [col.id]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addCard(col.id)}
                placeholder={t("module:kanban.addPlaceholder")}
                className="h-6 text-[11px] font-mono bg-background/60 border-border/40 px-2"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => addCard(col.id)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </KanbanColumn>
        ))}
      </KanbanBoard>

      <KanbanOverlay>
        {({ value: activeId, variant }) => {
          if (variant === "column") return null
          const activeCard = columns
            .flatMap(c => c.cards)
            .find(c => c.id === activeId)
          if (!activeCard) return null
          return (
            <div className="bg-card border border-primary/40 rounded px-2 py-1.5 text-xs shadow-lg opacity-90">
              <span className="font-mono text-[11px]">{activeCard.text}</span>
            </div>
          )
        }}
      </KanbanOverlay>
    </Kanban>
  )
}
