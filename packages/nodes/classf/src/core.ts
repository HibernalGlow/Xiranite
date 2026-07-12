import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CrashuData, CrashuInput, CrashuResult } from "@xiranite/node-crashu/core"
import type { MigratefData, MigratefInput, MigratefResult } from "@xiranite/node-migratef/core"
import type { SameaData, SameaInput, SameaResult } from "@xiranite/node-samea/core"

export type ClassfAction = "plan" | "classify"
export type ClassfTransferMode = "move" | "copy"
export type ClassfClassifyMode = "off" | "auto" | "only"
export type ClassfExistingPolicy = "merge" | "skip"
export type ClassfPlanStatus = "ready" | "skipped" | "moved" | "copied" | "conflict" | "error"
export type ClassfStage = "samea" | "crashu" | "already" | "wait"

export interface ClassfInput {
  action?: ClassfAction; path?: string; paths?: string[]; listText?: string
  crashuSourcePaths?: string[]; crashuSimilarityThreshold?: number
  targetDir?: string; transferMode?: ClassfTransferMode; classifyMode?: ClassfClassifyMode; existingPolicy?: ClassfExistingPolicy; dryRun?: boolean
  sameaIgnorePathBlacklist?: boolean; sameaMinOccurrences?: number; sameaCentralize?: boolean
}
export interface ClassfDirEntry { name: string; path: string; isFile: boolean; isDirectory: boolean }
export interface ClassfPathInfo { path: string; exists: boolean; isFile: boolean; isDirectory: boolean }
export interface ClassfPlanItem { sourcePath: string; targetPath: string; sourceName: string; targetRelative: string; kind: "file" | "folder"; stage: ClassfStage; status: ClassfPlanStatus; reason?: string }
export interface ClassfData {
  action: ClassfAction; transferMode: ClassfTransferMode; classifyMode: ClassfClassifyMode; targetDir?: string; baseDir?: string; items: ClassfPlanItem[]
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
    transferMode: input.transferMode ?? "move", classifyMode: input.classifyMode ?? "auto", existingPolicy: input.existingPolicy ?? "merge", dryRun: input.dryRun ?? true,
    sameaIgnorePathBlacklist: input.sameaIgnorePathBlacklist ?? false, sameaMinOccurrences: clampInt(input.sameaMinOccurrences ?? 1, 1, 100), sameaCentralize: input.sameaCentralize ?? false,
  }
}

