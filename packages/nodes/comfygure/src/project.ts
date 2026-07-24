import { createHash, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { brotliCompress, brotliDecompress, constants as zlibConstants } from "node:zlib"

import { canonicalizeEx } from "json-canonicalize"
import { z } from "zod"
import { ruleTreeSchema } from "@xiranite/shared/rules"

import {
  ANIMA_INT8_RECIPE,
  COMFYGURE_BINDING_MANIFEST_FORMAT,
  COMFYGURE_FORMAT,
  COMFYGURE_TEMPLATE_FORMAT,
  compressComfygureText,
  decompressComfygureText,
  normalizeComfygureProgram,
  normalizeComfygureProfile,
  type ComfygureBindingManifest,
  type ComfygureProfile,
  type ComfygureProfileProgram,
  type ComfygureProgram,
  type ComfygureProgramDraft,
  type ComfygureTemplate,
  type PromptGraph,
  type PromptInput,
} from "./core.js"

export const COMFYGURE_PROJECT_FORMAT = "comfygure-project/v1" as const
export const COMFYGURE_CONTENT_BLOB_FORMAT = "comfygure-content/v1" as const
export const COMFYGURE_RESOLVED_PROFILE_FORMAT = "comfygure-resolved-profile/v1" as const
export const COMFYGURE_COMPILER_PACKAGE = "@xiranite/node-comfygure" as const
export const COMFYGURE_COMPILER_VERSION = "0.1.0" as const
export const COMFYGURE_CONTENT_COMPRESSION_THRESHOLD = 4_096
export const COMFYGURE_BROTLI_QUALITY = 4 as const

const compressBrotli = promisify(brotliCompress)
const decompressBrotli = promisify(brotliDecompress)
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface ComfygureContentBlob {
  format: typeof COMFYGURE_CONTENT_BLOB_FORMAT
  mediaType: "text/plain;charset=utf-8" | "application/json"
  hash: `sha256:${string}`
  rawSize: number
  storedSize: number
  codec: "identity" | "brotli"
  brotliQuality?: typeof COMFYGURE_BROTLI_QUALITY
  data: string
}

export interface ComfygureRecipeReference {
  id: string
  version: number
}

export interface ComfygureCompilerIdentity {
  package: typeof COMFYGURE_COMPILER_PACKAGE
  version: string
}

export interface ComfygureProfileSourceReference {
  kind: "built-in" | "local" | "project"
  id: string
  version: string
}

export interface ComfygureResolvedProfileSnapshot {
  format: typeof COMFYGURE_RESOLVED_PROFILE_FORMAT
  source: ComfygureProfileSourceReference
  contentHash: `sha256:${string}`
  resolvedAt: string
  profile: ComfygureProfileProgram
}

export interface ComfygureProjectTemplateSnapshot {
  name: string
  sourceFormat: "api" | "ui"
  repairedSource: boolean
  originalSource: ComfygureContentBlob
  normalizedGraph: ComfygureContentBlob
  defaultLoras: ComfygureTemplate["defaultLoras"]
  bindingManifest: ComfygureBindingManifest
}

export interface ComfygureProjectDocument {
  format: typeof COMFYGURE_PROJECT_FORMAT
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  recipe: ComfygureRecipeReference
  compiler: ComfygureCompilerIdentity
  resolvedProfile: ComfygureResolvedProfileSnapshot
  profileOverrides: ComfygureProgramDraft
  program: ComfygureProgram
  template?: ComfygureProjectTemplateSnapshot
}

export interface CreateComfygureProjectOptions {
  id?: string
  name?: string
  profile: ComfygureProfile
  profileSource?: Partial<ComfygureProfileSourceReference>
  profileOverrides?: ComfygureProgramDraft
  template?: ComfygureTemplate
  now?: Date
}

export interface ComfygureProjectStore {
  read(path: string): Promise<ComfygureProjectDocument>
  save(path: string, project: ComfygureProjectDocument): Promise<ComfygureProjectDocument>
}

const finiteNumber = z.number().finite()
const nonnegativeInteger = z.number().int().nonnegative()
const timestampSchema = z.string().datetime({ offset: true })
const hashSchema = z.string().regex(SHA256_PATTERN)
const loraSchema = z.object({
  name: z.string().min(1),
  modelStrength: finiteNumber.optional(),
  clipStrength: finiteNumber.optional(),
  activationTerms: z.string().optional(),
  injectionTerms: z.string().optional(),
  enabled: z.boolean().optional(),
}).strict()
const comfygureRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int(),
  when: ruleTreeSchema,
  effects: z.array(z.object({
    type: z.literal("comfygure.enable-lora/v1"),
    payload: z.object({ loraName: z.string().min(1) }).strict(),
  }).strict()),
}).strict()
const modelSchema = z.object({ unetName: z.string().min(1), clipName: z.string().min(1), vaeName: z.string().min(1) }).strict()
const parametersSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  seed: nonnegativeInteger,
  seedMode: z.enum(["fixed", "increment"]),
  steps: z.number().int().positive(),
  cfg: finiteNumber,
  samplerName: z.string().min(1),
  scheduler: z.string().min(1),
  denoise: finiteNumber,
  foveaStrength: finiteNumber,
  sharpness: finiteNumber,
  maskInertia: finiteNumber,
}).strict()
const teaCacheSchema = z.object({
  threshold: finiteNumber,
  adaptiveMode: z.boolean(),
  earlyStepsFactor: finiteNumber,
  lateStepsFactor: finiteNumber,
  startPercent: finiteNumber,
  endPercent: finiteNumber,
  cacheDevice: z.string().min(1),
}).strict()
const outputSchema = z.object({
  filenamePrefix: z.string(),
  format: z.enum(["png", "jpeg", "webp"]),
  quality: finiteNumber,
  preview: z.boolean(),
}).strict()
const batchEntrySchema = z.object({ text: z.string(), sourceName: z.string().optional(), sourcePath: z.string().optional() }).strict()
const batchSchema = z.object({
  prompts: z.array(z.string()),
  entries: z.array(batchEntrySchema),
  maxPrompts: nonnegativeInteger,
  queueCount: nonnegativeInteger,
  shuffle: z.boolean(),
  allowDuplicates: z.boolean(),
  selectionSeed: nonnegativeInteger,
}).strict()
const programSchema = z.object({
  format: z.literal(COMFYGURE_FORMAT),
  recipe: z.literal(ANIMA_INT8_RECIPE),
  name: z.string().min(1),
  model: modelSchema,
  prompts: z.object({ positive: z.string(), negative: z.string(), positivePrefix: z.string() }).strict(),
  templates: z.object({ positive: z.string(), negative: z.string(), filenamePrefix: z.string() }).strict(),
  batch: batchSchema,
  loras: z.array(loraSchema),
  rules: z.array(comfygureRuleSchema),
  parameters: parametersSchema,
  teaCache: teaCacheSchema,
  output: outputSchema,
}).strict()
const profileProgramSchema = programSchema.pick({ model: true, loras: true, rules: true, parameters: true, teaCache: true, output: true })
const programDraftSchema = z.object({
  name: z.string().optional(),
  model: modelSchema.partial().optional(),
  prompts: z.object({ positive: z.string(), negative: z.string(), positivePrefix: z.string() }).partial().strict().optional(),
  templates: z.object({ positive: z.string(), negative: z.string(), filenamePrefix: z.string() }).partial().strict().optional(),
  batch: batchSchema.partial().optional(),
  loras: z.array(loraSchema).optional(),
  rules: z.array(comfygureRuleSchema).optional(),
  parameters: parametersSchema.partial().optional(),
  teaCache: teaCacheSchema.partial().optional(),
  output: outputSchema.partial().optional(),
}).strict()
const promptPrimitiveSchema = z.union([z.string(), finiteNumber, z.boolean(), z.null()])
const promptInputSchema: z.ZodType<PromptInput> = z.lazy(() => z.union([
  promptPrimitiveSchema,
  z.tuple([z.string(), nonnegativeInteger]),
  z.array(promptInputSchema),
  z.record(z.string(), promptInputSchema),
]))
const promptGraphSchema: z.ZodType<PromptGraph> = z.record(z.string(), z.object({
  class_type: z.string().min(1),
  inputs: z.record(z.string(), promptInputSchema),
  _meta: z.record(z.string(), promptInputSchema).optional(),
}).strict())
const bindingKeySchema = z.enum([
  "positivePrompt", "negativePrompt", "unetName", "clipName", "vaeName", "width", "height", "batchSize", "seed", "steps", "cfg",
  "samplerName", "scheduler", "denoise", "filenamePrefix", "outputFormat", "outputQuality", "outputPreview",
])
const bindingManifestSchema = z.object({
  format: z.literal(COMFYGURE_BINDING_MANIFEST_FORMAT),
  confirmed: z.boolean(),
  bindings: z.array(z.object({
    key: bindingKeySchema,
    targets: z.array(z.object({ nodeId: z.string().min(1), inputName: z.string().min(1) }).strict()),
    confidence: z.enum(["explicit", "inferred"]),
  }).strict()),
}).strict()

