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
 * 拖拽 lane：拖动标题栏 grip 时 setLaneDrag(id)，可在 LaneContainer 中重排
 */
import { useState } from "react"
import { Pencil, Ellipsis, EyeOff, Trash2 } from "lucide-react"
import type { Lane as LaneType } from "@/types/workspace"
import { useWSDispatch, actions } from "@/store/workspaceContext"
import { setLaneDrag, clearDrag } from "@/store/dragState"
import { LaneCard } from "./LaneCard"
import { LaneResizer } from "./LaneResizer"
import { cn } from "@/lib/utils"

const RATIO_PRESETS = [0.5, 1, 1.5, 2, 3]

/** 泳道折叠/展开图标 — 从 Xlchemy LaneDragHandle.svelte 移植的 SVG。
 *  画的是一个泳道外框 + 一个 lane 矩形，直观表示"泳道"。 */
function LaneIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 15 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 150ms" }}
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
      />
    </svg>
  )
}

interface Props {
  lane: LaneType
  components: { id: string; moduleId: string }[]
}

export function Lane({ lane, components }: Props) {
  const dispatch = useWSDispatch()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(lane.label)
  const [ratioInput, setRatioInput] = useState(String(lane.widthRatio))

  function handleDragStart(e: React.DragEvent) {
    setLaneDrag(lane.id)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/x-lane-id", lane.id)
    }
  }

  function handleDragEnd() {
    clearDrag()
  }

  function commitRename() {
    const trimmed = name.trim()
    if (trimmed) dispatch(actions.renameLane(lane.id, trimmed))
    setRenaming(false)
  }

  function commitRatioInput() {
    const val = parseFloat(ratioInput)
    if (!isNaN(val) && val > 0) dispatch(actions.setLaneWidthRatio(lane.id, val))
    setRatioInput(String(lane.widthRatio))
  }

  if (lane.collapsed) {
    return (
      <div
        data-lane-id={lane.id}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className="w-12 flex-shrink-0 flex flex-col items-center gap-2 py-3 px-1 border-r border-border/40 bg-muted/20 hover:bg-muted/40 cursor-grab active:cursor-grabbing"
      >
        <button
          onClick={() => dispatch(actions.toggleLaneCollapse(lane.id))}
          className="text-muted-foreground hover:text-foreground"
          title="展开"
        >
          <LaneIcon collapsed />
        </button>
        <span
          className="text-[10px] font-mono tracking-widest text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {lane.label}
        </span>
      </div>
    )
  }

  return (
    <div
      data-lane-id={lane.id}
      style={{ flex: lane.widthRatio, minWidth: 240, maxWidth: 720 }}
      className="relative flex flex-col h-full border-r border-border/40 bg-card/40 last:border-r-0 flex-shrink-0"
    >
      {/* 标题栏 */}
      <div className="flex items-center gap-1.5 h-8 px-2 border-b border-border/40 bg-muted/30 flex-shrink-0">
        <button
          onClick={() => dispatch(actions.toggleLaneCollapse(lane.id))}
          className="text-muted-foreground hover:text-foreground"
          title="折叠"
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
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className="flex-1 text-[11px] font-mono font-semibold tracking-widest uppercase text-muted-foreground cursor-grab active:cursor-grabbing truncate select-none"
            title="拖动重排"
          >
            {lane.label}
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(o => !o)
          }}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="更多操作"
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
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); dispatch(actions.toggleLaneCollapse(lane.id)) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm"
            >
              <LaneIcon collapsed={false} /> Collapse
            </button>

            <div className="px-2 py-1.5 border-t border-border/60 mt-1">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <span className="text-[10px] font-mono tracking-widest">WIDTH RATIO</span>
              </div>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {RATIO_PRESETS.map(preset => (
                  <button
                    key={preset}
                    onClick={(e) => { e.stopPropagation(); dispatch(actions.setLaneWidthRatio(lane.id, preset)) }}
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
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); dispatch(actions.toggleLaneVisibility(lane.id)) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm border-t border-border/60"
            >
              <EyeOff className="h-3.5 w-3.5" /> Hide
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); dispatch(actions.removeLane(lane.id)) }}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-destructive/10 hover:text-destructive rounded-sm"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      )}

      {/* 内容区：card 列表 */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0"
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
        }}
      >
        {components.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-[10px] font-mono text-muted-foreground/60">// empty lane</p>
          </div>
        ) : (
          components.map(c => (
            <LaneCard key={c.id} compId={c.id} moduleId={c.moduleId} laneId={lane.id} />
          ))
        )}
      </div>

      <LaneResizer
        onResize={(deltaRatio) => {
          dispatch(actions.setLaneWidthRatio(lane.id, lane.widthRatio + deltaRatio))
        }}
      />
    </div>
  )
}
