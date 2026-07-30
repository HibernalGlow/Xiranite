import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  ComfygureData,
  ComfygureInput,
  ComfygureProgramDraft,
  ComfygureRuntime,
  ComfygureTarget,
  ComfyuiPromptHistory,
  ComfyuiSubmission,
  CompiledProgram,
  CompiledRunPlan,
  ResourceRequirement,
} from "./contracts.js"
import { optionalString, stringValue } from "./value-normalization.js"
import { importComfyuiWorkflow, workflowError } from "./workflow-import.js"
import { exportComfygureCanvas } from "./canvas-export.js"
import { createComfygureProfile, normalizeProfileId } from "./profiles.js"
import { preflightComfyuiTarget, submitComfyuiPrompt, readComfyuiPromptHistory, extractComfygureControlOptions, readComfyuiObjectInfo } from "./comfyui-client.js"
import { compileAnimaInt8RunPlanWithRules, compileComfygureTemplateRunPlanWithRules } from "./compiler.js"
export { resolveActiveLoras, createComfygureLoraRule, resolveComfygureRules, compileAnimaInt8Program, compileComfygureTemplate, compileAnimaInt8RunPlan, compileComfygureTemplateRunPlan, compileAnimaInt8RunPlanWithRules, compileComfygureTemplateRunPlanWithRules, resolveBatchSequence } from "./compiler.js"

export { parseComfygureVisualTemplate, serializeComfygureVisualTemplate } from "./template-engine.js"
export { preflightComfyuiTarget, submitComfyuiPrompt, readComfyuiPromptHistory, createComfyuiImageUrl, normalizeComfyuiEndpoint, extractComfygureControlOptions } from "./comfyui-client.js"
export { createComfygureProfile, normalizeComfygureProfile, resolveComfygureProfile, summarizeComfygureProfile } from "./profiles.js"
export { DEFAULT_COMFYGURE_PROGRAM, normalizeComfygureProgram, normalizePromptText } from "./program-normalization.js"
export { exportComfygureCanvas } from "./canvas-export.js"
export { importComfyuiWorkflow, confirmComfygureTemplateBindings, inferComfygureBindingManifest } from "./workflow-import.js"
export { compressComfygureText, decompressComfygureText } from "./compressed-text.js"

export {
  ANIMA_INT8_RECIPE,
  COMFYGURE_BINDING_MANIFEST_FORMAT,
  COMFYGURE_ENABLE_LORA_EFFECT,
  COMFYGURE_FORMAT,
  COMFYGURE_PROFILE_FORMAT,
  COMFYGURE_RULE_FACTS,
  COMFYGURE_RUN_PLAN_FORMAT,
  COMFYGURE_TEMPLATE_FORMAT,
  COMFYGURE_TEMPLATE_VARIABLES,
  DEFAULT_COMFYUI_ENDPOINT,
  DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS,
  DEFAULT_NEGATIVE_TEMPLATE,
  DEFAULT_OUTPUT_PREFIX_TEMPLATE,
  DEFAULT_POSITIVE_TEMPLATE,
} from "./contracts.js"
export type {
  ComfygureBatch,
  ComfygureBatchEntry,
  ComfygureBinding,
  ComfygureBindingKey,
  ComfygureBindingManifest,
  ComfygureBindingTarget,
  ComfygureCanvasExport,
  ComfygureCanvasExportOptions,
  ComfygureCanvasGroup,
  ComfygureCanvasLink,
  ComfygureCanvasNode,
  ComfygureCompileOptions,
  ComfygureCompressedText,
  ComfygureControlOptions,
  ComfygureData,
  ComfygureEnableLoraEffect,
  ComfygureFetchResponse,
  ComfygureInput,
  ComfygureLora,
  ComfygureProfile,
  ComfygureProfileProgram,
  ComfygureProfileStore,
  ComfygureProfileSummary,
  ComfygureProgram,
  ComfygureProgramDraft,
  ComfygurePromptComposition,
  ComfygureRuleEffect,
  ComfygureRuleFactDefinition,
  ComfygureRulePolicy,
  ComfygureRuleResolution,
  ComfygureRunPlanOptions,
  ComfygureRuntime,
  ComfygureTarget,
  ComfygureTargetAdapter,
  ComfygureTemplate,
  ComfygureTemplatePart,
  ComfygureTemplateVariable,
  ComfygureVisualTemplate,
  ComfygureWorkflowDiagnostic,
  ComfygureWorkflowImport,
  ComfygureWorkflowImportOptions,
  ComfyuiOutputImage,
  ComfyuiPromptHistory,
  ComfyuiSubmission,
  ComfyuiWorkflowSourceFormat,
  CompiledGenerationJob,
  CompiledProgram,
  CompiledRunPlan,
  PreflightReport,
  PromptGraph,
  PromptInput,
  PromptLink,
  PromptNode,
  PromptPrimitive,
  ResourceRequirement,
} from "./contracts.js"