export const comfygureContentBlobSchema = z.object({
  format: z.literal(COMFYGURE_CONTENT_BLOB_FORMAT),
  mediaType: z.enum(["text/plain;charset=utf-8", "application/json"]),
  hash: hashSchema,
  rawSize: nonnegativeInteger,
  storedSize: nonnegativeInteger,
  codec: z.enum(["identity", "brotli"]),
  brotliQuality: z.literal(COMFYGURE_BROTLI_QUALITY).optional(),
  data: z.string().regex(BASE64_PATTERN),
}).strict().superRefine((value, context) => {
  if (value.codec === "brotli" && value.brotliQuality !== COMFYGURE_BROTLI_QUALITY) {
    context.addIssue({ code: "custom", message: `Brotli content must use quality ${COMFYGURE_BROTLI_QUALITY}.`, path: ["brotliQuality"] })
  }
  if (value.codec === "identity" && value.brotliQuality !== undefined) {
    context.addIssue({ code: "custom", message: "Identity content cannot declare a Brotli quality.", path: ["brotliQuality"] })
  }
})

export const comfygureResolvedProfileSnapshotSchema = z.object({
  format: z.literal(COMFYGURE_RESOLVED_PROFILE_FORMAT),
  source: z.object({ kind: z.enum(["built-in", "local", "project"]), id: z.string().min(1), version: z.string().min(1) }).strict(),
  contentHash: hashSchema,
  resolvedAt: timestampSchema,
  profile: profileProgramSchema,
}).strict()

