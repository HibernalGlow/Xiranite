// React Flow projection of a linear Marku workflow. The canvas is a visual
// projection only: node positions derive from step order via workflow-state
// and never persist; dragging a node horizontally reorders the steps. The
// selected node exposes inline module and config editing so the sidebar can
// stay collapsed while the canvas fills the card.
import { useEffect, useMemo } from "react"
import type { CSSProperties } from "react"
import { Settings2 } from "lucide-react"
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState } from "@xyflow/react"
import type { Edge, Node, NodeProps, NodeTypes, Viewport } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { MarkuWorkflow } from "@xiranite/node-marku/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { findModuleMeta } from "./constants"
import { ModulePicker } from "./controls"
import type { MarkuWorkflowViewport } from "./types"
import { StepConfigField } from "./WorkflowInspector"
import { projectWorkflowGraph, stepIndexForDragPosition } from "./workflow-state"

interface WorkflowEditorProps {
  running: boolean
  selectedStepId?: string
  viewport?: MarkuWorkflowViewport
  workflow: MarkuWorkflow
  onChangeStepConfig: (stepId: string, config: Record<string, unknown>) => void
  onChangeStepModule: (stepId: string, module: string) => void
  onMoveStep: (stepId: string, targetIndex: number) => void
  onSelectStep: (stepId: string) => void
  onViewportChange: (viewport: MarkuWorkflowViewport) => void
}

type StepNodeData = {
  index: number
  module: string
  selected: boolean
  running: boolean
  config: Record<string, unknown>
  onChangeModule: (module: string) => void
  onChangeConfig: (config: Record<string, unknown>) => void
}
type StepFlowNode = Node<StepNodeData, "markuStep">

const NODE_TYPES: NodeTypes = { markuStep: StepFlowNodeCard }
const FLOW_STYLE = {
  "--xy-background-color": "transparent",
  "--xy-edge-stroke": "color-mix(in oklch, var(--primary) 72%, transparent)",
  "--xy-edge-stroke-width": "2",
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
} as CSSProperties

export function WorkflowEditor(props: WorkflowEditorProps) {
  const projection = useMemo(
    () => projectWorkflowGraph(props.workflow, props.selectedStepId),
    [props.workflow, props.selectedStepId],
  )
  const flowNodes = useMemo<StepFlowNode[]>(
    () => projection.nodes.map((node) => {
      const step = props.workflow.steps.find((item) => item.id === node.id)
      return {
        id: node.id,
        type: "markuStep" as const,
        position: node.position,
        data: {
          index: node.index,
          module: node.module,
          selected: node.selected,
          running: props.running,
          config: step?.config ?? {},
          onChangeModule: (module: string) => props.onChangeStepModule(node.id, module),
          onChangeConfig: (config: Record<string, unknown>) => props.onChangeStepConfig(node.id, config),
        },
        draggable: !props.running,
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projection, props.running, props.workflow, props.onChangeStepModule, props.onChangeStepConfig],
  )
  const flowEdges = useMemo<Edge[]>(
    () => projection.edges.map((edge) => ({
      ...edge,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    })),
    [projection],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<StepFlowNode>(flowNodes)
  // The projection is the source of truth: any draft change snaps nodes back
  // onto the ordered lane instead of preserving free-form drag positions.
  useEffect(() => {
    setNodes(flowNodes)
  }, [flowNodes, setNodes])

  return (
    <div className="h-full min-h-0" data-testid="marku-workflow-editor">
      <ReactFlow<StepFlowNode, Edge>
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => props.onSelectStep(node.id)}
        onNodeDragStop={(_event, node) => props.onMoveStep(node.id, stepIndexForDragPosition(node.position.x, props.workflow.steps.length))}
        onMoveEnd={(_event, viewport: Viewport) => props.onViewportChange({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        minZoom={0.5}
        maxZoom={1.5}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        style={FLOW_STYLE}
        {...(props.viewport
          ? { defaultViewport: props.viewport }
          : { fitView: true, fitViewOptions: { padding: 0.2, maxZoom: 1 } })}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="color-mix(in oklch, var(--muted-foreground) 22%, transparent)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}

function StepFlowNodeCard({ data, id }: NodeProps<StepFlowNode>) {
  const meta = findModuleMeta(data.module)
  const Icon = meta.icon
  return (
    <div
      data-testid={`marku-flow-node-${id}`}
      className={cn(
        "w-52 rounded-xl border bg-card/95 px-3 py-2 shadow-md",
        data.selected ? "border-primary ring-2 ring-primary/25" : "border-border",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!size-2.5 !border-2 !border-background !bg-primary" />
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="shrink-0 tabular-nums">{data.index + 1}</Badge>
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{meta.shortLabel}</span>
        {data.selected && (
          <Popover>
            <PopoverTrigger asChild>
              <Button aria-label="编辑步骤配置" className="nodrag nopan shrink-0" disabled={data.running} size="icon-sm" variant="outline">
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="nodrag nopan nowheel w-72 p-3" side="bottom">
              <StepConfigField
                ariaLabel="marku workflow node config"
                config={data.config}
                disabled={data.running}
                inputId="marku-workflow-node-config"
                seedKey={id}
                onConfigChange={data.onChangeConfig}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      {data.selected && (
        <div className="nodrag nopan mt-2">
          <ModulePicker compact disabled={data.running} module={meta.id} onModuleChange={data.onChangeModule} />
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className="!size-2.5 !border-2 !border-background !bg-primary" />
    </div>
  )
}
