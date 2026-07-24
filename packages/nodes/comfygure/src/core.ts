import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate"
import { jsonrepair } from "jsonrepair"

export const COMFYGURE_FORMAT = "comfygure/v1" as const
export const COMFYGURE_RUN_PLAN_FORMAT = "comfygure-run-plan/v1" as const
export const COMFYGURE_TEMPLATE_FORMAT = "comfygure-template/v1" as const
export const COMFYGURE_BINDING_MANIFEST_FORMAT = "comfygure-binding-manifest/v1" as const
export const ANIMA_INT8_RECIPE = "anima-int8/v1" as const
export const DEFAULT_COMFYUI_ENDPOINT = "http://127.0.0.1:8000"
export const DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS = 10_000

export type PromptPrimitive = string | number | boolean | null
export type PromptLink = readonly [nodeId: string, outputIndex: number]
export type PromptInput = PromptPrimitive | PromptLink | readonly PromptInput[] | { readonly [key: string]: PromptInput }

export interface PromptNode {
  class_type: string
  inputs: Record<string, PromptInput>
  _meta?: Record<string, PromptInput>
}

export type PromptGraph = Record<string, PromptNode>

export type ComfyuiWorkflowSourceFormat = "api" | "ui"
export type ComfygureBindingKey =
  | "positivePrompt"
  | "negativePrompt"
  | "unetName"
  | "clipName"
  | "vaeName"
  | "width"
  | "height"
  | "batchSize"
  | "seed"
  | "steps"
  | "cfg"
  | "samplerName"
  | "scheduler"
  | "denoise"
  | "filenamePrefix"
  | "outputFormat"
  | "outputQuality"
  | "outputPreview"

export interface ComfygureBindingTarget {
  nodeId: string
  inputName: string
}

export interface ComfygureBinding {
  key: ComfygureBindingKey
  targets: readonly ComfygureBindingTarget[]
  confidence: "explicit" | "inferred"
}

export interface ComfygureBindingManifest {
  format: typeof COMFYGURE_BINDING_MANIFEST_FORMAT
  confirmed: boolean
  bindings: readonly ComfygureBinding[]
}

export interface ComfygureWorkflowDiagnostic {
  severity: "error" | "warning"
  code: string
  message: string
  nodeId?: string
  inputName?: string
}

export interface ComfygureTemplate {
  format: typeof COMFYGURE_TEMPLATE_FORMAT
  name: string
  sourceFormat: ComfyuiWorkflowSourceFormat
  originalSource: ComfygureCompressedText
  repairedSource: boolean
  graph: PromptGraph
  defaultLoras: readonly ComfygureLora[]
  bindingManifest: ComfygureBindingManifest
}

export interface ComfygureWorkflowImport {
  sourceFormat?: ComfyuiWorkflowSourceFormat
  repairedSource: boolean
  template?: ComfygureTemplate
  diagnostics: readonly ComfygureWorkflowDiagnostic[]
}

export interface ComfygureWorkflowImportOptions {
  objectInfo?: Record<string, unknown>
  name?: string
}

export interface ComfygureLora {
  name: string
  modelStrength?: number
  clipStrength?: number
  activationTerms?: string
  injectionTerms?: string
  enabled?: boolean
}

export interface ComfygureBatch {
  prompts: readonly string[]
  maxPrompts: number
  queueCount: number
  shuffle: boolean
  allowDuplicates: boolean
  selectionSeed: number
}

