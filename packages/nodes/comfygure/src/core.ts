import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export const COMFYGURE_FORMAT = "comfygure/v1" as const
export const ANIMA_INT8_RECIPE = "anima-int8/v1" as const
export const DEFAULT_COMFYUI_ENDPOINT = "http://127.0.0.1:8000"
export const DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS = 10_000

export type PromptLink = readonly [nodeId: string, outputIndex: number]
export type PromptInput = string | number | boolean | null | PromptLink

export interface PromptNode {
  class_type: string
  inputs: Record<string, PromptInput>
}

export type PromptGraph = Record<string, PromptNode>

export interface ComfygureLora {
  name: string
  modelStrength?: number
  clipStrength?: number
  activationTerms?: string
  injectionTerms?: string
  enabled?: boolean
}

export interface ComfygureProgram {
  format: typeof COMFYGURE_FORMAT
  recipe: typeof ANIMA_INT8_RECIPE
  name: string
  model: {
    unetName: string
    clipName: string
    vaeName: string
  }
  prompts: {
    positive: string
    negative: string
    positivePrefix: string
  }
  loras: readonly ComfygureLora[]
  parameters: {
    width: number
    height: number
    batchSize: number
    seed: number
    steps: number
    cfg: number
    samplerName: string
    scheduler: string
    denoise: number
    foveaStrength: number
    sharpness: number
    maskInertia: number
  }
  teaCache: {
    threshold: number
    adaptiveMode: boolean
    earlyStepsFactor: number
    lateStepsFactor: number
    startPercent: number
    endPercent: number
    cacheDevice: string
  }
  output: {
    filenamePrefix: string
    format: "png" | "jpeg" | "webp"
    quality: number
    preview: boolean
  }
}

export interface ComfygureProgramDraft {
  name?: string
  model?: Partial<ComfygureProgram["model"]>
  prompts?: Partial<ComfygureProgram["prompts"]>
  loras?: readonly ComfygureLora[]
  parameters?: Partial<ComfygureProgram["parameters"]>
  teaCache?: Partial<ComfygureProgram["teaCache"]>
  output?: Partial<ComfygureProgram["output"]>
}

export interface ComfygureTarget {
  endpoint?: string
  clientId?: string
}

export interface ResourceRequirement {
  classType: string
  inputName: string
  resourceName: string
  kind: "unet" | "clip" | "vae" | "lora"
}

export interface CompiledProgram {
  program: ComfygureProgram
  graph: PromptGraph
  activeLoras: readonly ComfygureLora[]
  positivePrompt: string
  negativePrompt: string
  requiredClasses: readonly string[]
  requiredResources: readonly ResourceRequirement[]
}

export interface PreflightReport {
  endpoint: string
  online: boolean
  availableClassCount: number
  missingClasses: readonly string[]
  missingResources: readonly ResourceRequirement[]
  uncheckedResources: readonly ResourceRequirement[]
  warnings: readonly string[]
}

export interface ComfygureData {
  compiled: CompiledProgram
  preflight?: PreflightReport
  submission?: ComfyuiSubmission
}

export interface ComfygureInput {
  action?: "compile" | "preflight" | "submit"
  program?: ComfygureProgramDraft
  target?: ComfygureTarget
}

export interface ComfygureFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface ComfygureRuntime {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<ComfygureFetchResponse>
}

export interface ComfyuiSubmission {
  endpoint: string
  promptId: string
  queueNumber?: number
  clientId: string
}

