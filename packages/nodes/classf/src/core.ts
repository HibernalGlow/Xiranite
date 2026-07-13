import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CrashuData, CrashuInput, CrashuResult } from "@xiranite/node-crashu/core"
import type { MigratefData, MigratefInput, MigratefResult, MigratePlanItem } from "@xiranite/node-migratef/core"
import type { SameaData, SameaInput, SameaResult } from "@xiranite/node-samea/core"

export type ClassfAction = "plan" | "classify"
export type ClassfTransferMode = "move" | "copy"
export type ClassfClassifyMode = "off" | "auto" | "only"
export type ClassfPlacementMode = "local" | "root"
export type ClassfExistingPolicy = "merge" | "skip"
export type ClassfPlanStatus = "ready" | "skipped" | "moved" | "copied" | "conflict" | "error"
export type ClassfStage = "samea" | "crashu" | "already" | "wait"

export interface ClassfInput {
  action?: ClassfAction; path?: string; paths?: string[]; listText?: string
  crashuSourcePaths?: string[]; crashuSimilarityThreshold?: number
  targetDir?: string; transferMode?: ClassfTransferMode; classifyMode?: ClassfClassifyMode; placementMode?: ClassfPlacementMode; existingPolicy?: ClassfExistingPolicy; dryRun?: boolean
  sameaIgnorePathBlacklist?: boolean; sameaMinOccurrences?: number; sameaCentralize?: boolean
}
export interface ClassfDirEntry { name: string; path: string; isFile: boolean; isDirectory: boolean }
export interface ClassfPathInfo { path: string; exists: boolean; isFile: boolean; isDirectory: boolean }
export interface ClassfPlanItem { sourcePath: string; targetPath: string; sourceName: string; targetRelative: string; kind: "file" | "folder"; stage: ClassfStage; status: ClassfPlanStatus; reason?: string }
export type ClassfProgressData =
  | { kind: "classf-plan"; result: ClassfData }
  | { kind: "classf-stage"; stage: ClassfStage; status: "running" | "completed" }
  | { kind: "classf-item"; sourcePath: string; stage: ClassfStage; status: ClassfPlanStatus | "running"; reason?: string }
export interface ClassfData {
  action: ClassfAction; transferMode: ClassfTransferMode; classifyMode: ClassfClassifyMode; placementMode: ClassfPlacementMode; targetDir?: string; baseDir?: string; items: ClassfPlanItem[]
  selectedCount: number; readyCount: number; movedCount: number; copiedCount: number; waitCount: number; conflictCount: number; errorCount: number; errors: string[]
  samea?: SameaData; crashu?: CrashuData; migrateAlready?: MigratefData; migrateWait?: MigratefData
}
export interface ClassfRuntime {
  runSamea: (input: SameaInput, onEvent: (event: NodeRunEvent) => void) => Promise<SameaResult>
  runCrashu: (input: CrashuInput, onEvent: (event: NodeRunEvent) => void) => Promise<CrashuResult>
  runMigratef: (input: MigratefInput, onEvent: (event: NodeRunEvent) => void) => Promise<MigratefResult>
  readClipboardPaths: () => Promise<string[]>
  pathInfo: (path: string) => Promise<ClassfPathInfo>; listDir: (path: string) => Promise<ClassfDirEntry[]>; join: (...parts: string[]) => string; dirname: (path: string) => string; basename: (path: string) => string; relative: (from: string, to: string) => string
}
export type ClassfResult = NodeRunResult<ClassfData>

const DEFAULT_CRASHU_SOURCE_PATH = "E:\\1Hub\\EH\\1EHV"
const DEFAULT_CRASHU_THRESHOLD = 0.8

