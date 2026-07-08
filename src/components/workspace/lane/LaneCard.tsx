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
import { X } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useWorkspaceActions } from "@/store/workspaceContext"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { DefaultNodeDragGrip, NodeSurfaceChrome, type NodeSurfaceChromeAction } from "@/components/workspace/NodeSurfaceChrome"
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
  const moduleName = mod && i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : (mod?.name ?? moduleId)
  const actions: NodeSurfaceChromeAction[] = [
    {
      key: "hide",
      label: t("common:hideIn", { view: t("topbar:viewMode.lane") }),
      icon: <X className="h-3 w-3" />,
      danger: true,
      onClick: (e) => {
        e.stopPropagation()
        workspaceActions.toggleComponentVisibility(compId, "lane")
      },
    },
  ]
  const dragHandle = (
    <span
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      data-lane-card-drag-handle="true"
      className="cursor-grab text-muted-foreground/55 active:cursor-grabbing"
      title={t("common:dragToOtherLane")}
    >
      <DefaultNodeDragGrip />
    </span>
  )

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
        "group relative flex h-[clamp(420px,56vh,620px)] min-h-[420px] flex-col overflow-hidden rounded-md bg-card/72 text-card-foreground outline outline-1 outline-transparent shadow-[0_18px_50px_-36px_oklch(0_0_0/0.42)] backdrop-blur-md transition-[background-color,box-shadow,outline-color] hover:bg-card/82 hover:outline-border/35 hover:shadow-[0_22px_58px_-34px_oklch(0_0_0/0.5)]",
        isDragging ? "opacity-50 ring-2 ring-primary/40" : "",
      ].join(" ")}
    >
      <NodeSurfaceChrome actions={actions} dragHandle={dragHandle} moduleName={moduleName} version={mod?.version} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <ModuleRenderer moduleId={moduleId} compId={compId} />
      </div>
    </div>
  )
}
