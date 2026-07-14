import type { DragEvent, ReactNode } from "react"
import type { CzkawkaCardConfig, CzkawkaCardId, CzkawkaCardLayout, CzkawkaCardPanelId } from "@xiranite/node-czkawka/card-layout"
import { cardsForPanel, createDefaultCzkawkaCardLayout, CZKAWKA_CARD_REGISTRY, moveCzkawkaCard, moveCzkawkaCardBy, updateCzkawkaCard } from "@xiranite/node-czkawka/card-layout"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, LayoutPanelTop, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string

const DRAG_TYPE = "application/x-czkawka-card"

export function CzkawkaCardStack({ layout, panel, onChange, renderCard }: { layout: CzkawkaCardLayout; panel: CzkawkaCardPanelId; onChange: (layout: CzkawkaCardLayout) => void; renderCard: (id: CzkawkaCardId) => ReactNode }) {
  const { t } = useNodeI18n("czkawka")
  const cards = cardsForPanel(layout, panel)
  function dropAtEnd(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const id = event.dataTransfer.getData(DRAG_TYPE) as CzkawkaCardId
    if (id) onChange(moveCzkawkaCard(layout, id, panel, cards.length))
  }
  return (
    <div data-testid={`czkawka-card-stack-${panel}`} className="grid content-start gap-2" onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
      {cards.map((card, index) => (
        <CzkawkaLayoutCard key={card.id} card={card} first={index === 0} last={index === cards.length - 1} onChange={onChange} layout={layout} t={t}>
          {renderCard(card.id)}
        </CzkawkaLayoutCard>
      ))}
      {cards.length ? null : <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">{t("cards.empty", "该面板没有可见卡片")}</div>}
    </div>
  )
}

function CzkawkaLayoutCard({ card, first, last, layout, onChange, children, t }: { card: CzkawkaCardConfig; first: boolean; last: boolean; layout: CzkawkaCardLayout; onChange: (layout: CzkawkaCardLayout) => void; children: ReactNode; t: Translate }) {
  const definition = CZKAWKA_CARD_REGISTRY.find((item) => item.id === card.id)!
  const title = cardTitle(definition.id, definition.title, t)
  function startDrag(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(DRAG_TYPE, card.id)
  }
  function dropBefore(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    const id = event.dataTransfer.getData(DRAG_TYPE) as CzkawkaCardId
    if (id) onChange(moveCzkawkaCard(layout, id, card.panel, card.order))
  }
  return (
    <article data-card-id={card.id} draggable onDragStart={startDrag} onDragOver={(event) => event.preventDefault()} onDrop={dropBefore} className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-card" style={card.collapsed ? undefined : { height: card.height }}>
      <header className="flex shrink-0 items-center gap-1 border-b bg-muted/20 px-1 py-1">
        <GripVertical className="size-3 cursor-grab text-muted-foreground" />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold"
          onClick={() =>
            onChange(
              updateCzkawkaCard(layout, card.id, {
                collapsed: !card.collapsed
              })
            )
          }
        >
          {card.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          <span className="truncate">{title}</span>
        </button>
        <Button aria-label={t("cards.moveUp", "上移{{title}}", { title })} disabled={first} size="icon-xs" variant="ghost" onClick={() => onChange(moveCzkawkaCardBy(layout, card.id, -1))}>
          <ArrowUp />
        </Button>
        <Button aria-label={t("cards.moveDown", "下移{{title}}", { title })} disabled={last} size="icon-xs" variant="ghost" onClick={() => onChange(moveCzkawkaCardBy(layout, card.id, 1))}>
          <ArrowDown />
        </Button>
      </header>
      {card.collapsed ? null : (
        <>
          <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
          <input
            aria-label={t("cards.resize", "调整{{title}}高度", { title })}
            title={t("cards.resizeHint", "拖动调整高度，双击恢复默认")}
            className="h-1 w-full cursor-row-resize accent-primary"
            type="range"
            min={definition.minHeight}
            max={definition.maxHeight}
            step={8}
            value={card.height}
            onDoubleClick={() =>
              onChange(
                updateCzkawkaCard(layout, card.id, {
                  height: definition.defaultHeight
                })
              )
            }
            onChange={(event) =>
              onChange(
                updateCzkawkaCard(layout, card.id, {
                  height: Number(event.currentTarget.value)
                })
              )
            }
          />
        </>
      )}
    </article>
  )
}

export function CzkawkaCardManager({ layout, onChange }: { layout: CzkawkaCardLayout; onChange: (layout: CzkawkaCardLayout) => void }) {
  const { t } = useNodeI18n("czkawka")
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label={t("cards.manage", "管理卡片")} size="icon-sm" variant="ghost">
          <LayoutPanelTop />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("cards.managerTitle", "卡片管理")}</DialogTitle>
          <DialogDescription>{t("cards.managerDescription", "配置卡片可见性、面板归属和顺序。拖动卡片也可跨面板移动。")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          {CZKAWKA_CARD_REGISTRY.map((definition) => {
            const card = layout.cards.find((item) => item.id === definition.id)!
            const title = cardTitle(definition.id, definition.title, t)
            return (
              <div key={definition.id} className="grid grid-cols-[minmax(0,1fr)_130px_auto] items-center gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{title}</div>
                  <div className="text-[10px] text-muted-foreground">{card.collapsed ? t("cards.collapsed", "已折叠") : `${card.height}px`}</div>
                </div>
                <Select value={card.panel} onValueChange={(panel) => onChange(moveCzkawkaCard(layout, card.id, panel as CzkawkaCardPanelId, layout.cards.filter((item) => item.panel === panel).length))}>
                  <SelectTrigger aria-label={t("cards.panel", "{{title}}面板", { title })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="source">{t("sections.conditions", "扫描条件")}</SelectItem>
                    <SelectItem value="analysis">{t("cards.analysisOperations", "分析操作")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  aria-label={card.visible ? t("cards.hide", "隐藏{{title}}", { title }) : t("cards.show", "显示{{title}}", { title })}
                  size="icon-sm"
                  variant={card.visible ? "secondary" : "ghost"}
                  onClick={() =>
                    onChange(
                      updateCzkawkaCard(layout, card.id, {
                        visible: !card.visible
                      })
                    )
                  }
                >
                  {card.visible ? <Eye /> : <EyeOff />}
                </Button>
              </div>
            )
          })}
        </div>
        <Button variant="outline" onClick={() => onChange(createDefaultCzkawkaCardLayout())}>
          <RotateCcw />
          {t("cards.restore", "恢复默认布局")}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function cardTitle(id: CzkawkaCardId, fallback: string, t: Translate): string {
  return t(`cards.titles.${id}`, fallback)
}
