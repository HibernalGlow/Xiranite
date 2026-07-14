import { useEffect, useMemo, useRef } from "react"
import type { CSSProperties } from "react"
import { createPortal } from "react-dom"
import type { VertFormatCategory } from "@xiranite/node-vert/core"
import { detectVertCategory, VERT_FORMAT_GROUPS } from "@xiranite/node-vert/core"
import { Background, BackgroundVariant, ConnectionLineType, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState } from "@xyflow/react"
import type { Connection, Edge, Node, NodeProps, NodeTypes } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { FileAudio, FileImage, FileText, FileVideo, Group, Plus, Route, Trash2, Ungroup, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { VertConversionGroupConfig, VertOutputCategory } from "./types"

export interface VertInputFileGroup {
  key: string
  extension: string
  category: VertFormatCategory
  paths: string[]
  files: File[]
}

export interface VertConversionRoute {
  key: string
  group: VertInputFileGroup
  config: VertConversionGroupConfig
}

interface TopologyProps {
  compact?: boolean
  dense?: boolean
  toolbarTarget?: HTMLElement | null
  groups: VertInputFileGroup[]
  routes: VertConversionRoute[]
  running: boolean
  onChange: (key: string, config: VertConversionGroupConfig) => void
  onAddConversion: () => void
  onConnectConversion: (sourceFormat: string, outputCategory: VertOutputCategory) => void
  onRemoveConversion: (key: string) => void
  onRemoveFile: (file: File) => void
  onRemoveGroup: (group: VertInputFileGroup) => void
  onRemovePath: (path: string) => void
}

const CATEGORY_ORDER: VertOutputCategory[] = ["image", "video", "audio", "document"]
const CATEGORY_META = {
  image: { label: "图片", icon: FileImage, className: "border-chart-1/40 bg-chart-1/10 text-chart-1" },
  video: { label: "视频", icon: FileVideo, className: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  audio: { label: "音频", icon: FileAudio, className: "border-chart-3/40 bg-chart-3/10 text-chart-3" },
  document: { label: "文档", icon: FileText, className: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
} as const

type SourceNodeData = {
  group: VertInputFileGroup
  running: boolean
  onRemoveFile: (file: File) => void
  onRemoveGroup: (group: VertInputFileGroup) => void
  onRemovePath: (path: string) => void
}
type CategoryNodeData = { category: VertOutputCategory; active: boolean }
type OutputNodeData = { route: VertConversionRoute; sourceFormats: string[]; onChange: TopologyProps["onChange"]; onRemove: TopologyProps["onRemoveConversion"] }
type SourceFlowNode = Node<SourceNodeData, "sourceGroup">
type ManualGroupFlowNode = Node<{ label: string }, "manualGroup">
type CategoryFlowNode = Node<CategoryNodeData, "categoryRouter">
type OutputFlowNode = Node<OutputNodeData, "outputGroup">
type VertFlowNode = SourceFlowNode | ManualGroupFlowNode | CategoryFlowNode | OutputFlowNode

const NODE_TYPES: NodeTypes = {
  sourceGroup: SourceFlowNodeCard,
  manualGroup: ManualGroupFlowNodeCard,
  categoryRouter: CategoryFlowNodeCard,
  outputGroup: OutputFlowNodeCard,
}
const FLOW_STYLE = {
  "--xy-background-color": "transparent",
  "--xy-edge-stroke": "color-mix(in oklch, var(--primary) 72%, transparent)",
  "--xy-edge-stroke-width": "2",
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
} as CSSProperties
const CONNECTION_LINE_STYLE = { stroke: "var(--primary)", strokeWidth: 2.5 } as CSSProperties

export function ConversionTopology(props: TopologyProps) {
  if (!props.groups.length) return <TopologyEmpty compact={props.compact} />
  if (props.compact) return <CompactTopology {...props} />
  return <FlowTopology {...props} />
}

function FlowTopology(props: TopologyProps) {
  const reduceMotion = useReducedMotion()
  const groupSequence = useRef(1)
  const flow = useMemo(() => buildFlow(props, Boolean(reduceMotion)), [props.routes, props.running, props.onChange, props.onRemoveFile, props.onRemoveGroup, props.onRemovePath, reduceMotion])
  const [nodes, setNodes, onNodesChange] = useNodesState<VertFlowNode>(flow.nodes)
  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]))
      const groups = current.filter((node): node is ManualGroupFlowNode => node.type === "manualGroup")
      const groupIds = new Set(groups.map((node) => node.id))
      const next = flow.nodes.map((node) => {
        const previous = currentById.get(node.id)
        if (previous?.parentId && groupIds.has(previous.parentId)) return { ...node, parentId: previous.parentId, extent: "parent" as const, position: previous.position, selected: previous.selected }
        return { ...node, position: previous?.position ?? node.position, selected: previous?.selected }
      })
      const usedGroups = new Set(next.map((node) => node.parentId).filter(Boolean))
      return [...groups.filter((group) => usedGroups.has(group.id)), ...next]
    })
  }, [flow.nodes, setNodes])
  const selected = nodes.filter((node) => node.selected)
  const canGroup = selected.filter((node) => !node.parentId && node.type !== "manualGroup").length >= 2
  const canUngroup = selected.some((node) => node.type === "manualGroup" || node.parentId)
  function isValidConnection(connection: Connection): boolean {
    return Boolean(connectionToConversion(connection)) && !props.running
  }
  function connectConversion(connection: Connection) {
    const conversion = connectionToConversion(connection)
    if (!conversion || props.running) return
    props.onConnectConversion(conversion.sourceFormat, conversion.outputCategory)
  }
  function groupSelected() {
    setNodes((current) => {
      const members = current.filter((node) => node.selected && !node.parentId && node.type !== "manualGroup")
      if (members.length < 2) return current
      const left = Math.min(...members.map((node) => node.position.x)) - 20
      const top = Math.min(...members.map((node) => node.position.y)) - 38
      const right = Math.max(...members.map((node) => node.position.x + nodeDimension(node, "width"))) + 20
      const bottom = Math.max(...members.map((node) => node.position.y + nodeDimension(node, "height"))) + 20
      const id = `manual-group:${groupSequence.current++}`
      const group: ManualGroupFlowNode = { id, type: "manualGroup", position: { x: left, y: top }, data: { label: `手动组 ${groupSequence.current - 1}` }, style: { width: right - left, height: bottom - top }, selected: false }
      const memberIds = new Set(members.map((node) => node.id))
      return [group, ...current.map((node) => memberIds.has(node.id) ? { ...node, parentId: id, extent: "parent" as const, position: { x: node.position.x - left, y: node.position.y - top }, selected: false } : node)]
    })
  }
  function ungroupSelected() {
    setNodes((current) => {
      const groupIds = new Set<string>()
      for (const node of current) { if (node.selected && node.type === "manualGroup") groupIds.add(node.id); else if (node.selected && node.parentId) groupIds.add(node.parentId) }
      if (!groupIds.size) return current
      const groups = new Map(current.filter((node) => groupIds.has(node.id)).map((node) => [node.id, node]))
      return current.flatMap((node) => {
        if (groupIds.has(node.id) && node.type === "manualGroup") return []
        if (!node.parentId || !groupIds.has(node.parentId)) return [node]
        const parent = groups.get(node.parentId)
        if (!parent) return [node]
        const { extent: _extent, parentId: _parentId, ...rest } = node
        return [{ ...rest, position: { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y }, selected: false } as VertFlowNode]
      })
    })
  }
  const toolbar = <div className="flex items-center gap-1.5"><Button disabled={props.running || !props.groups.length} size="sm" onClick={props.onAddConversion}><Plus data-icon="inline-start" />添加转换组</Button><Button disabled={!canGroup} size="sm" variant="outline" onClick={groupSelected}><Group data-icon="inline-start" />组合</Button><Button disabled={!canUngroup} size="sm" variant="ghost" onClick={ungroupSelected}><Ungroup data-icon="inline-start" />解组</Button><Badge variant="secondary">{props.routes.length} 个转换组</Badge></div>
  return <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background/55" data-testid="vert-conversion-topology">
    {props.toolbarTarget ? createPortal(toolbar, props.toolbarTarget) : null}
    {props.toolbarTarget ? null : <div className="z-10 flex items-center justify-end border-b bg-background/80 px-3 py-1.5 backdrop-blur">{toolbar}</div>}
    <div className="min-h-[330px] flex-1">
      <ReactFlow<VertFlowNode, Edge> nodes={nodes} edges={flow.edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onConnect={connectConversion} isValidConnection={isValidConnection} connectionLineType={ConnectionLineType.Bezier} connectionLineStyle={CONNECTION_LINE_STYLE} connectionRadius={28} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.45} maxZoom={1.35} nodesDraggable nodesConnectable={!props.running} elementsSelectable multiSelectionKeyCode="Shift" onlyRenderVisibleElements panOnScroll proOptions={{ hideAttribution: true }} zoomOnDoubleClick={false} style={FLOW_STYLE}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="color-mix(in oklch, var(--muted-foreground) 22%, transparent)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  </section>
}

