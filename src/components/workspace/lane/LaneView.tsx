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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Columns3 } from "lucide-react"
import { MouseSensor, TouchSensor, useSensor, useSensors, type UniqueIdentifier } from "@dnd-kit/core"
import type { Lane as LaneType } from "@/types/workspace"
import { useWorkspaceActions, useWorkspaceShallowSelector, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { translateLabel } from "@/lib/i18nLabel"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { Button } from "@/components/ui/button"
import { Kanban, KanbanBoard, KanbanOverlay } from "@/components/ui/kanban"
import { Lane } from "./Lane"
import { getModule } from "@/components/modules/registry"
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
  const laneScrollRef = useRef<HTMLDivElement | null>(null)
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null)
  const handleDropModule = useCallback((moduleId: string) => {
    workspaceActions.deployComponent(moduleId, { viewMode: "lane" })
  }, [workspaceActions])
  const { isModuleOver, moduleDropHandlers } = useModuleDropTarget(handleDropModule)
  const laneSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
  )

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

  const updateActiveLane = useCallback(() => {
    const scroller = laneScrollRef.current
    if (!scroller) return

    const laneElements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-lane-id]"))
      .filter((element) => element.closest("[data-lane-board='true']"))
    if (laneElements.length === 0) {
      setActiveLaneId(null)
      return
    }

    const scrollerRect = scroller.getBoundingClientRect()
    const viewportCenter = scrollerRect.left + scrollerRect.width / 2
    const activeElement = laneElements.reduce((best, element) => {
      const rect = element.getBoundingClientRect()
      const distance = Math.abs(rect.left + rect.width / 2 - viewportCenter)
      return distance < best.distance ? { element, distance } : best
    }, { element: laneElements[0], distance: Number.POSITIVE_INFINITY }).element

    setActiveLaneId(activeElement.dataset.laneId ?? null)
  }, [])

  useEffect(() => {
    const scroller = laneScrollRef.current
    if (!scroller) return

    updateActiveLane()
    scroller.addEventListener("scroll", updateActiveLane, { passive: true })
    const observer = new ResizeObserver(updateActiveLane)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener("scroll", updateActiveLane)
      observer.disconnect()
    }
  }, [updateActiveLane, wsLanes.length])

  const scrollToLane = useCallback((laneId: string) => {
    const scroller = laneScrollRef.current
    if (!scroller) return

    const laneElement = Array.from(scroller.querySelectorAll<HTMLElement>("[data-lane-id]"))
      .find((element) => element.dataset.laneId === laneId && element.closest("[data-lane-board='true']"))
    if (!laneElement) return

    const scrollerRect = scroller.getBoundingClientRect()
    const laneRect = laneElement.getBoundingClientRect()
    scroller.scrollTo({
      left: scroller.scrollLeft + laneRect.left - scrollerRect.left - (scroller.clientWidth - laneRect.width) / 2,
      behavior: "smooth",
    })
    setActiveLaneId(laneId)
    window.setTimeout(() => setActiveLaneId(laneId), 360)
  }, [])

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
    <Kanban value={kanbanValue} getItemValue={(item) => item.id} onValueChange={handleKanbanChange} sensors={laneSensors}>
      <div className="relative flex-1 ws-canvas-bg flex min-w-0 overflow-hidden" data-testid="lane-drop-target">
        <div ref={laneScrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <KanbanBoard
            className="h-full w-max min-w-max gap-0 overflow-visible"
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
        </div>

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
        <LaneDock
          lanes={wsLanes}
          activeLaneId={activeLaneId ?? wsLanes[0]?.id ?? null}
          cardsByLane={kanbanValue}
          onSelect={scrollToLane}
        />
      </div>
      <KanbanOverlay className="z-[1000]">
        {({ value, variant }) => {
          if (variant === "column") {
            const lane = wsLanes.find((item) => item.id === value)
            if (!lane) return null
            return (
              <div className="xiranite-ui-copy h-[min(72vh,720px)] w-80 overflow-hidden rounded-md border border-border/50 bg-card shadow-2xl">
                <div className="flex h-8 items-center border-b border-border/40 bg-muted/30 px-2 text-[11px] font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                  {typeof lane.label === "string" ? lane.label : value}
                </div>
                <div className="p-2 text-[10px] font-mono text-muted-foreground">
                  {(kanbanValue[lane.id] ?? []).length} items
                </div>
              </div>
            )
          }

          const component = laneComponents.find((item) => item.id === value)
          if (!component) return null
          const mod = getModule(component.moduleId)
          return (
            <div className="xiranite-ui-copy w-80 rounded-md border border-border/50 bg-card/95 p-3 text-card-foreground shadow-2xl">
              <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                {mod?.name ?? component.moduleId}
              </div>
              <div className="mt-2 h-24 rounded-sm bg-muted/30" />
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

function LaneDock({
  lanes,
  activeLaneId,
  cardsByLane,
  onSelect,
}: {
  lanes: LaneType[]
  activeLaneId: string | null
  cardsByLane: Record<UniqueIdentifier, LaneCardItem[]>
  onSelect: (laneId: string) => void
}) {
  const { t } = useTranslation()
  if (lanes.length <= 1) return null

  const activeIndex = Math.max(0, lanes.findIndex((lane) => lane.id === activeLaneId))

  return (
    <div className="xiranite-ui-copy pointer-events-none absolute bottom-4 right-4 z-40 flex max-w-[min(520px,calc(100%-2rem))] items-center gap-2 rounded-full border border-border/45 bg-card/88 px-2.5 py-2 shadow-[0_16px_48px_-28px_oklch(0_0_0/0.5)] backdrop-blur-md">
      <span className="pointer-events-none min-w-8 text-center text-[10px] font-mono text-muted-foreground">
        {activeIndex + 1}/{lanes.length}
      </span>
      <div className="pointer-events-auto flex max-w-[min(420px,calc(100vw-8rem))] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lanes.map((lane, index) => {
          const active = lane.id === activeLaneId
          const label = translateLabel(lane.label, t)
          const cardCount = cardsByLane[lane.id]?.length ?? 0
          return (
            <button
              key={lane.id}
              type="button"
              aria-label={`${label} (${index + 1}/${lanes.length}, ${cardCount})`}
              title={`${label} - ${cardCount}`}
              onClick={() => onSelect(lane.id)}
              className={cn(
                "h-2.5 flex-shrink-0 rounded-full border transition-[width,background-color,border-color,opacity] hover:opacity-100",
                active
                  ? "w-8 border-primary/55 bg-primary"
                  : "w-2.5 border-border/60 bg-muted-foreground/35 opacity-70 hover:border-primary/45 hover:bg-primary/45",
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
