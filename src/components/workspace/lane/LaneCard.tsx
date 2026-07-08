/**
 * LaneCard — 泳道内的卡片。
 *
 * 从 Xlchemy LaneCard.svelte 移植为 React，简化为：
 * - 标题栏（拖拽手柄 + 模块名 + 关闭按钮）
 * - 内容区（ModuleRenderer）
 *
 * 拖拽：由 @dnd-kit 的 sortable handle 触发，释放时由 LaneView dispatch MOVE_COMPONENT_TO_LANE。
 *
 * 关闭：dispatch TOGGLE_COMPONENT_VISIBILITY(lane) — 仅在 lane 模式下隐藏。
 *
 */
import { useTranslation } from "react-i18next"
import { GripVertical, X } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useWorkspaceActions } from "@/store/workspaceContext"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { cardDndId } from "./dndIds"

interface Props {
  compId: string
  moduleId: string
  laneId: string
}

export function LaneCard({ compId, moduleId, laneId }: Props) {
  const { t, i18n } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  const mod = getModule(moduleId)
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardDndId(compId),
    data: { type: "card", cardId: compId, laneId },
  })

  return (
    <div
      ref={setNodeRef}
      data-card-id={compId}
      data-component-id={compId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={[
        "rounded-md border bg-card overflow-hidden flex flex-col",
        "border-border/60 shadow-sm",
        isDragging ? "opacity-50 ring-2 ring-primary/40" : "",
      ].join(" ")}
    >
      <div className="xiranite-ui-copy flex items-center gap-1.5 h-7 px-2 border-b border-border/40 bg-muted/30 flex-shrink-0">
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          data-lane-card-drag-handle="true"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          title={t("common:dragToOtherLane")}
        >
          <GripVertical className="h-3.5 w-3.5 rotate-90" />
        </span>
        <span className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase truncate flex-1">
          {mod && i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : (mod?.name ?? moduleId)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            workspaceActions.toggleComponentVisibility(compId, "lane")
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
