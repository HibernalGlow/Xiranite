import type { ComponentInstance } from "@/types/workspace"

const DRY_RUN_MODULE_IDS = new Set([
  "audiov", "bandia", "bitv", "classf", "classq", "coveru", "crashu", "diny", "enginev",
  "envuconfig", "formatv", "gifu", "jellypot", "kavvka", "marku", "migratef", "movea",
  "mvz", "nameu", "rawfilter", "repacku", "scoolp", "seriex", "simiu", "smartzip",
  "snf", "synct", "timeu", "trename",
])

const PREVIEW_MODULE_IDS = new Set(["dissolvef", "transq"])

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
