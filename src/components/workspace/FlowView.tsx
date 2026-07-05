import { useCallback, useMemo } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  type Node,
  type Edge,
  type NodeChange,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { Button } from "@/components/ui/button"
import { Plus, X, Workflow } from "lucide-react"

/**
 * FlowView — 真实接入 @xyflow/react。
 *
 * 三种 viewMode 共享同一份 store：components 数组。
 * - 组件 → React Flow 节点（每个 component 一个节点）
 * - flowPosition / flowSize 持久化在 store 中
 * - 节点内容用 ModuleRenderer 渲染（与 CardView/DockviewView 共享）
 * - NodeResizer 让用户可拖拽节点边框调整大小，调整后写回 store.flowSize
 * - 关闭按钮 dispatch REMOVE_COMPONENT
 *
 * 切到其他 viewMode 时 ReactFlow 卸载，节点位置/尺寸不丢失。
 */
function FlowNode({ data, id, selected }: NodeProps) {
  const dispatch = useWSDispatch()
  const d = data as { moduleId?: string; compId?: string }
  const mod = d.moduleId ? getModule(d.moduleId) : null

  return (
    <div
      className="rounded-md border border-border bg-card shadow-[0_8px_24px_-8px_oklch(0_0_0/0.35)] flex flex-col overflow-hidden"
      style={{ width: 384, height: 320 }}
    >
      {/* NodeResizer 必须在节点根 div 内，selected 时显示 8 个 resize handle */}
      <NodeResizer
        nodeId={id}
        isVisible={!!selected}
        minWidth={280}
        minHeight={180}
        color="oklch(0.62 0.18 152)"
      />
      <div className="flex h-8 items-center gap-2 border-b border-border/60 bg-muted/30 px-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase truncate flex-1">
          {mod?.name ?? d.moduleId ?? "node"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch(actions.toggleComponentVisibility(id, "flow"))
          }}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {d.moduleId && d.compId && <ModuleRenderer moduleId={d.moduleId} compId={d.compId} />}
      </div>
    </div>
  )
}

// ⚠️ nodeTypes 必须在组件外定义 — 否则每次 FlowCanvas 渲染都会创建新对象，
// ReactFlow 内部 useStore 会检测到引用变化并重置内部状态，导致节点不渲染。
const nodeTypes = { module: FlowNode }

function FlowCanvas() {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()

  // 仅渲染未在 flow 模式下隐藏的组件
  const flowComponents = useMemo(
    () => visibleComponents.filter(c => !c.hiddenIn?.flow),
    [visibleComponents],
  )

  const nodes: Node[] = useMemo(() => flowComponents.map(comp => ({
    id: comp.id,
    type: "module",
    position: comp.flowPosition ?? { x: 100, y: 100 },
    data: { moduleId: comp.moduleId, compId: comp.id },
    zIndex: comp.z ?? 1,
  })), [flowComponents])

  const edges: Edge[] = useMemo(() => [], [])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    changes.forEach(c => {
      if (c.type === "position" && c.position) {
        dispatch(actions.setComponentFlowPos(c.id, c.position.x, c.position.y))
      } else if (c.type === "dimensions" && c.dimensions) {
        dispatch(actions.setComponentFlowSize(c.id, c.dimensions.width, c.dimensions.height))
      }
    })
  }, [dispatch])

  if (flowComponents.length === 0) {
    return (
      <div className="flex-1 ws-canvas-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <Workflow className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">// flow canvas is empty</p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.setOverlay("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            OPEN MODULE REGISTRY
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 ws-canvas-bg relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.5 0 0 / 0.2)" />
        <Controls className="!bg-card !border !border-border !rounded !shadow" />
        <MiniMap
          className="!bg-card !border !border-border !rounded"
          nodeColor={() => "oklch(0.5 0.15 250)"}
          maskColor="oklch(0 0 0 / 0.6)"
        />
      </ReactFlow>
      <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-card/80 backdrop-blur border border-border text-[10px] font-mono text-muted-foreground z-10 pointer-events-none">
        drag nodes · positions persisted via flowPosition in store
      </div>
    </div>
  )
}

export function FlowView() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  )
}
