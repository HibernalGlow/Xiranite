import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { sortTargetsForRemoval } from "./ordering.js"
import { parseCleanfPaths } from "./paths.js"
import { CLEANING_PRESETS, getDefaultPresets } from "./presets.js"

export type CleanfItemType = "file" | "dir"
export type CleanfAction = "clean" | "undo"
export type CleanfPresetId =
  | "empty_folders"
  | "backup_files"
  | "temp_folders"
  | "trash_files"
  | "hb_txt_files"
  | "log_files"
  | "upscale"
  | string

export interface CleanfInput {
  action?: CleanfAction
  paths?: string[]
  presets?: CleanfPresetId[]
  exclude?: string
  preview?: boolean
}

export interface CleanfItem {
  path: string
  name: string
  type: CleanfItemType
  parentPath: string | null
  depth: number
}

export interface CleanfPattern {
  pattern: string
  type: CleanfItemType | "both"
  description: string
}

export interface CleanfPreset {
  id: CleanfPresetId
  name: string
  description: string
  functionName: "remove_empty_folders" | "remove_backup_and_temp"
  patterns?: CleanfPattern[]
  enabled: boolean
}

export interface CleanfTarget {
  path: string
  name: string
  type: CleanfItemType
  preset: CleanfPresetId
  reason: string
  depth: number
}

export interface CleanfPlan {
  targets: CleanfTarget[]
  removedDetails: Record<string, number>
}

export interface CleanfData {
  totalRemoved: number
  removedDetails: Record<string, number>
  previewFiles: string[]
  skipped: number
  restored?: number
  undoAvailable?: boolean
  undoBatchCount?: number
  undoPersistent?: boolean
}

export interface CleanfRemovalResult {
  removed: number
  skipped: number
  undoable?: number
  undoBatchCount?: number
  undoPersistent?: boolean
}

export interface CleanfUndoResult {
  succeeded: number
  failed: number
}

export interface CleanfUndoState {
  available: boolean
  count: number
  persistent: boolean
}

export interface CleanfRuntime {
  scanPath: (path: string) => Promise<CleanfItem[]>
  removeTargets: (targets: CleanfTarget[]) => Promise<CleanfRemovalResult>
  undoLatest?: () => Promise<CleanfUndoResult>
  undoState?: () => CleanfUndoState
}

export type CleanfResult = NodeRunResult<CleanfData>

export interface CleanfPresetCombination {
  id: string
  name: string
  description: string
  presets: CleanfPresetId[]
}

/** The preset catalog lives in `presets.ts` and is forwarded here under the same names: `planCleanf` below keeps
 * reading one table, while `interaction.ts` — which `cli.ts` loads — reads that module instead of value-importing
 * this one, because a core value import evaluates the whole engine in the face process (ADR-0074 §5). */
export { CLEANING_PRESETS, PRESET_COMBINATIONS, getDefaultPresets } from "./presets.js"

/** `paths.ts` holds the one implementation; the GUI face reads it through `@xiranite/node-cleanf/paths` because
 * a value import of this module would put a second execution host in the browser chunk (ADR-0074 §5). */
export { parseCleanfPaths } from "./paths.js"

export function parseExcludeKeywords(exclude?: string): string[] {
  return (exclude ?? "").split(",").map((value) => value.trim()).filter(Boolean)
}

export function isExcluded(path: string, keywords: string[]): boolean {
  return keywords.some((keyword) => path.includes(keyword))
}

export function matchesPattern(item: CleanfItem, rule: CleanfPattern): boolean {
  if (rule.type !== "both" && rule.type !== item.type) return false
  return new RegExp(rule.pattern, "i").test(item.name)
}

