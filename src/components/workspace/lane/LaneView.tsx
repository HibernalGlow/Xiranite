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
 * - 拖拽 lane 标题栏重排（REORDER_LANE）
 * - 拖拽 card 跨 lane 移动（MOVE_COMPONENT_TO_LANE）
 * - 顶栏切换到 lane 时，若当前 workspace 还没 lane，自动建一个默认 lane
 * - "+ ADD LANE" 按钮：dispatch ADD_LANE
 * - 关闭 card：dispatch TOGGLE_COMPONENT_VISIBILITY(lane) — 仅 lane 模式下隐藏
 */
import { useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Columns3 } from "lucide-react"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { getDragMode, getDragState, clearDrag } from "@/store/dragState"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { Button } from "@/components/ui/button"
import { Lane } from "./Lane"
import { LaneCard } from "./LaneCard"

export function LaneView() {
  const { t } = useTranslation()
  const { state, visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()

  // 当前 workspace 的 lanes（隐藏的不渲染）
  const wsLanes = useMemo(
    () => state.lanes.filter(l => l.workspaceId === state.activeWorkspaceId && !l.hidden),
    [state.lanes, state.activeWorkspaceId],
  )

  // 在 lane 模式下未隐藏的组件
  const laneComponents = useMemo(
    () => visibleComponents.filter(c => isComponentVisibleInView(c, "lane")),
    [visibleComponents],
  )

  // 每个 lane 内的组件列表（按 cardOrder 排序；不在 cardOrder 中的也加上，放到末尾）
  const cardsByLane = useMemo(() => {
    const map = new Map<string, { id: string; moduleId: string }[]>()
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
      map.set(lane.id, ordered)
    }
    return map
  }, [wsLanes, laneComponents])

  // 没归属任何 lane 的组件 — 兜底到第一个 lane（不修改 store，仅 UI 展示）
  const orphanComponents = useMemo(() => {
    const laneIds = new Set(wsLanes.map(l => l.id))
    return laneComponents.filter(c => !c.laneId || !laneIds.has(c.laneId))
  }, [laneComponents, wsLanes])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const mode = getDragMode()
    if (mode === "none") return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    const mode = getDragMode()
    if (mode === "none") return
    e.preventDefault()
    e.stopPropagation()

    // 找到 drop 落点的 lane 元素
    const target = (e.target as HTMLElement).closest("[data-lane-id]") as HTMLElement | null
    const toLaneId = target?.dataset?.laneId ?? null
    if (!toLaneId) {
      clearDrag()
      return
    }

    if (mode === "lane") {
      const { laneId: fromId } = getDragState()
      if (fromId && fromId !== toLaneId) {
        dispatch(actions.reorderLane(fromId, toLaneId))
      }
    } else if (mode === "card") {
      const { cardId, fromLaneId } = getDragState()
      if (cardId && fromLaneId) {
        // 计算 drop 位置：找最近的 card，判断在前还是后插入
        const targetCardEl = (e.target as HTMLElement).closest("[data-card-id]") as HTMLElement | null
        let targetCardId: string | null = null
        let insertAfter = false
        if (targetCardEl) {
          targetCardId = targetCardEl.dataset.cardId ?? null
          const rect = targetCardEl.getBoundingClientRect()
          insertAfter = e.clientY > rect.top + rect.height / 2
        } else {
          // 没落到具体 card 上 — 找最近的一个
          const cards = target?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []
          if (cards.length > 0) {
            let nearest: HTMLElement | null = null
            let nearestDist = Infinity
            for (const card of Array.from(cards)) {
              const rect = card.getBoundingClientRect()
              const midpoint = rect.top + rect.height / 2
              const dist = Math.abs(e.clientY - midpoint)
              if (dist < nearestDist) {
                nearestDist = dist
                nearest = card
                insertAfter = e.clientY > midpoint
              }
            }
            targetCardId = nearest?.dataset?.cardId ?? null
          }
        }
        dispatch(actions.moveComponentToLane(cardId, toLaneId, targetCardId, insertAfter))
      }
    }
    clearDrag()
  }, [dispatch])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as Node).contains(related)) return
  }, [])

  // 没有任何 lane：显示空态 + 创建默认 lane
  if (wsLanes.length === 0) {
    return (
      <div className="flex-1 ws-canvas-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <Columns3 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">{t("view:lane.empty")}</p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.addLane())}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("view:lane.addLane")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 ws-canvas-bg flex overflow-x-auto overflow-y-hidden"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {wsLanes.map(lane => (
        <Lane
          key={lane.id}
          lane={lane}
          components={cardsByLane.get(lane.id) ?? []}
        />
      ))}

      {/* 兜底：没归属任何 lane 的组件也展示（在末尾） */}
      {orphanComponents.length > 0 && (
        <div className="flex-shrink-0 w-72 flex flex-col border-l border-border/40 bg-card/40">
          <div className="h-8 px-2 flex items-center border-b border-border/40 bg-muted/30">
            <span className="text-[11px] font-mono font-semibold tracking-widest uppercase text-muted-foreground">
              {t("common:unfiled")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {orphanComponents.map(c => (
              <LaneCard key={c.id} compId={c.id} moduleId={c.moduleId} laneId="" />
            ))}
          </div>
        </div>
      )}

      {/* Add Lane 按钮 */}
      <div className="flex-shrink-0 w-12 flex items-center justify-center border-l border-border/40">
        <button
          onClick={() => dispatch(actions.addLane())}
          className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
          title={t("common:addLane")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