export function normalizeClassfInput(input: ClassfInput) {
  return {
    action: input.action ?? "plan", path: clean(input.path), paths: uniqueClean([input.path, ...(input.paths ?? []), ...parseList(input.listText)]), listText: input.listText ?? "",
    crashuSourcePaths: uniqueClean(input.crashuSourcePaths ?? []), crashuSimilarityThreshold: clamp01(input.crashuSimilarityThreshold ?? DEFAULT_CRASHU_THRESHOLD), targetDir: optional(input.targetDir),
    transferMode: input.transferMode ?? "move", classifyMode: input.classifyMode ?? "auto", placementMode: input.placementMode ?? "local", existingPolicy: input.existingPolicy ?? "merge", dryRun: input.dryRun ?? true,
    sameaIgnorePathBlacklist: input.sameaIgnorePathBlacklist ?? false, sameaMinOccurrences: clampInt(input.sameaMinOccurrences ?? 1, 1, 100), sameaCentralize: input.sameaCentralize ?? false,
  }
}

export async function runClassf(input: ClassfInput, runtime: ClassfRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<ClassfResult> {
  const normalized = normalizeClassfInput(input)
  try {
    const sameaPaths = normalized.paths.length ? normalized.paths : await runtime.readClipboardPaths()
    if (!sameaPaths.length) return failure("SameA found no valid archive roots in the clipboard.", normalized)
    if (normalized.placementMode === "root" && !normalized.targetDir) return failure("Root placement requires a target directory.", normalized)
    const crashuSourcePaths = normalized.crashuSourcePaths.length ? normalized.crashuSourcePaths : [DEFAULT_CRASHU_SOURCE_PATH]
    onEvent({ type: "progress", progress: 5, message: "SameA: building the source plan.", data: { kind: "classf-stage", stage: "samea", status: "running" } satisfies ClassfProgressData })
    const sameaPlan = await runtime.runSamea({ action: "plan", paths: sameaPaths, ignorePathBlacklist: normalized.sameaIgnorePathBlacklist, minOccurrences: normalized.sameaMinOccurrences, centralize: normalized.sameaCentralize, dryRun: true }, (event) => forward(event, 5, 15, onEvent))
    if (!sameaPlan.success || !sameaPlan.data) return failure(sameaPlan.message, normalized, { samea: sameaPlan.data })
    const groups = sameaPlan.data.groups.filter((group) => group.status === "ready")
    let crashuData: CrashuData | undefined
    if (groups.length) {
      onEvent({ type: "progress", progress: 20, message: "CrashU: matching source folders against SameA artists.", data: { kind: "classf-stage", stage: "crashu", status: "running" } satisfies ClassfProgressData })
      const crashu = await runtime.runCrashu({ action: "scan", sourcePaths: crashuSourcePaths, targetNames: groups.map((group) => group.name), similarityThreshold: normalized.crashuSimilarityThreshold, dryRun: true }, (event) => forward(event, 20, 15, onEvent))
      if (!crashu.success || !crashu.data) return failure(crashu.message, normalized, { samea: sameaPlan.data, crashu: crashu.data })
      crashuData = crashu.data
    }

    const sourceFiles = await collectInputFiles(sameaPaths, runtime)
    const transfers = buildFileTransfers(sourceFiles, sameaPaths, sameaPlan.data, crashuData, normalized, runtime)
    const baseDir = normalized.placementMode === "root" ? normalized.targetDir : inferInputBase(sameaPaths, runtime)
    onEvent({ type: "progress", progress: 35, message: "MigrateF: building the complete per-directory transfer plan.", data: { kind: "classf-stage", stage: "already", status: "running" } satisfies ClassfProgressData })
    const alreadyPlan = await runTransferGroups(transfers.filter((item) => item.stage === "already"), "plan", normalized, runtime, (event) => forward(event, 35, 5, onEvent))
    const waitPlan = await runTransferGroups(transfers.filter((item) => item.stage === "wait"), "plan", normalized, runtime, (event) => forward(event, 40, 5, onEvent))
    const items = transferItems([...alreadyPlan.plan, ...waitPlan.plan], transfers, sameaPaths, normalized, runtime)
    const plannedData = summarize({ ...normalized, paths: sameaPaths }, items, baseDir, { samea: sameaPlan.data, crashu: crashuData, migrateAlready: alreadyPlan.data, migrateWait: waitPlan.data })
    onEvent({ type: "progress", progress: 45, message: `ClassF plan ready: ${plannedData.readyCount} transfer(s).`, data: { kind: "classf-plan", result: plannedData } satisfies ClassfProgressData })
    if (normalized.action === "plan" || normalized.dryRun) {
      return { success: plannedData.errorCount === 0, message: `ClassF pipeline planned ${plannedData.readyCount} transfer(s).`, data: plannedData }
    }

    const completedAlready = await runTransferGroups(transfers.filter((item) => item.stage === "already"), normalized.transferMode, normalized, runtime, (event) => forwardMigrate(event, 50, 25, "already", items, runtime, onEvent))
    emitCompletedItems(completedAlready.data, "already", baseDir ?? "", runtime, onEvent)
    const completedWait = await runTransferGroups(transfers.filter((item) => item.stage === "wait"), normalized.transferMode, normalized, runtime, (event) => forwardMigrate(event, 75, 25, "wait", items, runtime, onEvent))
    emitCompletedItems(completedWait.data, "wait", baseDir ?? "", runtime, onEvent)
    const completedItems = transferItems([...completedAlready.plan, ...completedWait.plan], transfers, sameaPaths, normalized, runtime)
    const data = summarize({ ...normalized, paths: sameaPaths }, completedItems, baseDir, { samea: sameaPlan.data, crashu: crashuData, migrateAlready: completedAlready.data, migrateWait: completedWait.data })
    return { success: data.errorCount === 0, message: `ClassF pipeline applied ${data.movedCount + data.copiedCount} transfer(s).`, data }
  } catch (error) { return failure(errorMessage(error), normalized) }
}

interface FileTransfer { sourcePath: string; targetDir: string; targetPath: string; stage: "already" | "wait" }

async function collectInputFiles(paths: string[], runtime: Pick<ClassfRuntime, "pathInfo" | "listDir">): Promise<ClassfDirEntry[]> {
  const files: ClassfDirEntry[] = []
  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile) { files.push({ name: pathName(path), path: info.path, isFile: true, isDirectory: false }); return }
    if (!info.isDirectory) return
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile) files.push(entry)
      else if (entry.isDirectory && !isClassificationDirectory(entry.name)) await visit(entry.path)
    }
  }
  for (const path of paths) await visit(path)
  return [...new Map(files.map((file) => [normalizePath(file.path), file])).values()]
}