export const comfygureProjectDocumentSchema = z.object({
  format: z.literal(COMFYGURE_PROJECT_FORMAT),
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  recipe: z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict(),
  compiler: z.object({ package: z.literal(COMFYGURE_COMPILER_PACKAGE), version: z.string().min(1) }).strict(),
  resolvedProfile: comfygureResolvedProfileSnapshotSchema,
  profileOverrides: programDraftSchema,
  program: programSchema,
  template: z.object({
    name: z.string().min(1),
    sourceFormat: z.enum(["api", "ui"]),
    repairedSource: z.boolean(),
    originalSource: comfygureContentBlobSchema,
    normalizedGraph: comfygureContentBlobSchema,
    defaultLoras: z.array(loraSchema),
    bindingManifest: bindingManifestSchema,
  }).strict().optional(),
}).strict()

export function canonicalizeComfygureJson(value: unknown): string {
  return canonicalizeEx(value, { allowCircular: false, filterUndefined: true, undefinedInArrayToNull: false })
}

export function hashComfygureJson(value: unknown): `sha256:${string}` {
  return sha256(Buffer.from(canonicalizeComfygureJson(value), "utf8"))
}

export async function createComfygureTextBlob(value: string): Promise<ComfygureContentBlob> {
  return await createContentBlob(Buffer.from(value, "utf8"), "text/plain;charset=utf-8")
}

