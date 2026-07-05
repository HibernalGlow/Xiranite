import { useCallback, useEffect, useMemo } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  Background,
  Controls,
  MiniMap,
  NodeResizeControl,
  ResizeControlVariant,
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
import { MoveDiagonal2, Plus, X, Workflow } from "lucide-react"

type FlowNodeData = {
  moduleId?: string
  compId?: string
}

function FlowNode({ data, id, selected }: NodeProps<Node<FlowNodeData>>) {
  const dispatch = useWSDispatch()
  const { zoom } = useViewport()
  const mod = data.moduleId ? getModule(data.moduleId) : null
  const handleScale = zoom > 0 ? 1 / zoom : 1

  return (
    <div className="relative h-full w-full rounded-md border border-border bg-card shadow-[0_8px_24px_-8px_oklch(0_0_0/0.35)] flex flex-col overflow-visible">
      <NodeResizeControl
        nodeId={id}
        position="bottom-right"
        variant={ResizeControlVariant.Handle}
        minWidth={280}
        minHeight={180}
        autoScale={false}
        className="!h-10 !w-10 !rounded-[14px] !border !border-black/10 !bg-white !text-neutral-800 !shadow-[0_10px_24px_-10px_oklch(0_0_0/0.7)]"
        style={{
          right: -14,
          bottom: -14,
          cursor: "nwse-resize",
          pointerEvents: "all",
          touchAction: "none",
          transform: `scale(${handleScale})`,
          transformOrigin: "center",
          zIndex: 20,
        }}
        onResize={(_, params) => {
          dispatch(actions.setComponentFlowSize(id, params.width, params.height))
        }}
        onResizeEnd={(_, params) => {
          dispatch(actions.setComponentFlowSize(id, params.width, params.height))
        }}
      >
        <MoveDiagonal2 className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 stroke-[2.5]" />
      </NodeResizeControl>
      <div className="flex h-8 items-center gap-2 border-b border-border/60 bg-muted/30 px-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase truncate flex-1">
          {mod?.name ?? data.moduleId ?? "node"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch(actions.setComponentVisibility(id, "flow", false))
          }}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Hide in flow"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden rounded-b-md">
        {data.moduleId && data.compId && <ModuleRenderer moduleId={data.moduleId} compId={data.compId} />}
      </div>
    </div>
  )
}

const nodeTypes = { module: FlowNode }

function FlowCanvas() {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  const flowComponents = useMemo(
    () => visibleComponents.filter(c => !c.hiddenIn?.flow),
    [visibleComponents],
  )

  const nodes: Node<FlowNodeData>[] = useMemo(() => {
    const seenPositions = new Map<string, number>()

    return flowComponents.map((comp, index) => {
      const storedPosition = comp.flowPosition
      const positionKey = storedPosition ? `${storedPosition.x}:${storedPosition.y}` : ""
      const collisionIndex = positionKey ? (seenPositions.get(positionKey) ?? 0) : 0
      if (positionKey) seenPositions.set(positionKey, collisionIndex + 1)

      const position = storedPosition && collisionIndex === 0
        ? storedPosition
        : {
            x: 100 + (index % 3) * 440,
            y: 100 + Math.floor(index / 3) * 380,
          }

      return {
        id: comp.id,
        type: "module",
        position,
        data: { moduleId: comp.moduleId, compId: comp.id },
        width: comp.flowSize?.width ?? 384,
        height: comp.flowSize?.height ?? 320,
        zIndex: comp.z ?? 1,
      }
    })
  }, [flowComponents])

  const edges: Edge[] = useMemo(() => [], [])
  const nodeIdsKey = useMemo(() => nodes.map(node => node.id).join("|"), [nodes])

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return

    let raf = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: 180, maxZoom: 1 })
    })

    return () => cancelAnimationFrame(raf)
  }, [fitView, nodeIdsKey, nodes.length, nodesInitialized])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    changes.forEach(c => {
      if (c.type === "position" && c.position && c.dragging === false) {
        dispatch(actions.setComponentFlowPos(c.id, c.position.x, c.position.y))
      } else if (c.type === "dimensions" && c.dimensions) {
        dispatch(actions.setComponentFlowSize(c.id, c.dimensions.width, c.dimensions.height))
      }
    })
  }, [dispatch])

  if (flowComponents.length === 0) {
    return (
      <div className="flex-1 min-h-0 w-full ws-canvas-bg flex items-center justify-center">
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
    <div className="flex-1 min-h-0 w-full ws-canvas-bg relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        className="h-full w-full"
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
        drag nodes - positions and sizes persist in workspace state
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
