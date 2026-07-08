/**
 * Lane — 单个泳道。
 *
 * 从 Xlchemy Lane.svelte 移植为 React，简化为：
 * - 标题栏（折叠按钮 + 标题 + 拖拽手柄 + 菜单）
 * - 内容区（按 cardOrder 排序的 LaneCard 列表，垂直滚动）
 * - 右侧调宽手柄（LaneResizer）
 *
 * 折叠：dispatch TOGGLE_LANE_COLLAPSE
 * 调宽：dispatch SET_LANE_WIDTH_RATIO（按 ratio 增量累加并 clamp 到 0.25~4）
 * 拖拽 lane：拖动标题栏时由 @dnd-kit 在 LaneView 中重排。
 */
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { Pencil, Ellipsis, EyeOff, Trash2 } from "lucide-react"
import { useDroppable } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Lane as LaneType } from "@/types/workspace"
import { useWorkspaceActions } from "@/store/workspaceContext"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { translateLabel } from "@/lib/i18nLabel"
import { LaneCard } from "./LaneCard"
import { LaneResizer } from "./LaneResizer"
import { cn } from "@/lib/utils"
import { cardDndId, laneDndId, laneDropDndId } from "./dndIds"

const RATIO_PRESETS = [0.5, 1, 1.5, 2, 3]

/** 泳道折叠/展开图标 — 从 Xlchemy LaneDragHandle.svelte 移植的 SVG。
 *  原版设计：泳道外框 + 内部 lane 矩形，矩形 fill 状态表示折叠/展开：
 *  - 展开态：矩形空心（fill: none），hover 变实心
 *  - 折叠态：矩形实心（fill: currentColor），hover 变空心 */
function LaneIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 15 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.75 0.75H2.75C1.64543 0.75 0.75 1.64543 0.75 2.75V6.75C0.75 7.85457 1.64543 8.75 2.75 8.75H11.75C12.8546 8.75 13.75 7.85457 13.75 6.75V2.75C13.75 1.64543 12.8546 0.75 11.75 0.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="0.75"
        y="0.75"
        width="5"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill={collapsed ? "currentColor" : "none"}
        className="transition-[fill]"
      />
    </svg>
  )
}

interface Props {
  lane: LaneType
  components: { id: string; moduleId: string }[]
}