export async function createComfygureJsonBlob(value: unknown): Promise<ComfygureContentBlob> {
  return await createContentBlob(Buffer.from(canonicalizeComfygureJson(value), "utf8"), "application/json")
}

export async function readComfygureContentBlob(blob: ComfygureContentBlob): Promise<Uint8Array> {
  const parsed = comfygureContentBlobSchema.parse(blob)
  const stored = Buffer.from(parsed.data, "base64")
  if (stored.byteLength !== parsed.storedSize) throw new Error("Comfygure content blob stored size does not match its metadata.")
  const raw = parsed.codec === "brotli" ? await decompressBrotli(stored) : stored
  if (raw.byteLength !== parsed.rawSize) throw new Error("Comfygure content blob raw size does not match its metadata.")
  if (sha256(raw) !== parsed.hash) throw new Error("Comfygure content blob failed SHA-256 integrity verification.")
  return raw
}

export async function readComfygureTextBlob(blob: ComfygureContentBlob): Promise<string> {
  if (blob.mediaType !== "text/plain;charset=utf-8") throw new Error("Comfygure content blob is not UTF-8 text.")
  return Buffer.from(await readComfygureContentBlob(blob)).toString("utf8")
}

export async function readComfygureJsonBlob(blob: ComfygureContentBlob): Promise<unknown> {
  if (blob.mediaType !== "application/json") throw new Error("Comfygure content blob is not JSON.")
  return JSON.parse(Buffer.from(await readComfygureContentBlob(blob)).toString("utf8")) as unknown
}

export function createComfygureResolvedProfileSnapshot(
  profile: ComfygureProfile,
  source: Partial<ComfygureProfileSourceReference> = {},
  now = new Date(),
): ComfygureResolvedProfileSnapshot {
  const normalized = normalizeComfygureProfile(profile)
  if (!normalized) throw new Error("Cannot create a resolved snapshot from an invalid Comfygure profile.")
  const resolvedProfile = structuredClone(normalized.program)
  return comfygureResolvedProfileSnapshotSchema.parse({
    format: COMFYGURE_RESOLVED_PROFILE_FORMAT,
    source: {
      kind: source.kind ?? "local",
      id: source.id?.trim() || normalized.id,
      version: source.version?.trim() || String(normalized.revision),
    },
    contentHash: hashComfygureJson(resolvedProfile),
    resolvedAt: now.toISOString(),
    profile: resolvedProfile,
  }) as ComfygureResolvedProfileSnapshot
}

export async function createComfygureProjectDocument(
  input: ComfygureProgramDraft,
  options: CreateComfygureProjectOptions,
): Promise<ComfygureProjectDocument> {
  const now = options.now ?? new Date()
  const program = normalizeComfygureProgram(input)
  const parsedRecipe = parseRecipe(program.recipe)
  const project: ComfygureProjectDocument = {
    format: COMFYGURE_PROJECT_FORMAT,
    schemaVersion: 1,
    id: options.id?.trim() || randomUUID(),
    name: options.name?.trim() || program.name,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    recipe: parsedRecipe,
    compiler: { package: COMFYGURE_COMPILER_PACKAGE, version: COMFYGURE_COMPILER_VERSION },
    resolvedProfile: createComfygureResolvedProfileSnapshot(options.profile, options.profileSource, now),
    profileOverrides: structuredClone(options.profileOverrides ?? {}),
    program,
    ...(options.template ? { template: await createProjectTemplateSnapshot(options.template) } : {}),
  }
  return await parseComfygureProjectDocument(project)
}

