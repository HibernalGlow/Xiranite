import { jsonrepair } from "jsonrepair"
import { COMFYGURE_BINDING_MANIFEST_FORMAT, COMFYGURE_TEMPLATE_FORMAT } from "./contracts.js"
import type { ComfygureBindingKey, ComfygureBindingManifest, ComfygureBindingTarget, ComfygureLora, ComfygureTemplate, ComfygureWorkflowDiagnostic, ComfygureWorkflowImport, ComfygureWorkflowImportOptions, PromptGraph, PromptInput, PromptLink } from "./contracts.js"
import { stringValue, isRecord } from "./value-normalization.js"
import { orderedPromptNodes, clonePromptGraph, promptInputString, numberPromptInput, integerPromptInput } from "./prompt-graph.js"
import { compressComfygureText } from "./compressed-text.js"

/**
 * Parses both native API Prompt Graph exports and editor workflow exports. UI
 * workflows require object_info because widget order is not part of the API
 * contract and must not be guessed from a rendered editor.
 */
export function importComfyuiWorkflow(source: string, options: ComfygureWorkflowImportOptions = {}): ComfygureWorkflowImport {
  const diagnostics: ComfygureWorkflowDiagnostic[] = []
  const original = source.replace(/^\uFEFF/, "").trim()
  if (!original) return { repairedSource: false, diagnostics: [workflowError("empty-source", "The imported workflow is empty.")] }

  let value: unknown
  let repairedSource = false
  try {
    value = JSON.parse(original) as unknown
  } catch {
    try {
      value = JSON.parse(jsonrepair(original)) as unknown
      repairedSource = true
      diagnostics.push({ severity: "warning", code: "repaired-json", message: "The imported file was not strict JSON and was repaired before normalization." })
    } catch (error) {
      return {
        repairedSource: false,
        diagnostics: [workflowError("invalid-json", `The imported workflow could not be parsed: ${error instanceof Error ? error.message : String(error)}`)],
      }
    }
  }

  const sourceFormat = isRecord(value) && Array.isArray(value.nodes) ? "ui" : "api"
  const graph = sourceFormat === "ui"
    ? normalizeComfyuiUiWorkflow(value, options.objectInfo, diagnostics)
    : normalizeComfyuiApiGraph(value, diagnostics)
  if (!graph) return { sourceFormat, repairedSource, diagnostics }

  for (const [nodeId, node] of Object.entries(graph)) {
    if (COMPILE_TIME_NODE_TYPES.has(node.class_type)) {
      diagnostics.push({
        severity: "warning",
        code: "compile-time-node",
        message: `${node.class_type} is marked for compile-time resolution and will not be sent to ComfyUI.`,
        nodeId,
      })
    }
  }

  const compressed = compressComfygureText(original)
  if (!compressed) return { sourceFormat, repairedSource, diagnostics: [...diagnostics, workflowError("empty-source", "The imported workflow is empty.")] }
  return {
    sourceFormat,
    repairedSource,
    diagnostics,
    template: {
      format: COMFYGURE_TEMPLATE_FORMAT,
      name: stringValue(options.name, "Imported ComfyUI template"),
      sourceFormat,
      originalSource: compressed,
      repairedSource,
      graph,
      defaultLoras: extractGlowLoraCandidates(graph),
      bindingManifest: inferComfygureBindingManifest(graph),
    },
  }
}
export function confirmComfygureTemplateBindings(template: ComfygureTemplate): ComfygureTemplate {
  return {
    ...template,
    graph: clonePromptGraph(template.graph),
    bindingManifest: { ...template.bindingManifest, confirmed: true, bindings: template.bindingManifest.bindings.map((binding) => ({ ...binding, targets: [...binding.targets] })) },
  }
}
export function inferComfygureBindingManifest(graph: PromptGraph): ComfygureBindingManifest {
  const bindings = new Map<ComfygureBindingKey, ComfygureBindingTarget[]>()
  const unclassifiedPromptTargets: ComfygureBindingTarget[] = []
  const add = (key: ComfygureBindingKey, nodeId: string, inputName: string) => {
    const targets = bindings.get(key) ?? []
    targets.push({ nodeId, inputName })
    bindings.set(key, targets)
  }

  for (const [nodeId, node] of orderedPromptNodes(graph)) {
    const title = stringValue(node._meta?.title, "").toLocaleLowerCase()
    const classType = node.class_type.toLocaleLowerCase()
    if (classType.includes("cliptextencode") && "text" in node.inputs) {
      if (/(?:negative|\bneg\b|负)/iu.test(title)) add("negativePrompt", nodeId, "text")
      else if (/(?:positive|\bpos\b|正)/iu.test(title)) add("positivePrompt", nodeId, "text")
      else unclassifiedPromptTargets.push({ nodeId, inputName: "text" })
    }
    for (const [inputName] of Object.entries(node.inputs)) {
      const key = bindingKeyForInput(node.class_type, inputName)
      if (key) add(key, nodeId, inputName)
    }
  }

  if (!bindings.has("positivePrompt") && unclassifiedPromptTargets.length) bindings.set("positivePrompt", [unclassifiedPromptTargets.shift()!])
  if (!bindings.has("negativePrompt") && unclassifiedPromptTargets.length) bindings.set("negativePrompt", [unclassifiedPromptTargets.shift()!])

  return {
    format: COMFYGURE_BINDING_MANIFEST_FORMAT,
    confirmed: false,
    bindings: [...bindings.entries()]
      .map(([key, targets]) => ({ key, targets, confidence: "inferred" as const }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  }
}
export const COMPILE_TIME_NODE_TYPES = new Set([
  "BatchLoadTexts",
  "GlowDynamicTypedOutputs",
  "GlowTriggerLoRAStack",
  "GlowQueueControl",
  "PromptCleaningMaid",
  "AnimaPromptFormatter",
])
export interface UiWorkflowNode {
  id: string | number
  type: string
  mode?: number
  title?: string
  inputs?: readonly unknown[]
  widgets_values?: readonly unknown[]
}
export interface UiWorkflowLink {
  id: string
  originId: string
  originSlot: number
  targetId: string
  targetSlot: number
}
export function normalizeComfyuiApiGraph(value: unknown, diagnostics: ComfygureWorkflowDiagnostic[]): PromptGraph | undefined {
  if (!isRecord(value) || Array.isArray(value.nodes)) {
    diagnostics.push(workflowError("invalid-api-graph", "Expected a ComfyUI API Prompt Graph object keyed by node ID."))
    return undefined
  }
  const graph: PromptGraph = {}
  for (const [nodeId, rawNode] of Object.entries(value)) {
    if (!isRecord(rawNode)) {
      diagnostics.push(workflowError("invalid-node", "Every API graph node must be an object.", nodeId))
      continue
    }
    const classType = stringValue(rawNode.class_type, "")
    if (!classType) {
      diagnostics.push(workflowError("missing-class-type", "The API graph node has no class_type.", nodeId))
      continue
    }
    if (!isRecord(rawNode.inputs)) {
      diagnostics.push(workflowError("missing-inputs", "The API graph node has no inputs object.", nodeId))
      continue
    }
    const inputs = normalizePromptInputs(rawNode.inputs, diagnostics, nodeId)
    const meta = isRecord(rawNode._meta) ? normalizePromptInputs(rawNode._meta, diagnostics, nodeId) : undefined
    graph[nodeId] = { class_type: classType, inputs, ...(meta && Object.keys(meta).length ? { _meta: meta } : {}) }
  }
  if (Object.keys(graph).length === 0) diagnostics.push(workflowError("empty-api-graph", "The API Prompt Graph contains no valid nodes."))
  return Object.keys(graph).length ? graph : undefined
}
export function normalizeComfyuiUiWorkflow(value: unknown, objectInfo: Record<string, unknown> | undefined, diagnostics: ComfygureWorkflowDiagnostic[]): PromptGraph | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    diagnostics.push(workflowError("invalid-ui-workflow", "Expected a ComfyUI UI workflow with a nodes array."))
    return undefined
  }
  if (!objectInfo) {
    diagnostics.push(workflowError("object-info-required", "UI workflow conversion requires live /object_info evidence for widget ordering and node definitions."))
    return undefined
  }

  const nodes = new Map<string, UiWorkflowNode>()
  for (const rawNode of value.nodes) {
    if (!isRecord(rawNode) || (typeof rawNode.id !== "string" && typeof rawNode.id !== "number") || typeof rawNode.type !== "string") {
      diagnostics.push(workflowError("invalid-ui-node", "A UI workflow node is missing its ID or type."))
      continue
    }
    const nodeId = String(rawNode.id)
    if (nodes.has(nodeId)) {
      diagnostics.push(workflowError("duplicate-ui-node-id", "The UI workflow contains duplicate node IDs.", nodeId))
      continue
    }
    nodes.set(nodeId, rawNode as unknown as UiWorkflowNode)
  }
  const links = normalizeUiWorkflowLinks(value.links, diagnostics)
  const graph: PromptGraph = {}
  for (const [nodeId, node] of nodes) {
    if (node.type === "Reroute") continue
    if (node.type.toLocaleLowerCase().includes("subgraph")) {
      diagnostics.push(workflowError("unsupported-subgraph", "Subgraphs must be expanded in the ComfyUI editor before importing a template.", nodeId))
      continue
    }
    if (node.mode === 4) {
      diagnostics.push(workflowError("unsupported-bypass", "Bypassed UI nodes must be removed or baked into a pure template before importing.", nodeId))
      continue
    }
    const definition = objectInfo[node.type]
    if (!isRecord(definition)) {
      diagnostics.push(workflowError("unknown-node-definition", `The local target did not report ${node.type} in /object_info.`, nodeId))
      continue
    }
    const widgetValues = widgetValuesByInputName(node, definition, diagnostics, nodeId)
    const inputs: Record<string, PromptInput> = {}
    const uiInputs = Array.isArray(node.inputs) ? node.inputs : []
    const linkedInputNames = new Set<string>()
    for (const rawInput of uiInputs) {
      if (!isRecord(rawInput) || typeof rawInput.name !== "string") continue
      const inputName = rawInput.name
      if (rawInput.link === null || rawInput.link === undefined) continue
      linkedInputNames.add(inputName)
      const link = links.get(String(rawInput.link))
      if (!link) {
        diagnostics.push(workflowError("missing-ui-link", `Input ${inputName} references a missing link.`, nodeId, inputName))
        continue
      }
      const origin = resolveUiLinkOrigin(link, links, nodes, new Set())
      if (!origin) {
        diagnostics.push(workflowError("unresolvable-ui-link", `Input ${inputName} cannot be traced through a reroute.`, nodeId, inputName))
        continue
      }
      if (!nodes.has(origin[0]) || nodes.get(origin[0])?.mode === 4) {
        diagnostics.push(workflowError("unsupported-bypassed-link", `Input ${inputName} depends on a bypassed or missing node.`, nodeId, inputName))
        continue
      }
      inputs[inputName] = origin
    }
    for (const [inputName, inputValue] of widgetValues) {
      if (!linkedInputNames.has(inputName)) inputs[inputName] = inputValue
    }
    graph[nodeId] = {
      class_type: node.type,
      inputs,
      ...(node.title?.trim() ? { _meta: { title: node.title.trim() } } : {}),
    }
  }
  if (Object.keys(graph).length === 0) diagnostics.push(workflowError("empty-ui-graph", "The UI workflow contains no convertible execution nodes."))
  return Object.keys(graph).length ? graph : undefined
}
export function normalizePromptInputs(value: Record<string, unknown>, diagnostics: ComfygureWorkflowDiagnostic[], nodeId: string): Record<string, PromptInput> {
  const result: Record<string, PromptInput> = {}
  for (const [inputName, inputValue] of Object.entries(value)) {
    const normalized = normalizePromptInput(inputValue)
    if (normalized === undefined) {
      diagnostics.push(workflowError("unsupported-input-value", `Input ${inputName} has an unsupported non-JSON value.`, nodeId, inputName))
      continue
    }
    result[inputName] = normalized
  }
  return result
}
export function normalizePromptInput(value: unknown, depth = 0): PromptInput | undefined {
  if (depth > 32) return undefined
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    if (value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && typeof value[1] === "number" && Number.isFinite(value[1])) return [String(value[0]), value[1]]
    const array: PromptInput[] = []
    for (const item of value) {
      const normalized = normalizePromptInput(item, depth + 1)
      if (normalized === undefined) return undefined
      array.push(normalized)
    }
    return array
  }
  if (isRecord(value)) {
    const record: Record<string, PromptInput> = {}
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizePromptInput(item, depth + 1)
      if (normalized === undefined) return undefined
      record[key] = normalized
    }
    return record
  }
  return undefined
}
export function normalizeUiWorkflowLinks(value: unknown, diagnostics: ComfygureWorkflowDiagnostic[]): Map<string, UiWorkflowLink> {
  const links = new Map<string, UiWorkflowLink>()
  if (!Array.isArray(value)) return links
  for (const rawLink of value) {
    if (!Array.isArray(rawLink) || rawLink.length < 5 || (typeof rawLink[0] !== "number" && typeof rawLink[0] !== "string") || (typeof rawLink[1] !== "number" && typeof rawLink[1] !== "string") || typeof rawLink[2] !== "number" || (typeof rawLink[3] !== "number" && typeof rawLink[3] !== "string") || typeof rawLink[4] !== "number") {
      diagnostics.push(workflowError("invalid-ui-link", "The UI workflow contains a malformed link."))
      continue
    }
    links.set(String(rawLink[0]), { id: String(rawLink[0]), originId: String(rawLink[1]), originSlot: rawLink[2], targetId: String(rawLink[3]), targetSlot: rawLink[4] })
  }
  return links
}
export function resolveUiLinkOrigin(link: UiWorkflowLink, links: Map<string, UiWorkflowLink>, nodes: Map<string, UiWorkflowNode>, visited: Set<string>): PromptLink | undefined {
  if (!visited.add(link.id)) return undefined
  const origin = nodes.get(link.originId)
  if (!origin) return undefined
  if (origin.type !== "Reroute") return [link.originId, link.originSlot]
  const rerouteInput = Array.isArray(origin.inputs) ? origin.inputs.find((value) => isRecord(value) && value.link !== null && value.link !== undefined) : undefined
  if (!isRecord(rerouteInput)) return undefined
  const rerouteLink = links.get(String(rerouteInput.link))
  return rerouteLink ? resolveUiLinkOrigin(rerouteLink, links, nodes, visited) : undefined
}
export function widgetValuesByInputName(node: UiWorkflowNode, definition: Record<string, unknown>, diagnostics: ComfygureWorkflowDiagnostic[], nodeId: string): Map<string, PromptInput> {
  const result = new Map<string, PromptInput>()
  const widgetNames = objectInfoInputNames(definition)
  const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
  for (let index = 0; index < widgetNames.length; index += 1) {
    const inputName = widgetNames[index]!
    const value = values[index]
    if (value === undefined) continue
    const normalized = normalizePromptInput(value)
    if (normalized === undefined) {
      diagnostics.push(workflowError("unsupported-widget-value", `Widget ${inputName} has an unsupported value.`, nodeId, inputName))
      continue
    }
    result.set(inputName, normalized)
  }
  return result
}
export function objectInfoInputNames(definition: Record<string, unknown>): readonly string[] {
  const input = isRecord(definition.input) ? definition.input : undefined
  const required = input && isRecord(input.required) ? input.required : undefined
  const optional = input && isRecord(input.optional) ? input.optional : undefined
  return [...Object.keys(required ?? {}), ...Object.keys(optional ?? {})]
}
export function workflowError(code: string, message: string, nodeId?: string, inputName?: string): ComfygureWorkflowDiagnostic {
  return { severity: "error", code, message, ...(nodeId ? { nodeId } : {}), ...(inputName ? { inputName } : {}) }
}
export function bindingKeyForInput(classType: string, inputName: string): ComfygureBindingKey | undefined {
  switch (inputName) {
    case "unet_name": return "unetName"
    case "clip_name": return "clipName"
    case "vae_name": return "vaeName"
    case "width": return "width"
    case "height": return "height"
    case "batch_size": return "batchSize"
    case "seed": return "seed"
    case "steps": return "steps"
    case "cfg": return "cfg"
    case "sampler_name": return "samplerName"
    case "scheduler": return "scheduler"
    case "denoise": return "denoise"
    case "filename_prefix": return "filenamePrefix"
    case "quality": return classType.toLocaleLowerCase().includes("save") ? "outputQuality" : undefined
    case "format": return classType.toLocaleLowerCase().includes("save") ? "outputFormat" : undefined
    case "preview": return classType.toLocaleLowerCase().includes("save") ? "outputPreview" : undefined
    default: return undefined
  }
}
export function extractGlowLoraCandidates(graph: PromptGraph): readonly ComfygureLora[] {
  const loras: ComfygureLora[] = []
  for (const [, node] of orderedPromptNodes(graph)) {
    if (node.class_type !== "GlowTriggerLoRAStack") continue
    const count = integerPromptInput(node.inputs.lora_count, 0, 0, 30)
    for (let index = 1; index <= count; index += 1) {
      const name = promptInputString(node.inputs[`lora_name_${index}`])
      if (!name || name === "None") continue
      const outputTrigger = promptInputString(node.inputs[`output_trigger_${index}`])
      const loraTrigger = promptInputString(node.inputs[`lora_trigger_${index}`])
      loras.push({
        name,
        modelStrength: numberPromptInput(node.inputs[`model_weight_${index}`], 1),
        clipStrength: numberPromptInput(node.inputs[`clip_weight_${index}`], 1),
        activationTerms: promptInputString(node.inputs[`trigger_${index}`]),
        injectionTerms: outputTrigger || loraTrigger,
        enabled: node.inputs[`enable_${index}`] !== false,
      })
    }
  }
  return loras
}
