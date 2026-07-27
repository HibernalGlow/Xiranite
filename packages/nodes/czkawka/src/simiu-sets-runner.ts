import type { NodeRunEvent } from "@xiranite/contract"
import { applySimiuSetOperations, scanSimiuSets, undoSimiuSetLog } from "./simiu-sets.js"
import type { CzkawkaData, CzkawkaEntry, CzkawkaGroup, CzkawkaNormalizedInput, CzkawkaResult, CzkawkaRuntime } from "./core.js"

export interface CzkawkaSimiuSetRunnerHelpers {
  makeGroup(index: number, raw: Array<Partial<CzkawkaEntry> & { path: string; name: string; size: number; modifiedDate: number }>, runtime: Pick<CzkawkaRuntime, "basename">, reclaimable: boolean): CzkawkaGroup
  filterAndSort(groups: CzkawkaGroup[], input: Pick<Required<CzkawkaNormalizedInput>, "filterText" | "sortBy" | "descending">): CzkawkaGroup[]
  summarize(value: CzkawkaNormalizedInput, groups: CzkawkaGroup[], messages: string, stopped: boolean): CzkawkaData
  fail(value: CzkawkaNormalizedInput, message: string): CzkawkaResult
}

export async function runCzkawkaSimiuSetScan(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void, helpers: CzkawkaSimiuSetRunnerHelpers): Promise<CzkawkaResult> {
  if (!runtime.extractSimiuFeatures) return helpers.fail(value, "The configured Czkawka runtime does not provide Simiu feature extraction.")
  onEvent({ type: "progress", progress: 2, message: "Starting Simiu sets." })
  const scanned = await scanSimiuSets({
    roots: value.includedDirectories,
    recursive: value.recursive,
    scanOrder: value.simiuSetsScanOrder,
    namePrefix: value.simiuSetsNamePrefix,
    minimumGroupSize: value.simiuSetsMinimumGroupSize,
    threshold: value.simiuSetsThreshold,
    maxWorkers: value.threadCount,
  }, {
    listDirectory: runtime.listDirectory,
    extractSimiuFeatures: runtime.extractSimiuFeatures,
    pathExists: runtime.pathExists,
    ensureDirectory: runtime.ensureDirectory,
    movePath: runtime.movePath,
    copyPath: runtime.copyPath,
    linkPath: runtime.linkPath,
    removePath: runtime.removePath,
    readText: runtime.readText,
    writeText: runtime.writeText,
    join: runtime.join,
    dirname: runtime.dirname,
    basename: runtime.basename,
    isCancelled: runtime.isCancelled,
    waitWhilePaused: runtime.waitWhilePaused,
  }, (progress, message) => onEvent({ type: "progress", progress, message }))
  let groups = scanned.groups.map((group, index) => helpers.makeGroup(index, group.files.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, false))
  groups = helpers.filterAndSort(groups, value)
  const data: CzkawkaData = {
    ...helpers.summarize(value, groups, scanned.messages.join("\n"), scanned.stopped),
    simiuSets: {
      groups: scanned.groups,
      operations: scanned.operations,
      directoryCount: scanned.directoryCount,
      imageCount: scanned.imageCount,
    },
  }
  return {
    success: !scanned.stopped,
    message: scanned.stopped ? `Stopped Simiu sets; retained ${data.fileCount} partial item(s).` : `Found ${data.fileCount} item(s) in ${data.groupCount} Simiu set(s).`,
    data,
  }
}

export async function runCzkawkaSimiuSetApply(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void, helpers: CzkawkaSimiuSetRunnerHelpers): Promise<CzkawkaResult> {
  if (!value.simiuSetsOperations.length) return helpers.fail(value, "No Simiu set operations were supplied.")
  const operations = value.simiuSetsOperations.map((operation) => ({ ...operation, mode: value.simiuSetsOperationMode }))
  const applied = await applySimiuSetOperations(operations, value.dryRun, runtime)
  const entries = applied.operations.map((operation, index) => ({
    id: `simiu:${index}`,
    groupId: 0,
    path: operation.sourcePath,
    name: runtime.basename(operation.sourcePath),
    size: 0,
    modifiedDate: 0,
    secondaryPath: operation.targetPath,
    operation: operation.mode === "link" ? "link" : operation.mode,
    status: operation.status === "planned" ? "planned" : operation.status === "succeeded" ? operation.mode === "move" ? "moved" : operation.mode === "copy" ? "copied" : "linked" : "error",
    error: operation.error,
  } satisfies CzkawkaEntry))
  onEvent({ type: "progress", progress: 100, message: value.dryRun ? "Planned Simiu set operations." : "Applied Simiu set operations." })
  const data: CzkawkaData = {
    ...helpers.summarize(value, [helpers.makeGroup(0, entries, runtime, false)], "", false),
    simiuSets: { groups: [], operations, directoryCount: 0, imageCount: 0, undoLogPaths: applied.undoLogPaths },
  }
  return { success: data.errorCount === 0, message: value.dryRun ? `Planned ${data.affectedCount} Simiu set operation(s).` : `Applied ${data.affectedCount} Simiu set operation(s).`, data }
}

export async function runCzkawkaSimiuSetUndo(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void, helpers: CzkawkaSimiuSetRunnerHelpers): Promise<CzkawkaResult> {
  if (!value.simiuSetsUndoLogPath) return helpers.fail(value, "A Simiu undo log path is required.")
  const reverted = await undoSimiuSetLog(value.simiuSetsUndoLogPath, value.simiuSetsCleanEmptyDirectories, runtime)
  const entries = reverted.operations.map((operation, index) => ({
    id: `simiu-undo:${index}`,
    groupId: 0,
    path: operation.sourcePath,
    name: runtime.basename(operation.sourcePath),
    size: 0,
    modifiedDate: 0,
    secondaryPath: operation.targetPath,
    operation: operation.mode === "link" ? "link" : operation.mode,
    status: operation.status === "succeeded" ? operation.mode === "move" ? "moved" : "deleted" : "error",
    error: operation.error,
  } satisfies CzkawkaEntry))
  onEvent({ type: "progress", progress: 100, message: "Restored Simiu set operations." })
  const data: CzkawkaData = { ...helpers.summarize(value, [helpers.makeGroup(0, entries, runtime, false)], "", false), simiuSets: { groups: [], operations: [], directoryCount: 0, imageCount: 0 } }
  return { success: data.errorCount === 0, message: `Restored ${data.affectedCount} Simiu set operation(s).`, data }
}
