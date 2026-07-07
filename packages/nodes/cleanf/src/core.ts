import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type CleanfItemType = "file" | "dir"
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
}

export interface CleanfRuntime {
  scanPath: (path: string) => Promise<CleanfItem[]>
  removeTargets: (targets: CleanfTarget[]) => Promise<{ removed: number; skipped: number }>
}

export type CleanfResult = NodeRunResult<CleanfData>

export const CLEANING_PRESETS: Record<string, CleanfPreset> = {
  empty_folders: {
    id: "empty_folders",
    name: "Empty folders",
    description: "Recursively remove empty folders.",
    functionName: "remove_empty_folders",
    enabled: true,
  },
  backup_files: {
    id: "backup_files",
    name: "Backup files",
    description: "Remove .bak backup files.",
    functionName: "remove_backup_and_temp",
    patterns: [{ pattern: String.raw`.*\.bak$`, type: "file", description: "Backup file" }],
    enabled: true,
  },
  temp_folders: {
    id: "temp_folders",
    name: "Temp folders",
    description: "Remove folders whose names start with temp_.",
    functionName: "remove_backup_and_temp",
    patterns: [{ pattern: String.raw`^temp_.*$`, type: "dir", description: "Temp folder" }],
    enabled: true,
  },
  trash_files: {
    id: "trash_files",
    name: "Trash files",
    description: "Remove .trash files and folders.",
    functionName: "remove_backup_and_temp",
    patterns: [{ pattern: String.raw`.*\.trash$`, type: "both", description: "Trash item" }],
    enabled: true,
  },
  hb_txt_files: {
    id: "hb_txt_files",
    name: "[#hb] text",
    description: "Remove txt files whose names start with [#hb].",
    functionName: "remove_backup_and_temp",
    patterns: [{ pattern: String.raw`^\[#hb\].*\.txt$`, type: "file", description: "[#hb] text file" }],
    enabled: true,
  },
  log_files: {
    id: "log_files",
    name: "Log files",
    description: "Remove common log files.",
    functionName: "remove_backup_and_temp",
    patterns: [
      { pattern: String.raw`.*\.log$`, type: "file", description: "Log file" },
      { pattern: String.raw`.*\.log\.\d+$`, type: "file", description: "Rotated log file" },
    ],
    enabled: false,
  },
  upscale: {
    id: "upscale",
    name: "Upscale files",
    description: "Remove .upbak files.",
    functionName: "remove_backup_and_temp",
    patterns: [{ pattern: String.raw`.*\.upbak$`, type: "file", description: "upbak file" }],
    enabled: false,
  },
}

export interface CleanfPresetCombination {
  id: string
  name: string
  description: string
  presets: CleanfPresetId[]
}

export const PRESET_COMBINATIONS: CleanfPresetCombination[] = [
  {
    id: "advanced",
    name: "高级清理",
    description: "标准清理 + [#hb]文本文件",
    presets: ["empty_folders", "backup_files", "temp_folders", "trash_files", "hb_txt_files"],
  },
  {
    id: "upscale",
    name: "upscale 环境清理",
    description: "包含日志与 upscale 缓存清理（谨慎使用）",
    presets: ["empty_folders", "backup_files", "temp_folders", "trash_files", "hb_txt_files", "log_files", "upscale"],
  },
  {
    id: "complete",
    name: "完整清理",
    description: "包含所有清理项目（谨慎使用）",
    presets: Object.keys(CLEANING_PRESETS),
  },
]

export function parseCleanfPaths(textOrPaths: string | string[] | undefined): string[] {
  const values = Array.isArray(textOrPaths) ? textOrPaths : (textOrPaths ?? "").split(/\r?\n|;/)
  return values.map((path) => path.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
}

export function parseExcludeKeywords(exclude?: string): string[] {
  return (exclude ?? "").split(",").map((value) => value.trim()).filter(Boolean)
}

export function getDefaultPresets(): CleanfPresetId[] {
  return Object.values(CLEANING_PRESETS).filter((preset) => preset.enabled).map((preset) => preset.id)
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

export function sortTargetsForRemoval(targets: CleanfTarget[]): CleanfTarget[] {
  return [...targets].sort((a, b) => b.depth - a.depth || b.path.length - a.path.length)
}

export async function runCleanf(
  input: CleanfInput,
  runtime: CleanfRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<CleanfResult> {
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
    message: `Cleanup completed, removed ${removed.removed} item(s).`,
    data: { totalRemoved: removed.removed, removedDetails: details, previewFiles: [], skipped: removed.skipped },
  }
}

function emptyData(): CleanfData {
  return { totalRemoved: 0, removedDetails: {}, previewFiles: [], skipped: 0 }
}
