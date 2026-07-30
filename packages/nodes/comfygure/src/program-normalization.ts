import { rulePolicySchema, type RuleTree } from "@xiranite/shared/rules"
import { ANIMA_INT8_RECIPE, COMFYGURE_ENABLE_LORA_EFFECT, COMFYGURE_FORMAT, DEFAULT_NEGATIVE_TEMPLATE, DEFAULT_OUTPUT_PREFIX_TEMPLATE, DEFAULT_POSITIVE_TEMPLATE } from "./contracts.js"
import type { ComfygureBatchEntry, ComfygureEnableLoraEffect, ComfygureLora, ComfygureProgram, ComfygureProgramDraft, ComfygureRulePolicy } from "./contracts.js"
import { stringValue, optionalString, bounded, rounded } from "./value-normalization.js"

export const REGION_SYNTAX = /\b(?:COUPLE|MASK|FEATHER|FILL|IMASK|AREA|MASK_SIZE|MASKW)\s*\(/i
export const WEIGHTED_TAG = /^(.+?):\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/
export const INLINE_LORA_TAG = /<lora:[^>]+>/gi
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
  templates: {
    positive: DEFAULT_POSITIVE_TEMPLATE,
    negative: DEFAULT_NEGATIVE_TEMPLATE,
    filenamePrefix: DEFAULT_OUTPUT_PREFIX_TEMPLATE,
  },
  batch: {
    prompts: [],
    entries: [],
    maxPrompts: 0,
    queueCount: 0,
    shuffle: false,
    allowDuplicates: true,
    selectionSeed: 0,
  },
  loras: [],
  rules: [],
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
export function normalizeComfygureProgram(input: ComfygureProgramDraft = {}): ComfygureProgram {
  const source = input
  const parameters = source.parameters ?? {}
  const teaCache = source.teaCache ?? {}
  const output = source.output ?? {}
  const model = source.model ?? {}
  const prompts = source.prompts ?? {}
  const templates = source.templates ?? {}
  const batch = source.batch ?? {}
  const batchEntries = normalizeBatchEntries(batch.entries, batch.prompts)
  const filenameTemplateFallback = typeof output.filenamePrefix === "string"
    ? "{{ output.prefix }}"
    : DEFAULT_OUTPUT_PREFIX_TEMPLATE
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
    templates: {
      positive: stringValue(templates.positive, DEFAULT_POSITIVE_TEMPLATE),
      negative: stringValue(templates.negative, DEFAULT_NEGATIVE_TEMPLATE),
      filenamePrefix: stringValue(templates.filenamePrefix, filenameTemplateFallback),
    },
    batch: {
      prompts: batchEntries.map((entry) => entry.text),
      entries: batchEntries,
      maxPrompts: rounded(batch.maxPrompts, DEFAULT_COMFYGURE_PROGRAM.batch.maxPrompts, 0, 100_000),
      queueCount: rounded(batch.queueCount, DEFAULT_COMFYGURE_PROGRAM.batch.queueCount, 0, 100_000),
      shuffle: batch.shuffle === true,
      allowDuplicates: batch.allowDuplicates !== false,
      selectionSeed: rounded(batch.selectionSeed, DEFAULT_COMFYGURE_PROGRAM.batch.selectionSeed, 0, Number.MAX_SAFE_INTEGER),
    },
    loras: normalizeLoras(source.loras),
    rules: normalizeComfygureRules(source.rules),
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
export function normalizeLoras(value: readonly ComfygureLora[] | undefined): readonly ComfygureLora[] {
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
export function normalizeBatchEntries(entries: readonly ComfygureBatchEntry[] | undefined, prompts: readonly string[] | undefined): readonly ComfygureBatchEntry[] {
  const source: readonly (ComfygureBatchEntry | string)[] = Array.isArray(entries) && entries.length ? entries : Array.isArray(prompts) ? prompts : []
  return source.flatMap((entry) => {
    const text = typeof entry === "string" ? entry.trim() : typeof entry?.text === "string" ? entry.text.trim() : ""
    if (!text) return []
    if (typeof entry === "string") return [{ text }]
    const sourceName = optionalString(entry.sourceName)
    const sourcePath = optionalString(entry.sourcePath)
    return [{ text, ...(sourceName ? { sourceName } : {}), ...(sourcePath ? { sourcePath } : {}) }]
  })
}
export function normalizeComfygureRules(value: readonly ComfygureRulePolicy[] | undefined): readonly ComfygureRulePolicy[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const parsed = rulePolicySchema.safeParse(candidate)
    if (!parsed.success) return []
    const effects = parsed.data.effects.flatMap((effect) => {
      if (effect.type !== COMFYGURE_ENABLE_LORA_EFFECT) return []
      const loraName = stringValue(effect.payload.loraName, "")
      return loraName ? [{ type: COMFYGURE_ENABLE_LORA_EFFECT, payload: { loraName } } satisfies ComfygureEnableLoraEffect] : []
    })
    if (effects.length === 0) return []
    return [{
      id: parsed.data.id,
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      priority: parsed.data.priority,
      when: parsed.data.when as RuleTree,
      effects,
    }]
  })
}
export function normalizeRegionPrompt(value: string): string {
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
export function removeUnmatchedBrackets(value: string): string {
  return removeUnmatchedBracketType(removeUnmatchedBracketType(value, "(", ")"), "[", "]")
}
export function removeUnmatchedBracketType(value: string, open: string, close: string): string {
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
export function splitPromptTags(value: string): string[] {
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
export function normalizePromptTag(value: string): string {
  const compact = value.replace(/[\t\r\n]+/g, " ").replace(/[ ]{2,}/g, " ").trim()
  if (!compact) return ""
  const underscored = compact.replace(/_/g, " ")
  if (underscored.startsWith("(") || underscored.startsWith("[") || REGION_SYNTAX.test(underscored)) return underscored
  const match = underscored.match(WEIGHTED_TAG)
  return match ? `(${match[1]!.trim()}:${match[2]})` : underscored
}
export function safeOutputPrefix(value: string): string {
  const segments = value.replace(/\\/g, "/").split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map(sanitizeOutputSegment)
    .filter(Boolean)
  return segments.join("/").slice(0, 512) || "comfygure"
}
export function sanitizeOutputSegment(value: string): string {
  // Windows rejects ASCII control characters in file and directory names.
  // oxlint-disable-next-line no-control-regex
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120)
}