export async function parseComfygureProjectDocument(value: unknown): Promise<ComfygureProjectDocument> {
  const project = comfygureProjectDocumentSchema.parse(value) as ComfygureProjectDocument
  const expectedProfileHash = hashComfygureJson(project.resolvedProfile.profile)
  if (project.resolvedProfile.contentHash !== expectedProfileHash) throw new Error("Resolved Profile Snapshot content hash does not match its profile data.")
  if (project.template) {
    await readComfygureTextBlob(project.template.originalSource)
    promptGraphSchema.parse(await readComfygureJsonBlob(project.template.normalizedGraph))
  }
  return project
}

export function assertSupportedComfygureRecipe(project: Pick<ComfygureProjectDocument, "recipe">): void {
  const current = parseRecipe(ANIMA_INT8_RECIPE)
  if (project.recipe.id !== current.id || project.recipe.version !== current.version) {
    throw new Error(`Comfygure compiler recipe ${project.recipe.id}/v${project.recipe.version} is not installed.`)
  }
}

export async function materializeComfygureProjectTemplate(snapshot: ComfygureProjectTemplateSnapshot): Promise<ComfygureTemplate> {
  const originalSource = await readComfygureTextBlob(snapshot.originalSource)
  const graph = promptGraphSchema.parse(await readComfygureJsonBlob(snapshot.normalizedGraph))
  return {
    format: COMFYGURE_TEMPLATE_FORMAT,
    name: snapshot.name,
    sourceFormat: snapshot.sourceFormat,
    originalSource: compressComfygureText(originalSource) ?? { format: "deflate-base64/v1", data: "", lineCount: 0, uncompressedLength: 0 },
    repairedSource: snapshot.repairedSource,
    graph,
    defaultLoras: structuredClone(snapshot.defaultLoras),
    bindingManifest: structuredClone(snapshot.bindingManifest),
  }
}

async function createProjectTemplateSnapshot(template: ComfygureTemplate): Promise<ComfygureProjectTemplateSnapshot> {
  const originalSource = decompressComfygureText(template.originalSource)
  if (!originalSource && template.originalSource.uncompressedLength > 0) throw new Error("Imported ComfyUI source could not be decompressed for the Project Document.")
  return {
    name: template.name,
    sourceFormat: template.sourceFormat,
    repairedSource: template.repairedSource,
    originalSource: await createComfygureTextBlob(originalSource),
    normalizedGraph: await createComfygureJsonBlob(template.graph),
    defaultLoras: structuredClone(template.defaultLoras),
    bindingManifest: structuredClone(template.bindingManifest),
  }
}

async function createContentBlob(raw: Buffer, mediaType: ComfygureContentBlob["mediaType"]): Promise<ComfygureContentBlob> {
  const compressed = raw.byteLength > COMFYGURE_CONTENT_COMPRESSION_THRESHOLD
  const stored = compressed
    ? await compressBrotli(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: COMFYGURE_BROTLI_QUALITY } })
    : raw
  return comfygureContentBlobSchema.parse({
    format: COMFYGURE_CONTENT_BLOB_FORMAT,
    mediaType,
    hash: sha256(raw),
    rawSize: raw.byteLength,
    storedSize: stored.byteLength,
    codec: compressed ? "brotli" : "identity",
    ...(compressed ? { brotliQuality: COMFYGURE_BROTLI_QUALITY } : {}),
    data: stored.toString("base64"),
  }) as ComfygureContentBlob
}

function sha256(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function parseRecipe(recipe: string): ComfygureRecipeReference {
  const match = /^(.+)\/v([1-9]\d*)$/.exec(recipe)
  if (!match) throw new Error(`Invalid Comfygure compiler recipe: ${recipe}`)
  return { id: match[1]!, version: Number(match[2]) }
}
