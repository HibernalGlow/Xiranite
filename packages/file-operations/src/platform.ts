import { cp, lstat, mkdir, rename as renamePath, rm } from "node:fs/promises"
import { basename, dirname, normalize, resolve } from "node:path"
import {
  getTrashCapabilities,
  listTrashItems,
  restoreTrashItem,
  trashPath,
  type TrashCapabilities,
  type TrashItemReceipt,
  type TrashPathResult,
} from "@xiranite/czkawka-native"
import { moveFile, renameFile } from "move-file"

import type {
  FileMutation,
  FileMutationGuard,
  FileMutationProvider,
  FileOperationScheduler,
  FileUndoReceipt,
} from "./types.js"

export interface PlatformFileMutationProviderOptions {
  scheduler?: FileOperationScheduler
  ownerId?: string
  move?: typeof moveFile
  rename?: typeof renameFile
  trash?: (path: string) => Promise<TrashPathResult>
  restoreTrash?: (receipt: TrashItemReceipt) => Promise<void>
  listTrash?: () => Promise<TrashItemReceipt[]>
  trashCapabilities?: TrashCapabilities
}

export class PlatformFileMutationProvider implements FileMutationProvider {
  readonly #scheduler?: FileOperationScheduler
  readonly #ownerId: string
  readonly #move: typeof moveFile
  readonly #rename: typeof renameFile
  readonly #trash: (path: string) => Promise<TrashPathResult>
  readonly #restoreTrash?: (receipt: TrashItemReceipt) => Promise<void>
  readonly #listTrash?: () => Promise<TrashItemReceipt[]>
  readonly trashRestore: boolean

  constructor(options: PlatformFileMutationProviderOptions = {}) {
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "xiranite:file-operations"
    this.#move = options.move ?? moveFile
    this.#rename = options.rename ?? renameFile
    this.#trash = options.trash ?? trashPath
    const capabilities = options.trashCapabilities ?? getTrashCapabilities()
    this.#restoreTrash = capabilities.restore ? options.restoreTrash ?? restoreTrashItem : undefined
    this.#listTrash = capabilities.list ? options.listTrash ?? listTrashItems : undefined
    this.trashRestore = Boolean(this.#restoreTrash)
  }

  async execute(operation: FileMutation, signal?: AbortSignal): Promise<FileUndoReceipt | undefined> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: `file.${operation.kind}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      signal?.throwIfAborted()
      return await this.#execute(operation, true)
    } finally {
      lease?.release()
    }
  }

  async undo(receipt: FileUndoReceipt, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: "file.undo",
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      if (receipt.original.kind === "trash") {
        if (!this.#restoreTrash || !receipt.providerData) {
          throw Object.assign(new Error("Trash restore is unavailable for this receipt."), { code: "ENOTSUP" })
        }
        if (await pathExists(receipt.guard.path)) throw stalePath(receipt.guard.path)
        const item = receipt.providerData.kind === "trash-rs"
          ? receipt.providerData.item
          : await this.#resolveLegacyTrashItem(receipt.original.sourcePath)
        await this.#restoreTrash(item)
        await waitForRestoredPath(receipt.original.sourcePath, receipt.guard)
        return
      }
      const current = await snapshot(receipt.guard.path)
      if (!sameGuard(current, receipt.guard)) throw stalePath(receipt.guard.path)
      await this.#execute(receipt.inverse, false)
    } finally {
      lease?.release()
    }
  }

  async #resolveLegacyTrashItem(sourcePath: string): Promise<TrashItemReceipt> {
    if (!this.#listTrash) throw Object.assign(new Error("Legacy trash receipt lookup is unavailable."), { code: "ENOTSUP" })
    const item = (await this.#listTrash())
      .filter((candidate) => samePath(joinTrashPath(candidate.originalParent, candidate.name), sourcePath))
      .sort((left, right) => right.timeDeleted - left.timeDeleted || right.id.localeCompare(left.id))[0]
    if (!item) throw Object.assign(new Error(`Recycle bin item was not found for: ${sourcePath}`), { code: "ENOENT" })
    return item
  }

  async #execute(operation: FileMutation, createUndo: boolean): Promise<FileUndoReceipt | undefined> {
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
          ? receipt(operation, { kind: "move", sourcePath: operation.destinationPath, destinationPath: operation.sourcePath }, await snapshot(operation.destinationPath))
          : undefined
      }
      case "rename": {
        const sourceDirectory = dirname(operation.sourcePath)
        if (sourceDirectory !== dirname(operation.destinationPath)) {
          throw Object.assign(new Error("Rename source and destination must share a directory."), { code: "EXDEV" })
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
          ? receipt(operation, { kind: "rename", sourcePath: operation.destinationPath, destinationPath: operation.sourcePath }, await snapshot(operation.destinationPath))
          : undefined
      }
      case "delete":
        await rm(operation.sourcePath, { recursive: true, force: false })
        return undefined
      case "trash": {
        const guard = await snapshot(operation.sourcePath)
        const result = await this.#trash(operation.sourcePath)
        return createUndo && result.receipt && this.trashRestore
          ? receipt(operation, operation, guard, { kind: "trash-rs", item: result.receipt })
          : undefined
      }
      case "create-directory":
        await mkdir(operation.destinationPath, { recursive: false })
        return createUndo
          ? receipt(operation, { kind: "delete", sourcePath: operation.destinationPath }, await snapshot(operation.destinationPath))
          : undefined
    }
  }
}

function receipt(
  original: FileMutation,
  inverse: FileMutation,
  guard: FileMutationGuard,
  providerData?: FileUndoReceipt["providerData"],
): FileUndoReceipt {
  return { original, inverse, guard, providerData }
}

async function snapshot(path: string): Promise<FileMutationGuard> {
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

function sameGuard(left: FileMutationGuard, right: FileMutationGuard): boolean {
  return left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs && left.device === right.device && left.inode === right.inode
}

function isWindowsCaseOnlyRename(sourcePath: string, destinationPath: string): boolean {
  if (process.platform !== "win32") return false
  const source = normalize(resolve(sourcePath))
  const destination = normalize(resolve(destinationPath))
  return source !== destination && source.toLocaleLowerCase("en-US") === destination.toLocaleLowerCase("en-US")
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
  if (!await pathExists(path)) return
  throw Object.assign(new Error(`Destination already exists: ${path}`), { code: "EEXIST" })
}

async function waitForRestoredPath(path: string, guard: FileMutationGuard): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const restored = await snapshot(path)
      if (restored.kind === guard.kind && (guard.kind !== "file" || restored.size === guard.size)) return
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw Object.assign(new Error(`Trash restore did not recreate the original path: ${path}`), { code: "ENOENT" })
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function joinTrashPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, "")}\\${name}`
}

function samePath(left: string, right: string): boolean {
  const comparable = (value: string) => {
    let normalized = value.replaceAll("/", "\\")
    if (normalized.startsWith("\\\\?\\UNC\\")) normalized = `\\\\${normalized.slice(8)}`
    else if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4)
    normalized = normalized.replace(/[\\]+$/, "")
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
  }
  return comparable(left) === comparable(right)
}
