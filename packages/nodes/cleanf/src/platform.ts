import { execFile } from "node:child_process"
import { lstat, readdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import {
  createMemoryFileOperationStore,
  FileOperationService,
  type FileOperationExecutor,
  type FileUndoResult,
  type FileUndoState,
} from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type { CleanfItem, CleanfRemovalResult, CleanfRuntime, CleanfTarget } from "./core.js"
import { sortTargetsForRemoval } from "./core.js"

const FILE_OPERATION_BATCH_SIZE = 256

export interface CleanfFileOperations extends FileOperationExecutor {
  undoLatest?(): Promise<FileUndoResult>
  undoState?(): FileUndoState
}

export interface CleanfRuntimeContext {
  fileOperations?: CleanfFileOperations
}

let standaloneFileOperations: CleanfFileOperations | undefined

export function createNodeCleanfRuntime(context: CleanfRuntimeContext = {}): CleanfRuntime {
  const fileOperations = context.fileOperations ?? getStandaloneFileOperations()
  return {
    scanPath,
    removeTargets: (targets) => removeTargets(targets, fileOperations),
    undoLatest: fileOperations.undoLatest
      ? async () => {
          const result = await fileOperations.undoLatest!()
          return { succeeded: result.succeeded, failed: result.failed }
        }
      : undefined,
    undoState: fileOperations.undoState
      ? () => {
          const state = fileOperations.undoState!()
          return { available: state.available, count: state.count, persistent: state.persistent }
        }
      : undefined,
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolve({ code, stdout: stdout ?? "" })
    })
  })
}

async function scanPath(path: string): Promise<CleanfItem[]> {
  const root = resolve(path)
  const stat = await lstat(root)
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`)
  }

  const items: CleanfItem[] = []
  await walkDirectory(root, 1, items)
  return items
}

async function walkDirectory(path: string, depth: number, items: CleanfItem[]): Promise<void> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const childPath = join(path, entry.name)
    if (!entry.isDirectory() && !entry.isFile()) continue

    items.push({
      path: childPath,
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      parentPath: path,
      depth,
    })

    if (entry.isDirectory()) {
      await walkDirectory(childPath, depth + 1, items)
    }
  }
}

async function removeTargets(
  targets: CleanfTarget[],
  fileOperations: CleanfFileOperations,
): Promise<CleanfRemovalResult> {
  const initialUndoState = fileOperations.undoState?.()
  if (initialUndoState && !initialUndoState.trashRestore) {
    throw Object.assign(new Error("Recycle-bin restore is unavailable; Cleanf refused to run without undo support."), { code: "ENOTSUP" })
  }

  let removed = 0
  let skipped = 0
  let undoable = 0
  let undoBatchCount = 0

  const ordered = sortTargetsForRemoval(targets)
  for (let offset = 0; offset < ordered.length; offset += FILE_OPERATION_BATCH_SIZE) {
    const batch = ordered.slice(offset, offset + FILE_OPERATION_BATCH_SIZE)
    const result = await fileOperations.execute({
      operations: batch.map((target) => ({ kind: "trash" as const, sourcePath: target.path })),
      concurrency: 1,
    })
    removed += result.succeeded
    skipped += result.failed + result.cancelled
    undoable += result.undoable
    if (result.undoId) undoBatchCount += 1
  }

  const undoState = fileOperations.undoState?.()
  return {
    removed,
    skipped,
    undoable,
    undoBatchCount,
    undoPersistent: undoState?.persistent,
  }
}

function getStandaloneFileOperations(): CleanfFileOperations {
  if (standaloneFileOperations) return standaloneFileOperations
  const store = createMemoryFileOperationStore()
  const service = new FileOperationService(
    new PlatformFileMutationProvider({ ownerId: "cleanf:file-operations" }),
    { nodeId: "cleanf" },
    { journal: store, deletions: store },
  )
  standaloneFileOperations = {
    execute: (request) => service.execute(request),
    undoLatest: () => service.undoLatest(),
    undoState: () => ({ ...service.undoState(), persistent: false }),
  }
  return standaloneFileOperations
}

export function makeCleanfItem(path: string, type: "file" | "dir", depth = 1): CleanfItem {
  const resolved = resolve(path)
  return {
    path: resolved,
    name: basename(resolved),
    type,
    parentPath: dirname(resolved),
    depth,
  }
}
