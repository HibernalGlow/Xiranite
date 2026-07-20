import { execFile } from "node:child_process"
import { cp, lstat, mkdir, rename as renamePath, rm } from "node:fs/promises"
import { basename, dirname, normalize, resolve } from "node:path"
import { promisify } from "node:util"
import { moveFile, renameFile } from "move-file"
import trash from "trash"

import type {
  ReaderFileMutation,
  ReaderFileMutationGuard,
  ReaderFileMutationProvider,
  ReaderFileUndoReceipt,
} from "../../ports/ReaderFileMutationProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

const execFileAsync = promisify(execFile)
export const WINDOWS_FIND_TRASH_ITEM_SCRIPT = [
  "$target = [IO.Path]::GetFullPath($env:XIRANITE_TRASH_SOURCE)",
  "$parent = [IO.Path]::GetDirectoryName($target)",
  "$name = [IO.Path]::GetFileName($target)",
  "$bin = (New-Object -ComObject Shell.Application).Namespace(10)",
  "if ($null -eq $bin) { exit 2 }",
  "$item = $null",
  "for ($attempt = 0; $attempt -lt 20 -and $null -eq $item; $attempt += 1) {",
  "  $item = $bin.Items() | Where-Object {",
  "    $from = $_.ExtendedProperty('System.Recycle.DeletedFrom')",
  "    $displayName = $_.ExtendedProperty('System.ItemNameDisplay')",
  "    if (-not $displayName) { $displayName = $_.Name }",
  "    $from -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$from), [IO.Path]::GetFullPath($parent)) -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$displayName, $name)",
  "  } | Sort-Object -Property @{ Expression = { $_.ExtendedProperty('System.Recycle.DateDeleted') }; Descending = $true } | Select-Object -First 1",
  "  if ($null -eq $item) { Start-Sleep -Milliseconds 50 }",
  "}",
  "if ($null -eq $item) { exit 3 }",
  "Write-Output $item.Path",
].join("\n")
const WINDOWS_RESTORE_SCRIPT = "$bin = (New-Object -ComObject Shell.Application).Namespace(10); if ($null -eq $bin) { exit 2 }; $item = $bin.Items() | Where-Object { [StringComparer]::OrdinalIgnoreCase.Equals([string]$_.Path, $env:XIRANITE_TRASH_ITEM) } | Select-Object -First 1; if ($null -eq $item) { exit 3 }; $item.InvokeVerb('undelete')"

export interface PlatformReaderFileMutationProviderOptions {
  scheduler?: ResourceScheduler
  ownerId?: string
  move?: typeof moveFile
  rename?: typeof renameFile
  trash?: (path: string) => Promise<void>
  restoreTrash?: (path: string, itemPath: string, signal?: AbortSignal) => Promise<void>
  identifyTrash?: (path: string, signal?: AbortSignal) => Promise<string | undefined>
}

export class PlatformReaderFileMutationProvider implements ReaderFileMutationProvider {
  readonly #scheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #move: typeof moveFile
  readonly #rename: typeof renameFile
  readonly #trash: (path: string) => Promise<void>
  readonly #restoreTrash?: (path: string, itemPath: string, signal?: AbortSignal) => Promise<void>
  readonly #identifyTrash?: (path: string, signal?: AbortSignal) => Promise<string | undefined>
  readonly trashRestore: boolean

  constructor(options: PlatformReaderFileMutationProviderOptions = {}) {
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "neoview:file-operations"
    this.#move = options.move ?? moveFile
    this.#rename = options.rename ?? renameFile
    const usesDefaultTrash = options.trash === undefined
    this.#trash = options.trash ?? ((path) => trash(path, { glob: false }))
    this.#restoreTrash = options.restoreTrash
    this.#identifyTrash = options.identifyTrash ?? (process.platform === "win32" && usesDefaultTrash ? identifyWindowsTrash : undefined)
    if (options.restoreTrash === undefined && process.platform === "win32" && usesDefaultTrash) this.#restoreTrash = restoreWindowsTrash
    this.trashRestore = Boolean(this.#restoreTrash && this.#identifyTrash)
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
      const receipt = await this.#execute(operation, true)
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
      if (receipt.original.kind === "trash") {
        if (!this.#restoreTrash || receipt.providerData?.kind !== "windows-recycle-bin") {
          throw new Error("Reader trash restore is unavailable for this receipt.")
        }
        if (await pathExists(receipt.guard.path)) throw stalePath(receipt.guard.path)
        await this.#restoreTrash(receipt.original.sourcePath, receipt.providerData.itemPath, signal)
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
      case "trash": {
        const guard = await snapshot(operation.sourcePath)
        await this.#trash(operation.sourcePath)
        if (!createUndo || !this.trashRestore) return undefined
        let itemPath: string | undefined
        try {
          itemPath = await this.#identifyTrash!(operation.sourcePath)
        } catch {
          // The trash mutation already succeeded; report it as non-undoable when item capture fails.
          return undefined
        }
        return itemPath ? receipt(operation, operation, guard, { kind: "windows-recycle-bin", itemPath }) : undefined
      }
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

function receipt(
  original: ReaderFileMutation,
  inverse: ReaderFileMutation,
  guard: ReaderFileMutationGuard,
  providerData?: ReaderFileUndoReceipt["providerData"],
): ReaderFileUndoReceipt {
  return { original, inverse, guard, providerData }
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

async function identifyWindowsTrash(path: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted()
  const result = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_FIND_TRASH_ITEM_SCRIPT,
  ], {
    env: { ...process.env, XIRANITE_TRASH_SOURCE: path },
    windowsHide: true,
    maxBuffer: 256 * 1024,
  })
  const itemPath = result.stdout.trim()
  return itemPath || undefined
}

async function restoreWindowsTrash(_path: string, itemPath: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_RESTORE_SCRIPT,
  ], {
    env: { ...process.env, XIRANITE_TRASH_ITEM: itemPath },
    windowsHide: true,
    maxBuffer: 256 * 1024,
  })
}

async function waitForRestoredPath(path: string, guard: ReaderFileMutationGuard): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await pathMatchesRestoredShape(path, guard)) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw Object.assign(new Error(`Reader trash restore did not recreate the original path: ${path}`), { code: "ENOENT" })
}

async function pathMatchesRestoredShape(path: string, guard: ReaderFileMutationGuard): Promise<boolean> {
  try {
    const restored = await snapshot(path)
    return restored.kind === guard.kind && (guard.kind !== "file" || restored.size === guard.size)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}