export async function runClassf(input: ClassfInput, runtime: ClassfRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<ClassfResult> {
  const normalized = normalizeClassfInput(input)
  try {
    const sameaPaths = normalized.paths.length ? normalized.paths : await runtime.readClipboardPaths()
    if (!sameaPaths.length) return failure("SameA found no valid archive roots in the clipboard.", normalized)
    const crashuSourcePaths = normalized.crashuSourcePaths.length ? normalized.crashuSourcePaths : [DEFAULT_CRASHU_SOURCE_PATH]
    onEvent({ type: "progress", progress: 10, message: "SameA: extracting artist folders." })
    const samea = await runtime.runSamea({ action: normalized.action === "classify" ? "classify" : "plan", paths: sameaPaths, ignorePathBlacklist: normalized.sameaIgnorePathBlacklist, minOccurrences: normalized.sameaMinOccurrences, centralize: normalized.sameaCentralize, dryRun: normalized.action !== "classify" || normalized.dryRun }, (event) => forward(event, 10, 35, onEvent))
    if (!samea.success || !samea.data) return failure(samea.message, normalized, { samea: samea.data })
    const groups = samea.data.groups.filter((group) => group.status === "ready")
    if (!groups.length) return failure("SameA found no eligible artist folders for CrashU.", normalized, { samea: samea.data })

    onEvent({ type: "progress", progress: 45, message: "CrashU: matching source folders against SameA artists." })
    const crashu = await runtime.runCrashu({ action: "scan", sourcePaths: crashuSourcePaths, targetNames: groups.map((group) => group.name), similarityThreshold: normalized.crashuSimilarityThreshold, dryRun: true }, (event) => forward(event, 45, 30, onEvent))
    if (!crashu.success || !crashu.data) return failure(crashu.message, normalized, { samea: samea.data, crashu: crashu.data })
    const selected = resolveCrashuTargets(crashu.data, groups)
    if (!selected.length) return failure("CrashU found no source folders matching SameA artist folders.", normalized, { samea: samea.data, crashu: crashu.data })
    const baseDir = normalized.targetDir ? runtime.dirname(normalized.targetDir) : inferCommonParent(selected, runtime)
    if (!baseDir) return failure("ClassF requires CrashU matches in one parent directory or an explicit target directory.", normalized, { samea: samea.data, crashu: crashu.data })
    const alreadyDir = normalized.targetDir ?? runtime.join(baseDir, "already")

    onEvent({ type: "progress", progress: 75, message: "MigrateF: building already-folder plan." })
    const migrateAlready = await runtime.runMigratef({ action: normalized.action === "classify" && !normalized.dryRun ? normalized.transferMode : "plan", mode: "direct", sourcePaths: selected, targetPath: alreadyDir, dryRun: normalized.action !== "classify" || normalized.dryRun }, (event) => forward(event, 75, 15, onEvent))
    const items = migrateItems(migrateAlready.data, "already", runtime)
    let migrateWait: MigratefData | undefined
    if (normalized.classifyMode === "auto") {
      const waitCandidates = await collectWaitCandidates(baseDir, new Set(selected.map(normalizePath)), runtime)
      if (waitCandidates.length) {
        const wait = await runtime.runMigratef({ action: normalized.action === "classify" && !normalized.dryRun ? normalized.transferMode : "plan", mode: "direct", sourcePaths: waitCandidates.map((entry) => entry.path), targetPath: runtime.join(baseDir, "wait"), dryRun: normalized.action !== "classify" || normalized.dryRun }, (event) => forward(event, 90, 10, onEvent))
        migrateWait = wait.data
        items.push(...migrateItems(wait.data, "wait", runtime))
      }
    }
    const data = summarize({ ...normalized, paths: sameaPaths }, items, baseDir, { samea: samea.data, crashu: crashu.data, migrateAlready: migrateAlready.data, migrateWait })
    return { success: data.errorCount === 0, message: normalized.action === "classify" && !normalized.dryRun ? `ClassF pipeline applied ${data.movedCount + data.copiedCount} transfer(s).` : `ClassF pipeline planned ${data.readyCount} transfer(s).`, data }
  } catch (error) { return failure(errorMessage(error), normalized) }
}

export function inferCommonParent(paths: string[], runtime: Pick<ClassfRuntime, "dirname">): string | undefined { const parents = new Set(paths.map((path) => normalizePath(runtime.dirname(path)))); return parents.size === 1 ? runtime.dirname(paths[0]!) : undefined }
export async function collectWaitCandidates(baseDir: string, selected: Set<string>, runtime: Pick<ClassfRuntime, "listDir">): Promise<ClassfDirEntry[]> { return (await runtime.listDir(baseDir)).filter((entry) => !selected.has(normalizePath(entry.path)) && entry.name !== "already" && entry.name !== "wait" && (entry.isFile || entry.isDirectory)) }

function resolveCrashuTargets(crashu: CrashuData, groups: SameaData["groups"]): string[] { const byName = new Map(groups.map((group) => [group.name.toLowerCase(), group.targetDir])); return [...new Set(crashu.similarFolders.map((folder) => byName.get(folder.target.toLowerCase())).filter((path): path is string => Boolean(path)))] }
function migrateItems(data: MigratefData | undefined, stage: "already" | "wait", runtime: Pick<ClassfRuntime, "basename" | "relative" | "dirname">): ClassfPlanItem[] { return (data?.plan ?? []).map((item) => ({ sourcePath: item.sourcePath, targetPath: item.targetPath, sourceName: runtime.basename(item.sourcePath), targetRelative: item.targetPath ? runtime.relative(runtime.dirname(item.targetPath), item.targetPath) : runtime.basename(item.sourcePath), kind: item.kind === "directory" ? "folder" : "file", stage, status: item.status === "pending" ? "ready" : item.status === "success" ? item.action === "copy" ? "copied" : "moved" : item.status === "error" ? "error" : "skipped", reason: item.reason })) }
function summarize(input: ReturnType<typeof normalizeClassfInput>, items: ClassfPlanItem[], baseDir: string | undefined, stages: Pick<ClassfData, "samea" | "crashu" | "migrateAlready" | "migrateWait"> = {}): ClassfData { const errors = items.filter((item) => item.status === "error" || item.status === "conflict").map((item) => `${item.sourcePath}: ${item.reason ?? item.status}`); return { action: input.action, transferMode: input.transferMode, classifyMode: input.classifyMode, targetDir: input.targetDir, baseDir, items, selectedCount: input.paths.length, readyCount: items.filter((item) => item.status === "ready").length, movedCount: items.filter((item) => item.status === "moved").length, copiedCount: items.filter((item) => item.status === "copied").length, waitCount: items.filter((item) => item.stage === "wait").length, conflictCount: items.filter((item) => item.status === "conflict").length, errorCount: items.filter((item) => item.status === "error").length, errors, ...stages } }
function failure(message: string, input: ReturnType<typeof normalizeClassfInput>, stages: Pick<ClassfData, "samea" | "crashu" | "migrateAlready" | "migrateWait"> = {}): ClassfResult { return { success: false, message, data: summarize(input, [{ sourcePath: "", targetPath: "", sourceName: "", targetRelative: "", kind: "file", stage: "samea", status: "error", reason: message }], undefined, stages) } }
function forward(event: NodeRunEvent, offset: number, span: number, sink: (event: NodeRunEvent) => void) { sink(event.type === "progress" ? { ...event, progress: offset + Math.round(((event.progress ?? 0) / 100) * span) } : event) }
function parseList(value: unknown): string[] { return String(value ?? "").split(/\r?\n|,/).map(clean).filter(Boolean) }
function uniqueClean(values: Array<string | undefined>): string[] { return [...new Set(values.map(clean).filter(Boolean))] }
function clean(value: unknown): string { return String(value ?? "").trim() }
function optional(value: unknown): string | undefined { const text = clean(value); return text || undefined }
function normalizePath(path: string): string { return path.replace(/\\/g, "/").toLowerCase() }
function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6 }
function clampInt(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