function buildFlow(props: TopologyProps, reduceMotion: boolean): { nodes: VertFlowNode[]; edges: Edge[] } {
  const nodes: VertFlowNode[] = []
  const edges: Edge[] = []
  const sourceCategoryEdges = new Set<string>()
  const rowCount = Math.max(props.groups.length, props.routes.length)
  const height = Math.max(620, rowCount * 170 + 50)
  const categoryGap = (height - 120) / CATEGORY_ORDER.length
  for (const [index, group] of props.groups.entries()) {
    const sourceId = `source:${group.key}`
    const y = 20 + index * 170
    nodes.push({ id: sourceId, type: "sourceGroup", position: { x: 20, y }, data: { group, running: props.running, onRemoveFile: props.onRemoveFile, onRemoveGroup: props.onRemoveGroup, onRemovePath: props.onRemovePath }, className: "[&.selected>article]:border-primary [&.selected>article]:ring-2 [&.selected>article]:ring-primary/25", style: { width: 300, height: 130 } })
  }
  for (const [index, route] of props.routes.entries()) {
    const sourceId = `source:${route.group.key}`
    const categoryId = `category:${route.config.outputCategory}`
    const outputId = `output:${route.key}`
    const y = 20 + index * 170
    nodes.push({ id: outputId, type: "outputGroup", position: { x: 700, y }, data: { route, sourceFormats: props.groups.map((group) => group.extension), onChange: props.onChange, onRemove: props.onRemoveConversion }, className: "[&.selected>article]:border-primary [&.selected>article]:ring-2 [&.selected>article]:ring-primary/25", style: { width: 300, height: 142 } })
    const edgeStyle = { strokeWidth: props.running ? 3 : 2 }
    const sourceCategoryId = `${sourceId}->${categoryId}`
    if (!sourceCategoryEdges.has(sourceCategoryId)) {
      sourceCategoryEdges.add(sourceCategoryId)
      edges.push({ id: sourceCategoryId, source: sourceId, target: categoryId, type: "default", animated: !reduceMotion, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: edgeStyle })
    }
    edges.push({ id: `${categoryId}->${outputId}`, source: categoryId, target: outputId, type: "default", animated: !reduceMotion, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: edgeStyle })
  }
  for (const [index, category] of CATEGORY_ORDER.entries()) {
    nodes.push({ id: `category:${category}`, type: "categoryRouter", position: { x: 430, y: 20 + index * categoryGap }, data: { category, active: props.routes.some((route) => route.config.outputCategory === category) }, className: "[&.selected>div]:border-primary [&.selected>div]:ring-2 [&.selected>div]:ring-primary/25", style: { width: 150, height: 90 } })
  }
  return { nodes, edges }
}