function buildFileTransfers(files: ClassfDirEntry[], roots: string[], samea: SameaData, crashu: CrashuData | undefined, input: ReturnType<typeof normalizeClassfInput>, runtime: Pick<ClassfRuntime, "join" | "dirname" | "basename" | "relative">): FileTransfer[] {
  const detected = new Map(samea.items.filter((item) => item.sourcePath).map((item) => [normalizePath(item.sourcePath), item]))
  const matchedArtists = new Set((crashu?.similarFolders ?? []).map((folder) => folder.target.toLocaleLowerCase()))
  const transfers: FileTransfer[] = []
  for (const file of files) {
    const artist = detected.get(normalizePath(file.path))?.artistName.toLocaleLowerCase()
    const stage: "already" | "wait" = artist && matchedArtists.has(artist) ? "already" : "wait"
    if (input.classifyMode === "only" && stage === "wait") continue
    const targetDir = input.placementMode === "local"
      ? runtime.join(runtime.dirname(file.path), stage)
      : rootTargetDirectory(file.path, roots, input.targetDir!, stage, runtime)
    transfers.push({ sourcePath: file.path, targetDir, targetPath: runtime.join(targetDir, runtime.basename(file.path)), stage })
  }
  return transfers
}

function rootTargetDirectory(file: string, roots: string[], targetRoot: string, stage: "already" | "wait", runtime: Pick<ClassfRuntime, "join" | "dirname" | "basename" | "relative">): string {
  const owner = owningRoot(file, roots)
  const relativeFile = owner ? runtime.relative(owner, file) : runtime.basename(file)
  const preserved = roots.length > 1 && owner ? runtime.join(runtime.basename(owner), relativeFile) : relativeFile
  const relativeDir = parentRelative(preserved)
  return relativeDir ? runtime.join(targetRoot, stage, relativeDir) : runtime.join(targetRoot, stage)
}

