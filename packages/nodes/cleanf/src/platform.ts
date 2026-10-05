import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
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

/**
 * cleanf's machine half, through the host capability surface (ADR-0078). Reads are `fs.stat` / `fs.list`; the
 * deletions are not — they stay with `@xiranite/file-operations`, because that is what keeps the recycle-bin
 * journal and the undo stack this node's `undoLatest` hands back.
 */
const { fs, proc, os } = hostCapabilities

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
  const { platform } = await os.platform()

  if (platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  if (platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

/**
 * `proc.exec` answers a non-zero exit as a value; it rejects only when the program could not be started, which
 * is the case Node's `execFile` callback had already reported as `code 1`. A clipboard tool that is not
 * installed has to keep meaning "nothing readable here" rather than throwing out of the picker.
 */
async function runCommand(command: string, args: string[]): Promise<ExecResult> {
  try {
    return await proc.exec(command, args)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
    }
  }
}

async function scanPath(path: string): Promise<CleanfItem[]> {
  const root = resolve(path)
  const info = await fs.stat(root)
  if (info === null) throw missingPath(root)
  if (info.kind !== "dir") {
    throw new Error(`Path is not a directory: ${root}`)
  }

  const items: CleanfItem[] = []
  await walkDirectory(root, 1, items)
  return items
}

async function walkDirectory(path: string, depth: number, items: CleanfItem[]): Promise<void> {
  let entries
  try {
    entries = await fs.list(path)
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.kind !== "dir" && entry.kind !== "file") continue

    items.push({
      path: entry.path,
      name: entry.name,
      type: entry.kind === "dir" ? "dir" : "file",
      parentPath: path,
      depth,
    })

    if (entry.kind === "dir") {
      await walkDirectory(entry.path, depth + 1, items)
    }
  }
}

/** `fs.stat` answers `null` where `lstat` threw; callers show the message, so the absent path keeps Node's text. */
function missingPath(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT" })
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
