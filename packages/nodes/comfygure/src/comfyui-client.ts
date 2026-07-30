import { DEFAULT_COMFYUI_ENDPOINT, DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS } from "./contracts.js"
import type { ComfygureControlOptions, ComfygureRuntime, ComfygureTarget, ComfygureFetchResponse, ComfyuiOutputImage, ComfyuiPromptHistory, ComfyuiSubmission, CompiledProgram, PreflightReport, ResourceRequirement } from "./contracts.js"
import { stringValue, isRecord } from "./value-normalization.js"

export async function preflightComfyuiTarget(compiled: Pick<CompiledProgram, "requiredClasses" | "requiredResources">, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<PreflightReport> {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  let objectInfo: Record<string, unknown>
  try {
    objectInfo = await readComfyuiObjectInfo(target, runtime)
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
  const controlOptions = extractComfygureControlOptions(objectInfo)
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
    controlOptions,
  }
}
export async function submitComfyuiPrompt(compiled: CompiledProgram, target: ComfygureTarget, runtime: ComfygureRuntime): Promise<ComfyuiSubmission> {
  if (runtime.targetAdapter) return await runtime.targetAdapter.submitPrompt(compiled, target)
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
  if (runtime.targetAdapter) return await runtime.targetAdapter.readPromptHistory(promptId, target)
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
export function extractHistoryImages(entry: Record<string, unknown>, endpoint: string): readonly ComfyuiOutputImage[] {
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
export function historyError(status: Record<string, unknown> | undefined): string {
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
export function resourceChoices(nodeInfo: Record<string, unknown>, inputName: string): readonly string[] | undefined {
  const input = isRecord(nodeInfo.input) ? nodeInfo.input : undefined
  const required = input && isRecord(input.required) ? input.required : undefined
  const widget = required?.[inputName]
  if (!Array.isArray(widget) || !Array.isArray(widget[0])) return undefined
  return widget[0].filter((value): value is string => typeof value === "string")
}
export function extractComfygureControlOptions(objectInfo: Record<string, unknown>): ComfygureControlOptions {
  const samplerNames = new Set<string>()
  const schedulers = new Set<string>()
  const sourceNodeTypes = new Set<string>()
  for (const [classType, definitionValue] of Object.entries(objectInfo)) {
    if (!isRecord(definitionValue) || !isRecord(definitionValue.input)) continue
    const input = definitionValue.input
    for (const sectionName of ["required", "optional"] as const) {
      const section = isRecord(input[sectionName]) ? input[sectionName] : undefined
      if (!section) continue
      const samplerValues = comboChoices(section.sampler_name)
      const schedulerValues = comboChoices(section.scheduler)
      if (samplerValues.length) samplerValues.forEach((value) => samplerNames.add(value))
      if (schedulerValues.length) schedulerValues.forEach((value) => schedulers.add(value))
      if (samplerValues.length || schedulerValues.length) sourceNodeTypes.add(classType)
    }
  }
  return { samplerNames: [...samplerNames], schedulers: [...schedulers], sourceNodeTypes: [...sourceNodeTypes] }
}
export function comboChoices(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return []
  return value[0].filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
}
export function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname.toLocaleLowerCase() === "localhost"
}
export function describeComfyuiPromptError(value: unknown): string {
  if (!isRecord(value)) return ""
  const error = typeof value.error === "string" ? value.error : undefined
  const nodeErrors = isRecord(value.node_errors) ? Object.keys(value.node_errors) : []
  if (error) return `: ${error}`
  return nodeErrors.length ? `: node validation failed for ${nodeErrors.join(", ")}` : ""
}
export async function fetchComfyui(
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
export async function readComfyuiObjectInfo(target: ComfygureTarget, runtime: ComfygureRuntime): Promise<Record<string, unknown>> {
  if (runtime.targetAdapter) return await runtime.targetAdapter.readObjectInfo(target)
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  const response = await fetchComfyui(runtime, `${endpoint}/object_info`, { method: "GET", headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (!isRecord(payload)) throw new Error("/object_info did not return a node map.")
  return payload
}