async function runTransferGroups(transfers: FileTransfer[], action: "plan" | ClassfTransferMode, input: ReturnType<typeof normalizeClassfInput>, runtime: ClassfRuntime, onEvent: (event: NodeRunEvent) => void): Promise<{ plan: MigratePlanItem[]; data: MigratefData | undefined }> {
  const groups = new Map<string, FileTransfer[]>()
  for (const transfer of transfers) groups.set(transfer.targetDir, [...(groups.get(transfer.targetDir) ?? []), transfer])
  const results: MigratefData[] = []
  for (const [targetPath, group] of groups) {
    const result = await runtime.runMigratef({ action, mode: "direct", sourcePaths: group.map((item) => item.sourcePath), targetPath, dryRun: action === "plan" }, onEvent)
    if (result.data) results.push(result.data)
  }
  const data = mergeMigrateData(results)
  return { plan: data?.plan ?? [], data }
}

function mergeMigrateData(results: MigratefData[]): MigratefData | undefined {
  if (!results.length) return undefined
  return {
    plan: results.flatMap((item) => item.plan), history: results.flatMap((item) => item.history),
    migratedCount: sum(results, "migratedCount"), skippedCount: sum(results, "skippedCount"), errorCount: sum(results, "errorCount"), totalCount: sum(results, "totalCount"),
    operationId: results.map((item) => item.operationId).filter(Boolean).join(","), successCount: sum(results, "successCount"), failedCount: sum(results, "failedCount"), errors: results.flatMap((item) => item.errors),
  }
}

function transferItems(plan: MigratePlanItem[], transfers: FileTransfer[], roots: string[], input: ReturnType<typeof normalizeClassfInput>, runtime: Pick<ClassfRuntime, "basename" | "relative">): ClassfPlanItem[] {
  const bySource = new Map(transfers.map((item) => [normalizePath(item.sourcePath), item]))
  return plan.map((item) => {
    const transfer = bySource.get(normalizePath(item.sourcePath))
    const stage = transfer?.stage ?? "wait"
    return {
      sourcePath: item.sourcePath, targetPath: item.targetPath, sourceName: runtime.basename(item.sourcePath),
      targetRelative: displayTarget(item.targetPath, item.sourcePath, roots, input, runtime), kind: "file", stage,
      status: item.status === "pending" ? "ready" : item.status === "success" ? item.action === "copy" ? "copied" : "moved" : item.status === "error" ? "error" : "skipped",
      reason: item.reason,
    }
  })
}

function displayTarget(target: string, source: string, roots: string[], input: ReturnType<typeof normalizeClassfInput>, runtime: Pick<ClassfRuntime, "relative">): string {
  if (input.placementMode === "root" && input.targetDir) return runtime.relative(input.targetDir, target)
  const owner = owningRoot(source, roots)
  return owner ? runtime.relative(owner, target) : target
}

function owningRoot(path: string, roots: string[]): string | undefined {
  const normalized = normalizePath(path)
  return [...roots].sort((left, right) => right.length - left.length).find((root) => normalized === normalizePath(root) || normalized.startsWith(`${normalizePath(root).replace(/\/$/, "")}/`))
}

function inferInputBase(paths: string[], runtime: Pick<ClassfRuntime, "dirname">): string | undefined {
  if (!paths.length) return undefined
  return paths.length === 1 ? paths[0] : inferCommonParent(paths, runtime)
}

function parentRelative(path: string): string { const normalized = path.replace(/\\/g, "/"); const index = normalized.lastIndexOf("/"); return index > 0 ? normalized.slice(0, index) : "" }
function pathName(path: string): string { return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path }
function isClassificationDirectory(name: string): boolean { return name.toLocaleLowerCase() === "already" || name.toLocaleLowerCase() === "wait" }
function sum(items: MigratefData[], key: "migratedCount" | "skippedCount" | "errorCount" | "totalCount" | "successCount" | "failedCount"): number { return items.reduce((total, item) => total + item[key], 0) }

