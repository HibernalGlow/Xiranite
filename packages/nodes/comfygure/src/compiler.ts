import { RULE_TREE_FORMAT, createRuleId } from "@xiranite/shared/rules"
import { ANIMA_INT8_RECIPE, COMFYGURE_ENABLE_LORA_EFFECT, COMFYGURE_RUN_PLAN_FORMAT, COMFYGURE_TEMPLATE_FORMAT } from "./contracts.js"
import type { ComfygureBatch, ComfygureBatchEntry, ComfygureBindingKey, ComfygureCompileOptions, ComfygureLora, ComfygureProgram, ComfygureProgramDraft, ComfygurePromptComposition, ComfygureRulePolicy, ComfygureRuleResolution, ComfygureRunPlanOptions, ComfygureTemplate, CompiledGenerationJob, CompiledProgram, CompiledRunPlan, PromptGraph, PromptInput, PromptLink, PromptNode, ResourceRequirement } from "./contracts.js"
import { optionalString } from "./value-normalization.js"
import { orderedPromptNodes, clonePromptGraph, rewritePromptGraphLinks, referencedOutputIndexes, promptLinksIn, isPromptLink, promptOutputKey, nextPromptGraphNodeId, promptInputString, numberPromptInput, integerPromptInput, booleanPromptInput } from "./prompt-graph.js"
import { COMPILE_TIME_NODE_TYPES } from "./workflow-import.js"
import { REGION_SYNTAX, normalizeComfygureProgram, normalizePromptText, splitPromptTags, normalizePromptTag, safeOutputPrefix } from "./program-normalization.js"
import { renderComfygureLiquid, pathBasename, pathStem } from "./template-engine.js"

