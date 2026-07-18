import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type MigratefAction = "move" | "copy" | "undo" | "history" | "plan"
export type MigratefMode = "preserve" | "flat" | "direct"

export interface MigratefInput {
  action?: MigratefAction
  mode?: MigratefMode
  path?: string
  sourcePaths?: string[]
  targetPath?: string
  maxWorkers?: number
  batchId?: string
  historyLimit?: number
  historyPath?: string
  dryRun?: boolean
}

export interface MigratefPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface MigratefDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface MigrateOperation {
  sourcePath: string
  targetPath: string
  action: "move" | "copy"
}

export interface MigratePlanItem extends MigrateOperation {
  kind: "file" | "directory"
  status: "pending" | "skipped" | "success" | "error"
  reason?: string
}

export interface UndoRecord {
  id: string
  timestamp: string
  description: string
  action: "move" | "copy"
  operations: MigrateOperation[]
  undone?: boolean
}

export interface MigratefData {
  plan: MigratePlanItem[]
  history: UndoRecord[]
  migratedCount: number
  skippedCount: number
  errorCount: number
  totalCount: number
  operationId: string
  successCount: number
  failedCount: number
  errors: string[]
}

export interface MigratefRuntime {
  pathInfo: (path: string) => Promise<MigratefPathInfo>
  listDir: (path: string) => Promise<MigratefDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  copyFile: (source: string, target: string) => Promise<void>
  copyDir: (source: string, target: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  deletePath: (path: string) => Promise<void>
  readText: (path: string) => Promise<string | null>
  writeText: (path: string, content: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  now: () => Date
  randomId: () => string
  defaultHistoryPath: () => string
}

export type MigratefResult = NodeRunResult<MigratefData>

export function normalizeMigratefInput(input: MigratefInput): Required<MigratefInput> {
  const paths = [...(input.sourcePaths ?? [])]
  if (input.path) paths.unshift(input.path)
  return {
    action: input.action ?? "move",
    mode: input.mode ?? "preserve",
    path: clean(input.path),
    sourcePaths: [...new Set(paths.map(clean).filter(Boolean))],
    targetPath: clean(input.targetPath),
    maxWorkers: input.maxWorkers ?? 16,
    batchId: clean(input.batchId),
    historyLimit: input.historyLimit ?? 10,
    historyPath: clean(input.historyPath),
    dryRun: input.dryRun ?? false,
  }
}

export async function runMigratef(
  input: MigratefInput,
  runtime: MigratefRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<MigratefResult> {
  const normalized = normalizeMigratefInput(input)
  try {
    if (normalized.action === "history") return await history(normalized, runtime)
    if (normalized.action === "undo") return await undo(normalized, runtime, onEvent)
    const plan = await buildMigratefPlan(normalized, runtime)
    if (normalized.action === "plan" || normalized.dryRun) {
      return success(`Plan generated: ${plan.filter((item) => item.status === "pending").length} item(s).`, {
        plan,
        totalCount: plan.length,
        skippedCount: plan.filter((item) => item.status === "skipped").length,
      })
    }
    return await executePlan(normalized, plan, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function buildMigratefPlan(input: Required<MigratefInput>, runtime: MigratefRuntime): Promise<MigratePlanItem[]> {
  if (!input.sourcePaths.length) throw new Error("At least one source path is required.")
  if (!input.targetPath) throw new Error("Target path is required.")

  const action = input.action === "copy" ? "copy" : "move"
  const plan: MigratePlanItem[] = []
  for (const source of input.sourcePaths) {
    const info = await runtime.pathInfo(source)
    if (!info.exists) {
      plan.push({ sourcePath: source, targetPath: "", action, kind: "file", status: "skipped", reason: "source_missing" })
      continue
    }
    if (input.mode === "direct") {
      const targetPath = runtime.join(input.targetPath, runtime.basename(info.path))
      const targetInfo = await runtime.pathInfo(targetPath)
      plan.push({
        sourcePath: info.path,
        targetPath,
        action,
        kind: info.isDirectory ? "directory" : "file",
        status: targetInfo.exists ? "skipped" : "pending",
        ...(targetInfo.exists ? { reason: "target_exists" } : {}),
      })
      continue
    }

    const files = await collectFiles(info, input.mode === "preserve", runtime)
    if (!files.length) {
      plan.push({ sourcePath: info.path, targetPath: "", action, kind: info.isDirectory ? "directory" : "file", status: "skipped", reason: "no_files" })
      continue
    }
    for (const file of files) {
      const targetPath = input.mode === "preserve"
        ? runtime.join(input.targetPath, preserveRelativeTarget(file.path))
        : runtime.join(input.targetPath, runtime.basename(file.path))
      plan.push({ sourcePath: file.path, targetPath, action, kind: "file", status: "pending" })
    }
  }
  return plan
}

export async function collectFiles(source: MigratefPathInfo, recursive: boolean, runtime: MigratefRuntime): Promise<MigratefPathInfo[]> {
  if (source.isFile) return [source]
  if (!source.isDirectory) return []
  const files: MigratefPathInfo[] = []
  async function walk(path: string) {
    for (const entry of await runtime.listDir(path)) {
      if (entry.isFile) files.push({ path: entry.path, exists: true, isFile: true, isDirectory: false })
      else if (entry.isDirectory && recursive) await walk(entry.path)
    }
  }
  await walk(source.path)
  return files
}

export function preserveRelativeTarget(path: string): string {
  return path
    .replace(/^[A-Za-z]:/, "")
    .replace(/^[/\\]+/, "")
    .replace(/[:*?"<>|]/g, "_")
}

export function parseMigratefHistory(content: string | null): UndoRecord[] {
  if (!content?.trim()) return []
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isUndoRecord)
  } catch {
    return []
  }
}

export function dumpMigratefHistory(records: UndoRecord[]): string {
  return `${JSON.stringify(records, null, 2)}\n`
}

async function executePlan(
  input: Required<MigratefInput>,
  plan: MigratePlanItem[],
  runtime: MigratefRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<MigratefResult> {
  const pending = plan.filter((item) => item.status === "pending")
  let migratedCount = 0
  let errorCount = 0
  const completed: MigratePlanItem[] = []

  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(pending.length, 1)) * 100), message: runtime.basename(item.sourcePath) })
    try {
      await runtime.ensureDir(runtime.dirname(item.targetPath))
      if (item.action === "copy") {
        if (item.kind === "directory") await runtime.copyDir(item.sourcePath, item.targetPath)
        else await runtime.copyFile(item.sourcePath, item.targetPath)
      } else {
        await runtime.movePath(item.sourcePath, item.targetPath)
      }
      completed.push({ ...item, status: "success" })
      migratedCount += 1
    } catch (error) {
      completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) })
      errorCount += 1
    }
  }

  const skipped = plan.filter((item) => item.status === "skipped")
  const operationId = await recordUndoIfNeeded(input, completed, runtime)
  onEvent({ type: "progress", progress: 100, message: "Migration completed." })
  return {
    success: errorCount === 0,
    message: `${input.action === "copy" ? "Copy" : "Move"} completed: ${migratedCount} success, ${skipped.length} skipped, ${errorCount} failed.`,
    data: data({
      plan: [...skipped, ...completed],
      migratedCount,
      skippedCount: skipped.length,
      errorCount,
      totalCount: plan.length,
      operationId,
    }),
  }
}