export function inferCommonParent(paths: string[], runtime: Pick<ClassfRuntime, "dirname">): string | undefined { const parents = new Set(paths.map((path) => normalizePath(runtime.dirname(path)))); return parents.size === 1 ? runtime.dirname(paths[0]!) : undefined }
export async function collectWaitCandidates(baseDir: string, selected: Set<string>, runtime: Pick<ClassfRuntime, "listDir">): Promise<ClassfDirEntry[]> { return (await runtime.listDir(baseDir)).filter((entry) => !selected.has(normalizePath(entry.path)) && entry.name !== "already" && entry.name !== "wait" && (entry.isFile || entry.isDirectory)) }

function summarize(input: ReturnType<typeof normalizeClassfInput>, items: ClassfPlanItem[], baseDir: string | undefined, stages: Pick<ClassfData, "samea" | "crashu" | "migrateAlready" | "migrateWait"> = {}): ClassfData { const errors = items.filter((item) => item.status === "error" || item.status === "conflict").map((item) => `${item.sourcePath}: ${item.reason ?? item.status}`); return { action: input.action, transferMode: input.transferMode, classifyMode: input.classifyMode, placementMode: input.placementMode, targetDir: input.targetDir, baseDir, items, selectedCount: input.paths.length, readyCount: items.filter((item) => item.status === "ready").length, movedCount: items.filter((item) => item.status === "moved").length, copiedCount: items.filter((item) => item.status === "copied").length, waitCount: items.filter((item) => item.stage === "wait").length, conflictCount: items.filter((item) => item.status === "conflict").length, errorCount: items.filter((item) => item.status === "error").length, errors, ...stages } }
function failure(message: string, input: ReturnType<typeof normalizeClassfInput>, stages: Pick<ClassfData, "samea" | "crashu" | "migrateAlready" | "migrateWait"> = {}): ClassfResult { return { success: false, message, data: summarize(input, [{ sourcePath: "", targetPath: "", sourceName: "", targetRelative: "", kind: "file", stage: "samea", status: "error", reason: message }], undefined, stages) } }
function forward(event: NodeRunEvent, offset: number, span: number, sink: (event: NodeRunEvent) => void) { sink(event.type === "progress" ? { ...event, progress: offset + Math.round(((event.progress ?? 0) / 100) * span) } : event) }
function forwardMigrate(event: NodeRunEvent, offset: number, span: number, stage: "already" | "wait", planned: ClassfPlanItem[], runtime: Pick<ClassfRuntime, "basename">, sink: (event: NodeRunEvent) => void) {
  if (event.type !== "progress") return sink(event)
  const item = planned.find((candidate) => candidate.stage === stage && runtime.basename(candidate.sourcePath) === event.message)
  sink({ ...event, progress: offset + Math.round(((event.progress ?? 0) / 100) * span), data: item ? { kind: "classf-item", sourcePath: item.sourcePath, stage, status: "running" } satisfies ClassfProgressData : event.data })
}
function emitCompletedItems(data: MigratefData | undefined, stage: "already" | "wait", baseDir: string, runtime: Pick<ClassfRuntime, "basename" | "relative">, sink: (event: NodeRunEvent) => void) {
  for (const item of data?.plan ?? []) {
    const status: ClassfPlanStatus = item.status === "pending" ? "ready" : item.status === "success" ? item.action === "copy" ? "copied" : "moved" : item.status === "error" ? "error" : "skipped"
    sink({ type: "log", message: `${runtime.basename(item.sourcePath)}: ${status}`, data: { kind: "classf-item", sourcePath: item.sourcePath, stage, status, reason: item.reason } satisfies ClassfProgressData })
  }
}
function parseList(value: unknown): string[] { return String(value ?? "").split(/\r?\n|,/).map(clean).filter(Boolean) }
function uniqueClean(values: Array<string | undefined>): string[] { return [...new Set(values.map(clean).filter(Boolean))] }
function clean(value: unknown): string { return String(value ?? "").trim() }
function optional(value: unknown): string | undefined { const text = clean(value); return text || undefined }
function normalizePath(path: string): string { return path.replace(/\\/g, "/").toLowerCase() }
function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6 }
function clampInt(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
