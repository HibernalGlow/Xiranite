import { cp, lstat, mkdir, rename as renamePath, rm, stat } from "node:fs/promises"
import { basename, dirname, normalize, resolve } from "node:path"
import { moveFile, renameFile } from "move-file"
import trash from "trash"

import type {
  ReaderFileMutation,
  ReaderFileMutationGuard,
  ReaderFileMutationProvider,
  ReaderFileUndoReceipt,
} from "../../ports/ReaderFileMutationProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export interface PlatformReaderFileMutationProviderOptions {
  scheduler?: ResourceScheduler
  ownerId?: string
  move?: typeof moveFile
  rename?: typeof renameFile
  trash?: (path: string) => Promise<void>
}

export class PlatformReaderFileMutationProvider implements ReaderFileMutationProvider {
  readonly #scheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #move: typeof moveFile
  readonly #rename: typeof renameFile
  readonly #trash: (path: string) => Promise<void>

  constructor(options: PlatformReaderFileMutationProviderOptions = {}) {
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "neoview:file-operations"
    this.#move = options.move ?? moveFile
    this.#rename = options.rename ?? renameFile
    this.#trash = options.trash ?? ((path) => trash(path, { glob: false }))
  }

  async execute(operation: ReaderFileMutation, signal?: AbortSignal): Promise<ReaderFileUndoReceipt | undefined> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: `reader.file.${operation.kind}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      signal?.throwIfAborted()
      const receipt = await this.#execute(operation)
      return receipt
    } finally {
      lease?.release()
    }
  }

  async undo(receipt: ReaderFileUndoReceipt, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: "reader.file.undo",
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      const current = await snapshot(receipt.guard.path)
      if (!sameGuard(current, receipt.guard)) throw stalePath(receipt.guard.path)
      await this.#execute(receipt.inverse, false)
    } finally {
      lease?.release()
    }
  }

  async #execute(operation: ReaderFileMutation, createUndo = true): Promise<ReaderFileUndoReceipt | undefined> {
    switch (operation.kind) {
      case "copy": {
        const destinationExisted = await pathExists(operation.destinationPath)
        if (operation.overwrite !== true) await assertDestinationAbsent(operation.destinationPath)
        await cp(operation.sourcePath, operation.destinationPath, {
          recursive: true,
          force: operation.overwrite === true,
          errorOnExist: operation.overwrite !== true,
          preserveTimestamps: true,
        })
        return createUndo && !destinationExisted
          ? receipt(operation, { kind: "delete", sourcePath: operation.destinationPath }, await snapshot(operation.destinationPath))
          : undefined
      }
      case "move": {
        const destinationExisted = await pathExists(operation.destinationPath)
        await this.#move(operation.sourcePath, operation.destinationPath, { overwrite: operation.overwrite === true })
        return createUndo && !destinationExisted
          ? receipt(operation, { kind: "move", sourcePath: operation.destinationPath, destinationPath: operation.sourcePath, overwrite: false }, await snapshot(operation.destinationPath))
          : undefined
      }
      case "rename": {
        const sourceDirectory = dirname(operation.sourcePath)
        if (sourceDirectory !== dirname(operation.destinationPath)) {
          throw Object.assign(new Error("Reader rename source and destination must share a directory."), { code: "EXDEV" })
        }
        const caseOnly = isWindowsCaseOnlyRename(operation.sourcePath, operation.destinationPath)
        const destinationExisted = caseOnly ? false : await pathExists(operation.destinationPath)
        if (caseOnly) {
          await renamePath(operation.sourcePath, operation.destinationPath)
        } else {
          await this.#rename(basename(operation.sourcePath), basename(operation.destinationPath), {
            cwd: sourceDirectory,
            overwrite: operation.overwrite === true,
          })
        }
        return createUndo && !destinationExisted
          ? receipt(operation, { kind: "rename", sourcePath: operation.destinationPath, destinationPath: operation.sourcePath, overwrite: false }, await snapshot(operation.destinationPath))
          : undefined
      }
      case "delete":
        await rm(operation.sourcePath, { recursive: true, force: false })
        return
      case "trash":
        await stat(operation.sourcePath)
        await this.#trash(operation.sourcePath)
        return
      case "create-directory":
        await mkdir(operation.destinationPath, { recursive: false })
        return createUndo
          ? receipt(operation, { kind: "delete", sourcePath: operation.destinationPath }, await snapshot(operation.destinationPath))
          : undefined
    }
  }
}

function isWindowsCaseOnlyRename(sourcePath: string, destinationPath: string): boolean {
  if (process.platform !== "win32") return false
  const source = normalize(resolve(sourcePath))
  const destination = normalize(resolve(destinationPath))
  return source !== destination && source.toLocaleLowerCase("en-US") === destination.toLocaleLowerCase("en-US")
}

function receipt(original: ReaderFileMutation, inverse: ReaderFileMutation, guard: ReaderFileMutationGuard): ReaderFileUndoReceipt {
  return { original, inverse, guard }
}

async function snapshot(path: string): Promise<ReaderFileMutationGuard> {
  const value = await lstat(path)
  return {
    path,
    kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : value.isSymbolicLink() ? "symbolic-link" : "other",
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
    device: value.dev,
    inode: value.ino,
  }
}

function sameGuard(left: ReaderFileMutationGuard, right: ReaderFileMutationGuard): boolean {
  return left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs && left.device === right.device && left.inode === right.inode
}

function stalePath(path: string): Error {
  return Object.assign(new Error(`Undo target changed after the operation: ${path}`), { code: "ESTALE" })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}

async function assertDestinationAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return
    throw error
  }
  throw Object.assign(new Error(`Destination already exists: ${path}`), { code: "EEXIST" })
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}