export function resolveActiveLoras(program: ComfygureProgram, positiveText: string): readonly ComfygureLora[] {
  const comparable = positiveText.toLocaleLowerCase()
  return program.loras.filter((lora) => {
    if (lora.enabled === false) return false
    const terms = splitActivationTerms(lora.activationTerms ?? "").map((term) => term.toLocaleLowerCase())
    return terms.length === 0 || terms.some((term) => comparable.includes(term))
  })
}
export function createComfygureLoraRule(loraName: string, activationTerms = ""): ComfygureRulePolicy {
  const terms = splitActivationTerms(activationTerms)
  const id = createRuleId("lora-policy")
  return {
    id,
    name: `Enable ${loraName}`,
    enabled: true,
    priority: 0,
    when: {
      format: RULE_TREE_FORMAT,
      version: 1,
      root: {
        id: createRuleId("group"),
        kind: "group",
        combinator: terms.length > 1 ? "any" : "all",
        not: false,
        children: terms.map((term) => ({
          id: createRuleId("condition"),
          kind: "condition" as const,
          field: "prompt.activationText",
          operator: "contains" as const,
          value: term,
        })),
      },
    },
    effects: [{ type: COMFYGURE_ENABLE_LORA_EFFECT, payload: { loraName } }],
  }
}
export async function resolveComfygureRules(
  program: ComfygureProgram,
  options: ComfygureCompileOptions = {},
): Promise<ComfygureRuleResolution> {
  const batchEntry = options.batchEntry ?? { text: program.prompts.positive }
  const facts = createComfygureRuleFacts(program, options, batchEntry)
  const { evaluateRulePolicies } = await import("@xiranite/shared/rules-engine")
  const matches = await evaluateRulePolicies(program.rules, facts)
  const controlledLoras = new Set(program.rules.flatMap((policy) => policy.effects.map((effect) => effect.payload.loraName)))
  const matchedLoras = new Set(matches.flatMap((match) => match.effects.map((effect) => effect.payload.loraName)))
  const activationText = String(facts["prompt.activationText"] ?? "")
  const enabledLoraNames = program.loras
    .filter((lora) => lora.enabled !== false)
    .filter((lora) => controlledLoras.has(lora.name) ? matchedLoras.has(lora.name) : legacyLoraMatches(lora, activationText))
    .map((lora) => lora.name)
  return Object.freeze({
    facts,
    matchedPolicyIds: Object.freeze(matches.map((match) => match.policyId)),
    enabledLoraNames: Object.freeze(enabledLoraNames),
  })
}
export function resolvePromptComposition(program: ComfygureProgram, options: ComfygureCompileOptions = {}): { activeLoras: readonly ComfygureLora[]; composition: ComfygurePromptComposition } {
  const batchEntry = options.batchEntry ?? { text: program.prompts.positive }
  const sourceText = batchEntry.text || program.prompts.positive
  const activationText = normalizePromptText([program.prompts.positivePrefix, sourceText].filter(Boolean).join(", "))
  if (program.rules.length > 0 && !options.ruleResolution) throw new Error("Comfygure rule policies require the async rule-aware compiler entry point.")
  const enabledLoras = options.ruleResolution ? new Set(options.ruleResolution.enabledLoraNames) : undefined
  const activeLoras = enabledLoras ? program.loras.filter((lora) => enabledLoras.has(lora.name)) : resolveActiveLoras(program, activationText)
  const injectedTerms = activeLoras.flatMap((lora) => splitPromptTags(lora.injectionTerms ?? "").map(normalizePromptTag).filter(Boolean))
  const context = createLiquidContext(program, activeLoras, options, batchEntry, injectedTerms)
  const renderedPositive = renderComfygureLiquid("positive", program.templates.positive, context)
  const positivePrompt = ensurePromptTerms(normalizePromptText(renderedPositive), injectedTerms)
  const negativePrompt = normalizePromptText(renderComfygureLiquid("negative", program.templates.negative, context))
  const filenamePrefix = safeOutputPrefix(renderComfygureLiquid("filename prefix", program.templates.filenamePrefix, context))
  return {
    activeLoras,
    composition: {
      sourceText,
      activeLoraNames: activeLoras.map((lora) => lora.name),
      injectedTerms,
      renderedPositive,
      positivePrompt,
      negativePrompt,
      filenamePrefix,
    },
  }
}
export function createLiquidContext(
  program: ComfygureProgram,
  activeLoras: readonly ComfygureLora[],
  options: ComfygureCompileOptions,
  batchEntry: ComfygureBatchEntry,
  injectedTerms: readonly string[],
): Record<string, unknown> {
  const sourceName = batchEntry.sourceName || pathBasename(batchEntry.sourcePath ?? "")
  const sourcePath = batchEntry.sourcePath ?? ""
  const jobIndex = Math.max(0, Math.trunc(options.jobIndex ?? 0))
  const sourceIndex = Math.max(0, Math.trunc(options.sourceIndex ?? 0))
  const loopIndex = Math.max(0, Math.trunc(options.loopIndex ?? 0))
  return {
    project: program.name,
    run: optionalString(options.runId) ?? "preview",
    job: jobIndex + 1,
    seed: program.parameters.seed,
    model: pathStem(program.model.unetName),
    sourceName,
    prompt: {
      prefix: program.prompts.positivePrefix,
      positive: program.prompts.positive,
      negative: program.prompts.negative,
    },
    batch: {
      text: batchEntry.text,
      sourceName,
      sourceStem: pathStem(sourceName),
      sourcePath,
      sourceIndex,
      loopIndex,
    },
    lora: {
      names: activeLoras.map((lora) => lora.name),
      tags: [...injectedTerms],
    },
    models: {
      unet: program.model.unetName,
      clip: program.model.clipName,
      vae: program.model.vaeName,
    },
    image: {
      width: program.parameters.width,
      height: program.parameters.height,
      batchSize: program.parameters.batchSize,
    },
    sampler: {
      name: program.parameters.samplerName,
      scheduler: program.parameters.scheduler,
      steps: program.parameters.steps,
      cfg: program.parameters.cfg,
    },
    output: {
      prefix: program.output.filenamePrefix,
      format: program.output.format,
    },
  }
}
export function createComfygureRuleFacts(
  program: ComfygureProgram,
  options: ComfygureCompileOptions,
  batchEntry: ComfygureBatchEntry,
): Readonly<Record<string, unknown>> {
  const sourceName = batchEntry.sourceName || pathBasename(batchEntry.sourcePath ?? "")
  const activationText = normalizePromptText([program.prompts.positivePrefix, batchEntry.text || program.prompts.positive].filter(Boolean).join(", "))
  const loraTags = program.loras.flatMap((lora) => [
    ...splitActivationTerms(lora.activationTerms ?? ""),
    ...splitPromptTags(lora.injectionTerms ?? "").map(normalizePromptTag).filter(Boolean),
  ])
  const facts: Record<string, unknown> = {
    "prompt.activationText": activationText,
    "batch.text": batchEntry.text,
    "batch.sourceName": sourceName,
    "batch.sourcePath": batchEntry.sourcePath ?? "",
    "batch.sourceIndex": Math.max(0, Math.trunc(options.sourceIndex ?? 0)),
    "batch.loopIndex": Math.max(0, Math.trunc(options.loopIndex ?? 0)),
    "model.unet": program.model.unetName,
    "model.clip": program.model.clipName,
    "model.vae": program.model.vaeName,
    "image.width": program.parameters.width,
    "image.height": program.parameters.height,
    "image.batchSize": program.parameters.batchSize,
    "sampler.seed": program.parameters.seed,
    "sampler.name": program.parameters.samplerName,
    "sampler.scheduler": program.parameters.scheduler,
    "sampler.steps": program.parameters.steps,
    "sampler.cfg": program.parameters.cfg,
    "sampler.denoise": program.parameters.denoise,
    "output.prefix": program.output.filenamePrefix,
    "output.format": program.output.format,
    "lora.names": Object.freeze(program.loras.map((lora) => lora.name)),
    "lora.tags": Object.freeze([...new Set(loraTags)]),
  }
  return Object.freeze(facts)
}
export function legacyLoraMatches(lora: ComfygureLora, activationText: string): boolean {
  const comparable = activationText.toLocaleLowerCase()
  const terms = splitActivationTerms(lora.activationTerms ?? "").map((term) => term.toLocaleLowerCase())
  return terms.length === 0 || terms.some((term) => comparable.includes(term))
}
export function compileAnimaInt8Program(input: ComfygureProgramDraft = {}, options: ComfygureCompileOptions = {}): CompiledProgram {
  const program = normalizeComfygureProgram(input)
  const { activeLoras, composition } = resolvePromptComposition(program, options)
  const { positivePrompt, negativePrompt, filenamePrefix } = composition
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
      filename_prefix: filenamePrefix,
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
    filenamePrefix,
    promptComposition: composition,
    ...(options.ruleResolution ? { ruleResolution: options.ruleResolution } : {}),
    requiredClasses: [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
    requiredResources,
  }
}
export function compileComfygureTemplate(template: ComfygureTemplate, input: ComfygureProgramDraft = {}, options: ComfygureCompileOptions = {}): CompiledProgram {
  if (template.format !== COMFYGURE_TEMPLATE_FORMAT) throw new Error("Unsupported Comfygure template format.")
  if (!template.bindingManifest.confirmed) throw new Error("Confirm the imported template bindings before compiling it.")
  const normalizedProgram = normalizeComfygureProgram(input)
  const program = normalizedProgram.loras.length ? normalizedProgram : { ...normalizedProgram, loras: template.defaultLoras }
  const { activeLoras, composition } = resolvePromptComposition(program, options)
  const { positivePrompt, negativePrompt, filenamePrefix } = composition
  const graph = clonePromptGraph(template.graph)
  materializeGlowTriggerLoraStacks(graph, activeLoras)
  for (const binding of template.bindingManifest.bindings) {
    const value = templateBindingValue(binding.key, program, positivePrompt, negativePrompt, filenamePrefix)
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
    filenamePrefix,
    promptComposition: composition,
    ...(options.ruleResolution ? { ruleResolution: options.ruleResolution } : {}),
    requiredClasses: [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
    requiredResources: inferGraphResourceRequirements(graph),
  }
}
export function compileAnimaInt8RunPlan(input: ComfygureProgramDraft = {}, options: ComfygureRunPlanOptions = {}): CompiledRunPlan {
  const program = normalizeComfygureProgram(input)
  const batchEntries = program.batch.entries.slice(0, program.batch.maxPrompts || undefined)
  if (batchEntries.length === 0) {
    const entry = { text: program.prompts.positive }
    const compiled = compileAnimaInt8Program(program, { ...options, batchEntry: entry })
    return {
      format: COMFYGURE_RUN_PLAN_FORMAT,
      recipe: ANIMA_INT8_RECIPE,
      program,
      jobs: [{ index: 0, sourceIndex: 0, loopIndex: 0, sourceText: program.prompts.positive, seed: program.parameters.seed, compiled }],
    }
  }

  const sequence = resolveBatchSequence(batchEntries.length, program.batch)
  const jobs = sequence.map((sourceIndex, index) => {
    const seed = resolveJobSeed(program.parameters.seed, program.parameters.seedMode, index)
    const entry = batchEntries[sourceIndex] ?? { text: "" }
    const loopIndex = Math.floor(index / batchEntries.length)
    const jobProgram: ComfygureProgramDraft = {
      ...program,
      prompts: { ...program.prompts, positive: entry.text },
      parameters: { ...program.parameters, seed },
    }
    return {
      index,
      sourceIndex,
      loopIndex,
      sourceText: entry.text,
      ...(entry.sourceName ? { sourceName: entry.sourceName } : {}),
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      seed,
      compiled: compileAnimaInt8Program(jobProgram, { ...options, jobIndex: index, sourceIndex, loopIndex, batchEntry: entry }),
    }
  })
  return { format: COMFYGURE_RUN_PLAN_FORMAT, recipe: ANIMA_INT8_RECIPE, program, jobs }
}
export function compileComfygureTemplateRunPlan(template: ComfygureTemplate, input: ComfygureProgramDraft = {}, options: ComfygureRunPlanOptions = {}): CompiledRunPlan {
  const program = normalizeComfygureProgram(input)
  const batchEntries = program.batch.entries.slice(0, program.batch.maxPrompts || undefined)
  if (batchEntries.length === 0) {
    const entry = { text: program.prompts.positive }
    const compiled = compileComfygureTemplate(template, program, { ...options, batchEntry: entry })
    return {
      format: COMFYGURE_RUN_PLAN_FORMAT,
      recipe: ANIMA_INT8_RECIPE,
      program,
      jobs: [{ index: 0, sourceIndex: 0, loopIndex: 0, sourceText: program.prompts.positive, seed: program.parameters.seed, compiled }],
    }
  }
  const sequence = resolveBatchSequence(batchEntries.length, program.batch)
  const jobs = sequence.map((sourceIndex, index) => {
    const seed = resolveJobSeed(program.parameters.seed, program.parameters.seedMode, index)
    const entry = batchEntries[sourceIndex] ?? { text: "" }
    const loopIndex = Math.floor(index / batchEntries.length)
    const jobProgram: ComfygureProgramDraft = {
      ...program,
      prompts: { ...program.prompts, positive: entry.text },
      parameters: { ...program.parameters, seed },
    }
    return {
      index,
      sourceIndex,
      loopIndex,
      sourceText: entry.text,
      ...(entry.sourceName ? { sourceName: entry.sourceName } : {}),
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      seed,
      compiled: compileComfygureTemplate(template, jobProgram, { ...options, jobIndex: index, sourceIndex, loopIndex, batchEntry: entry }),
    }
  })
  return { format: COMFYGURE_RUN_PLAN_FORMAT, recipe: ANIMA_INT8_RECIPE, program, jobs }
}
export async function compileAnimaInt8RunPlanWithRules(
  input: ComfygureProgramDraft = {},
  options: ComfygureRunPlanOptions = {},
): Promise<CompiledRunPlan> {
  return await compileRunPlanWithRules(normalizeComfygureProgram(input), options, (program, compileOptions) => compileAnimaInt8Program(program, compileOptions))
}
export async function compileComfygureTemplateRunPlanWithRules(
  template: ComfygureTemplate,
  input: ComfygureProgramDraft = {},
  options: ComfygureRunPlanOptions = {},
): Promise<CompiledRunPlan> {
  const normalized = normalizeComfygureProgram(input)
  const program = normalized.loras.length ? normalized : { ...normalized, loras: template.defaultLoras }
  return await compileRunPlanWithRules(program, options, (jobProgram, compileOptions) => compileComfygureTemplate(template, jobProgram, compileOptions))
}
export async function compileRunPlanWithRules(
  program: ComfygureProgram,
  options: ComfygureRunPlanOptions,
  compile: (program: ComfygureProgram, options: ComfygureCompileOptions) => CompiledProgram,
): Promise<CompiledRunPlan> {
  const batchEntries = program.batch.entries.slice(0, program.batch.maxPrompts || undefined)
  if (batchEntries.length === 0) {
    const entry = { text: program.prompts.positive }
    const compileOptions = { ...options, batchEntry: entry }
    const ruleResolution = await resolveComfygureRules(program, compileOptions)
    const compiled = compile(program, { ...compileOptions, ruleResolution })
    return {
      format: COMFYGURE_RUN_PLAN_FORMAT,
      recipe: ANIMA_INT8_RECIPE,
      program,
      jobs: [{ index: 0, sourceIndex: 0, loopIndex: 0, sourceText: program.prompts.positive, seed: program.parameters.seed, compiled }],
    }
  }

  const sequence = resolveBatchSequence(batchEntries.length, program.batch)
  const jobs: CompiledGenerationJob[] = []
  for (const [index, sourceIndex] of sequence.entries()) {
    const seed = resolveJobSeed(program.parameters.seed, program.parameters.seedMode, index)
    const entry = batchEntries[sourceIndex] ?? { text: "" }
    const loopIndex = Math.floor(index / batchEntries.length)
    const jobProgram = normalizeComfygureProgram({
      ...program,
      prompts: { ...program.prompts, positive: entry.text },
      parameters: { ...program.parameters, seed },
    })
    const compileOptions = { ...options, jobIndex: index, sourceIndex, loopIndex, batchEntry: entry }
    const ruleResolution = await resolveComfygureRules(jobProgram, compileOptions)
    jobs.push({
      index,
      sourceIndex,
      loopIndex,
      sourceText: entry.text,
      ...(entry.sourceName ? { sourceName: entry.sourceName } : {}),
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      seed,
      compiled: compile(jobProgram, { ...compileOptions, ruleResolution }),
    })
  }
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
export function templateBindingValue(key: ComfygureBindingKey, program: ComfygureProgram, positivePrompt: string, negativePrompt: string, filenamePrefix: string): PromptInput {
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
    case "filenamePrefix": return filenamePrefix
    case "outputFormat": return program.output.format
    case "outputQuality": return program.output.quality
    case "outputPreview": return program.output.preview
  }
}
export function applyTemplateLoras(graph: PromptGraph, activeLoras: readonly ComfygureLora[]): void {
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
export function inferGraphResourceRequirements(graph: PromptGraph): readonly ResourceRequirement[] {
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
export function materializeGlowTriggerLoraStacks(graph: PromptGraph, activeLoras: readonly ComfygureLora[]): void {
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
export function materializeStaticCompileTimeNodes(graph: PromptGraph): void {
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
export function resolveGlowDynamicOutput(node: PromptNode, outputIndex: number, graph: PromptGraph, visited: Set<string>): PromptInput | undefined {
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
export function resolveStaticPromptInput(value: PromptInput | undefined, graph: PromptGraph, visited: Set<string>): PromptInput | undefined {
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
export function coerceGlowDefaultValue(type: string, raw: PromptInput | undefined): PromptInput {
  const value = raw === null || raw === undefined ? "" : raw
  if (type === "STRING" || type === "COMBO") return String(value)
  if (type === "INT") return integerPromptInput(value, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  if (type === "FLOAT") return numberPromptInput(value, 0)
  if (type === "BOOLEAN") return booleanPromptInput(value, false)
  return null
}
export function prunePromptGraphToOutputNodes(graph: PromptGraph): void {
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
export function resolveJobSeed(baseSeed: number, mode: "fixed" | "increment", jobIndex: number): number {
  if (mode === "fixed") return baseSeed
  return Math.min(Number.MAX_SAFE_INTEGER, baseSeed + jobIndex)
}
export function createSeededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}
export function shuffleIndices(indices: readonly number[], random: () => number): number[] {
  const shuffled = [...indices]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!]
  }
  return shuffled
}
export function ensurePromptTerms(value: string, terms: readonly string[]): string {
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
export function splitActivationTerms(value: string): string[] {
  return value.split(/[\n,，、|;；]+/).map((term) => term.trim()).filter(Boolean)
}
export function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