async function recordUndoIfNeeded(input: Required<MigratefInput>, completed: MigratePlanItem[], runtime: MigratefRuntime): Promise<string> {
  const successful = completed.filter((item) => item.status === "success")
  if (!successful.length) return ""
  const id = runtime.randomId()
  const record: UndoRecord = {
    id,
    timestamp: runtime.now().toISOString(),
    description: `${input.mode} ${input.action} to ${input.targetPath}`,
    action: input.action === "copy" ? "copy" : "move",
    operations: successful.map((item) => ({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: item.action })),
  }
  const path = historyPath(input, runtime)
  const records = parseMigratefHistory(await runtime.readText(path))
  records.unshift(record)
  await runtime.writeText(path, dumpMigratefHistory(records.slice(0, 100)))
  return id
}

async function history(input: Required<MigratefInput>, runtime: MigratefRuntime): Promise<MigratefResult> {
  const records = parseMigratefHistory(await runtime.readText(historyPath(input, runtime))).slice(0, input.historyLimit)
  return success(`Loaded ${records.length} history record(s).`, { history: records })
}

async function undo(input: Required<MigratefInput>, runtime: MigratefRuntime, onEvent: (event: NodeRunEvent) => void): Promise<MigratefResult> {
  const path = historyPath(input, runtime)
  const records = parseMigratefHistory(await runtime.readText(path))
  const record = input.batchId ? records.find((item) => item.id === input.batchId) : records.find((item) => !item.undone)
  if (!record) return failure(input.batchId ? `Undo batch not found: ${input.batchId}` : "No undoable batch found.")
  if (record.undone) return failure(`Undo batch already applied: ${record.id}`)

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []
  const operations = [...record.operations].reverse()
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(operations.length, 1)) * 100), message: operation.targetPath })
    try {
      if (record.action === "move") {
        await runtime.ensureDir(runtime.dirname(operation.sourcePath))
        await runtime.movePath(operation.targetPath, operation.sourcePath)
      } else {
        await runtime.deletePath(operation.targetPath)
      }
      successCount += 1
    } catch (error) {
      failedCount += 1
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  record.undone = failedCount === 0
  await runtime.writeText(path, dumpMigratefHistory(records))
  onEvent({ type: "progress", progress: 100, message: "Undo completed." })
  return {
    success: failedCount === 0,
    message: `Undo completed: ${successCount} success, ${failedCount} failed.`,
    data: data({ history: records, successCount, failedCount, errors }),
  }
}

function historyPath(input: Required<MigratefInput>, runtime: MigratefRuntime): string {
  return input.historyPath || runtime.defaultHistoryPath()
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function isUndoRecord(value: unknown): value is UndoRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<UndoRecord>
  return typeof record.id === "string" && typeof record.timestamp === "string" && Array.isArray(record.operations)
}

function data(partial: Partial<MigratefData>): MigratefData {
  return {
    plan: [],
    history: [],
    migratedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    totalCount: 0,
    operationId: "",
    successCount: 0,
    failedCount: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<MigratefData>): MigratefResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): MigratefResult {
  return { success: false, message, data: data({ errors: [message], failedCount: 1 }) }
}