const REGION_SYNTAX = /\b(?:COUPLE|MASK|FEATHER|FILL|IMASK|AREA|MASK_SIZE|MASKW)\s*\(/i
const WEIGHTED_TAG = /^(.+?):\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/

export const DEFAULT_COMFYGURE_PROGRAM: ComfygureProgram = {
  format: COMFYGURE_FORMAT,
  recipe: ANIMA_INT8_RECIPE,
  name: "ANIMA INT8",
  model: {
    unetName: "silvermoonmixAnima_v20_INT8.safetensors",
    clipName: "qwen_3_06b_base.safetensors",
    vaeName: "qwen_image_vae.safetensors",
  },
  prompts: {
    positive: "",
    negative: "",
    positivePrefix: "",
  },
  loras: [],
  parameters: {
    width: 1024,
    height: 1024,
    batchSize: 1,
    seed: 0,
    steps: 26,
    cfg: 4.5,
    samplerName: "euler_ancestral",
    scheduler: "beta57",
    denoise: 1,
    foveaStrength: 3,
    sharpness: 0.5,
    maskInertia: 0.85,
  },
  teaCache: {
    threshold: 0.01,
    adaptiveMode: true,
    earlyStepsFactor: 0.4,
    lateStepsFactor: 1.8,
    startPercent: 0,
    endPercent: 1,
    cacheDevice: "cuda",
  },
  output: {
    filenamePrefix: "comfygure",
    format: "png",
    quality: 100,
    preview: true,
  },
}

export function normalizeComfygureProgram(input: ComfygureProgramDraft = {}): ComfygureProgram {
  const source = input
  const parameters = source.parameters ?? {}
  const teaCache = source.teaCache ?? {}
  const output = source.output ?? {}
  const model = source.model ?? {}
  const prompts = source.prompts ?? {}
  return {
    format: COMFYGURE_FORMAT,
    recipe: ANIMA_INT8_RECIPE,
    name: stringValue(source.name, DEFAULT_COMFYGURE_PROGRAM.name),
    model: {
      unetName: stringValue(model.unetName, DEFAULT_COMFYGURE_PROGRAM.model.unetName),
      clipName: stringValue(model.clipName, DEFAULT_COMFYGURE_PROGRAM.model.clipName),
      vaeName: stringValue(model.vaeName, DEFAULT_COMFYGURE_PROGRAM.model.vaeName),
    },
    prompts: {
      positive: stringValue(prompts.positive, ""),
      negative: stringValue(prompts.negative, ""),
      positivePrefix: stringValue(prompts.positivePrefix, ""),
    },
    loras: normalizeLoras(source.loras),
    parameters: {
      width: rounded(parameters.width, DEFAULT_COMFYGURE_PROGRAM.parameters.width, 64, 4096, 64),
      height: rounded(parameters.height, DEFAULT_COMFYGURE_PROGRAM.parameters.height, 64, 4096, 64),
      batchSize: rounded(parameters.batchSize, 1, 1, 64),
      seed: rounded(parameters.seed, 0, 0, Number.MAX_SAFE_INTEGER),
      steps: rounded(parameters.steps, DEFAULT_COMFYGURE_PROGRAM.parameters.steps, 1, 200),
      cfg: bounded(parameters.cfg, DEFAULT_COMFYGURE_PROGRAM.parameters.cfg, 0, 100),
      samplerName: stringValue(parameters.samplerName, DEFAULT_COMFYGURE_PROGRAM.parameters.samplerName),
      scheduler: stringValue(parameters.scheduler, DEFAULT_COMFYGURE_PROGRAM.parameters.scheduler),
      denoise: bounded(parameters.denoise, 1, 0, 1),
      foveaStrength: bounded(parameters.foveaStrength, DEFAULT_COMFYGURE_PROGRAM.parameters.foveaStrength, 0, 10),
      sharpness: bounded(parameters.sharpness, DEFAULT_COMFYGURE_PROGRAM.parameters.sharpness, 0, 10),
      maskInertia: bounded(parameters.maskInertia, DEFAULT_COMFYGURE_PROGRAM.parameters.maskInertia, 0, 1),
    },
    teaCache: {
      threshold: bounded(teaCache.threshold, DEFAULT_COMFYGURE_PROGRAM.teaCache.threshold, 0, 1),
      adaptiveMode: teaCache.adaptiveMode !== false,
      earlyStepsFactor: bounded(teaCache.earlyStepsFactor, DEFAULT_COMFYGURE_PROGRAM.teaCache.earlyStepsFactor, 0, 10),
      lateStepsFactor: bounded(teaCache.lateStepsFactor, DEFAULT_COMFYGURE_PROGRAM.teaCache.lateStepsFactor, 0, 10),
      startPercent: bounded(teaCache.startPercent, DEFAULT_COMFYGURE_PROGRAM.teaCache.startPercent, 0, 1),
      endPercent: bounded(teaCache.endPercent, DEFAULT_COMFYGURE_PROGRAM.teaCache.endPercent, 0, 1),
      cacheDevice: stringValue(teaCache.cacheDevice, DEFAULT_COMFYGURE_PROGRAM.teaCache.cacheDevice),
    },
    output: {
      filenamePrefix: safeOutputPrefix(stringValue(output.filenamePrefix, DEFAULT_COMFYGURE_PROGRAM.output.filenamePrefix)),
      format: output.format === "jpeg" || output.format === "webp" ? output.format : "png",
      quality: rounded(output.quality, DEFAULT_COMFYGURE_PROGRAM.output.quality, 1, 100),
      preview: output.preview !== false,
    },
  }
}

export function normalizePromptText(value: string): string {
  const text = value.trim()
  if (!text) return ""
  if (REGION_SYNTAX.test(text)) return text.replace(/\bCOUPLE\s+MASK\s*\(/gi, "COUPLE(").replace(/[\t ]{2,}/g, " ").trim()
  const tags = splitPromptTags(text)
  return tags.map(normalizePromptTag).filter(Boolean).join(", ")
}

export function resolveActiveLoras(program: ComfygureProgram, positiveText: string): readonly ComfygureLora[] {
  const comparable = positiveText.toLocaleLowerCase()
  return program.loras.filter((lora) => {
    if (lora.enabled === false) return false
    const terms = splitPromptTags(lora.activationTerms ?? "").map((term) => term.toLocaleLowerCase())
    return terms.every((term) => !term || comparable.includes(term))
  })
}

export function compileAnimaInt8Program(input: ComfygureProgramDraft = {}): CompiledProgram {
  const program = normalizeComfygureProgram(input)
  const composedPositive = normalizePromptText([program.prompts.positivePrefix, program.prompts.positive].filter(Boolean).join(", "))
  const activeLoras = resolveActiveLoras(program, composedPositive)
  const positivePrompt = ensurePromptTerms(composedPositive, activeLoras.flatMap((lora) => splitPromptTags(lora.injectionTerms ?? "")))
  const negativePrompt = normalizePromptText(program.prompts.negative)
  const graph: PromptGraph = {
    "1": {
      class_type: "OTUNetLoaderW8A8",
      inputs: {
        unet_name: program.model.unetName,
        weight_dtype: "default",
        model_type: "anima",
        on_the_fly_quantization: false,
        enable_convrot: true,
        lora_mode: "None",
      },
    },
    "2": {
      class_type: "AnimaTeaCache",
      inputs: {
        threshold: program.teaCache.threshold,
        adaptive_mode: program.teaCache.adaptiveMode,
        early_steps_factor: program.teaCache.earlyStepsFactor,
        late_steps_factor: program.teaCache.lateStepsFactor,
        start_percent: program.teaCache.startPercent,
        end_percent: program.teaCache.endPercent,
        cache_device: program.teaCache.cacheDevice,
        model: ["1", 0],
      },
    },
    "3": {
      class_type: "CLIPLoader",
      inputs: { clip_name: program.model.clipName, type: "stable_diffusion", device: "cpu" },
    },
    "4": { class_type: "VAELoader", inputs: { vae_name: program.model.vaeName } },
  }

  let nextNodeId = 5
  let lastLoraStack: PromptLink | undefined
  for (const group of chunk(activeLoras, 3)) {
    const inputs: Record<string, PromptInput> = {}
    for (let index = 0; index < 3; index += 1) {
      const lora = group[index]
      const slot = index + 1
      inputs[`switch_${slot}`] = lora ? "On" : "Off"
      inputs[`lora_name_${slot}`] = lora?.name ?? "None"
      inputs[`model_weight_${slot}`] = lora?.modelStrength ?? 1
      inputs[`clip_weight_${slot}`] = lora?.clipStrength ?? 1
    }
    if (lastLoraStack) inputs.lora_stack = lastLoraStack
    const nodeId = String(nextNodeId++)
    graph[nodeId] = { class_type: "CR LoRA Stack", inputs }
    lastLoraStack = [nodeId, 0]
  }

  let modelLink: PromptLink = ["2", 0]
  let clipLink: PromptLink = ["3", 0]
  if (lastLoraStack) {
    const applyId = String(nextNodeId++)
    graph[applyId] = {
      class_type: "CR Apply LoRA Stack",
      inputs: { model: modelLink, clip: clipLink, lora_stack: lastLoraStack },
    }
    modelLink = [applyId, 0]
    clipLink = [applyId, 1]
  }

  const positiveId = String(nextNodeId++)
  const negativeId = String(nextNodeId++)
  const latentId = String(nextNodeId++)
  const samplerId = String(nextNodeId++)
  const decodeId = String(nextNodeId++)
  const outputId = String(nextNodeId++)
  graph[positiveId] = { class_type: "CLIPTextEncode", inputs: { text: positivePrompt, clip: clipLink } }
  graph[negativeId] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: clipLink } }
  graph[latentId] = {
    class_type: "AnimaLatentImage",
    inputs: { preset: "Custom", width: program.parameters.width, height: program.parameters.height, batch_size: program.parameters.batchSize },
  }
  graph[samplerId] = {
    class_type: "FLS_SamplerV4",
    inputs: {
      seed: program.parameters.seed,
      steps: program.parameters.steps,
      cfg: program.parameters.cfg,
      sampler_name: program.parameters.samplerName,
      scheduler: program.parameters.scheduler,
      denoise: program.parameters.denoise,
      fovea_strength: program.parameters.foveaStrength,
      sharpness: program.parameters.sharpness,
      mask_inertia: program.parameters.maskInertia,
      model: modelLink,
      positive: [positiveId, 0],
      negative: [negativeId, 0],
      latent_image: [latentId, 0],
    },
  }
  graph[decodeId] = { class_type: "VAEDecode", inputs: { samples: [samplerId, 0], vae: ["4", 0] } }
  graph[outputId] = {
    class_type: "LayerUtility: SaveImagePlus",
    inputs: {
      custom_path: "",
      filename_prefix: program.output.filenamePrefix,
      timestamp: "None",
      format: program.output.format,
      quality: program.output.quality,
      meta_data: false,
      blind_watermark: "",
      save_workflow_as_json: true,
      preview: program.output.preview,
      images: [decodeId, 0],
    },
  }

  const requiredResources: ResourceRequirement[] = [
    { classType: "OTUNetLoaderW8A8", inputName: "unet_name", resourceName: program.model.unetName, kind: "unet" },
    { classType: "CLIPLoader", inputName: "clip_name", resourceName: program.model.clipName, kind: "clip" },
    { classType: "VAELoader", inputName: "vae_name", resourceName: program.model.vaeName, kind: "vae" },
    ...activeLoras.map((lora) => ({ classType: "CR LoRA Stack", inputName: "lora_name_1", resourceName: lora.name, kind: "lora" }) satisfies ResourceRequirement),
  ]
  return {
    program,
    graph,
    activeLoras,
    positivePrompt,
    negativePrompt,
    requiredClasses: [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
    requiredResources,
  }
}

export async function preflightComfyuiTarget(compiled: CompiledProgram, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<PreflightReport> {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  let objectInfo: Record<string, unknown>
  try {
    const response = await fetchComfyui(runtime, `${endpoint}/object_info`, { method: "GET", headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (!isRecord(payload)) throw new Error("/object_info did not return a node map.")
    objectInfo = payload
  } catch (error) {
    return {
      endpoint,
      online: false,
      availableClassCount: 0,
      missingClasses: compiled.requiredClasses,
      missingResources: [],
      uncheckedResources: compiled.requiredResources,
      warnings: [error instanceof Error ? error.message : String(error)],
    }
  }

  const missingClasses = compiled.requiredClasses.filter((classType) => !isRecord(objectInfo[classType]))
  const missingResources: ResourceRequirement[] = []
  const uncheckedResources: ResourceRequirement[] = []
  for (const requirement of compiled.requiredResources) {
    const nodeInfo = objectInfo[requirement.classType]
    const choices = isRecord(nodeInfo) ? resourceChoices(nodeInfo, requirement.inputName) : undefined
    if (!choices) uncheckedResources.push(requirement)
    else if (!choices.includes(requirement.resourceName)) missingResources.push(requirement)
  }
  return {
    endpoint,
    online: true,
    availableClassCount: Object.keys(objectInfo).length,
    missingClasses,
    missingResources,
    uncheckedResources,
    warnings: uncheckedResources.length ? ["Some resource widgets are not enumerable in /object_info and need /prompt validation before a run."] : [],
  }
}

export async function runComfygure(input: ComfygureInput, runtime: ComfygureRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<NodeRunResult<ComfygureData>> {
  const compiled = compileAnimaInt8Program(input.program)
  if (input.action !== "preflight" && input.action !== "submit") {
    return { success: true, message: `Compiled ${Object.keys(compiled.graph).length} fixed ComfyUI node(s).`, data: { compiled } }
  }
  onEvent({ type: "progress", progress: 20, message: "Inspecting the local ComfyUI target." })
  const preflight = await preflightComfyuiTarget(compiled, input.target ?? {}, runtime)
  const compatible = preflight.online && preflight.missingClasses.length === 0 && preflight.missingResources.length === 0
  if (!compatible) {
    onEvent({ type: "progress", progress: 100, message: preflight.online ? "Compatibility preflight found incompatible requirements." : "Local ComfyUI target is unavailable." })
    const message = preflight.online
      ? `Compatibility preflight found ${preflight.missingClasses.length} missing class(es) and ${preflight.missingResources.length} missing resource(s).`
      : `ComfyUI target is unavailable at ${preflight.endpoint}.`
    return { success: false, message, data: { compiled, preflight } }
  }
  if (input.action === "preflight") {
    onEvent({ type: "progress", progress: 100, message: "Compatibility preflight complete." })
    return { success: true, message: "Compatibility preflight passed. No generation was submitted.", data: { compiled, preflight } }
  }

  onEvent({ type: "progress", progress: 65, message: "Submitting the fixed prompt graph to ComfyUI." })
  try {
    const submission = await submitComfyuiPrompt(compiled, input.target ?? {}, runtime)
    onEvent({ type: "progress", progress: 100, message: `ComfyUI accepted prompt ${submission.promptId}.` })
    return { success: true, message: `ComfyUI accepted prompt ${submission.promptId}.`, data: { compiled, preflight, submission } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent({ type: "progress", progress: 100, message: "ComfyUI rejected the prompt graph." })
    return { success: false, message, data: { compiled, preflight } }
  }
}

export async function submitComfyuiPrompt(compiled: CompiledProgram, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<ComfyuiSubmission> {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  const clientId = stringValue(target.clientId, "xiranite-comfygure")
  const response = await fetchComfyui(runtime, `${endpoint}/prompt`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ prompt: compiled.graph, client_id: clientId }),
  })
  const payload = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(`ComfyUI prompt submission failed: HTTP ${response.status}${describeComfyuiPromptError(payload)}`)
  if (!isRecord(payload)) throw new Error("ComfyUI prompt submission did not return an acknowledgement object.")
  const promptId = typeof payload.prompt_id === "string" ? payload.prompt_id : ""
  if (!promptId) throw new Error(`ComfyUI rejected the prompt graph${describeComfyuiPromptError(payload)}.`)
  const queueNumber = typeof payload.number === "number" && Number.isFinite(payload.number) ? payload.number : undefined
  return { endpoint, promptId, queueNumber, clientId }
}

export function normalizeComfyuiEndpoint(value: string | undefined): string {
  const candidate = stringValue(value, DEFAULT_COMFYUI_ENDPOINT).replace(/\/+$/, "")
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error(`Invalid ComfyUI endpoint: ${candidate}`) }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI endpoint must use HTTP or HTTPS.")
  if (!isLocalHost(url.hostname)) throw new Error("Comfygure only supports a manually started local ComfyUI endpoint.")
  return url.toString().replace(/\/$/, "")
}

function normalizeLoras(value: readonly ComfygureLora[] | undefined): readonly ComfygureLora[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const name = stringValue(item?.name, "")
    if (!name || name === "None") return []
    return [{
      name,
      modelStrength: bounded(item.modelStrength, 1, -10, 10),
      clipStrength: bounded(item.clipStrength, 1, -10, 10),
      activationTerms: normalizePromptText(stringValue(item.activationTerms, "")),
      injectionTerms: normalizePromptText(stringValue(item.injectionTerms, "")),
      enabled: item.enabled !== false,
    }]
  })
}

function ensurePromptTerms(value: string, terms: readonly string[]): string {
  if (REGION_SYNTAX.test(value)) return value
  const tags = splitPromptTags(value).map(normalizePromptTag).filter(Boolean)
  const known = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
  for (const term of terms.map(normalizePromptTag).filter(Boolean)) {
    if (!known.has(term.toLocaleLowerCase())) {
      tags.push(term)
      known.add(term.toLocaleLowerCase())
    }
  }
  return tags.join(", ")
}

function splitPromptTags(value: string): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "(" || char === "[") depth += 1
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1
    else if ((char === "," || char === "\n" || char === "，") && depth === 0) {
      result.push(value.slice(start, index))
      start = index + 1
    }
  }
  result.push(value.slice(start))
  return result
}

