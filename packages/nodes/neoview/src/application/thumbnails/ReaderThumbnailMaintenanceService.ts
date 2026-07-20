import type {
  ReaderThumbnailInvalidCleanupResult,
  ReaderThumbnailMaintenanceSnapshot,
  ReaderThumbnailStore,
} from "../../ports/ReaderThumbnailStore.js"

export type ReaderThumbnailMaintenancePort = Pick<
  ReaderThumbnailStore,
  "maintenanceSnapshot" | "cleanup" | "cleanupInvalid" | "clearFailures" | "clearFolderRepresentativeManifests"
>

export type ReaderThumbnailMaintenanceStatus =
  | { enabled: false }
  | { enabled: true; snapshot: ReaderThumbnailMaintenanceSnapshot }

export type ReaderThumbnailCleanupCommand =
  | { kind: "empty"; limit: number }
  | { kind: "expired"; days: number; limit: number }
  | { kind: "invalid"; scanLimit: number; deleteLimit: number }
  | { kind: "path-prefix"; prefix: string; limit: number }

export type ReaderThumbnailCleanupResult =
  | { enabled: false }
  | { enabled: true; kind: "empty"; deleted: number }
  | { enabled: true; kind: "expired"; deleted: number; cutoff: string; foldersPreserved: true }
  | { enabled: true; kind: "invalid"; result: ReaderThumbnailInvalidCleanupResult }
  | { enabled: true; kind: "path-prefix"; prefix: string; deleted: number }

export type ReaderThumbnailFailureCleanupResult =
  | { enabled: false }
  | { enabled: true; deleted: number }

export type ReaderFolderManifestCleanupResult =
  | { enabled: false }
  | { enabled: true; prefix: string; deleted: number }

export class ReaderThumbnailMaintenanceService {
  readonly #store?: ReaderThumbnailMaintenancePort
  readonly #now: () => number

  constructor(store?: ReaderThumbnailMaintenancePort, options: { now?: () => number } = {}) {
    this.#store = store
    this.#now = options.now ?? Date.now
  }

  async status(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceStatus> {
    signal?.throwIfAborted()
    const operation = this.#store?.maintenanceSnapshot
    if (!operation) return { enabled: false }
    const snapshot = await operation.call(this.#store, signal)
    signal?.throwIfAborted()
    return { enabled: true, snapshot }
  }

  async cleanup(command: ReaderThumbnailCleanupCommand, signal?: AbortSignal): Promise<ReaderThumbnailCleanupResult> {
    signal?.throwIfAborted()
    if (command.kind === "invalid") {
      assertInteger(command.scanLimit, "scanLimit", 1, 2_000)
      assertInteger(command.deleteLimit, "deleteLimit", 1, 500)
      const operation = this.#store?.cleanupInvalid
      if (!operation) return { enabled: false }
      const result = await operation.call(this.#store, {
        scanLimit: command.scanLimit,
        deleteLimit: command.deleteLimit,
      }, signal)
      signal?.throwIfAborted()
      return {
        enabled: true,
        kind: command.kind,
        result,
      }
    }

    if (command.kind === "path-prefix") {
      const prefix = validatePathPrefix(command.prefix)
      assertInteger(command.limit, "limit", 1, 10_000)
      const operation = this.#store?.cleanup
      if (!operation) return { enabled: false }
      const deleted = await operation.call(this.#store, { kind: command.kind, prefix, limit: command.limit }, signal)
      signal?.throwIfAborted()
      return {
        enabled: true,
        kind: command.kind,
        prefix,
        deleted,
      }
    }

    assertInteger(command.limit, "limit", 1, 10_000)
    const operation = this.#store?.cleanup
    if (!operation) return { enabled: false }
    if (command.kind === "empty") {
      const deleted = await operation.call(this.#store, { kind: command.kind, limit: command.limit }, signal)
      signal?.throwIfAborted()
      return {
        enabled: true,
        kind: command.kind,
        deleted,
      }
    }

    assertInteger(command.days, "days", 1, 3_650)
    const cutoff = sqliteTimestamp(new Date(this.#now() - command.days * 86_400_000))
    const deleted = await operation.call(this.#store, {
      kind: command.kind,
      cutoff,
      limit: command.limit,
      preserveFolders: true,
    }, signal)
    signal?.throwIfAborted()
    return {
      enabled: true,
      kind: command.kind,
      deleted,
      cutoff,
      foldersPreserved: true,
    }
  }

  async clearFailures(options: { reason?: string; limit: number }, signal?: AbortSignal): Promise<ReaderThumbnailFailureCleanupResult> {
    signal?.throwIfAborted()
    assertInteger(options.limit, "limit", 1, 10_000)
    if (options.reason !== undefined && (!options.reason || options.reason.length > 128)) {
      throw new RangeError("reason must be 1..128 characters when provided")
    }
    const operation = this.#store?.clearFailures
    if (!operation) return { enabled: false }
    const deleted = await operation.call(this.#store, { reason: options.reason, limit: options.limit }, signal)
    signal?.throwIfAborted()
    return {
      enabled: true,
      deleted,
    }
  }

  async clearFolderRepresentativeManifests(
    options: { prefix: string; limit: number },
    signal?: AbortSignal,
  ): Promise<ReaderFolderManifestCleanupResult> {
    signal?.throwIfAborted()
    const prefix = validatePathPrefix(options.prefix)
    assertInteger(options.limit, "limit", 1, 1_000)
    const operation = this.#store?.clearFolderRepresentativeManifests
    if (!operation) return { enabled: false }
    const deleted = await operation.call(this.#store, { prefix, limit: options.limit }, signal)
    signal?.throwIfAborted()
    return { enabled: true, prefix, deleted }
  }
}

function sqliteTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19)
}

function assertInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
}

function validatePathPrefix(value: string): string {
  if (typeof value !== "string") throw new TypeError("prefix must be a string.")
  const prefix = value.trim()
  if (!prefix || prefix.length > 4_096 || prefix.includes("\0")) {
    throw new RangeError("prefix must be 1..4096 characters without NUL.")
  }
  return prefix
}
