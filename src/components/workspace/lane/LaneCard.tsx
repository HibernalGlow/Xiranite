/**
 * LaneCard — 泳道内的卡片。
 *
 * 从 Xlchemy LaneCard.svelte 移植为 React，简化为：
 * - 标题栏（拖拽手柄 + 模块名 + 关闭按钮）
 * - 内容区（ModuleRenderer）
 *
 * 拖拽：draggable 在最外层 div，拖动时 setCardDrag(id, laneId)。
 * 释放时由 LaneView 的 onDrop 统一 dispatch MOVE_COMPONENT_TO_LANE。
 *
 * 关闭：dispatch TOGGLE_COMPONENT_VISIBILITY(lane) — 仅在 lane 模式下隐藏。
 *
 * ⚠️ 不订阅 dragState 全局 store：HTML5 drag 期间 React 重渲染会中断拖拽上下文。
 *    只用本地 useState 跟踪 isDragging 显示视觉反馈。
 */
import { useState } from "react"
import { GripVertical, X } from "lucide-react"
import { useWSDispatch, actions } from "@/store/workspaceContext"
import { setCardDrag, clearDrag } from "@/store/dragState"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"

interface Props {
  compId: string
  moduleId: string
  laneId: string
}

export function LaneCard({ compId, moduleId, laneId }: Props) {
  const dispatch = useWSDispatch()
  const mod = getModule(moduleId)
  const [isDragging, setIsDragging] = useState(false)

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation()  // 阻止冒泡到 Lane 的 dragStart（避免整条 lane 被拖）
    setCardDrag(compId, laneId)
    setIsDragging(true)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/x-card-id", compId)
    }
  }

  function handleDragEnd() {
    clearDrag()
    setIsDragging(false)
  }

  return (
    <div
      data-card-id={compId}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={[
        "rounded-md border bg-card overflow-hidden flex flex-col",
        "border-border/60 shadow-sm",
        isDragging ? "opacity-50 ring-2 ring-primary/40" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 h-7 px-2 border-b border-border/40 bg-muted/30 flex-shrink-0">
        <span
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          title="拖到其他泳道"
        >
          <GripVertical className="h-3.5 w-3.5 rotate-90" />
        </span>
        <span className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase truncate flex-1">
          {mod?.name ?? moduleId}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch(actions.toggleComponentVisibility(compId, "lane"))
          }}
          className="grid h-4 w-4 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ModuleRenderer moduleId={moduleId} compId={compId} />
      </div>
    </div>
  )
}
