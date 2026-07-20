/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/TranslationOverlayCard.tsx
 * @migration-status adapted
 *
 * Page-region OCR overlay is not yet on the shared control plane.
 * This card documents status and avoids fake local-only state that would desync GUI/CLI.
 */
import { EyeOff } from "lucide-react"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function TranslationOverlayCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看翻译叠加层</ReaderCardEmptyState>
  return (
    <div className="space-y-3 text-xs" data-neoview-card="translation-overlay">
      <div className="flex items-center gap-2 text-sm font-medium">
        <EyeOff className="size-4 text-muted-foreground" />
        翻译叠加层
      </div>
      <p className="text-muted-foreground leading-relaxed">
        页面区域 OCR 叠加层尚未接入统一 Reader 控制面（区域持久化、导出/导入与翻页生命周期仍待迁移）。
        标题翻译请使用「标题翻译」与「翻译服务配置」。
      </p>
    </div>
  )
}