function SourceFlowNodeCard({ data }: NodeProps<SourceFlowNode>) {
  const category = normalizedCategory(data.group.category)
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const total = data.group.paths.length + data.group.files.length
  return <article className="flex size-full flex-col overflow-hidden rounded-xl border border-primary/55 bg-card/95 px-3 py-2 shadow-md"><Handle aria-label={`从 .${data.group.extension} 拉线添加转换层`} type="source" position={Position.Right} className="!size-3 !border-2 !border-background !bg-primary" /><div className="flex items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", meta.className)}><Icon className="size-4" /></div><span className="font-mono text-sm font-semibold uppercase">.{data.group.extension}</span><Badge variant="outline">{total} 个</Badge><span className="ml-auto text-[10px] text-muted-foreground">文件团</span><Button aria-label={`清空 .${data.group.extension} 文件团`} className="nodrag nopan" disabled={data.running} size="icon-xs" variant="ghost" onClick={() => data.onRemoveGroup(data.group)}><Trash2 /></Button></div><ul className="nowheel nodrag nopan mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">{data.group.paths.map((path) => <FileRow key={`path:${path}`} engine="CLI" label={fileName(path)} title={path} disabled={data.running} onRemove={() => data.onRemovePath(path)} />)}{data.group.files.map((file) => <FileRow key={`file:${browserFileKey(file)}`} engine="Wasm" label={file.name} title={file.name} disabled={data.running} onRemove={() => data.onRemoveFile(file)} />)}</ul></article>
}

