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
import { Pencil, Columns3, ChevronDown, Ellipsis, EyeOff, Trash2 } from "lucide-react"
import type { Lane as LaneType } from "@/types/workspace"
import { useWSDispatch, actions } from "@/store/workspaceContext"
import { setLaneDrag, clearDrag, getDragState, subscribe } from "@/store/dragState"
import { useSyncExternalStore } from "react"
import { LaneCard } from "./LaneCard"
import { LaneResizer } from "./LaneResizer"
import { cn } from "@/lib/utils"

const RATIO_PRESETS = [0.5, 1, 1.5, 2, 3]

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

  // 订阅 dragState 判断是否有 lane 拖到自己上面
  const dragState = useSyncExternalStore(subscribe, getDragState, getDragState)
  const isDragOver = dragState.laneId !== null && dragState.laneId !== lane.id

  function handleDragStart(e: React.DragEvent) {
    setLaneDrag(lane.id)
    e.dataTransfer?.setData("text/x-lane-id", lane.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
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
          className="rotate-180 text-[10px] font-mono tracking-widest text-muted-foreground hover:text-foreground"
          style={{ writingMode: "vertical-rl" }}
          title="展开"
        >
          {lane.label}
        </button>
      </div>
    )
  }

  return (
    <div
      data-lane-id={lane.id}
      style={{ flex: lane.widthRatio, minWidth: 240, maxWidth: 720 }}
      className={cn(
        "flex flex-col h-full border-r border-border/40 bg-card/40 last:border-r-0",
        isDragOver && "ring-2 ring-primary/40 ring-inset"
      )}
    >
      {/* 标题栏 */}
      <div className="flex items-center gap-1.5 h-8 px-2 border-b border-border/40 bg-muted/30 flex-shrink-0">
        <button
          onClick={() => dispatch(actions.toggleLaneCollapse(lane.id))}
          className="text-muted-foreground hover:text-foreground"
          title="折叠"
        >
          <ChevronDown className="h-3.5 w-3.5" />
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
            className="flex-1 text-[11px] font-mono font-semibold tracking-widest uppercase text-muted-foreground cursor-grab active:cursor-grabbing truncate"
            title="拖动重排"
          >
            {lane.label}
          </span>
        )}

        <button
          onClick={() => setMenuOpen(o => !o)}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="更多操作"
        >
          <Ellipsis className="h-3.5 w-3.5" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-card shadow-lg z-40 p-1 text-xs">
              <button
                onClick={() => { setMenuOpen(false); setRenaming(true) }}
                className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm"
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); dispatch(actions.toggleLaneCollapse(lane.id)) }}
                className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm"
              >
                <ChevronDown className="h-3.5 w-3.5" /> Collapse
              </button>

              <div className="px-2 py-1.5 border-t border-border/60 mt-1">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  <Columns3 className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-mono tracking-widest">WIDTH RATIO</span>
                </div>
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {RATIO_PRESETS.map(preset => (
                    <button
                      key={preset}
                      onClick={() => dispatch(actions.setLaneWidthRatio(lane.id, preset))}
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
                onClick={() => { setMenuOpen(false); dispatch(actions.toggleLaneVisibility(lane.id)) }}
                className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-muted/60 rounded-sm border-t border-border/60"
              >
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </button>
              <button
                onClick={() => { setMenuOpen(false); dispatch(actions.removeLane(lane.id)) }}
                className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-destructive/10 hover:text-destructive rounded-sm"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </>
        )}
      </div>

      {/* 内容区：card 列表 */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2"
        onDragOver={(e) => {
          if (dragState.mode === "none") return
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
