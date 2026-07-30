import type { RuleEffect, RulePolicy } from "@xiranite/shared/rules"

export const COMFYGURE_FORMAT = "comfygure/v1" as const
export const COMFYGURE_RUN_PLAN_FORMAT = "comfygure-run-plan/v1" as const
export const COMFYGURE_TEMPLATE_FORMAT = "comfygure-template/v1" as const
export const COMFYGURE_BINDING_MANIFEST_FORMAT = "comfygure-binding-manifest/v1" as const
export const COMFYGURE_PROFILE_FORMAT = "comfygure-profile/v1" as const
export const ANIMA_INT8_RECIPE = "anima-int8/v1" as const
export const COMFYGURE_ENABLE_LORA_EFFECT = "comfygure.enable-lora/v1" as const
export const DEFAULT_COMFYUI_ENDPOINT = "http://127.0.0.1:8000"
export const DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS = 10_000
export const DEFAULT_POSITIVE_TEMPLATE = "{{ prompt.prefix }}, {{ prompt.positive }}"
export const DEFAULT_NEGATIVE_TEMPLATE = "{{ prompt.negative }}"
export const DEFAULT_OUTPUT_PREFIX_TEMPLATE = "comfygure/{{ project | safe_segment }}/{{ run | safe_segment }}/{{ job }}-{{ seed }}"
export type PromptPrimitive = string | number | boolean | null
export type PromptLink = readonly [nodeId: string, outputIndex: number]
export type PromptInput = PromptPrimitive | PromptLink | readonly PromptInput[] | { readonly [key: string]: PromptInput }
export interface PromptNode {
  class_type: string
  inputs: Record<string, PromptInput>
  _meta?: Record<string, PromptInput>
}
export type PromptGraph = Record<string, PromptNode>
export interface ComfygureCanvasExport {
  version: 0.4
  last_node_id: number
  last_link_id: number
  nodes: readonly ComfygureCanvasNode[]
  links: readonly ComfygureCanvasLink[]
  groups: readonly ComfygureCanvasGroup[]
  config: {}
  extra: { comfygure: { format: "comfygure-canvas/v1"; sourceNodeCount: number; objectInfoUsed: boolean; diagnostics: readonly string[] } }
}
export interface ComfygureCanvasNode {
  id: number
  type: string
  pos: readonly [number, number]
  size: readonly [number, number]
  flags: {}
  order: number
  mode: 0
  inputs: readonly { label: string; name: string; type: string; link: number | null; widget?: { name: string } }[]
  outputs: readonly { label: string; name: string; type: string; slot_index: number; links: readonly number[] | null }[]
  properties: Record<string, PromptInput>
  widgets_values: readonly PromptInput[]
  title?: string
}
export type ComfygureCanvasLink = readonly [id: number, originId: number, originSlot: number, targetId: number, targetSlot: number, type: string]
export interface ComfygureCanvasGroup {
  id: number
  title: string
  bounding: readonly [number, number, number, number]
  color: string
  font_size: 24
  flags: {}
}
export interface ComfygureCanvasExportOptions {
  objectInfo?: Record<string, unknown>
}
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
export interface ComfygureEnableLoraEffect extends RuleEffect {
  type: typeof COMFYGURE_ENABLE_LORA_EFFECT
  payload: { loraName: string }
}
export type ComfygureRuleEffect = ComfygureEnableLoraEffect
export type ComfygureRulePolicy = RulePolicy<ComfygureRuleEffect>
export interface ComfygureRuleResolution {
  facts: Readonly<Record<string, unknown>>
  matchedPolicyIds: readonly string[]
  enabledLoraNames: readonly string[]
}
export interface ComfygureRuleFactDefinition {
  name: string
  label: string
  type: "string" | "number" | "boolean" | "string[]"
}
export const COMFYGURE_RULE_FACTS: readonly ComfygureRuleFactDefinition[] = [
  { name: "prompt.activationText", label: "Prompt text", type: "string" },
  { name: "batch.text", label: "Batch text", type: "string" },
  { name: "batch.sourceName", label: "Source filename", type: "string" },
  { name: "batch.sourcePath", label: "Source path", type: "string" },
  { name: "batch.sourceIndex", label: "Source index", type: "number" },
  { name: "batch.loopIndex", label: "Loop index", type: "number" },
  { name: "model.unet", label: "UNet model", type: "string" },
  { name: "model.clip", label: "CLIP model", type: "string" },
  { name: "model.vae", label: "VAE model", type: "string" },
  { name: "image.width", label: "Image width", type: "number" },
  { name: "image.height", label: "Image height", type: "number" },
  { name: "image.batchSize", label: "Image batch size", type: "number" },
  { name: "sampler.seed", label: "Seed", type: "number" },
  { name: "sampler.name", label: "Sampler", type: "string" },
  { name: "sampler.scheduler", label: "Scheduler", type: "string" },
  { name: "sampler.steps", label: "Steps", type: "number" },
  { name: "sampler.cfg", label: "CFG", type: "number" },
  { name: "sampler.denoise", label: "Denoise", type: "number" },
  { name: "output.prefix", label: "Output prefix", type: "string" },
  { name: "output.format", label: "Output format", type: "string" },
  { name: "lora.names", label: "Configured LoRA names", type: "string[]" },
  { name: "lora.tags", label: "Configured LoRA tags", type: "string[]" },
] as const
export interface ComfygureBatchEntry {
  text: string
  sourceName?: string
  sourcePath?: string
}
export interface ComfygureBatch {
  prompts: readonly string[]
  entries: readonly ComfygureBatchEntry[]
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
  templates: {
    positive: string
    negative: string
    filenamePrefix: string
  }
  batch: ComfygureBatch
  loras: readonly ComfygureLora[]
  rules: readonly ComfygureRulePolicy[]
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
export type ComfygureProfileProgram = Pick<ComfygureProgram, "model" | "loras" | "rules" | "parameters" | "teaCache" | "output">
export interface ComfygureProfile {
  format: typeof COMFYGURE_PROFILE_FORMAT
  schemaVersion: 1
  id: string
  name: string
  revision: number
  createdAt: string
  updatedAt: string
  program: ComfygureProfileProgram
}
export interface ComfygureProfileSummary {
  id: string
  name: string
  revision: number
  updatedAt: string
}
export interface ComfygureProgramDraft {
  name?: string
  model?: Partial<ComfygureProgram["model"]>
  prompts?: Partial<ComfygureProgram["prompts"]>
  templates?: Partial<ComfygureProgram["templates"]>
  batch?: Partial<ComfygureBatch>
  loras?: readonly ComfygureLora[]
  rules?: readonly ComfygureRulePolicy[]
  parameters?: Partial<ComfygureProgram["parameters"]>
  teaCache?: Partial<ComfygureProgram["teaCache"]>
  output?: Partial<ComfygureProgram["output"]>
}
export interface ComfygureTarget {
  endpoint?: string
  clientId?: string
  libraryPath?: string
  profileLibraryPath?: string
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
  filenamePrefix: string
  promptComposition: ComfygurePromptComposition
  ruleResolution?: ComfygureRuleResolution
  requiredClasses: readonly string[]
  requiredResources: readonly ResourceRequirement[]
}
export interface CompiledGenerationJob {
  index: number
  sourceIndex: number
  loopIndex: number
  sourceText: string
  sourceName?: string
  sourcePath?: string
  seed: number
  compiled: CompiledProgram
}
export interface CompiledRunPlan {
  format: typeof COMFYGURE_RUN_PLAN_FORMAT
  recipe: typeof ANIMA_INT8_RECIPE
  program: ComfygureProgram
  jobs: readonly CompiledGenerationJob[]
}
export interface ComfygurePromptComposition {
  sourceText: string
  activeLoraNames: readonly string[]
  injectedTerms: readonly string[]
  renderedPositive: string
  positivePrompt: string
  negativePrompt: string
  filenamePrefix: string
}
export interface ComfygureRunPlanOptions {
  runId?: string
}
export interface ComfygureCompileOptions extends ComfygureRunPlanOptions {
  jobIndex?: number
  sourceIndex?: number
  loopIndex?: number
  batchEntry?: ComfygureBatchEntry
  ruleResolution?: ComfygureRuleResolution
}
export interface ComfygureTemplateVariable {
  path: string
  type: "string" | "number" | "string[]"
  scopes: readonly ("positive" | "negative" | "filenamePrefix")[]
}
export interface ComfygureTemplatePart {
  kind: "variable" | "text"
  value: string
}
export interface ComfygureVisualTemplate {
  supported: boolean
  parts: readonly ComfygureTemplatePart[]
  error?: string
}
export const COMFYGURE_TEMPLATE_VARIABLES: readonly ComfygureTemplateVariable[] = [
  { path: "project", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "run", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "job", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "seed", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "model", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "sourceName", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "prompt.prefix", type: "string", scopes: ["positive", "negative"] },
  { path: "prompt.positive", type: "string", scopes: ["positive", "negative"] },
  { path: "prompt.negative", type: "string", scopes: ["positive", "negative"] },
  { path: "batch.text", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "batch.sourceName", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "batch.sourceStem", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "batch.sourcePath", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "batch.sourceIndex", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "batch.loopIndex", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "lora.names", type: "string[]", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "lora.tags", type: "string[]", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "models.unet", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "models.clip", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "models.vae", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "image.width", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "image.height", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "image.batchSize", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "sampler.name", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "sampler.scheduler", type: "string", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "sampler.steps", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "sampler.cfg", type: "number", scopes: ["positive", "negative", "filenamePrefix"] },
  { path: "output.prefix", type: "string", scopes: ["filenamePrefix"] },
] as const
export interface PreflightReport {
  endpoint: string
  online: boolean
  availableClassCount: number
  missingClasses: readonly string[]
  missingResources: readonly ResourceRequirement[]
  uncheckedResources: readonly ResourceRequirement[]
  warnings: readonly string[]
  controlOptions?: ComfygureControlOptions
}
export interface ComfygureControlOptions {
  samplerNames: readonly string[]
  schedulers: readonly string[]
  sourceNodeTypes: readonly string[]
}
export interface ComfygureData {
  compiled: CompiledProgram
  runPlan: CompiledRunPlan
  canvas?: ComfygureCanvasExport
  workflowImport?: ComfygureWorkflowImport
  profiles?: readonly ComfygureProfileSummary[]
  profile?: ComfygureProfile
  preflight?: PreflightReport
  controlOptions?: ComfygureControlOptions
  submission?: ComfyuiSubmission
  submissions?: readonly ComfyuiSubmission[]
  history?: readonly ComfyuiPromptHistory[]
}
export interface ComfygureInput {
  action?: "compile" | "import" | "profiles" | "saveProfile" | "loadProfile" | "canvas" | "options" | "preflight" | "submit" | "refresh"
  program?: ComfygureProgramDraft
  template?: ComfygureTemplate
  workflowSource?: string
  profileId?: string
  profileName?: string
  runId?: string
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
  targetAdapter?: ComfygureTargetAdapter
  profileStore?: ComfygureProfileStore
  now?: () => Date
}
/**
 * Host-neutral boundary around the local ComfyUI transport. The Node platform
 * provides the pinned client implementation; compiler code only sees this
 * contract so protocol changes stay out of the compiler and UI projections.
 */
export interface ComfygureTargetAdapter {
  readObjectInfo(target: ComfygureTarget): Promise<Record<string, unknown>>
  submitPrompt(compiled: CompiledProgram, target: ComfygureTarget): Promise<ComfyuiSubmission>
  readPromptHistory(promptId: string, target: ComfygureTarget): Promise<ComfyuiPromptHistory>
}
export interface ComfygureProfileStore {
  list(profileLibraryPath?: string): Promise<readonly ComfygureProfileSummary[]>
  read(id: string, profileLibraryPath?: string): Promise<ComfygureProfile | undefined>
  save(profile: ComfygureProfile, profileLibraryPath?: string): Promise<ComfygureProfile>
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
