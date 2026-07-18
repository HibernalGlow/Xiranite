import { open } from "node:fs/promises"

import type { ReaderBookSettingsMigrationInspection } from "../../application/migration/ReaderBookSettingsMigrationService.js"
import type { LegacyBookSettingsImportResult } from "../../migration/LegacyBookSettingsImporter.js"
import { LegacyBookSettingsCodec } from "../../migration/LegacyBookSettingsCodec.js"

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export interface ReaderBookSettingsMigrationFilePort {
  inspect(inputPath: string, signal?: AbortSignal): Promise<ReaderBookSettingsMigrationInspection>
  import(
    inputPath: string,
    databasePath: string | undefined,
    strategy: "merge" | "overwrite",
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<ReaderBookSettingsMigrationFileImportResult>
}

export interface ReaderBookSettingsMigrationFileImportResult extends ReaderBookSettingsMigrationInspection {
  result: LegacyBookSettingsImportResult
}

export interface ReaderBookSettingsMigrationOwnedService extends AsyncDisposable {
  import(
    content: string,
    strategy: "merge" | "overwrite",
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<LegacyBookSettingsImportResult>
}

export interface ReaderBookSettingsMigrationFileControllerOptions {
  createService: (databasePath?: string) => Promise<ReaderBookSettingsMigrationOwnedService>
  maxBytes?: number
}

export class ReaderBookSettingsMigrationFileController implements ReaderBookSettingsMigrationFilePort {
  readonly #maxBytes: number
  readonly #codec = new LegacyBookSettingsCodec()

  constructor(private readonly options: ReaderBookSettingsMigrationFileControllerOptions) {
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1) {
      throw new RangeError("Legacy book settings maximum bytes must be a positive safe integer.")
    }
  }

  async inspect(inputPath: string, signal?: AbortSignal): Promise<ReaderBookSettingsMigrationInspection> {
    const content = await this.#read(inputPath, signal)
    return { report: this.#codec.decode(content).report }
  }

  async import(
    inputPath: string,
    databasePath: string | undefined,
    strategy: "merge" | "overwrite",
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<ReaderBookSettingsMigrationFileImportResult> {
    if (!confirmed) throw new Error("Legacy book settings import requires explicit confirmation after inspection.")
    const content = await this.#read(inputPath, signal)
    const inspection = { report: this.#codec.decode(content).report }
    signal?.throwIfAborted()
    const service = await this.options.createService(databasePath)
    try {
      const result = await service.import(content, strategy, true, signal)
      return { ...inspection, result }
    } finally {
      await service[Symbol.asyncDispose]()
    }
  }

  async #read(inputPath: string, signal?: AbortSignal): Promise<string> {
    const path = inputPath.trim()
    if (!path) throw new Error("Legacy book settings input path is required.")
    signal?.throwIfAborted()
    const file = await open(path, "r")
    try {
      const stats = await file.stat()
      if (!stats.isFile()) throw new Error(`Legacy book settings input is not a file: ${path}`)
      if (stats.size > this.#maxBytes) throw new Error(`Legacy book settings input exceeds ${this.#maxBytes} bytes.`)
      signal?.throwIfAborted()
      const content = await file.readFile({ encoding: "utf8", signal })
      if (Buffer.byteLength(content, "utf8") > this.#maxBytes) {
        throw new Error(`Legacy book settings input exceeds ${this.#maxBytes} bytes.`)
      }
      return content
    } finally {
      await file.close()
    }
  }
}
