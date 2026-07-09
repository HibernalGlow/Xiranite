import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type ClassfAction = "plan" | "classify"
export type ClassfTransferMode = "move" | "copy"
export type ClassfClassifyMode = "off" | "auto" | "only"
export type ClassfExistingPolicy = "merge" | "skip"
export type ClassfPlanStatus = "ready" | "skipped" | "moved" | "copied" | "conflict" | "error"
export type ClassfStage = "target" | "already" | "wait"

export interface ClassfInput {
  action?: ClassfAction
  path?: string
  paths?: string[]
  listText?: string
  targetDir?: string
  transferMode?: ClassfTransferMode
  classifyMode?: ClassfClassifyMode
  existingPolicy?: ClassfExistingPolicy
  dryRun?: boolean
}

export interface ClassfDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface ClassfPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface ClassfPlanItem {
  sourcePath: string
  targetPath: string
  sourceName: string
  targetRelative: string
  kind: "file" | "folder"
  stage: ClassfStage
  status: ClassfPlanStatus
  reason?: string
}

export interface ClassfData {
  action: ClassfAction
  transferMode: ClassfTransferMode
  classifyMode: ClassfClassifyMode
  targetDir?: string
  baseDir?: string
  items: ClassfPlanItem[]
  selectedCount: number
  readyCount: number
  movedCount: number
  copiedCount: number
  waitCount: number
  conflictCount: number
  errorCount: number
  errors: string[]
}

export interface ClassfRuntime {
  pathInfo: (path: string) => Promise<ClassfPathInfo>
  listDir: (path: string) => Promise<ClassfDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  transfer: (source: string, target: string, mode: ClassfTransferMode) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  relative: (from: string, to: string) => string
}

export type ClassfResult = NodeRunResult<ClassfData>

export function normalizeClassfInput(input: ClassfInput): Required<Omit<ClassfInput, "targetDir">> & { targetDir?: string } {
  return {
    action: input.action ?? "plan",
    path: clean(input.path),
    paths: uniqueClean([input.path, ...(input.paths ?? []), ...parseList(input.listText)]),
    listText: input.listText ?? "",
    targetDir: optional(input.targetDir),
    transferMode: input.transferMode ?? "move",
    classifyMode: input.classifyMode ?? "auto",
    existingPolicy: input.existingPolicy ?? "merge",
    dryRun: input.dryRun ?? true,
  }
}

export async function runClassf(input: ClassfInput, runtime: ClassfRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<ClassfResult> {
  const normalized = normalizeClassfInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one source path is required.", normalized)
    onEvent({ type: "progress", progress: 20, message: "Building classification plan." })
    const plan = await buildClassfPlan(normalized, runtime)
    if (normalized.action !== "classify" || normalized.dryRun) return success(`ClassF planned ${plan.items.length} item(s).`, plan)

    onEvent({ type: "progress", progress: 70, message: "Applying classification transfers." })
    const applied: ClassfPlanItem[] = []
    for (const item of plan.items) {
      if (item.status !== "ready") {
        applied.push(item)
        continue
      }
      try {
        await runtime.ensureDir(runtime.dirname(item.targetPath))
        await runtime.transfer(item.sourcePath, item.targetPath, normalized.transferMode)
        applied.push({ ...item, status: normalized.transferMode === "copy" ? "copied" : "moved" })
      } catch (error) {
        applied.push({ ...item, status: "error", reason: errorMessage(error) })
      }
    }
    return success(`ClassF applied ${applied.filter((item) => item.status === "moved" || item.status === "copied").length} transfer(s).`, data(normalized, applied, plan.baseDir))
  } catch (error) {
    return failure(errorMessage(error), normalized)
  }
}

export async function buildClassfPlan(input: ReturnType<typeof normalizeClassfInput>, runtime: ClassfRuntime): Promise<ClassfData> {
  const existingSources = await existingSourcePaths(input.paths, runtime)
  if (!existingSources.length) return data(input, input.paths.map((path) => skipped(path, runtime.basename(path), "path_missing")), undefined)

  const baseDir = input.classifyMode === "off"
    ? undefined
    : input.targetDir ? runtime.dirname(input.targetDir) : inferCommonParent(existingSources, runtime)
  const targetDir = resolveTargetDir(input, baseDir, runtime)
  if (!targetDir) return data(input, [errorItem(input.paths[0] ?? "", "target_required", runtime)], baseDir)

  const items: ClassfPlanItem[] = []
  for (const source of existingSources) {
    items.push(await planTransfer(source, targetDir, input.classifyMode === "off" ? "target" : "already", input.existingPolicy, runtime))
  }

  if (input.classifyMode === "auto" && baseDir) {
    const waitDir = runtime.join(baseDir, "wait")
    const selected = new Set(existingSources.map(normalizePath))
    const candidates = await collectWaitCandidates(baseDir, selected, runtime)
    for (const candidate of candidates) {
      items.push(await planTransfer(candidate.path, waitDir, "wait", input.existingPolicy, runtime))
    }
  }

  return data(input, items, baseDir)
}

