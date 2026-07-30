import type { ComfygureCanvasExport, ComfygureCanvasExportOptions, ComfygureCanvasGroup, ComfygureCanvasLink, ComfygureCanvasNode, PromptGraph, PromptInput, PromptNode } from "./contracts.js"
import { stringValue, isRecord } from "./value-normalization.js"
import { orderedPromptNodes, promptLinksIn, isPromptLink } from "./prompt-graph.js"

/**
 * Projects a fixed API prompt graph into the editor workflow format. This is
 * deliberately an export-only view: execution always uses the API graph.
 */
export function exportComfygureCanvas(graph: PromptGraph, options: ComfygureCanvasExportOptions = {}): ComfygureCanvasExport {
  const diagnostics: string[] = []
  const entries = orderedPromptNodes(graph)
  if (!options.objectInfo) diagnostics.push("Local /object_info was unavailable; port types and widget ordering use deterministic fallbacks.")

  const records = entries.map(([sourceId, node], index) => createCanvasNodeRecord(sourceId, node, index + 1, graph, options.objectInfo, diagnostics))
  const bySourceId = new Map(records.map((record) => [record.sourceId, record]))
  const layers = canvasLayers(records, bySourceId, diagnostics)
  const columns = new Map<number, CanvasNodeRecord[]>()
  for (const record of records) {
    const column = columns.get(layers.get(record.sourceId) ?? 0) ?? []
    column.push(record)
    columns.set(layers.get(record.sourceId) ?? 0, column)
  }

  for (const [layer, column] of columns) {
    let y = 56
    for (const record of column) {
      record.pos = [56 + layer * 520, y]
      y += record.size[1] + 44
    }
  }

  const links: ComfygureCanvasLink[] = []
  let nextLinkId = 1
  for (const target of records) {
    for (const input of target.inputs) {
      const value = target.node.inputs[input.name]
      if (!isPromptLink(value)) continue
      const origin = bySourceId.get(value[0])
      if (!origin) {
        diagnostics.push(`${target.sourceId}.${input.name} references missing node ${value[0]}; the dangling link was omitted.`)
        continue
      }
      const output = origin.outputs[value[1]]
      if (!output) {
        diagnostics.push(`${target.sourceId}.${input.name} references unavailable output ${value[1]} on ${value[0]}; the dangling link was omitted.`)
        continue
      }
      const linkId = nextLinkId++
      input.link = linkId
      output.links.push(linkId)
      const type = output.type === "*" ? input.type : output.type
      links.push([linkId, origin.id, output.slot_index, target.id, input.slotIndex, type])
    }
  }

  const nodes: ComfygureCanvasNode[] = records.map((record) => ({
    id: record.id,
    type: record.node.class_type,
    pos: record.pos,
    size: record.size,
    flags: {},
    order: record.order,
    mode: 0,
    inputs: record.inputs.map(({ slotIndex: _slotIndex, ...input }) => ({ ...input })),
    outputs: record.outputs.map((output) => ({
      label: output.name,
      name: output.name,
      type: output.type,
      slot_index: output.slot_index,
      links: output.links.length ? [...output.links] : null,
    })),
    properties: { "Node name for S&R": record.node.class_type },
    widgets_values: record.widgetValues,
    ...(record.title ? { title: record.title } : {}),
  }))

  const groups = [...columns.entries()]
    .sort(([left], [right]) => left - right)
    .map(([layer, column], index) => canvasGroupForLayer(layer, column, index + 1))

  return {
    version: 0.4,
    last_node_id: records.length,
    last_link_id: links.length,
    nodes,
    links,
    groups,
    config: {},
    extra: {
      comfygure: {
        format: "comfygure-canvas/v1",
        sourceNodeCount: entries.length,
        objectInfoUsed: Boolean(options.objectInfo),
        diagnostics,
      },
    },
  }
}
export interface CanvasInputRecord {
  slotIndex: number
  label: string
  name: string
  type: string
  link: number | null
  widget?: { name: string }
}
export interface CanvasOutputRecord {
  name: string
  type: string
  slot_index: number
  links: number[]
}
export interface CanvasNodeRecord {
  sourceId: string
  id: number
  node: PromptNode
  order: number
  title?: string
  size: [number, number]
  pos: [number, number]
  inputs: CanvasInputRecord[]
  outputs: CanvasOutputRecord[]
  widgetValues: PromptInput[]
}
export interface CanvasObjectInputDefinition {
  name: string
  type: string
  widget: boolean
}
export const CANVAS_GROUP_COLORS = ["#25384a", "#35432a", "#4a3825", "#442b40", "#2f3c45"] as const
export function createCanvasNodeRecord(
  sourceId: string,
  node: PromptNode,
  id: number,
  graph: PromptGraph,
  objectInfo: Record<string, unknown> | undefined,
  diagnostics: string[],
): CanvasNodeRecord {
  const definitionValue = objectInfo?.[node.class_type]
  const definition: Record<string, unknown> | undefined = isRecord(definitionValue) ? definitionValue : undefined
  if (objectInfo && !definition) diagnostics.push(`/object_info has no definition for ${node.class_type}; ${sourceId} uses fallback ports.`)
  const objectInputs = definition ? canvasObjectInputDefinitions(definition) : []
  const inputDefinitions = new Map(objectInputs.map((input) => [input.name, input]))
  for (const [name, value] of Object.entries(node.inputs)) {
    if (!inputDefinitions.has(name)) inputDefinitions.set(name, { name, type: canvasPromptInputType(value), widget: !isPromptLink(value) })
  }

  const inputs = [...inputDefinitions.values()].map((input, slotIndex) => ({
    slotIndex,
    label: input.name,
    name: input.name,
    type: input.type,
    link: null,
    ...(input.widget ? { widget: { name: input.name } } : {}),
  }))
  const outputDefinitions = definition ? canvasObjectOutputDefinitions(definition) : []
  const maximumReferencedOutputIndex = Math.max(-1, ...referencedOutputIndexesFromGraph(graph, sourceId))
  const outputCount = Math.max(outputDefinitions.length, maximumReferencedOutputIndex + 1)
  const outputs = Array.from({ length: outputCount }, (_, slotIndex) => ({
    name: outputDefinitions[slotIndex]?.name ?? `OUTPUT_${slotIndex + 1}`,
    type: outputDefinitions[slotIndex]?.type ?? "*",
    slot_index: slotIndex,
    links: [],
  }))
  const widgetValues = inputs
    .filter((input) => input.widget)
    .map((input) => {
      const value = node.inputs[input.name]
      return value === undefined || isPromptLink(value) ? null : value
    })
  const title = stringValue(node._meta?.title, "")
  const rowCount = Math.max(inputs.length, outputs.length, widgetValues.length, 1)
  return {
    sourceId,
    id,
    node,
    order: id - 1,
    ...(title ? { title } : {}),
    size: [320, Math.max(92, 54 + rowCount * 27)],
    pos: [0, 0],
    inputs,
    outputs,
    widgetValues,
  }
}
export function canvasObjectInputDefinitions(definition: Record<string, unknown>): CanvasObjectInputDefinition[] {
  const input = isRecord(definition.input) ? definition.input : undefined
  const sections = [input?.required, input?.optional]
  const result: CanvasObjectInputDefinition[] = []
  for (const section of sections) {
    if (!isRecord(section)) continue
    for (const [name, value] of Object.entries(section)) {
      if (result.some((input) => input.name === name)) continue
      result.push({ name, type: canvasObjectInputType(value), widget: canvasObjectInputHasWidget(value) })
    }
  }
  return result
}
export function canvasObjectOutputDefinitions(definition: Record<string, unknown>): Array<{ name: string; type: string }> {
  const types = Array.isArray(definition.output) ? definition.output : []
  const names = Array.isArray(definition.output_name) ? definition.output_name : []
  return types.map((rawType, index) => ({
    type: canvasPortType(rawType),
    name: typeof names[index] === "string" && names[index].trim() ? names[index].trim() : `OUTPUT_${index + 1}`,
  }))
}
export function canvasObjectInputType(value: unknown): string {
  if (!Array.isArray(value)) return "*"
  return canvasPortType(value[0])
}
export function canvasObjectInputHasWidget(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  if (Array.isArray(value[0])) return true
  const config = isRecord(value[1]) ? value[1] : undefined
  return Boolean(config && ("default" in config || "defaultInput" in config || "multiline" in config || "control_after_generate" in config))
}
export function canvasPromptInputType(value: PromptInput): string {
  if (isPromptLink(value)) return "*"
  if (typeof value === "string") return "STRING"
  if (typeof value === "boolean") return "BOOLEAN"
  if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT"
  return "*"
}
export function canvasPortType(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  return Array.isArray(value) ? "COMBO" : "*"
}
export function referencedOutputIndexesFromGraph(graph: PromptGraph, sourceId: string): number[] {
  const indexes: number[] = []
  for (const target of Object.values(graph)) {
    for (const input of Object.values(target.inputs)) {
      for (const link of promptLinksIn(input)) if (link[0] === sourceId) indexes.push(link[1])
    }
  }
  return indexes
}
export function canvasLayers(records: readonly CanvasNodeRecord[], bySourceId: ReadonlyMap<string, CanvasNodeRecord>, diagnostics: string[]): Map<string, number> {
  const resolved = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (sourceId: string): number => {
    const known = resolved.get(sourceId)
    if (known !== undefined) return known
    if (!visiting.add(sourceId)) {
      diagnostics.push(`Dependency cycle involving ${sourceId}; its layout falls back to the current column.`)
      return 0
    }
    const record = bySourceId.get(sourceId)
    let layer = 0
    if (record) {
      for (const input of Object.values(record.node.inputs)) {
        if (!isPromptLink(input) || !bySourceId.has(input[0])) continue
        layer = Math.max(layer, resolve(input[0]) + 1)
      }
    }
    visiting.delete(sourceId)
    resolved.set(sourceId, layer)
    return layer
  }
  for (const record of records) resolve(record.sourceId)
  return resolved
}
export function canvasGroupForLayer(layer: number, column: readonly CanvasNodeRecord[], id: number): ComfygureCanvasGroup {
  const left = Math.min(...column.map((record) => record.pos[0])) - 28
  const top = Math.min(...column.map((record) => record.pos[1])) - 36
  const right = Math.max(...column.map((record) => record.pos[0] + record.size[0])) + 28
  const bottom = Math.max(...column.map((record) => record.pos[1] + record.size[1])) + 36
  return {
    id,
    title: canvasLayerTitle(column),
    bounding: [left, top, right - left, bottom - top],
    color: CANVAS_GROUP_COLORS[layer % CANVAS_GROUP_COLORS.length]!,
    font_size: 24,
    flags: {},
  }
}
export function canvasLayerTitle(column: readonly CanvasNodeRecord[]): string {
  const stages = [...new Set(column.map((record) => canvasNodeStage(record.node.class_type)))]
  return stages.length === 1 ? stages[0]! : stages.join(" and ")
}
export function canvasNodeStage(classType: string): string {
  const type = classType.toLocaleLowerCase()
  if (/(?:save|preview|output)/.test(type)) return "Output"
  if (/(?:vae|decode|upscale|image)/.test(type)) return "Decode and image processing"
  if (/(?:sampler|latent|noise|cache)/.test(type)) return "Sampling"
  if (/(?:text|prompt|conditioning|lora)/.test(type)) return "Prompt conditioning"
  if (/(?:load|loader|model|unet|clip)/.test(type)) return "Models and inputs"
  return "Workflow utilities"
}
