/**
 * LaneCard — 泳道内的卡片。
 *
 * 从 Xlchemy LaneCard.svelte 移植为 React，简化为：
 * - 标题栏（拖拽手柄 + 模块名 + 关闭按钮）
 * - 内容区（ModuleRenderer）
 *
 * 拖拽：拖动 grip 把手时调 setCardDrag(id, laneId)，可以拖到其他 lane。
 * 关闭：dispatch TOGGLE_COMPONENT_VISIBILITY(lane) — 仅在 lane 模式下隐藏。
 */
import { useRef } from "react"
import { GripVertical, X } from "lucide-react"
import { useWSDispatch, actions } from "@/store/workspaceContext"
import { setCardDrag, clearDrag, getDragState, subscribe } from "@/store/dragState"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { useSyncExternalStore } from "react"

interface Props {
  compId: string
  moduleId: string
  laneId: string
}

export function LaneCard({ compId, moduleId, laneId }: Props) {
  const dispatch = useWSDispatch()
  const mod = getModule(moduleId)
  const isDraggingRef = useRef(false)

  // 订阅 dragState 以判断当前 card 是否被拖动
  const dragState = useSyncExternalStore(
    subscribe,
    () => getDragState(),
    () => getDragState(),
  )
  const isDragging = dragState.cardId === compId
  const isDropTarget = dragState.targetCardId === compId
  const dropAfter = isDropTarget && dragState.insertAfter

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation()
    setCardDrag(compId, laneId)
    e.dataTransfer?.setData("text/x-card-id", compId)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
    isDraggingRef.current = true
  }

  function handleDragEnd() {
    isDraggingRef.current = false
    clearDrag()
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
        isDropTarget && !dropAfter ? "border-t-2 border-t-primary" : "",
        isDropTarget && dropAfter ? "border-b-2 border-b-primary" : "",
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
