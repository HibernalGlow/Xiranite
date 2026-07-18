import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type TransqAction = "status" | "plan" | "run"
export type TransqQueueStatus = "pending" | "ready" | "output" | "conflict" | "missing"

export interface TransqInput {
  action?: TransqAction
  paths?: string[]
  /** Preview is on by default so filesystem changes are explicit. */
  preview?: boolean
}

export interface TransqDirectorySnapshot {
  originalImagesPath: string
  resultPath: string
  outputPath: string
  outputExists: boolean
  originalFiles: string[]
  resultFiles: string[]
  mappedFiles: string[]
  cleanupPaths: string[]
}

export interface TransqCopyOperation {
  sourcePath: string
  destinationPath: string
  filename: string
}

export interface TransqQueueItem {
  id: string
  originalImagesPath: string
  resultPath: string
  outputPath: string
  status: TransqQueueStatus
  originalCount: number
  resultCount: number
  missingFiles: string[]
  extraFiles: string[]
  copies: TransqCopyOperation[]
  cleanupPaths: string[]
  errors: string[]
}

export interface TransqData {
  items: TransqQueueItem[]
  pendingCount: number
  readyCount: number
  outputCount: number
  conflictCount: number
  copiedFiles: number
  deletedOriginals: number
  deletedWorkItems: number
  errors: string[]
}

export interface TransqRuntime {
  scanRoots: (roots: string[]) => Promise<TransqDirectorySnapshot[]>
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>
  moveDirectory: (sourcePath: string, destinationPath: string) => Promise<void>
  removePath: (path: string) => Promise<void>
}

export type TransqResult = NodeRunResult<TransqData>