function ManualGroupFlowNodeCard({ data }: NodeProps<ManualGroupFlowNode>) { return <div className="size-full rounded-2xl border-2 border-primary bg-primary/[0.045] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)]"><div className="px-3 py-2 text-[10px] font-semibold text-primary">{data.label} · 拖动整体</div></div> }

function CategoryFlowNodeCard({ data }: NodeProps<CategoryFlowNode>) {
  const meta = CATEGORY_META[data.category]
  const Icon = meta.icon
  return <div className={cn("flex size-full flex-col items-center justify-center rounded-xl border text-center shadow-sm transition-opacity", meta.className, data.active ? "opacity-100" : "opacity-55")}><Handle aria-label={`连接到${meta.label}转换层`} type="target" position={Position.Left} className="!size-3 !border-2 !border-background !bg-primary" /><Icon className="mb-1 size-5" /><span className="text-xs font-semibold">{meta.label}</span><span className="text-[10px] opacity-70">拖线添加</span>{data.active ? <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-primary ring-2 ring-background" /> : null}<Handle type="source" position={Position.Right} isConnectable={false} className="!size-2.5 !border-2 !border-background !bg-primary" /></div>
}

function OutputFlowNodeCard({ data }: NodeProps<OutputFlowNode>) {
  const { route } = data
  const sourceFormat = route.config.sourceFormat ?? route.group.extension
  const canDeleteSource = route.group.paths.length > 0
  return <article className="flex size-full flex-col justify-center gap-2 rounded-xl border border-primary/55 bg-card/95 px-3 py-2 shadow-md"><Handle type="target" position={Position.Left} isConnectable={false} className="!size-2.5 !border-2 !border-background !bg-primary" /><div className="flex items-center gap-2"><Route className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold uppercase">.{sourceFormat} → .{route.config.targetFormat}</span><Badge variant="outline">转换组</Badge><Button aria-label={`删除 .${sourceFormat} → .${route.config.targetFormat} 转换组`} className="nodrag nopan" size="icon-xs" variant="ghost" onClick={() => data.onRemove(route.key)}><Trash2 /></Button></div><div className="nodrag nopan grid grid-cols-2 gap-2"><SourceFormatSelect formats={data.sourceFormats} value={sourceFormat} onChange={(sourceFormat) => data.onChange(route.key, { ...route.config, sourceFormat })} /><TargetFormatSelect value={route.config.targetFormat} onChange={(targetFormat) => data.onChange(route.key, { ...route.config, outputCategory: categoryForFormat(targetFormat), targetFormat })} /></div><label className={cn("nodrag nopan flex items-center justify-between gap-2 text-[11px]", canDeleteSource ? "text-foreground" : "text-muted-foreground")} title={canDeleteSource ? "仅在本地 CLI 转换成功后删除源文件" : "浏览器/Wasm 无权删除磁盘源文件"}><span>成功后删除源文件 <span className="text-muted-foreground">· 默认关闭</span></span><Switch checked={route.config.deleteSourceAfterSuccess ?? false} disabled={!canDeleteSource} onCheckedChange={(deleteSourceAfterSuccess) => data.onChange(route.key, { ...route.config, deleteSourceAfterSuccess })} /></label></article>
}

function CompactTopology(props: TopologyProps) {
  const reduceMotion = useReducedMotion()
  if (props.dense) return <section className="flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-xl border bg-background/55 p-1.5" data-testid="vert-conversion-topology"><Badge variant="secondary" className="shrink-0">{props.routes.length} 组</Badge><AnimatePresence initial={false}>{props.routes.map((route) => <motion.div layout key={route.key} initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex shrink-0 items-center rounded-md border bg-card pl-2 font-mono text-[11px] font-semibold uppercase"><span>.{route.config.sourceFormat ?? route.group.extension} → .{route.config.targetFormat}</span><Button aria-label={`删除转换组 ${route.key}`} disabled={props.running} size="icon-xs" variant="ghost" onClick={() => props.onRemoveConversion(route.key)}><X /></Button></motion.div>)}</AnimatePresence></section>
  return <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-xl border bg-background/55 p-2" data-testid="vert-conversion-topology"><div className="flex items-center justify-between"><span className="text-xs font-semibold">文件团与转换组</span><Button disabled={!props.groups.length} size="xs" onClick={props.onAddConversion}><Plus data-icon="inline-start" />添加转换组</Button></div><AnimatePresence initial={false}>{props.routes.map((route) => <motion.div layout key={route.key} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-lg border bg-card p-2"><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2"><div className="min-w-0"><div className="font-mono text-xs font-semibold uppercase">.{route.config.sourceFormat ?? route.group.extension}</div><div className="text-[10px] text-muted-foreground">{route.group.paths.length + route.group.files.length} 个文件</div></div><Route className="size-4 text-primary" /><TargetFormatSelect value={route.config.targetFormat} onChange={(targetFormat) => props.onChange(route.key, { ...route.config, outputCategory: categoryForFormat(targetFormat), targetFormat })} /><Button aria-label={`删除转换组 ${route.key}`} disabled={props.running} size="icon-xs" variant="ghost" onClick={() => props.onRemoveConversion(route.key)}><Trash2 /></Button></div><div className="mt-1 flex gap-1 overflow-x-auto">{route.group.paths.map((path) => <CompactFileChip key={`path:${path}`} label={fileName(path)} disabled={props.running} onRemove={() => props.onRemovePath(path)} />)}{route.group.files.map((file) => <CompactFileChip key={`file:${browserFileKey(file)}`} label={file.name} disabled={props.running} onRemove={() => props.onRemoveFile(file)} />)}</div></motion.div>)}</AnimatePresence></section>
}

function TopologyEmpty({ compact }: { compact?: boolean }) { return <section className={cn("grid place-items-center rounded-xl border border-dashed bg-background/55 text-center", compact ? "min-h-20 p-3" : "min-h-[330px] p-8")} data-testid="vert-conversion-topology"><div><div className="mx-auto grid size-10 place-items-center rounded-full bg-secondary"><Route /></div><h4 className="mt-2 text-sm font-semibold">拖入文件后自动成团</h4><p className="mt-1 text-xs text-muted-foreground">PNG、JPG、MP4 等输入格式会各自生成一个转换组。</p></div></section> }

function SourceFormatSelect({ formats, onChange, value }: { formats: string[]; onChange: (value: string) => void; value: string }) { return <Select value={value} onValueChange={onChange}><SelectTrigger size="sm" className="nodrag nopan w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>源格式</SelectLabel>{formats.map((format) => <SelectItem key={format} value={format}>.{format}</SelectItem>)}</SelectGroup></SelectContent></Select> }
function TargetFormatSelect({ onChange, value }: { onChange: (value: string) => void; value: string }) { return <Select value={value} onValueChange={onChange}><SelectTrigger size="sm" className="nodrag nopan w-full"><SelectValue /></SelectTrigger><SelectContent>{CATEGORY_ORDER.map((category) => <SelectGroup key={category}><SelectLabel>{CATEGORY_META[category].label}</SelectLabel>{VERT_FORMAT_GROUPS[category].map((format) => <SelectItem key={format} value={format}>.{format}</SelectItem>)}</SelectGroup>)}</SelectContent></Select> }
function CompactFileChip({ disabled, label, onRemove }: { disabled: boolean; label: string; onRemove: () => void }) { return <span className="flex shrink-0 items-center rounded-md bg-muted/70 pl-1.5 text-[10px]"><span className="max-w-28 truncate">{label}</span><Button aria-label={`移除 ${label}`} disabled={disabled} size="icon-xs" variant="ghost" onClick={onRemove}><X /></Button></span> }
function FileRow({ disabled, engine, label, onRemove, title }: { disabled: boolean; engine: "CLI" | "Wasm"; label: string; onRemove: () => void; title: string }) { return <li className="group flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] hover:bg-muted/60"><span className="min-w-0 flex-1 truncate text-muted-foreground" title={title}>{label}</span><span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">{engine}</span><Button aria-label={`移除 ${label}`} className="nodrag nopan opacity-55 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" disabled={disabled} size="icon-xs" variant="ghost" onClick={onRemove}><X /></Button></li> }

export function defaultFormat(category: VertOutputCategory): string { return category === "image" ? "webp" : category === "video" ? "mp4" : category === "audio" ? "mp3" : "docx" }
export function compatibleCategories(category: VertFormatCategory): VertOutputCategory[] { if (category === "audio") return ["audio", "video"]; if (category === "video") return ["video", "audio"]; if (category === "document") return ["document"]; return ["image"] }
function normalizedCategory(category: VertFormatCategory): VertOutputCategory { return category === "unknown" ? "image" : category }
function categoryForFormat(format: string): VertOutputCategory { return normalizedCategory(detectVertCategory(format)) }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function browserFileKey(file: File): string { return `${file.name}:${file.size}:${file.lastModified}` }
function nodeDimension(node: VertFlowNode, key: "height" | "width"): number { const value = node.style?.[key]; if (typeof value === "number") return value; const parsed = Number.parseFloat(String(value ?? "")); return Number.isFinite(parsed) ? parsed : key === "width" ? 160 : 80 }

export function connectionToConversion(connection: Pick<Connection, "source" | "target">): { sourceFormat: string; outputCategory: VertOutputCategory } | undefined {
  if (!connection.source?.startsWith("source:") || !connection.target?.startsWith("category:")) return undefined
  const sourceFormat = connection.source.slice("source:".length)
  const outputCategory = connection.target.slice("category:".length)
  if (!sourceFormat || !CATEGORY_ORDER.includes(outputCategory as VertOutputCategory)) return undefined
  return { sourceFormat, outputCategory: outputCategory as VertOutputCategory }
}
