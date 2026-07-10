import type { ComponentInstance } from "@/types/workspace"

const DRY_RUN_MODULE_IDS = new Set([
  "audiov", "bandia", "bitv", "classf", "classq", "coveru", "crashu", "diny", "enginev",
  "envuconfig", "formatv", "gifu", "jellypot", "kavvka", "marku", "migratef", "movea",
  "mvz", "nameu", "rawfilter", "repacku", "scoolp", "seriex", "simiu", "smartzip",
  "snf", "synct", "timeu", "trename",
])

const PREVIEW_MODULE_IDS = new Set(["dissolvef", "transq"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function getHazardDisablePatch(component: ComponentInstance): Record<string, false> | null {
  if (component.moduleId === "cleanf") {
    return component.data?.previewMode === false ? null : { previewMode: false }
  }

  if (PREVIEW_MODULE_IDS.has(component.moduleId)) {
    return component.data?.preview === false ? null : { preview: false }
  }

  if (DRY_RUN_MODULE_IDS.has(component.moduleId) || component.data?.dryRun !== undefined) {
    return component.data?.dryRun === false ? null : { dryRun: false }
  }

  return null
}

export function countHazardAffectedNodes(components: ComponentInstance[]): number {
  return components.filter((component) => getHazardDisablePatch(component) !== null).length
}

export function resolveHazardComponentData(
  component: ComponentInstance | undefined,
  enabled: boolean,
): Record<string, unknown> | undefined {
  if (!component || !enabled) return component?.data
  const patch = getHazardDisablePatch(component)
  return patch ? { ...component.data, ...patch } : component.data
}

export function disableAllNodeDryRuns(
  components: ComponentInstance[],
  patchComponentData: (id: string, patch: Record<string, unknown>) => void,
): number {
  let changed = 0

  for (const component of components) {
    const patch = getHazardDisablePatch(component)
    if (!patch) continue
    patchComponentData(component.id, patch)
    changed += 1
  }

  return changed
}

/**
 * Final execution boundary for Hazard mode. Node UIs may hold a render-time
 * snapshot of their form state, so enforcing the policy here guarantees that
 * an already-mounted node cannot send a dry-run payload after Hazard is armed.
 */
export function applyHazardRunPolicy<TInput>(
  nodeId: string | undefined,
  input: TInput,
  enabled: boolean,
): TInput {
  if (!enabled || !nodeId || !isRecord(input)) return input

  if (nodeId === "cleanf") {
    return { ...input, preview: false } as TInput
  }

  if (PREVIEW_MODULE_IDS.has(nodeId)) {
    return { ...input, preview: false } as TInput
  }

  if (DRY_RUN_MODULE_IDS.has(nodeId) || typeof input.dryRun === "boolean") {
    return { ...input, dryRun: false } as TInput
  }

  return input
}