function normalizePromptTag(value: string): string {
  const compact = value.replace(/[\t\r\n]+/g, " ").replace(/[ ]{2,}/g, " ").trim()
  if (!compact) return ""
  const underscored = compact.replace(/_/g, " ")
  if (underscored.startsWith("(") || underscored.startsWith("[") || REGION_SYNTAX.test(underscored)) return underscored
  const match = underscored.match(WEIGHTED_TAG)
  return match ? `(${match[1]!.trim()}:${match[2]})` : underscored
}

function resourceChoices(nodeInfo: Record<string, unknown>, inputName: string): readonly string[] | undefined {
  const input = isRecord(nodeInfo.input) ? nodeInfo.input : undefined
  const required = input && isRecord(input.required) ? input.required : undefined
  const widget = required?.[inputName]
  if (!Array.isArray(widget) || !Array.isArray(widget[0])) return undefined
  return widget[0].filter((value): value is string => typeof value === "string")
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function rounded(value: unknown, fallback: number, min: number, max: number, step = 1): number {
  const result = bounded(value, fallback, min, max)
  return Math.round(result / step) * step
}

function safeOutputPrefix(value: string): string {
  return value.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "") || "comfygure"
}

function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname.toLocaleLowerCase() === "localhost"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function describeComfyuiPromptError(value: unknown): string {
  if (!isRecord(value)) return ""
  const error = typeof value.error === "string" ? value.error : undefined
  const nodeErrors = isRecord(value.node_errors) ? Object.keys(value.node_errors) : []
  if (error) return `: ${error}`
  return nodeErrors.length ? `: node validation failed for ${nodeErrors.join(", ")}` : ""
}

async function fetchComfyui(
  runtime: ComfygureRuntime,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<ComfygureFetchResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS)
  try {
    return await runtime.fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new Error(`ComfyUI request timed out after ${DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS / 1000} seconds.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