export function parseTransqPaths(paths: string[] | undefined): string[] {
  return (paths ?? []).map((path) => path.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
}

export function planTransqQueue(snapshot: TransqDirectorySnapshot): TransqQueueItem {
  const originalFiles = new Set(snapshot.originalFiles)
  const resultFiles = new Set(snapshot.resultFiles)
  const mappedFiles = new Set(snapshot.mappedFiles)
  const missingFiles = [...mappedFiles].filter((filename) => !resultFiles.has(filename)).sort()
  const extraFiles = [...resultFiles].filter((filename) => mappedFiles.size > 0 && !mappedFiles.has(filename)).sort()
  const absentOriginals = missingFiles.filter((filename) => !originalFiles.has(filename))
  const copies = missingFiles
    .filter((filename) => originalFiles.has(filename))
    .map((filename) => ({
      filename,
      sourcePath: joinPath(snapshot.originalImagesPath, filename),
      destinationPath: joinPath(snapshot.resultPath, filename),
    }))
  const errors: string[] = []

  if (snapshot.outputExists) errors.push(`Output already exists: ${snapshot.outputPath}`)
  if (absentOriginals.length) errors.push(`Mapped originals are missing: ${absentOriginals.join(", ")}`)

  const status: TransqQueueStatus = snapshot.outputExists
    ? "conflict"
    : absentOriginals.length
      ? "missing"
      : missingFiles.length
        ? "pending"
        : "ready"

  return {
    id: snapshot.originalImagesPath,
    originalImagesPath: snapshot.originalImagesPath,
    resultPath: snapshot.resultPath,
    outputPath: snapshot.outputPath,
    status,
    originalCount: snapshot.originalFiles.length,
    resultCount: snapshot.resultFiles.length,
    missingFiles,
    extraFiles,
    copies,
    cleanupPaths: [...snapshot.cleanupPaths],
    errors,
  }
}

export async function runTransq(
  input: TransqInput,
  runtime: TransqRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<TransqResult> {
  const action = input.action ?? "status"
  if (action === "status") {
    return {
      success: true,
      message: "Native TransQ is ready. Provide one or more translation workspace paths to plan a queue.",
      data: emptyData(),
    }
  }

  const roots = parseTransqPaths(input.paths)
  if (!roots.length) {
    return { success: false, message: "Provide at least one translation workspace path.", data: emptyData() }
  }

  onEvent({ type: "progress", progress: 10, message: "Scanning translation workspaces." })
  const snapshots = await runtime.scanRoots(roots)
  const items = snapshots.map(planTransqQueue)
  const data = summarize(items)

  if (!items.length) {
    return {
      success: false,
      message: "No original_images folders with a manga_translator_work/result queue were found.",
      data,
    }
  }

  const preview = action === "plan" || input.preview !== false
  if (preview) {
    onEvent({ type: "progress", progress: 100, message: `Planned ${items.length} translation queue(s); no files were changed.` })
    return {
      success: data.conflictCount === 0 && data.errors.length === 0,
      message: `Planned ${items.length} translation queue(s); ${data.pendingCount} need missing-file copies and ${data.conflictCount} need attention.`,
      data,
    }
  }

  let copiedFiles = 0
  let deletedWorkItems = 0
  let deletedOriginals = 0
  const errors = [...data.errors]
  const runnable = items.filter((item) => item.status === "pending" || item.status === "ready")

  for (const [index, item] of runnable.entries()) {
    const start = 20 + Math.round((index / Math.max(runnable.length, 1)) * 70)
    onEvent({ type: "progress", progress: start, message: `Organizing ${item.originalImagesPath}` })
    try {
      for (const copy of item.copies) {
        await runtime.copyFile(copy.sourcePath, copy.destinationPath)
        copiedFiles += 1
      }
      for (const cleanupPath of item.cleanupPaths) {
        await runtime.removePath(cleanupPath)
        deletedWorkItems += 1
      }
      await runtime.moveDirectory(item.resultPath, item.outputPath)
      await runtime.removePath(item.originalImagesPath)
      deletedOriginals += 1
      item.status = "output"
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      item.status = "conflict"
      item.errors.push(message)
      errors.push(`${item.originalImagesPath}: ${message}`)
    }
  }

  const completed = summarize(items, { copiedFiles, deletedWorkItems, deletedOriginals, errors })
  onEvent({ type: "progress", progress: 100, message: completed.errors.length ? "Translation queue finished with errors." : "Translation queue organized." })
  return {
    success: completed.errors.length === 0 && completed.conflictCount === 0,
    message: completed.errors.length
      ? `Organized ${completed.outputCount} translation queue(s); ${completed.errors.length} queue(s) need attention.`
      : `Organized ${completed.outputCount} translation queue(s).`,
    data: completed,
  }
}

function summarize(
  items: TransqQueueItem[],
  overrides: Pick<TransqData, "copiedFiles" | "deletedOriginals" | "deletedWorkItems" | "errors"> = {
    copiedFiles: 0,
    deletedOriginals: 0,
    deletedWorkItems: 0,
    errors: [],
  },
): TransqData {
  const itemErrors = items.flatMap((item) => item.errors)
  return {
    items,
    pendingCount: items.filter((item) => item.status === "pending").length,
    readyCount: items.filter((item) => item.status === "ready").length,
    outputCount: items.filter((item) => item.status === "output").length,
    conflictCount: items.filter((item) => item.status === "conflict" || item.status === "missing").length,
    copiedFiles: overrides.copiedFiles,
    deletedOriginals: overrides.deletedOriginals,
    deletedWorkItems: overrides.deletedWorkItems,
    errors: [...new Set([...overrides.errors, ...itemErrors])],
  }
}

function emptyData(): TransqData {
  return {
    items: [],
    pendingCount: 0,
    readyCount: 0,
    outputCount: 0,
    conflictCount: 0,
    copiedFiles: 0,
    deletedOriginals: 0,
    deletedWorkItems: 0,
    errors: [],
  }
}

function joinPath(parent: string, name: string): string {
  const separator = parent.includes("\\") ? "\\" : "/"
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`
}
