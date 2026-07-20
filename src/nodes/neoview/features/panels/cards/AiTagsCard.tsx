/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/AiTagsCard.tsx
 * @migration-status adapted
 */
import { Tags } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function AiTagsCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看 AI 标签</ReaderCardEmptyState>
  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-tags">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Tags className="size-3.5 text-muted-foreground" />
        AI 标签推断
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        生成式 AI 标签推断尚未接入统一控制面。现有 EMM 标签编辑、收藏标签与搜索联动请使用属性面板中的「EMM 标签」。
      </p>
      <Button type="button" size="sm" variant="outline" className="h-8 w-full text-[11px]" disabled title="待接入生成式标签能力">
        推断当前书籍标签
      </Button>
    </div>
  )
}
