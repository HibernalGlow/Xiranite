/**
 * LaneView — 泳道模式视图。
 *
 * 从 Xlchemy LaneContainer.svelte 移植为 React，作为 viewMode=lane 的渲染器。
 *
 * 数据模型（与其他 3 种 viewMode 共享同一份 store）：
 * - state.lanes: Lane[] — 当前 workspace 的所有泳道
 * - state.components: ComponentInstance[] — components 通过 laneId 归属到 lane
 * - lane.cardOrder: string[] — lane 内 card 的顺序
 *
 * 行为：
 * - lane 水平排列（flex-row），可水平滚动
 * - @dnd-kit 拖拽 lane 标题栏重排（REORDER_LANE）
 * - @dnd-kit 拖拽 card 跨 lane 移动（MOVE_COMPONENT_TO_LANE）
 * - 顶栏切换到 lane 时，若当前 workspace 还没 lane，自动建一个默认 lane
 * - "+ ADD LANE" 按钮：dispatch ADD_LANE
 * - 关闭 card：dispatch TOGGLE_COMPONENT_VISIBILITY(lane) — 仅 lane 模式下隐藏
 */
import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Columns3 } from "lucide-react"
import type { UniqueIdentifier } from "@dnd-kit/core"
import { useWorkspaceActions, useWorkspaceShallowSelector, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { Button } from "@/components/ui/button"
import { Kanban, KanbanBoard, KanbanOverlay } from "@/components/ui/kanban"
import { Lane } from "./Lane"
import { LaneCard } from "./LaneCard"
import { cn } from "@/lib/utils"

interface LaneCardItem {
  id: string
  moduleId: string
}

export function LaneView() {
  const { t } = useTranslation()
  const { lanes, activeWorkspaceId } = useWorkspaceShallowSelector((state) => ({
    lanes: state.lanes,
    activeWorkspaceId: state.activeWorkspaceId,
  }))
  const visibleComponents = useWorkspaceVisibleComponents()
  const workspaceActions = useWorkspaceActions()
  const handleDropModule = useCallback((moduleId: string) => {
    workspaceActions.deployComponent(moduleId, { viewMode: "lane" })
  }, [workspaceActions])
  const { isModuleOver, moduleDropHandlers } = useModuleDropTarget(handleDropModule)

  // 当前 workspace 的 lanes（隐藏的不渲染）
  const wsLanes = useMemo(
    () => lanes.filter(l => l.workspaceId === activeWorkspaceId && !l.hidden),
    [lanes, activeWorkspaceId],
  )

  // 在 lane 模式下未隐藏的组件
  const laneComponents = useMemo(
    () => visibleComponents.filter(c => isComponentVisibleInView(c, "lane")),
    [visibleComponents],
  )

  // 每个 lane 内的组件列表（按 cardOrder 排序；不在 cardOrder 中的也加上，放到末尾）
  const kanbanValue = useMemo<Record<UniqueIdentifier, LaneCardItem[]>>(() => {
    const columns: Record<UniqueIdentifier, LaneCardItem[]> = {}
    for (const lane of wsLanes) {
      const order = lane.cardOrder ?? []
      const ordered = order
        .map(id => laneComponents.find(c => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map(c => ({ id: c.id, moduleId: c.moduleId }))
      // 加上没在 cardOrder 中的（可能是新部署但还没更新到 cardOrder）
      const orderedSet = new Set(ordered.map(c => c.id))
      for (const c of laneComponents) {
        if (c.laneId === lane.id && !orderedSet.has(c.id)) {
          ordered.push({ id: c.id, moduleId: c.moduleId })
        }
      }
      columns[lane.id] = ordered
    }
    return columns
  }, [wsLanes, laneComponents])

  // 没归属任何 lane 的组件 — 兜底到第一个 lane（不修改 store，仅 UI 展示）
  const orphanComponents = useMemo(() => {
    const laneIds = new Set(wsLanes.map(l => l.id))
    return laneComponents.filter(c => !c.laneId || !laneIds.has(c.laneId))
  }, [laneComponents, wsLanes])

  const handleKanbanChange = useCallback((columns: Record<UniqueIdentifier, LaneCardItem[]>) => {
    const visibleLaneIds = new Set(wsLanes.map((lane) => lane.id))
    const laneOrder = Object.keys(columns).filter((id) => visibleLaneIds.has(id))
    const cardOrderByLane = Object.fromEntries(
      laneOrder.map((laneId) => [laneId, (columns[laneId] ?? []).map((card) => card.id)]),
    )
    workspaceActions.setLaneBoardLayout(activeWorkspaceId, laneOrder, cardOrderByLane)
  }, [activeWorkspaceId, workspaceActions, wsLanes])

  // 没有任何 lane：显示空态 + 创建默认 lane
  if (wsLanes.length === 0) {
    return (
      <div
        className={cn(
          "relative flex flex-1 items-center justify-center ws-canvas-bg transition-colors",
          isModuleOver && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
        data-testid="lane-drop-target"
        {...moduleDropHandlers}
      >
        {isModuleOver && <ModuleDropHint label={t("registry:dropHint")} />}
        <div className="xiranite-ui-copy text-center space-y-4">
          <Columns3 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">{t("view:lane.empty")}</p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => workspaceActions.addLane()}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("view:lane.addLane")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Kanban value={kanbanValue} getItemValue={(item) => item.id} onValueChange={handleKanbanChange}>
      <div className="flex-1 ws-canvas-bg flex overflow-hidden" data-testid="lane-drop-target">
        <KanbanBoard
          className="min-w-0 flex-1 gap-0 overflow-x-auto overflow-y-hidden"
          data-lane-board="true"
        >
          {wsLanes.map((lane) => (
            <Lane
              key={lane.id}
              lane={lane}
              components={kanbanValue[lane.id] ?? []}
            />
          ))}
        </KanbanBoard>

        {orphanComponents.length > 0 && (
          <div className="xiranite-ui-copy flex w-72 flex-shrink-0 flex-col border-l border-border/40 bg-card/40">
            <div className="h-8 px-2 flex items-center border-b border-border/40 bg-muted/30">
              <span className="text-[11px] font-mono font-semibold tracking-widest uppercase text-muted-foreground">
                {t("common:unfiled")}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {orphanComponents.map((component) => (
                <div
                  key={component.id}
                  className="rounded-md border border-border/40 bg-card/70 px-2 py-1.5 text-[10px] font-mono text-muted-foreground"
                >
                  {component.moduleId}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Lane 按钮 */}
        <div className="flex-shrink-0 w-12 flex items-center justify-center border-l border-border/40">
          <button
            onClick={() => workspaceActions.addLane()}
            className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title={t("common:addLane")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <KanbanOverlay className="z-[1000]">
        {({ value, variant }) => {
          if (variant === "column") {
            const lane = wsLanes.find((item) => item.id === value)
            if (!lane) return null
            return (
              <div className="h-[min(72vh,720px)] w-80 overflow-hidden rounded-md border border-border/50 bg-card shadow-2xl">
                <Lane lane={lane} components={kanbanValue[lane.id] ?? []} />
              </div>
            )
          }

          const component = laneComponents.find((item) => item.id === value)
          if (!component) return null
          return (
            <div className="w-80 shadow-2xl">
              <LaneCard compId={component.id} moduleId={component.moduleId} />
            </div>
          )
        }}
      </KanbanOverlay>
    </Kanban>
  )
}

function ModuleDropHint({ label }: { label: string }) {
  return (
    <div className="xiranite-ui-copy pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-sm border border-primary/40 bg-card/95 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-primary shadow-sm">
      {label}
    </div>
  )
}
