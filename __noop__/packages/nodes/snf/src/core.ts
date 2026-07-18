import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SnfAction = "scan" | "plan" | "rename"
export type SnfMode = "library" | "artist"
export type SnfPlanStatus = "ready" | "unchanged" | "skipped" | "renamed" | "conflict" | "error"

export interface SnfInput {
  action?: SnfAction
  path?: string
  paths?: string[]
  listText?: string
  mode?: SnfMode
  keepTimestamp?: boolean
  dryRun?: boolean
  priorityKeywords?: string[]
}

export interface SnfDirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface SnfPathInfo {
  path: string
  exists: boolean
  isDirectory: boolean
  atimeMs: number
  mtimeMs: number
}

export interface SnfPlanItem {
  artistPath: string
  sourcePath: string
  targetPath: string
  sourceName: string
  targetName: string
  sequence?: number
  status: SnfPlanStatus
  reason?: string
}

export interface SnfData {
  action: SnfAction
  mode: SnfMode
  items: SnfPlanItem[]
  artistCount: number
  scannedCount: number
  readyCount: number
  renamedCount: number
  unchangedCount: number
  skippedCount: number
  conflictCount: number
  errorCount: number
  errors: string[]
}

export interface SnfRuntime {
  pathInfo: (path: string) => Promise<SnfPathInfo>
  listDir: (path: string) => Promise<SnfDirEntry[]>
  rename: (from: string, to: string) => Promise<void>
  setTimes: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export type SnfResult = NodeRunResult<SnfData>

const DEFAULT_PRIORITY_KEYWORDS = ["同人志", "商业", "单行", "CG", "画集"] as const

export function normalizeSnfInput(input: SnfInput): Required<SnfInput> {
  return {
    action: input.action ?? "plan",
    path: clean(input.path),
    paths: uniqueClean([input.path, ...(input.paths ?? []), ...parseList(input.listText)]),
    listText: input.listText ?? "",
    mode: input.mode ?? "library",
    keepTimestamp: input.keepTimestamp ?? true,
    dryRun: input.dryRun ?? true,
    priorityKeywords: input.priorityKeywords?.length ? input.priorityKeywords : [...DEFAULT_PRIORITY_KEYWORDS],
  }
}

export async function runSnf(input: SnfInput, runtime: SnfRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<SnfResult> {
  const normalized = normalizeSnfInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one library or artist folder is required.", normalized)
    onEvent({ type: "progress", progress: 20, message: "Scanning numbered folders." })
    const artistFolders = await collectArtistFolders(normalized, runtime)
    const plan: SnfPlanItem[] = []
    for (const artistPath of artistFolders) plan.push(...await planArtistFolder(artistPath, normalized, runtime))

    if (normalized.action !== "rename" || normalized.dryRun) return success(`SNF planned ${plan.length} item(s).`, data(normalized, artistFolders.length, plan))

    onEvent({ type: "progress", progress: 70, message: "Renaming sequence folders." })
    const applied: SnfPlanItem[] = []
    for (const item of plan) {
      if (item.status !== "ready") {
        applied.push(item)
        continue
      }
      try {
        const info = await runtime.pathInfo(item.sourcePath)
        await runtime.rename(item.sourcePath, item.targetPath)
        if (normalized.keepTimestamp) await runtime.setTimes(item.targetPath, info.atimeMs, info.mtimeMs)
        applied.push({ ...item, status: "renamed" })
      } catch (error) {
        applied.push({ ...item, status: "error", reason: errorMessage(error) })
      }
    }
    return success(`SNF renamed ${applied.filter((item) => item.status === "renamed").length} folder(s).`, data(normalized, artistFolders.length, applied))
  } catch (error) {
    return failure(errorMessage(error), normalized)
  }
}

async function collectArtistFolders(input: Required<SnfInput>, runtime: SnfRuntime): Promise<string[]> {
  const folders: string[] = []
  for (const path of input.paths) {
    const info = await runtime.pathInfo(path)
    if (!info.exists || !info.isDirectory) continue
    if (input.mode === "artist") {
      folders.push(path)
      continue
    }
    const children = await runtime.listDir(path)
    const artistChildren = children.filter((entry) => entry.isDirectory)
    folders.push(...(artistChildren.length ? artistChildren.map((entry) => entry.path) : [path]))
  }
  return [...new Set(folders)]
}

export async function planArtistFolder(artistPath: string, input: Required<SnfInput>, runtime: SnfRuntime): Promise<SnfPlanItem[]> {
  const entries = (await runtime.listDir(artistPath)).filter((entry) => entry.isDirectory)
  const numbered = entries.map((entry) => ({ entry, parsed: parseNumberedFolder(entry.name) })).filter((item) => item.parsed)
  if (!numbered.length) {
    return [{ artistPath, sourcePath: artistPath, targetPath: artistPath, sourceName: runtime.basename(artistPath), targetName: runtime.basename(artistPath), status: "skipped", reason: "no_numbered_folders" }]
  }

  const sortedByNumber = [...numbered].sort((a, b) => a.parsed!.number - b.parsed!.number)
  if (isContinuous(sortedByNumber.map((item) => item.parsed!.number))) {
    return sortedByNumber.map((item) => ({
      artistPath,
      sourcePath: item.entry.path,
      targetPath: item.entry.path,
      sourceName: item.entry.name,
      targetName: item.entry.name,
      sequence: item.parsed!.number,
      status: "unchanged",
    }))
  }

  const plannedOrder = [...numbered].sort((a, b) => priority(a.parsed!.name, input.priorityKeywords) - priority(b.parsed!.name, input.priorityKeywords) || a.parsed!.number - b.parsed!.number)
  const existing = new Set(entries.map((entry) => entry.name.toLowerCase()))
  const items: SnfPlanItem[] = []
  for (let index = 0; index < plannedOrder.length; index += 1) {
    const item = plannedOrder[index]!
    const targetName = `${index + 1}. ${item.parsed!.name}`
    const targetPath = runtime.join(runtime.dirname(item.entry.path), targetName)
    if (targetName === item.entry.name) {
      items.push({ artistPath, sourcePath: item.entry.path, targetPath: item.entry.path, sourceName: item.entry.name, targetName, sequence: index + 1, status: "unchanged" })
    } else if (existing.has(targetName.toLowerCase())) {
      items.push({ artistPath, sourcePath: item.entry.path, targetPath, sourceName: item.entry.name, targetName, sequence: index + 1, status: "conflict", reason: "target_name_exists" })
    } else {
      items.push({ artistPath, sourcePath: item.entry.path, targetPath, sourceName: item.entry.name, targetName, sequence: index + 1, status: "ready" })
      existing.add(targetName.toLowerCase())
    }
  }
  return items
}

export function parseNumberedFolder(name: string): { number: number; name: string } | null {
  const match = /^(\d+)[.\s-]+(.+)$/.exec(name.trim())
  if (!match) return null
  return { number: Number(match[1]), name: match[2]!.trim() }
}

function isContinuous(numbers: number[]): boolean {
  return numbers[0] === 1 && numbers.every((number, index) => index === 0 || number === numbers[index - 1]! + 1)
}

function priority(name: string, keywords: readonly string[]): number {
  const lower = name.toLowerCase()
  const index = keywords.findIndex((keyword) => lower.includes(keyword.toLowerCase()))
  return index >= 0 ? index : keywords.length
}

function data(input: Required<SnfInput>, artistCount: number, items: SnfPlanItem[]): SnfData {
  const errors = items.filter((item) => item.reason && (item.status === "error" || item.status === "conflict")).map((item) => `${item.sourcePath}: ${item.reason}`)
  return {
    action: input.action,
    mode: input.mode,
    items,
    artistCount,
    scannedCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    renamedCount: items.filter((item) => item.status === "renamed").length,
    unchangedCount: items.filter((item) => item.status === "unchanged").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    errorCount: items.filter((item) => item.status === "error").length,
    errors,
  }
}

function success(message: string, data: SnfData): SnfResult {
  return { success: data.errorCount === 0, message, data }
}

function failure(message: string, input: Required<SnfInput>): SnfResult {
  return { success: false, message, data: data(input, 0, [{ artistPath: "", sourcePath: "", targetPath: "", sourceName: "", targetName: "", status: "error", reason: message }]) }
}

function parseList(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean) as string[])]
}

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
