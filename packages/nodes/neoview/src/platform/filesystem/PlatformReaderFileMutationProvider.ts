import { cp, lstat, mkdir, rm, stat } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { moveFile, renameFile } from "move-file"
import trash from "trash"

import type { ReaderFileMutation, ReaderFileMutationProvider } from "../../ports/ReaderFileMutationProvider.js"
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

  async execute(operation: ReaderFileMutation, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: `reader.file.${operation.kind}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      signal?.throwIfAborted()
      await this.#execute(operation)
      signal?.throwIfAborted()
    } finally {
      lease?.release()
    }
  }

  async #execute(operation: ReaderFileMutation): Promise<void> {
    switch (operation.kind) {
      case "copy":
        if (operation.overwrite !== true) await assertDestinationAbsent(operation.destinationPath)
        await cp(operation.sourcePath, operation.destinationPath, {
          recursive: true,
          force: operation.overwrite === true,
          errorOnExist: operation.overwrite !== true,
          preserveTimestamps: true,
        })
        return
      case "move":
        await this.#move(operation.sourcePath, operation.destinationPath, { overwrite: operation.overwrite === true })
        return
      case "rename": {
        const sourceDirectory = dirname(operation.sourcePath)
        if (sourceDirectory !== dirname(operation.destinationPath)) {
          throw Object.assign(new Error("Reader rename source and destination must share a directory."), { code: "EXDEV" })
        }
        await this.#rename(basename(operation.sourcePath), basename(operation.destinationPath), {
          cwd: sourceDirectory,
          overwrite: operation.overwrite === true,
        })
        return
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
    }
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
