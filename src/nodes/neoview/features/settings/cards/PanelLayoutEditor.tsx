import type { UniqueIdentifier } from "@dnd-kit/core"
import { GripVertical, Save } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanItemHandle, KanbanOverlay } from "@/components/ui/kanban"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { CARD_DEFINITIONS, PANEL_DEFINITIONS } from "../../panels/registry"

interface LayoutCardItem { id: string; title: string }
type LayoutColumns = Record<UniqueIdentifier, LayoutCardItem[]>
const HIDDEN_COLUMN = "__hidden__"

export default function PanelLayoutEditor({ shell, onSave }: { shell: ReaderShellConfigDto; onSave(patch: ReaderBoardLayoutPatch): Promise<void> }) {
  const [columns, setColumns] = useState<LayoutColumns>(() => createPanelLayoutColumns(shell))
  const [saving, setSaving] = useState(false)
  const latestColumnsRef = useRef(columns)
  latestColumnsRef.current = columns

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await onSave(createPanelBoardPatch(shell, latestColumnsRef.current))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-3" data-neoview-panel-layout-editor="true">
      <Kanban value={columns} getItemValue={(item) => item.id} onValueChange={setColumns}>
        <KanbanBoard className="h-[min(28rem,calc(100vh-16rem))] min-h-72 gap-3 overflow-x-auto">
          {Object.entries(columns).map(([panelId, cards]) => (
            <KanbanColumn key={panelId} value={panelId} className="h-full w-60 shrink-0 bg-muted/35" data-panel-layout-column={panelId}>
              <div className="flex h-8 items-center justify-between px-1 text-xs font-semibold">
                <span>{panelTitle(panelId)}</span>
                <span className="tabular-nums text-muted-foreground">{cards.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {cards.map((card) => (
                  <KanbanItem key={card.id} value={card.id} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-xs shadow-sm" data-panel-layout-card={card.id}>
                    <KanbanItemHandle aria-label={`拖动${card.title}`} className="text-muted-foreground"><GripVertical className="size-3.5" /></KanbanItemHandle>
                    <span className="min-w-0 flex-1 truncate">{card.title}</span>
                    <select
                      aria-label={`移动${card.title}到`}
                      className="max-w-24 rounded border bg-background px-1 py-0.5 text-[10px]"
                      value={panelId}
                      onChange={(event) => setColumns((current) => movePanelLayoutCard(current, card.id, event.target.value))}
                    >
                      <option value={HIDDEN_COLUMN}>隐藏</option>
                      {PANEL_DEFINITIONS.map((panel) => <option key={panel.id} value={panel.id}>{panel.title}</option>)}
                    </select>
                  </KanbanItem>
                ))}
              </div>
            </KanbanColumn>
          ))}
        </KanbanBoard>
        <KanbanOverlay>{({ value }) => <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-xl">{cardTitle(String(value))}</div>}</KanbanOverlay>
      </Kanban>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}><Save />保存面板布局</Button>
      </div>
    </div>
  )
}

export function createPanelLayoutColumns(shell: ReaderShellConfigDto): LayoutColumns {
  const panelIds = new Set<string>(PANEL_DEFINITIONS.map((panel) => panel.id))
  for (const panelId of Object.keys(shell.panelLayout)) panelIds.add(panelId)
  for (const card of CARD_DEFINITIONS) panelIds.add(shell.cardLayout[card.id]?.panelId ?? card.defaultPanel)
  const columns: LayoutColumns = { [HIDDEN_COLUMN]: [] }
  for (const panelId of panelIds) columns[panelId] = []
  for (const definition of CARD_DEFINITIONS) {
    const config = shell.cardLayout[definition.id]
    if (!(config?.visible ?? definition.defaultSidebarVisible ?? true)) {
      columns[HIDDEN_COLUMN]!.push({ id: definition.id, title: definition.title })
      continue
    }
    const panelId = config?.panelId ?? definition.defaultPanel
    columns[panelId] ??= []
    columns[panelId]!.push({ id: definition.id, title: definition.title })
  }
  for (const cards of Object.values(columns)) cards.sort((left, right) => (shell.cardLayout[left.id]?.order ?? 0) - (shell.cardLayout[right.id]?.order ?? 0))
  return columns
}

export function createPanelBoardPatch(shell: ReaderShellConfigDto, columns: LayoutColumns): ReaderBoardLayoutPatch {
  const cards = Object.entries(columns).flatMap(([panelId, values]) => values.map((card, order) => {
    const current = shell.cardLayout[card.id]
    return panelId === HIDDEN_COLUMN
      ? { cardId: card.id, panelId: current?.panelId ?? CARD_DEFINITIONS.find((definition) => definition.id === card.id)?.defaultPanel ?? "settings", visible: false, order }
      : { cardId: card.id, panelId, visible: true, order }
  }))
  const included = new Set(cards.map((card) => card.cardId))
  for (const [cardId, value] of Object.entries(shell.cardLayout)) if (!included.has(cardId)) cards.push({ cardId, panelId: value.panelId, visible: value.visible, order: value.order })
  const panelsWithVisibleCards = new Set(cards.filter((card) => card.visible).map((card) => card.panelId))
  const panelIds = new Set([...Object.keys(shell.panelLayout), ...panelsWithVisibleCards])
  return {
    board: {
      panels: [...panelIds].map((id) => {
        const current = shell.panelLayout[id]
        const definition = PANEL_DEFINITIONS.find((panel) => panel.id === id)
        return {
          id,
          visible: panelsWithVisibleCards.has(id) || current?.visible || false,
          order: current?.order ?? definition?.defaultOrder ?? 0,
          position: current?.position ?? definition?.defaultSide ?? "left",
        }
      }),
      cards,
    },
  }
}

export function movePanelLayoutCard(columns: LayoutColumns, cardId: string, destination: string): LayoutColumns {
  let moved: LayoutCardItem | undefined
  const next: LayoutColumns = {}
  for (const [panelId, cards] of Object.entries(columns)) {
    next[panelId] = cards.filter((card) => {
      if (card.id !== cardId) return true
      moved = card
      return false
    })
  }
  if (!moved) return columns
  next[destination] = [...(next[destination] ?? []), moved]
  return next
}

function panelTitle(panelId: string): string {
  if (panelId === HIDDEN_COLUMN) return "隐藏 / 未停靠"
  return PANEL_DEFINITIONS.find((panel) => panel.id === panelId)?.title ?? panelId
}

function cardTitle(cardId: string): string {
  return CARD_DEFINITIONS.find((card) => card.id === cardId)?.title ?? cardId
}