export async function runComfygure(input: ComfygureInput, runtime: ComfygureRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<NodeRunResult<ComfygureData>> {
  const program = await hydrateLoraTriggers(input.program, input.target, runtime)
  const runId = optionalString(input.runId) ?? (input.action === "submit" ? formatComfygureRunId(runtime.now?.() ?? new Date()) : "preview")
  let runPlan: CompiledRunPlan
  try {
    runPlan = input.template
      ? await compileComfygureTemplateRunPlanWithRules(input.template, program, { runId })
      : await compileAnimaInt8RunPlanWithRules(program, { runId })
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
  const compiled = runPlan.jobs[0]!.compiled
  if (input.action === "profiles" || input.action === "saveProfile" || input.action === "loadProfile") {
    const store = runtime.profileStore
    if (!store) return { success: false, message: "The local Comfygure profile store is unavailable.", data: { compiled, runPlan } }
    const profileLibraryPath = input.target?.profileLibraryPath
    try {
      if (input.action === "profiles") {
        const profiles = await store.list(profileLibraryPath)
        return { success: true, message: `Loaded ${profiles.length} Comfygure profile(s).`, data: { compiled, runPlan, profiles } }
      }
      const profileId = normalizeProfileId(input.profileId ?? "")
      if (input.action === "loadProfile") {
        if (!profileId) return { success: false, message: "Select a Comfygure profile to load.", data: { compiled, runPlan } }
        const profile = await store.read(profileId, profileLibraryPath)
        return profile
          ? { success: true, message: `Loaded profile ${profile.name}.`, data: { compiled, runPlan, profile } }
          : { success: false, message: `Comfygure profile ${profileId} was not found.`, data: { compiled, runPlan } }
      }
      const previous = profileId ? await store.read(profileId, profileLibraryPath) : undefined
      const profile = createComfygureProfile(runPlan.program, input.profileName ?? runPlan.program.name, { id: profileId || undefined, previous, now: runtime.now?.() })
      const saved = await store.save(profile, profileLibraryPath)
      return { success: true, message: `Saved profile ${saved.name} (revision ${saved.revision}).`, data: { compiled, runPlan, profile: saved } }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error), data: { compiled, runPlan } }
    }
  }
  if (input.action === "options") {
    onEvent({ type: "progress", progress: 20, message: "Reading sampler options from the local ComfyUI target." })
    try {
      const objectInfo = await readComfyuiObjectInfo(input.target ?? {}, runtime)
      const controlOptions = extractComfygureControlOptions(objectInfo)
      onEvent({ type: "progress", progress: 100, message: "ComfyUI sampler options loaded." })
      return { success: true, message: `Loaded ${controlOptions.samplerNames.length} sampler(s) and ${controlOptions.schedulers.length} scheduler(s).`, data: { compiled, runPlan, controlOptions } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onEvent({ type: "progress", progress: 100, message: "Could not load ComfyUI sampler options." })
      return { success: false, message, data: { compiled, runPlan } }
    }
  }
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
  if (input.action === "canvas") {
    onEvent({ type: "progress", progress: 20, message: "Reading local ComfyUI node definitions for the canvas export." })
    let objectInfo: Record<string, unknown> | undefined
    let objectInfoError: string | undefined
    try {
      objectInfo = await readComfyuiObjectInfo(input.target ?? {}, runtime)
    } catch (error) {
      objectInfoError = error instanceof Error ? error.message : String(error)
    }
    const canvas = exportComfygureCanvas(compiled.graph, { objectInfo })
    onEvent({ type: "progress", progress: 100, message: "ComfyUI canvas export complete." })
    return {
      success: true,
      message: objectInfoError
        ? `Exported a diagnostic canvas without local /object_info: ${objectInfoError}`
        : `Exported ${canvas.nodes.length} fixed node(s) as a ComfyUI canvas.`,
      data: { compiled, runPlan, canvas },
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
    return { success: false, message, data: { compiled, runPlan, preflight, controlOptions: preflight.controlOptions } }
  }
  if (input.action === "preflight") {
    onEvent({ type: "progress", progress: 100, message: "Compatibility preflight complete." })
    return { success: true, message: "Compatibility preflight passed. No generation was submitted.", data: { compiled, runPlan, preflight, controlOptions: preflight.controlOptions } }
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
    return { success: true, message, data: { compiled, runPlan, preflight, controlOptions: preflight.controlOptions, submission: submissions[0], submissions } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent({ type: "progress", progress: 100, message: "ComfyUI rejected the prompt graph." })
    return { success: false, message, data: { compiled, runPlan, preflight, controlOptions: preflight.controlOptions, submission: submissions[0], submissions } }
  }
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

function formatComfygureRunId(value: Date): string {
  const date = Number.isNaN(value.getTime()) ? new Date(0) : value
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
