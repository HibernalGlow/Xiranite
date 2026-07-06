import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface KanbanCard { id: string; text: string }
interface KanbanColumn { id: string; titleKey: string; cards: KanbanCard[] }

let kId = 0

export default function KanbanModule() {
  const { t } = useTranslation()
  const [columns, setColumns] = useState<KanbanColumn[]>([
    { id: "backlog", titleKey: "module:kanban.backlog", cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.initScope") }, { id: `k-${++kId}`, text: t("module:kanban.defaultCards.defineRoles") }] },
    { id: "active",  titleKey: "module:kanban.active",  cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.deployGrid") }] },
    { id: "done",    titleKey: "module:kanban.done",    cards: [{ id: `k-${++kId}`, text: t("module:kanban.defaultCards.kernelBoot") }] },
  ])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<{ cardId: string; fromCol: string } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function addCard(colId: string) {
    const text = (drafts[colId] ?? "").trim()
    if (!text) return
    setColumns(cs => cs.map(c => c.id === colId ? { ...c, cards: [...c.cards, { id: `k-${++kId}`, text }] } : c))
    setDrafts(d => ({ ...d, [colId]: "" }))
  }

  function removeCard(colId: string, cardId: string) {
    setColumns(cs => cs.map(c => c.id === colId ? { ...c, cards: c.cards.filter(k => k.id !== cardId) } : c))
  }

  function onDragStart(cardId: string, fromCol: string) {
    setDragging({ cardId, fromCol })
  }

  function onDrop(toCol: string) {
    if (!dragging || dragging.fromCol === toCol) { setDragging(null); setDragOver(null); return }
    const { cardId, fromCol } = dragging
    setColumns(cs => {
      let card: KanbanCard | undefined
      const next = cs.map(c => {
        if (c.id === fromCol) { card = c.cards.find(k => k.id === cardId); return { ...c, cards: c.cards.filter(k => k.id !== cardId) } }
        return c
      })
      return next.map(c => c.id === toCol && card ? { ...c, cards: [...c.cards, card] } : c)
    })
    setDragging(null)
    setDragOver(null)
  }

  return (
    <div className="flex gap-2 h-full overflow-x-auto pb-1">
      {columns.map(col => (
        <div
          key={col.id}
          className={cn(
            "flex flex-col gap-1 min-w-[140px] flex-1 rounded border p-2 transition-colors",
            dragOver === col.id ? "border-primary/60 bg-primary/5" : "border-border/50 bg-muted/20"
          )}
          onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
          onDragLeave={() => setDragOver(null)}
          onDrop={() => onDrop(col.id)}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest">{t(col.titleKey)}</span>
            <span className="text-[10px] font-mono text-primary bg-primary/10 px-1 rounded">{col.cards.length}</span>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto">
            {col.cards.map(card => (
              <div
                key={card.id}
                draggable
                onDragStart={() => onDragStart(card.id, col.id)}
                className="group flex items-start gap-1 bg-card border border-border/50 rounded px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
              >
                <span className="flex-1 font-mono text-[11px] leading-tight break-words">{card.text}</span>
                <button
                  onClick={() => removeCard(col.id, card.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
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
            <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={() => addCard(col.id)}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