export interface ComfygureCompressedText {
  format: "deflate-base64/v1"
  data: string
  lineCount: number
  uncompressedLength: number
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
  batch: ComfygureBatch
  loras: readonly ComfygureLora[]
  parameters: {
    width: number
    height: number
    batchSize: number
    seed: number
    seedMode: "fixed" | "increment"
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
  batch?: Partial<ComfygureBatch>
  loras?: readonly ComfygureLora[]
  parameters?: Partial<ComfygureProgram["parameters"]>
  teaCache?: Partial<ComfygureProgram["teaCache"]>
  output?: Partial<ComfygureProgram["output"]>
}

export interface ComfygureTarget {
  endpoint?: string
  clientId?: string
  libraryPath?: string
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

export interface CompiledGenerationJob {
  index: number
  sourceIndex: number
  loopIndex: number
  sourceText: string
  seed: number
  compiled: CompiledProgram
}

export interface CompiledRunPlan {
  format: typeof COMFYGURE_RUN_PLAN_FORMAT
  recipe: typeof ANIMA_INT8_RECIPE
  program: ComfygureProgram
  jobs: readonly CompiledGenerationJob[]
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
  runPlan: CompiledRunPlan
  workflowImport?: ComfygureWorkflowImport
  preflight?: PreflightReport
  submission?: ComfyuiSubmission
  submissions?: readonly ComfyuiSubmission[]
  history?: readonly ComfyuiPromptHistory[]
}

export interface ComfygureInput {
  action?: "compile" | "import" | "preflight" | "submit" | "refresh"
  program?: ComfygureProgramDraft
  template?: ComfygureTemplate
  workflowSource?: string
  target?: ComfygureTarget
  promptIds?: readonly string[]
}

export interface ComfygureFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface ComfygureRuntime {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<ComfygureFetchResponse>
  readLoraTrigger?(libraryPath: string, loraName: string): Promise<string | undefined>
}

export interface ComfyuiSubmission {
  endpoint: string
  promptId: string
  queueNumber?: number
  clientId: string
}

export interface ComfyuiOutputImage {
  filename: string
  subfolder: string
  type: string
  url: string
}

export interface ComfyuiPromptHistory {
  endpoint: string
  promptId: string
  state: "pending" | "running" | "complete" | "error"
  images: readonly ComfyuiOutputImage[]
  error?: string
}

const REGION_SYNTAX = /\b(?:COUPLE|MASK|FEATHER|FILL|IMASK|AREA|MASK_SIZE|MASKW)\s*\(/i
const WEIGHTED_TAG = /^(.+?):\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/
const INLINE_LORA_TAG = /<lora:[^>]+>/gi

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
  batch: {
    prompts: [],
    maxPrompts: 0,
    queueCount: 0,
    shuffle: false,
    allowDuplicates: true,
    selectionSeed: 0,
  },
  loras: [],
  parameters: {
    width: 1024,
    height: 1024,
    batchSize: 1,
    seed: 0,
    seedMode: "increment",
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

export function normalizeComfygureProgram(input: ComfygureProgramDraft = {}): ComfygureProgram {
  const source = input
  const parameters = source.parameters ?? {}
  const teaCache = source.teaCache ?? {}
  const output = source.output ?? {}
  const model = source.model ?? {}
  const prompts = source.prompts ?? {}
  const batch = source.batch ?? {}
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
    batch: {
      prompts: normalizeBatchPrompts(batch.prompts),
      maxPrompts: rounded(batch.maxPrompts, DEFAULT_COMFYGURE_PROGRAM.batch.maxPrompts, 0, 100_000),
      queueCount: rounded(batch.queueCount, DEFAULT_COMFYGURE_PROGRAM.batch.queueCount, 0, 100_000),
      shuffle: batch.shuffle === true,
      allowDuplicates: batch.allowDuplicates !== false,
      selectionSeed: rounded(batch.selectionSeed, DEFAULT_COMFYGURE_PROGRAM.batch.selectionSeed, 0, Number.MAX_SAFE_INTEGER),
    },
    loras: normalizeLoras(source.loras),
    parameters: {
      width: rounded(parameters.width, DEFAULT_COMFYGURE_PROGRAM.parameters.width, 64, 4096, 64),
      height: rounded(parameters.height, DEFAULT_COMFYGURE_PROGRAM.parameters.height, 64, 4096, 64),
      batchSize: rounded(parameters.batchSize, 1, 1, 64),
      seed: rounded(parameters.seed, 0, 0, Number.MAX_SAFE_INTEGER),
      seedMode: parameters.seedMode === "fixed" ? "fixed" : "increment",
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
  const text = value.replace(INLINE_LORA_TAG, "").trim()
  if (!text) return ""
  if (REGION_SYNTAX.test(text)) return normalizeRegionPrompt(text)
  const tags = splitPromptTags(text)
  return tags.map((tag) => normalizePromptTag(removeUnmatchedBrackets(tag))).filter(Boolean).join(", ")
}

export function compressComfygureText(value: string): ComfygureCompressedText | undefined {
  const normalized = value.replace(/\r\n?/g, "\n")
  if (!normalized) return undefined
  return {
    format: "deflate-base64/v1",
    data: bytesToBase64(deflateSync(strToU8(normalized), { level: 6 })),
    lineCount: normalized.split("\n").length,
    uncompressedLength: normalized.length,
  }
}

export function decompressComfygureText(value: ComfygureCompressedText | undefined): string {
  if (!value || value.format !== "deflate-base64/v1" || !value.data) return ""
  try {
    return strFromU8(inflateSync(base64ToBytes(value.data)))
  } catch {
    return ""
  }
}

export function resolveActiveLoras(program: ComfygureProgram, positiveText: string): readonly ComfygureLora[] {
  const comparable = positiveText.toLocaleLowerCase()
  return program.loras.filter((lora) => {
    if (lora.enabled === false) return false
    const terms = splitActivationTerms(lora.activationTerms ?? "").map((term) => term.toLocaleLowerCase())
    return terms.length === 0 || terms.some((term) => comparable.includes(term))
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

export function compileComfygureTemplate(template: ComfygureTemplate, input: ComfygureProgramDraft = {}): CompiledProgram {
  if (template.format !== COMFYGURE_TEMPLATE_FORMAT) throw new Error("Unsupported Comfygure template format.")
  if (!template.bindingManifest.confirmed) throw new Error("Confirm the imported template bindings before compiling it.")
  const normalizedProgram = normalizeComfygureProgram(input)
  const program = normalizedProgram.loras.length ? normalizedProgram : { ...normalizedProgram, loras: template.defaultLoras }
  const composedPositive = normalizePromptText([program.prompts.positivePrefix, program.prompts.positive].filter(Boolean).join(", "))
  const activeLoras = resolveActiveLoras(program, composedPositive)
  const positivePrompt = ensurePromptTerms(composedPositive, activeLoras.flatMap((lora) => splitPromptTags(lora.injectionTerms ?? "")))
  const negativePrompt = normalizePromptText(program.prompts.negative)
  const graph = clonePromptGraph(template.graph)
  materializeGlowTriggerLoraStacks(graph, activeLoras)
  for (const binding of template.bindingManifest.bindings) {
    const value = templateBindingValue(binding.key, program, positivePrompt, negativePrompt)
    for (const target of binding.targets) {
      const node = graph[target.nodeId]
      if (!node) throw new Error(`Template binding ${binding.key} references missing node ${target.nodeId}.`)
      node.inputs[target.inputName] = value
    }
  }
  materializeStaticCompileTimeNodes(graph)
  applyTemplateLoras(graph, activeLoras)
  prunePromptGraphToOutputNodes(graph)
  const dynamicNodes = orderedPromptNodes(graph).filter(([, node]) => COMPILE_TIME_NODE_TYPES.has(node.class_type))
  if (dynamicNodes.length) throw new Error(`The template still contains dynamic editor node(s) required by its output: ${dynamicNodes.map(([, node]) => node.class_type).join(", ")}.`)
  return {
    program,
    graph,
    activeLoras,
    positivePrompt,
    negativePrompt,
    requiredClasses: [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
    requiredResources: inferGraphResourceRequirements(graph),
  }
}

export function compileAnimaInt8RunPlan(input: ComfygureProgramDraft = {}): CompiledRunPlan {
  const program = normalizeComfygureProgram(input)
  const batchPrompts = program.batch.prompts.slice(0, program.batch.maxPrompts || undefined)
  if (batchPrompts.length === 0) {
    const compiled = compileAnimaInt8Program(program)
    return {
      format: COMFYGURE_RUN_PLAN_FORMAT,
      recipe: ANIMA_INT8_RECIPE,
      program,
      jobs: [{ index: 0, sourceIndex: 0, loopIndex: 0, sourceText: program.prompts.positive, seed: program.parameters.seed, compiled }],
    }
  }

  const sequence = resolveBatchSequence(batchPrompts.length, program.batch)
  const jobs = sequence.map((sourceIndex, index) => {
    const seed = resolveJobSeed(program.parameters.seed, program.parameters.seedMode, index)
    const jobProgram: ComfygureProgramDraft = {
      ...program,
      prompts: { ...program.prompts, positive: batchPrompts[sourceIndex] ?? "" },
      parameters: { ...program.parameters, seed },
    }
    return {
      index,
      sourceIndex,
      loopIndex: Math.floor(index / batchPrompts.length),
      sourceText: batchPrompts[sourceIndex] ?? "",
      seed,
      compiled: compileAnimaInt8Program(jobProgram),
    }
  })
  return { format: COMFYGURE_RUN_PLAN_FORMAT, recipe: ANIMA_INT8_RECIPE, program, jobs }
}

export function compileComfygureTemplateRunPlan(template: ComfygureTemplate, input: ComfygureProgramDraft = {}): CompiledRunPlan {
  const program = normalizeComfygureProgram(input)
  const batchPrompts = program.batch.prompts.slice(0, program.batch.maxPrompts || undefined)
  if (batchPrompts.length === 0) {
    const compiled = compileComfygureTemplate(template, program)
    return {
      format: COMFYGURE_RUN_PLAN_FORMAT,
      recipe: ANIMA_INT8_RECIPE,
      program,
      jobs: [{ index: 0, sourceIndex: 0, loopIndex: 0, sourceText: program.prompts.positive, seed: program.parameters.seed, compiled }],
    }
  }
  const sequence = resolveBatchSequence(batchPrompts.length, program.batch)
  const jobs = sequence.map((sourceIndex, index) => {
    const seed = resolveJobSeed(program.parameters.seed, program.parameters.seedMode, index)
    const jobProgram: ComfygureProgramDraft = {
      ...program,
      prompts: { ...program.prompts, positive: batchPrompts[sourceIndex] ?? "" },
      parameters: { ...program.parameters, seed },
    }
    return {
      index,
      sourceIndex,
      loopIndex: Math.floor(index / batchPrompts.length),
      sourceText: batchPrompts[sourceIndex] ?? "",
      seed,
      compiled: compileComfygureTemplate(template, jobProgram),
    }
  })
  return { format: COMFYGURE_RUN_PLAN_FORMAT, recipe: ANIMA_INT8_RECIPE, program, jobs }
}

export function resolveBatchSequence(entryCount: number, batch: ComfygureBatch): readonly number[] {
  if (entryCount <= 0) return []
  const count = batch.queueCount > 0 ? batch.queueCount : entryCount
  const indices = Array.from({ length: entryCount }, (_, index) => index)
  if (!batch.shuffle) {
    if (!batch.allowDuplicates) return indices.slice(0, Math.min(count, indices.length))
    return Array.from({ length: count }, (_, index) => indices[index % indices.length]!)
  }

  const random = createSeededRandom(batch.selectionSeed)
  if (batch.allowDuplicates) return Array.from({ length: count }, () => indices[Math.floor(random() * indices.length)]!)

  const sequence: number[] = []
  while (sequence.length < count) {
    const round = shuffleIndices(indices, random)
    sequence.push(...round.slice(0, count - sequence.length))
  }
  return sequence
}

export async function preflightComfyuiTarget(compiled: Pick<CompiledProgram, "requiredClasses" | "requiredResources">, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<PreflightReport> {
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
  const program = await hydrateLoraTriggers(input.program, input.target, runtime)
  let runPlan: CompiledRunPlan
  try {
    runPlan = input.template ? compileComfygureTemplateRunPlan(input.template, program) : compileAnimaInt8RunPlan(program)
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
  const compiled = runPlan.jobs[0]!.compiled
  if (input.action === "import") {
    const workflowSource = stringValue(input.workflowSource, "")
    if (!workflowSource) return { success: false, message: "No ComfyUI workflow file was supplied.", data: { compiled, runPlan } }
    let workflowImport = importComfyuiWorkflow(workflowSource)
    if (workflowImport.sourceFormat === "ui") {
      try {
        const objectInfo = await readComfyuiObjectInfo(input.target ?? {}, runtime)
        workflowImport = importComfyuiWorkflow(workflowSource, { objectInfo })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        workflowImport = {
          ...workflowImport,
          diagnostics: [...workflowImport.diagnostics, workflowError("object-info-unavailable", `Could not read local /object_info: ${message}`)],
        }
      }
    }
    const errors = workflowImport.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    return {
      success: errors.length === 0,
      message: errors.length ? `Imported workflow needs ${errors.length} correction(s) before it can run.` : "Imported a ComfyUI template. Confirm the inferred bindings before compiling it.",
      data: { compiled, runPlan, workflowImport },
    }
  }
  if (input.action === "refresh") {
    const promptIds = normalizePromptIds(input.promptIds)
    if (promptIds.length === 0) return { success: false, message: "No ComfyUI prompt IDs are available to refresh.", data: { compiled, runPlan } }
    const histories: ComfyuiPromptHistory[] = []
    try {
      for (const [index, promptId] of promptIds.entries()) {
        onEvent({ type: "progress", progress: Math.round((index / promptIds.length) * 100), message: `Refreshing ComfyUI prompt ${index + 1} of ${promptIds.length}.` })
        histories.push(await readComfyuiPromptHistory(promptId, input.target ?? {}, runtime))
      }
      const completed = histories.filter((history) => history.state === "complete").length
      const failed = histories.filter((history) => history.state === "error").length
      const imageCount = histories.reduce((count, history) => count + history.images.length, 0)
      onEvent({ type: "progress", progress: 100, message: "ComfyUI result refresh complete." })
      return {
        success: failed === 0,
        message: failed > 0
          ? `${failed} ComfyUI prompt(s) reported an error.`
          : `${completed} of ${histories.length} ComfyUI prompt(s) complete with ${imageCount} image(s).`,
        data: { compiled, runPlan, history: histories },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onEvent({ type: "progress", progress: 100, message: "ComfyUI result refresh failed." })
      return { success: false, message, data: { compiled, runPlan, history: histories } }
    }
  }
  if (input.action !== "preflight" && input.action !== "submit") {
    const message = runPlan.jobs.length === 1
      ? `Compiled ${Object.keys(compiled.graph).length} fixed ComfyUI node(s).`
      : `Compiled ${runPlan.jobs.length} fixed ComfyUI prompt graph(s).`
    return { success: true, message, data: { compiled, runPlan } }
  }
  onEvent({ type: "progress", progress: 20, message: "Inspecting the local ComfyUI target." })
  const preflight = await preflightComfyuiTarget(compiledRequirementsFor(runPlan), input.target ?? {}, runtime)
  const compatible = preflight.online && preflight.missingClasses.length === 0 && preflight.missingResources.length === 0
  if (!compatible) {
    onEvent({ type: "progress", progress: 100, message: preflight.online ? "Compatibility preflight found incompatible requirements." : "Local ComfyUI target is unavailable." })
    const message = preflight.online
      ? `Compatibility preflight found ${preflight.missingClasses.length} missing class(es) and ${preflight.missingResources.length} missing resource(s).`
      : `ComfyUI target is unavailable at ${preflight.endpoint}.`
    return { success: false, message, data: { compiled, runPlan, preflight } }
  }
  if (input.action === "preflight") {
    onEvent({ type: "progress", progress: 100, message: "Compatibility preflight complete." })
    return { success: true, message: "Compatibility preflight passed. No generation was submitted.", data: { compiled, runPlan, preflight } }
  }

  onEvent({ type: "progress", progress: 65, message: "Submitting the fixed prompt graph to ComfyUI." })
  const submissions: ComfyuiSubmission[] = []
  try {
    for (const [index, job] of runPlan.jobs.entries()) {
      const submission = await submitComfyuiPrompt(job.compiled, input.target ?? {}, runtime)
      submissions.push(submission)
      const progress = 65 + Math.round(((index + 1) / runPlan.jobs.length) * 35)
      onEvent({ type: "progress", progress, message: `ComfyUI accepted prompt ${submission.promptId}.` })
    }
    const message = submissions.length === 1
      ? `ComfyUI accepted prompt ${submissions[0]!.promptId}.`
      : `ComfyUI accepted ${submissions.length} fixed prompt graph(s).`
    return { success: true, message, data: { compiled, runPlan, preflight, submission: submissions[0], submissions } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent({ type: "progress", progress: 100, message: "ComfyUI rejected the prompt graph." })
    return { success: false, message, data: { compiled, runPlan, preflight, submission: submissions[0], submissions } }
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

export async function readComfyuiPromptHistory(promptId: string, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<ComfyuiPromptHistory> {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  const response = await fetchComfyui(runtime, `${endpoint}/history/${encodeURIComponent(promptId)}`, { method: "GET", headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`ComfyUI history lookup failed: HTTP ${response.status}`)
  const payload = await response.json()
  const entry = isRecord(payload) && isRecord(payload[promptId]) ? payload[promptId] : undefined
  if (!entry) return { endpoint, promptId, state: "pending", images: [] }
  const status = isRecord(entry.status) ? entry.status : undefined
  const statusValue = stringValue(status?.status_str, stringValue(status?.status, "")).toLocaleLowerCase()
  const error = historyError(status)
  const state = error || statusValue === "error" || statusValue === "failed"
    ? "error"
    : statusValue === "success" || statusValue === "completed" || status?.completed === true
      ? "complete"
      : statusValue === "running" || statusValue === "executing"
        ? "running"
        : "pending"
  return {
    endpoint,
    promptId,
    state,
    images: extractHistoryImages(entry, endpoint),
    error: error || undefined,
  }
}

export function createComfyuiImageUrl(endpoint: string, image: Pick<ComfyuiOutputImage, "filename" | "subfolder" | "type">): string {
  const url = new URL("view", `${normalizeComfyuiEndpoint(endpoint)}/`)
  url.searchParams.set("filename", image.filename)
  if (image.subfolder) url.searchParams.set("subfolder", image.subfolder)
  if (image.type) url.searchParams.set("type", image.type)
  return url.toString()
}

export function normalizeComfyuiEndpoint(value: string | undefined): string {
  const candidate = stringValue(value, DEFAULT_COMFYUI_ENDPOINT).replace(/\/+$/, "")
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error(`Invalid ComfyUI endpoint: ${candidate}`) }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI endpoint must use HTTP or HTTPS.")
  if (!isLocalHost(url.hostname)) throw new Error("Comfygure only supports a manually started local ComfyUI endpoint.")
  return url.toString().replace(/\/$/, "")
}

const COMPILE_TIME_NODE_TYPES = new Set([
  "BatchLoadTexts",
  "GlowDynamicTypedOutputs",
  "GlowTriggerLoRAStack",
  "GlowQueueControl",
  "PromptCleaningMaid",
  "AnimaPromptFormatter",
])

interface UiWorkflowNode {
  id: string | number
  type: string
  mode?: number
  title?: string
  inputs?: readonly unknown[]
  widgets_values?: readonly unknown[]
}

interface UiWorkflowLink {
  id: string
  originId: string
  originSlot: number
  targetId: string
  targetSlot: number
}

function normalizeComfyuiApiGraph(value: unknown, diagnostics: ComfygureWorkflowDiagnostic[]): PromptGraph | undefined {
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

function normalizeComfyuiUiWorkflow(value: unknown, objectInfo: Record<string, unknown> | undefined, diagnostics: ComfygureWorkflowDiagnostic[]): PromptGraph | undefined {
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

function normalizePromptInputs(value: Record<string, unknown>, diagnostics: ComfygureWorkflowDiagnostic[], nodeId: string): Record<string, PromptInput> {
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

function normalizePromptInput(value: unknown, depth = 0): PromptInput | undefined {
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

function normalizeUiWorkflowLinks(value: unknown, diagnostics: ComfygureWorkflowDiagnostic[]): Map<string, UiWorkflowLink> {
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

function resolveUiLinkOrigin(link: UiWorkflowLink, links: Map<string, UiWorkflowLink>, nodes: Map<string, UiWorkflowNode>, visited: Set<string>): PromptLink | undefined {
  if (!visited.add(link.id)) return undefined
  const origin = nodes.get(link.originId)
  if (!origin) return undefined
  if (origin.type !== "Reroute") return [link.originId, link.originSlot]
  const rerouteInput = Array.isArray(origin.inputs) ? origin.inputs.find((value) => isRecord(value) && value.link !== null && value.link !== undefined) : undefined
  if (!isRecord(rerouteInput)) return undefined
  const rerouteLink = links.get(String(rerouteInput.link))
  return rerouteLink ? resolveUiLinkOrigin(rerouteLink, links, nodes, visited) : undefined
}

function widgetValuesByInputName(node: UiWorkflowNode, definition: Record<string, unknown>, diagnostics: ComfygureWorkflowDiagnostic[], nodeId: string): Map<string, PromptInput> {
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

function objectInfoInputNames(definition: Record<string, unknown>): readonly string[] {
  const input = isRecord(definition.input) ? definition.input : undefined
  const required = input && isRecord(input.required) ? input.required : undefined
  const optional = input && isRecord(input.optional) ? input.optional : undefined
  return [...Object.keys(required ?? {}), ...Object.keys(optional ?? {})]
}

function workflowError(code: string, message: string, nodeId?: string, inputName?: string): ComfygureWorkflowDiagnostic {
  return { severity: "error", code, message, ...(nodeId ? { nodeId } : {}), ...(inputName ? { inputName } : {}) }
}

function bindingKeyForInput(classType: string, inputName: string): ComfygureBindingKey | undefined {
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

function orderedPromptNodes(graph: PromptGraph): Array<[string, PromptNode]> {
  return Object.entries(graph).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
}

function clonePromptGraph(graph: PromptGraph): PromptGraph {
  return JSON.parse(JSON.stringify(graph)) as PromptGraph
}

function templateBindingValue(key: ComfygureBindingKey, program: ComfygureProgram, positivePrompt: string, negativePrompt: string): PromptInput {
  switch (key) {
    case "positivePrompt": return positivePrompt
    case "negativePrompt": return negativePrompt
    case "unetName": return program.model.unetName
    case "clipName": return program.model.clipName
    case "vaeName": return program.model.vaeName
    case "width": return program.parameters.width
    case "height": return program.parameters.height
    case "batchSize": return program.parameters.batchSize
    case "seed": return program.parameters.seed
    case "steps": return program.parameters.steps
    case "cfg": return program.parameters.cfg
    case "samplerName": return program.parameters.samplerName
    case "scheduler": return program.parameters.scheduler
    case "denoise": return program.parameters.denoise
    case "filenamePrefix": return program.output.filenamePrefix
    case "outputFormat": return program.output.format
    case "outputQuality": return program.output.quality
    case "outputPreview": return program.output.preview
  }
}

function applyTemplateLoras(graph: PromptGraph, activeLoras: readonly ComfygureLora[]): void {
  if (activeLoras.length === 0) return
  const slots: Array<{ node: PromptNode; slot: number }> = []
  for (const [, node] of orderedPromptNodes(graph)) {
    if (node.class_type !== "CR LoRA Stack") continue
    for (const inputName of Object.keys(node.inputs)) {
      const match = /^lora_name_(\d+)$/.exec(inputName)
      if (match) slots.push({ node, slot: Number(match[1]) })
    }
  }
  if (slots.length < activeLoras.length) throw new Error("The template does not expose enough CR LoRA Stack slots for the active LoRAs.")
  for (const [index, slot] of slots.entries()) {
    const lora = activeLoras[index]
    slot.node.inputs[`switch_${slot.slot}`] = lora ? "On" : "Off"
    slot.node.inputs[`lora_name_${slot.slot}`] = lora?.name ?? "None"
    slot.node.inputs[`model_weight_${slot.slot}`] = lora?.modelStrength ?? 1
    slot.node.inputs[`clip_weight_${slot.slot}`] = lora?.clipStrength ?? 1
  }
}

function inferGraphResourceRequirements(graph: PromptGraph): readonly ResourceRequirement[] {
  const resources = new Map<string, ResourceRequirement>()
  for (const [, node] of orderedPromptNodes(graph)) {
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (typeof value !== "string" || !value || value === "None") continue
      const kind = inputName === "unet_name"
        ? "unet"
        : inputName === "clip_name"
          ? "clip"
          : inputName === "vae_name"
            ? "vae"
            : /^lora_name(?:_\d+)?$/.test(inputName)
              ? "lora"
              : undefined
      if (!kind) continue
      const resource: ResourceRequirement = { classType: node.class_type, inputName, resourceName: value, kind }
      resources.set(`${resource.classType}\u0000${resource.inputName}\u0000${resource.resourceName}`, resource)
    }
  }
  return [...resources.values()]
}

function extractGlowLoraCandidates(graph: PromptGraph): readonly ComfygureLora[] {
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

function materializeGlowTriggerLoraStacks(graph: PromptGraph, activeLoras: readonly ComfygureLora[]): void {
  const glowNodes = orderedPromptNodes(graph).filter(([, node]) => node.class_type === "GlowTriggerLoRAStack")
  if (!glowNodes.length) return
  const redirects = new Map<string, PromptInput>()
  let nextId = nextPromptGraphNodeId(graph)
  for (const [nodeId, node] of glowNodes) {
    const count = Math.max(integerPromptInput(node.inputs.lora_count, 0, 0, 30), activeLoras.length)
    let loraStack = node.inputs.lora_stack
    if (count === 0) {
      redirects.set(promptOutputKey(nodeId, 0), loraStack ?? null)
      delete graph[nodeId]
      continue
    }
    for (let start = 0; start < count; start += 3) {
      const inputs: Record<string, PromptInput> = {}
      for (let slot = 1; slot <= 3; slot += 1) {
        inputs[`switch_${slot}`] = "Off"
        inputs[`lora_name_${slot}`] = "None"
        inputs[`model_weight_${slot}`] = 1
        inputs[`clip_weight_${slot}`] = 1
      }
      if (loraStack !== undefined) inputs.lora_stack = loraStack
      const stackId = String(nextId++)
      graph[stackId] = { class_type: "CR LoRA Stack", inputs, _meta: { title: `Comfygure resolved LoRA stack ${start / 3 + 1}` } }
      loraStack = [stackId, 0]
    }
    redirects.set(promptOutputKey(nodeId, 0), loraStack ?? null)
    delete graph[nodeId]
  }
  rewritePromptGraphLinks(graph, redirects)
}

function materializeStaticCompileTimeNodes(graph: PromptGraph): void {
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const redirects = new Map<string, PromptInput>()
    const removable = new Set<string>()
    for (const [nodeId, node] of orderedPromptNodes(graph)) {
      if (node.class_type === "GlowDynamicTypedOutputs") {
        const referencedOutputs = referencedOutputIndexes(graph, nodeId)
        for (const outputIndex of referencedOutputs) {
          const value = resolveGlowDynamicOutput(node, outputIndex, graph, new Set())
          if (value !== undefined) redirects.set(promptOutputKey(nodeId, outputIndex), value)
        }
        if ([...referencedOutputs].every((outputIndex) => redirects.has(promptOutputKey(nodeId, outputIndex)))) removable.add(nodeId)
        continue
      }
      if (node.class_type === "PromptCleaningMaid" || node.class_type === "AnimaPromptFormatter") {
        const passthrough = node.inputs.string ?? node.inputs.text
        if (passthrough !== undefined) {
          redirects.set(promptOutputKey(nodeId, 0), passthrough)
          removable.add(nodeId)
        }
      }
    }
    if (!redirects.size && !removable.size) return
    rewritePromptGraphLinks(graph, redirects)
    for (const nodeId of removable) delete graph[nodeId]
  }
}

function resolveGlowDynamicOutput(node: PromptNode, outputIndex: number, graph: PromptGraph, visited: Set<string>): PromptInput | undefined {
  const count = integerPromptInput(resolveStaticPromptInput(node.inputs.output_count, graph, visited), 1, 1, 30)
  const selected = integerPromptInput(resolveStaticPromptInput(node.inputs.index, graph, visited), 1, 1, count)
  const slot = outputIndex === count || outputIndex === 30 ? selected : outputIndex + 1
  if (slot < 1 || slot > count) return null
  const bypass = booleanPromptInput(resolveStaticPromptInput(node.inputs[`bypass_input_${slot}`] ?? node.inputs[`bypass_${slot}`], graph, visited), false)
  const input = node.inputs[`input_${slot}`]
  if (bypass) return input ?? null
  if (input !== undefined) return input
  const type = promptInputString(node.inputs[`type_${slot}`]).toLocaleUpperCase()
  return coerceGlowDefaultValue(type, node.inputs[`default_value_${slot}`])
}

function resolveStaticPromptInput(value: PromptInput | undefined, graph: PromptGraph, visited: Set<string>): PromptInput | undefined {
  if (value === undefined || !isPromptLink(value)) return value
  const key = promptOutputKey(value[0], value[1])
  if (!visited.add(key)) return undefined
  const node = graph[value[0]]
  if (!node) return undefined
  const type = node.class_type.toLocaleLowerCase()
  if (node.class_type === "GlowDynamicTypedOutputs") return resolveGlowDynamicOutput(node, value[1], graph, visited)
  if (type === "primitiveint" || type === "primitivefloat" || type === "primitivestring" || type === "primitiveboolean") return resolveStaticPromptInput(node.inputs.value, graph, visited)
  return undefined
}

function coerceGlowDefaultValue(type: string, raw: PromptInput | undefined): PromptInput {
  const value = raw === null || raw === undefined ? "" : raw
  if (type === "STRING" || type === "COMBO") return String(value)
  if (type === "INT") return integerPromptInput(value, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  if (type === "FLOAT") return numberPromptInput(value, 0)
  if (type === "BOOLEAN") return booleanPromptInput(value, false)
  return null
}

function prunePromptGraphToOutputNodes(graph: PromptGraph): void {
  const roots = orderedPromptNodes(graph)
    .filter(([, node]) => /(?:save|preview).*image|saveimageplus/i.test(node.class_type))
    .map(([nodeId]) => nodeId)
  if (!roots.length) return
  const required = new Set<string>()
  const visit = (nodeId: string) => {
    if (required.has(nodeId)) return
    required.add(nodeId)
    const node = graph[nodeId]
    if (!node) return
    for (const input of Object.values(node.inputs)) {
      for (const link of promptLinksIn(input)) visit(link[0])
    }
  }
  for (const nodeId of roots) visit(nodeId)
  for (const nodeId of Object.keys(graph)) if (!required.has(nodeId)) delete graph[nodeId]
}

function rewritePromptGraphLinks(graph: PromptGraph, redirects: ReadonlyMap<string, PromptInput>): void {
  for (const node of Object.values(graph)) {
    for (const [inputName, input] of Object.entries(node.inputs)) node.inputs[inputName] = replacePromptInputLinks(input, redirects, new Set())
  }
}

function replacePromptInputLinks(value: PromptInput, redirects: ReadonlyMap<string, PromptInput>, visited: Set<string>): PromptInput {
  if (isPromptLink(value)) {
    const key = promptOutputKey(value[0], value[1])
    const replacement = redirects.get(key)
    if (replacement === undefined || !visited.add(key)) return value
    return replacePromptInputLinks(replacement, redirects, visited)
  }
  if (Array.isArray(value)) return value.map((item) => replacePromptInputLinks(item, redirects, new Set()))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePromptInputLinks(item, redirects, new Set())]))
  return value
}

function referencedOutputIndexes(graph: PromptGraph, nodeId: string): Set<number> {
  const indexes = new Set<number>()
  for (const node of Object.values(graph)) {
    for (const input of Object.values(node.inputs)) {
      for (const link of promptLinksIn(input)) if (link[0] === nodeId) indexes.add(link[1])
    }
  }
  return indexes
}

function* promptLinksIn(value: PromptInput): Generator<PromptLink> {
  if (isPromptLink(value)) {
    yield value
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* promptLinksIn(item)
    return
  }
  if (isRecord(value)) for (const item of Object.values(value)) yield* promptLinksIn(item)
}

function isPromptLink(value: PromptInput): value is PromptLink {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
}

function promptOutputKey(nodeId: string, outputIndex: number): string {
  return `${nodeId}\u0000${outputIndex}`
}

function nextPromptGraphNodeId(graph: PromptGraph): number {
  const largest = Object.keys(graph).reduce((value, nodeId) => /^\d+$/.test(nodeId) ? Math.max(value, Number(nodeId)) : value, 0)
  return largest + 1
}

function promptInputString(value: PromptInput | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberPromptInput(value: PromptInput | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function integerPromptInput(value: PromptInput | undefined, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(numberPromptInput(value, fallback))))
}

function booleanPromptInput(value: PromptInput | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") return ["true", "1", "yes", "y", "on", "enable", "enabled"].includes(value.trim().toLocaleLowerCase())
  return fallback
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

function normalizeBatchPrompts(value: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((prompt) => {
    const normalized = typeof prompt === "string" ? prompt.trim() : ""
    return normalized ? [normalized] : []
  })
}

function resolveJobSeed(baseSeed: number, mode: "fixed" | "increment", jobIndex: number): number {
  if (mode === "fixed") return baseSeed
  return Math.min(Number.MAX_SAFE_INTEGER, baseSeed + jobIndex)
}

function createSeededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffleIndices(indices: readonly number[], random: () => number): number[] {
  const shuffled = [...indices]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!]
  }
  return shuffled
}

function compiledRequirementsFor(runPlan: CompiledRunPlan): Pick<CompiledProgram, "requiredClasses" | "requiredResources"> {
  const classes = new Set<string>()
  const resources = new Map<string, ResourceRequirement>()
  for (const job of runPlan.jobs) {
    for (const classType of job.compiled.requiredClasses) classes.add(classType)
    for (const resource of job.compiled.requiredResources) {
      resources.set(`${resource.classType}\u0000${resource.inputName}\u0000${resource.resourceName}`, resource)
    }
  }
  return { requiredClasses: [...classes].sort(), requiredResources: [...resources.values()] }
}

function normalizePromptIds(value: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((promptId) => {
    const normalized = stringValue(promptId, "").trim()
    return normalized ? [normalized] : []
  }))]
}

function extractHistoryImages(entry: Record<string, unknown>, endpoint: string): readonly ComfyuiOutputImage[] {
  const outputs = isRecord(entry.outputs) ? entry.outputs : {}
  const images: ComfyuiOutputImage[] = []
  for (const output of Object.values(outputs)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue
    for (const image of output.images) {
      if (!isRecord(image)) continue
      const filename = stringValue(image.filename, "").trim()
      if (!filename) continue
      const subfolder = stringValue(image.subfolder, "").trim()
      const type = stringValue(image.type, "output").trim() || "output"
      images.push({ filename, subfolder, type, url: createComfyuiImageUrl(endpoint, { filename, subfolder, type }) })
    }
  }
  return images
}

function historyError(status: Record<string, unknown> | undefined): string {
  if (!status) return ""
  const messages = Array.isArray(status.messages) ? status.messages : []
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue
    const details = isRecord(message[1]) ? message[1] : undefined
    const exception = stringValue(details?.exception_message, "").trim()
    const summary = stringValue(details?.node_type, "").trim()
    return exception || summary || "ComfyUI reported an execution error."
  }
  return ""
}

function normalizeRegionPrompt(value: string): string {
  const protectedMaskSize = "COMFYGUREMASKSIZE"
  return value
    .replace(/\bCOUPLE\s+MASK\s*\(/gi, "COUPLE(")
    .replace(/\bMASK_SIZE\b/gi, protectedMaskSize)
    .replace(/_/g, " ")
    .replaceAll(protectedMaskSize, "MASK_SIZE")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\t ]{2,}/g, " ")
    .trim()
}

function removeUnmatchedBrackets(value: string): string {
  return removeUnmatchedBracketType(removeUnmatchedBracketType(value, "(", ")"), "[", "]")
}

function removeUnmatchedBracketType(value: string, open: string, close: string): string {
  const openings: number[] = []
  const rejected = new Set<number>()
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === open) openings.push(index)
    else if (value[index] === close) {
      if (openings.length) openings.pop()
      else rejected.add(index)
    }
  }
  for (const index of openings) rejected.add(index)
  return [...value].filter((_, index) => !rejected.has(index)).join("")
}

function bytesToBase64(value: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < value.length; index += chunkSize) binary += String.fromCharCode(...value.subarray(index, index + chunkSize))
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
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

function splitActivationTerms(value: string): string[] {
  return value.split(/[\n,，、|;；]+/).map((term) => term.trim()).filter(Boolean)
}

async function hydrateLoraTriggers(
  program: ComfygureProgramDraft | undefined,
  target: ComfygureTarget | undefined,
  runtime: ComfygureRuntime,
): Promise<ComfygureProgramDraft | undefined> {
  const libraryPath = target?.libraryPath?.trim()
  if (!libraryPath || !runtime.readLoraTrigger || !program?.loras?.length) return program
  const loras = await Promise.all(program.loras.map(async (lora) => {
    if (!lora || lora.enabled === false || stringValue(lora.injectionTerms, "")) return lora
    try {
      const trigger = await runtime.readLoraTrigger!(libraryPath, lora.name)
      return trigger?.trim() ? { ...lora, injectionTerms: trigger } : lora
    } catch {
      return lora
    }
  }))
  return { ...program, loras }
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

async function readComfyuiObjectInfo(target: ComfygureTarget, runtime: ComfygureRuntime): Promise<Record<string, unknown>> {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  const response = await fetchComfyui(runtime, `${endpoint}/object_info`, { method: "GET", headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (!isRecord(payload)) throw new Error("/object_info did not return a node map.")
  return payload
}
