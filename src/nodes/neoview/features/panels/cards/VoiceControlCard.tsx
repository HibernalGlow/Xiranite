/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/VoiceControlCard.tsx
 * @migration-status adapted
 *
 * Browser speech recognition is host-specific and not yet exposed as a shared Reader capability.
 */
import { MicOff } from "lucide-react"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function VoiceControlCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看语音控制</ReaderCardEmptyState>
  return (
    <div className="space-y-3 text-xs" data-neoview-card="voice-control">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MicOff className="size-4 text-muted-foreground" />
        语音控制
      </div>
      <p className="text-muted-foreground leading-relaxed">
        语音识别与指令字典尚未接入统一 Reader 后端。当前请使用输入绑定与快捷键完成导航；
        后续会在不拖慢翻页热路径的前提下补齐可注入的 voice capability。
      </p>
    </div>
  )
}