export function inferCommonParent(paths: string[], runtime: Pick<ClassfRuntime, "dirname">): string | undefined {
  const parents = new Set(paths.map((path) => normalizePath(runtime.dirname(path))))
  return parents.size === 1 ? runtime.dirname(paths[0]!) : undefined
}

export async function collectWaitCandidates(baseDir: string, selected: Set<string>, runtime: ClassfRuntime): Promise<ClassfDirEntry[]> {
  const entries = await runtime.listDir(baseDir)
  return entries.filter((entry) => {
    const normalized = normalizePath(entry.path)
    if (selected.has(normalized)) return false
    if (entry.name === "already" || entry.name === "wait") return false
    return entry.isFile || entry.isDirectory
  })
}

async function existingSourcePaths(paths: string[], runtime: ClassfRuntime): Promise<string[]> {
  const result: string[] = []
  for (const path of paths) {
    const info = await runtime.pathInfo(path)
    if (info.exists) result.push(path)
  }
  return result
}

function resolveTargetDir(input: ReturnType<typeof normalizeClassfInput>, baseDir: string | undefined, runtime: Pick<ClassfRuntime, "join">): string | undefined {
  if (input.classifyMode === "off") return input.targetDir
  if (input.targetDir) return input.targetDir
  return baseDir ? runtime.join(baseDir, "already") : undefined
}

async function planTransfer(sourcePath: string, targetDir: string, stage: ClassfStage, policy: ClassfExistingPolicy, runtime: ClassfRuntime): Promise<ClassfPlanItem> {
  const sourceInfo = await runtime.pathInfo(sourcePath)
  const sourceName = runtime.basename(sourcePath)
  const targetPath = runtime.join(targetDir, sourceName)
  const targetRelative = runtime.relative(runtime.dirname(targetDir), targetPath)
  if (!sourceInfo.exists) return skipped(sourcePath, sourceName, "path_missing", stage)
  if (normalizePath(sourcePath) === normalizePath(targetPath)) return skipped(sourcePath, sourceName, "same_path", stage, sourceInfo.isDirectory ? "folder" : "file")
  const targetInfo = await runtime.pathInfo(targetPath)
  if (targetInfo.exists) {
    return {
      sourcePath,
      targetPath,
      sourceName,
      targetRelative,
      kind: sourceInfo.isDirectory ? "folder" : "file",
      stage,
      status: "conflict",
      reason: policy === "skip" ? "target_exists_skip" : "target_exists",
    }
  }
  return { sourcePath, targetPath, sourceName, targetRelative, kind: sourceInfo.isDirectory ? "folder" : "file", stage, status: "ready" }
}

function data(input: ReturnType<typeof normalizeClassfInput>, items: ClassfPlanItem[], baseDir: string | undefined): ClassfData {
  const errors = items.filter((item) => item.reason && (item.status === "error" || item.status === "conflict")).map((item) => `${item.sourcePath}: ${item.reason}`)
  return {
    action: input.action,
    transferMode: input.transferMode,
    classifyMode: input.classifyMode,
    targetDir: input.targetDir,
    baseDir,
    items,
    selectedCount: input.paths.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    movedCount: items.filter((item) => item.status === "moved").length,
    copiedCount: items.filter((item) => item.status === "copied").length,
    waitCount: items.filter((item) => item.stage === "wait").length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    errorCount: items.filter((item) => item.status === "error").length,
    errors,
  }
}

function success(message: string, data: ClassfData): ClassfResult {
  return { success: data.errorCount === 0, message, data }
}

function failure(message: string, input: ReturnType<typeof normalizeClassfInput>): ClassfResult {
  return { success: false, message, data: data(input, [{ sourcePath: "", targetPath: "", sourceName: "", targetRelative: "", kind: "file", stage: "target", status: "error", reason: message }], undefined) }
}

function skipped(sourcePath: string, sourceName: string, reason: string, stage: ClassfStage = "target", kind: "file" | "folder" = "file"): ClassfPlanItem {
  return { sourcePath, targetPath: sourcePath, sourceName, targetRelative: sourceName, kind, stage, status: "skipped", reason }
}

function errorItem(path: string, reason: string, runtime: Pick<ClassfRuntime, "basename">): ClassfPlanItem {
  return { sourcePath: path, targetPath: path, sourceName: runtime.basename(path), targetRelative: runtime.basename(path), kind: "file", stage: "target", status: "error", reason }
}

function parseList(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean) as string[])]
}

function optional(value: unknown): string | undefined {
  const text = clean(value)
  return text || undefined
}

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
