/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/AiTagsCard.tsx
 * @migration-status adapted
 *
 * AI tag inference reuses EMM suggestion pipeline when available; full generative tagging is not on the control plane yet.
 */
import { Tags } from "lucide-react"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function AiTagsCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看 AI 标签</ReaderCardEmptyState>
  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-tags">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Tags className="size-4 text-muted-foreground" />
        AI 标签推断
      </div>
      <p className="text-muted-foreground leading-relaxed">
        生成式 AI 标签推断尚未接入统一控制面。现有 EMM 标签编辑与收藏标签请使用属性面板中的「EMM 标签」。
      </p>
    </div>
  )
}