export function Lane({ lane, components }: Props) {
  const { t } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(translateLabel(lane.label, t))
  const [ratioInput, setRatioInput] = useState(String(lane.widthRatio))
  const handleDropModule = useCallback((moduleId: string) => {
    workspaceActions.deployComponent(moduleId, { viewMode: "lane", laneId: lane.id })
  }, [lane.id, workspaceActions])
  const { isModuleOver, moduleDropHandlers } = useModuleDropTarget(handleDropModule)
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: laneDndId(lane.id),
    data: { type: "lane", laneId: lane.id },
    disabled: renaming,
  })
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: laneDropDndId(lane.id),
    data: { type: "lane-drop", laneId: lane.id },
    disabled: lane.collapsed,
  })
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  function commitRename() {
    const trimmed = name.trim()
    if (trimmed) workspaceActions.renameLane(lane.id, trimmed)
    setRenaming(false)
  }

  function commitRatioInput() {
    const val = parseFloat(ratioInput)
    if (!isNaN(val) && val > 0) workspaceActions.setLaneWidthRatio(lane.id, val)
    setRatioInput(String(lane.widthRatio))
  }

  if (lane.collapsed) {
    return (
      <div
        ref={setNodeRef}
        data-lane-id={lane.id}
        style={sortableStyle}
        className="xiranite-ui-copy w-12 flex-shrink-0 flex flex-col items-center gap-2 py-3 px-1 border-r border-border/40 bg-muted/20 hover:bg-muted/40 cursor-grab active:cursor-grabbing"
      >
        <button
          onClick={() => workspaceActions.toggleLaneCollapse(lane.id)}
          className="text-muted-foreground hover:text-foreground"
          title={t("common:expand")}
        >
          <LaneIcon collapsed />
        </button>
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          data-lane-drag-handle="true"
          className="text-[10px] font-mono tracking-widest text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {translateLabel(lane.label, t)}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      data-lane-id={lane.id}
      style={{ flex: lane.widthRatio, minWidth: 240, maxWidth: 720, ...sortableStyle }}
      className="xiranite-ui-copy relative flex flex-col h-full border-r border-border/40 bg-card/40 last:border-r-0 flex-shrink-0"
    >
      {/* 标题栏 */}
      <div className="flex items-center gap-1.5 h-8 px-2 border-b border-border/40 bg-muted/30 flex-shrink-0">
        <button
          onClick={() => workspaceActions.toggleLaneCollapse(lane.id)}
          className="text-muted-foreground hover:text-foreground"
          title={t("common:collapse")}
        >
          <LaneIcon collapsed={false} />
        </button>

        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename() }}
            className="flex-1 bg-background border border-border px-1 py-0 text-[11px] font-mono rounded-sm outline-none focus:border-primary"
          />
        ) : (
          <span
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            data-lane-drag-handle="true"
            className="flex-1 text-[11px] font-mono font-semibold tracking-widest uppercase text-muted-foreground cursor-grab active:cursor-grabbing truncate select-none"
            title={t("common:dragReorder")}
          >
            {translateLabel(lane.label, t)}
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(o => !o)
          }}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("common:moreActions")}
        >
          <Ellipsis className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 菜单浮层 — relative 父级 + absolute 定位，z-50 高于其他 lane */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            onContextMenu={(e) => { e.preventDefault(); setMenuOpen(false) }}
          />
          <div className="absolute right-0 top-9 mt-0.5 w-48 rounded-md border border-border bg-card shadow-lg z-50 p-1 text-xs">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm"
            >
              <Pencil className="h-3.5 w-3.5" /> {t("common:rename")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); workspaceActions.toggleLaneCollapse(lane.id) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm"
            >
              <LaneIcon collapsed={false} /> {t("common:collapse")}
            </button>

            <div className="px-2 py-1.5 border-t border-border/60 mt-1">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <span className="text-[10px] font-mono tracking-widest">{t("common:widthRatio")}</span>
              </div>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {RATIO_PRESETS.map(preset => (
                  <button
                    key={preset}
                    onClick={(e) => { e.stopPropagation(); workspaceActions.setLaneWidthRatio(lane.id, preset) }}
                    className={cn(
                      "py-1 rounded-sm border text-[10px] font-mono",
                      Math.abs(lane.widthRatio - preset) < 0.01
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/40 hover:bg-muted/60"
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={ratioInput}
                  onChange={(e) => setRatioInput(e.target.value)}
                  onBlur={commitRatioInput}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRatioInput() }}
                  min={0.25}
                  max={4}
                  step={0.1}
                  className="w-14 bg-background border border-border px-1 py-0 text-[10px] font-mono rounded-sm outline-none focus:border-primary"
                />
                <span className="text-muted-foreground text-[10px]">×</span>
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); workspaceActions.toggleLaneVisibility(lane.id) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm border-t border-border/60"
            >
              <EyeOff className="h-3.5 w-3.5" /> {t("common:hide")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); workspaceActions.removeLane(lane.id) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-destructive/10 hover:text-destructive rounded-sm"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("common:delete")}
            </button>
          </div>
        </>
      )}

      {/* 内容区：card 列表 */}
      <div
        ref={setDropNodeRef}
        data-lane-drop-zone={lane.id}
        className={cn(
          "flex-1 overflow-y-auto p-2 space-y-2 min-h-0 transition-colors",
          isOver ? "bg-primary/5" : undefined,
          isModuleOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : undefined,
        )}
        {...moduleDropHandlers}
      >
        <SortableContext items={components.map((component) => cardDndId(component.id))} strategy={verticalListSortingStrategy}>
          {components.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[10px] font-mono text-muted-foreground/60">
                {isModuleOver ? t("registry:dropHint") : t("view:lane.emptyLane")}
              </p>
            </div>
          ) : (
            components.map(c => (
              <LaneCard key={c.id} compId={c.id} moduleId={c.moduleId} laneId={lane.id} />
            ))
          )}
        </SortableContext>
      </div>

      <LaneResizer
        onResize={(deltaRatio) => {
          workspaceActions.setLaneWidthRatio(lane.id, lane.widthRatio + deltaRatio)
        }}
      />
    </div>
  )
}