export function planCleanf(items: CleanfItem[], input: CleanfInput): CleanfPlan {
  const presetIds = input.presets?.length ? input.presets : getDefaultPresets()
  const excludeKeywords = parseExcludeKeywords(input.exclude)
  const selected = presetIds.map((id) => CLEANING_PRESETS[id]).filter(Boolean)
  const targets: CleanfTarget[] = []
  const scheduled = new Set<string>()
  const childrenByParent = new Map<string, CleanfItem[]>()

  for (const item of items) {
    if (!item.parentPath) continue
    const children = childrenByParent.get(item.parentPath) ?? []
    children.push(item)
    childrenByParent.set(item.parentPath, children)
  }

  const addTarget = (item: CleanfItem, preset: CleanfPreset, reason: string) => {
    if (scheduled.has(item.path) || isExcluded(item.path, excludeKeywords)) return
    scheduled.add(item.path)
    targets.push({ path: item.path, name: item.name, type: item.type, preset: preset.id, reason, depth: item.depth })
  }

  for (const preset of selected) {
    if (preset.functionName !== "remove_backup_and_temp") continue
    for (const item of items) {
      const rule = preset.patterns?.find((pattern) => matchesPattern(item, pattern))
      if (rule) addTarget(item, preset, rule.description)
    }
  }

  const emptyPreset = selected.find((preset) => preset.id === "empty_folders")
  if (emptyPreset) {
    const dirs = items.filter((item) => item.type === "dir").sort((a, b) => b.depth - a.depth)
    for (const dir of dirs) {
      if (scheduled.has(dir.path) || isExcluded(dir.path, excludeKeywords)) continue
      const children = childrenByParent.get(dir.path) ?? []
      if (children.every((child) => scheduled.has(child.path))) {
        addTarget(dir, emptyPreset, "Empty folder")
      }
    }
  }

  const removedDetails: Record<string, number> = {}
  for (const target of targets) {
    removedDetails[target.preset] = (removedDetails[target.preset] ?? 0) + 1
  }

  return { targets: sortTargetsForRemoval(targets), removedDetails }
}

/** `ordering.ts` holds the one implementation and `platform.ts` reads it there, for the same reason as the catalog
 * above: the machine half must not value-import core to order its own batches (ADR-0074 §5). */
export { sortTargetsForRemoval } from "./ordering.js"

export async function runCleanf(
  input: CleanfInput,
  runtime: CleanfRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<CleanfResult> {
  if (input.action === "undo") return undoCleanf(runtime, onEvent)

  const paths = parseCleanfPaths(input.paths)
  if (!paths.length) {
    return { success: false, message: "No valid paths provided.", data: emptyData() }
  }

  const allTargets: CleanfTarget[] = []
  const details: Record<string, number> = {}

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    onEvent({ type: "progress", progress: Math.round((index / paths.length) * 40), message: `Scanning ${path}` })
    const items = await runtime.scanPath(path)
    const plan = planCleanf(items, input)
    allTargets.push(...plan.targets)
    for (const [key, value] of Object.entries(plan.removedDetails)) {
      details[key] = (details[key] ?? 0) + value
    }
  }

  if (input.preview) {
    onEvent({ type: "progress", progress: 100, message: `Preview found ${allTargets.length} item(s).` })
    return {
      success: true,
      message: `Preview completed, found ${allTargets.length} item(s).`,
      data: { totalRemoved: allTargets.length, removedDetails: details, previewFiles: allTargets.map((target) => target.path), skipped: 0 },
    }
  }

  onEvent({ type: "progress", progress: 70, message: `Removing ${allTargets.length} item(s).` })
  const removed = await runtime.removeTargets(allTargets)
  onEvent({ type: "progress", progress: 100, message: "Cleanup completed." })

  return {
    success: true,
    message: `Cleanup completed, moved ${removed.removed} item(s) to the recycle bin.`,
    data: {
      totalRemoved: removed.removed,
      removedDetails: details,
      previewFiles: [],
      skipped: removed.skipped,
      undoAvailable: Boolean(removed.undoable),
      undoBatchCount: removed.undoBatchCount,
      undoPersistent: removed.undoPersistent,
    },
  }
}

async function undoCleanf(
  runtime: CleanfRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<CleanfResult> {
  if (!runtime.undoLatest) {
    return { success: false, message: "Cleanf undo is unavailable in this runtime.", data: emptyData() }
  }

  onEvent({ type: "progress", progress: 10, message: "Restoring the latest Cleanf cleanup batch." })
  const restored = await runtime.undoLatest()
  const state = runtime.undoState?.()
  onEvent({ type: "progress", progress: 100, message: `Restored ${restored.succeeded} item(s).` })
  const data: CleanfData = {
    ...emptyData(),
    restored: restored.succeeded,
    skipped: restored.failed,
    undoAvailable: state?.available ?? false,
    undoBatchCount: state?.count,
    undoPersistent: state?.persistent,
  }
  if (restored.failed) {
    return {
      success: false,
      message: `Undo restored ${restored.succeeded} item(s) and failed for ${restored.failed} item(s).`,
      data,
    }
  }
  if (!restored.succeeded) {
    return { success: true, message: "No Cleanf cleanup batch is available to undo.", data }
  }
  const suffix = state?.available ? ` ${state.count} earlier batch(es) remain available.` : ""
  return { success: true, message: `Undo completed, restored ${restored.succeeded} item(s).${suffix}`, data }
}

function emptyData(): CleanfData {
  return { totalRemoved: 0, removedDetails: {}, previewFiles: [], skipped: 0 }
}
