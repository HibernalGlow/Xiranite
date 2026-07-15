import type {
  ReaderThumbnailInvalidCleanupResult,
  ReaderThumbnailMaintenanceSnapshot,
  ReaderThumbnailStore,
} from "../../ports/ReaderThumbnailStore.js"

export type ReaderThumbnailMaintenancePort = Pick<
  ReaderThumbnailStore,
  "maintenanceSnapshot" | "cleanup" | "cleanupInvalid" | "clearFailures"
>

export type ReaderThumbnailMaintenanceStatus =
  | { enabled: false }
  | { enabled: true; snapshot: ReaderThumbnailMaintenanceSnapshot }

export type ReaderThumbnailCleanupCommand =
  | { kind: "empty"; limit: number }
  | { kind: "expired"; days: number; limit: number }
  | { kind: "invalid"; scanLimit: number; deleteLimit: number }

export type ReaderThumbnailCleanupResult =
  | { enabled: false }
  | { enabled: true; kind: "empty"; deleted: number }
  | { enabled: true; kind: "expired"; deleted: number; cutoff: string; foldersPreserved: true }
  | { enabled: true; kind: "invalid"; result: ReaderThumbnailInvalidCleanupResult }

export type ReaderThumbnailFailureCleanupResult =
  | { enabled: false }
  | { enabled: true; deleted: number }

export class ReaderThumbnailMaintenanceService {
  readonly #store?: ReaderThumbnailMaintenancePort
  readonly #now: () => number

  constructor(store?: ReaderThumbnailMaintenancePort, options: { now?: () => number } = {}) {
    this.#store = store
    this.#now = options.now ?? Date.now
  }

  async status(): Promise<ReaderThumbnailMaintenanceStatus> {
    const operation = this.#store?.maintenanceSnapshot
    if (!operation) return { enabled: false }
    return { enabled: true, snapshot: await operation.call(this.#store) }
  }

  async cleanup(command: ReaderThumbnailCleanupCommand): Promise<ReaderThumbnailCleanupResult> {
    if (command.kind === "invalid") {
      assertInteger(command.scanLimit, "scanLimit", 1, 2_000)
      assertInteger(command.deleteLimit, "deleteLimit", 1, 500)
      const operation = this.#store?.cleanupInvalid
      if (!operation) return { enabled: false }
      return {
        enabled: true,
        kind: command.kind,
        result: await operation.call(this.#store, {
          scanLimit: command.scanLimit,
          deleteLimit: command.deleteLimit,
        }),
      }
    }

    assertInteger(command.limit, "limit", 1, 10_000)
    const operation = this.#store?.cleanup
    if (!operation) return { enabled: false }
    if (command.kind === "empty") {
      return {
        enabled: true,
        kind: command.kind,
        deleted: await operation.call(this.#store, { kind: command.kind, limit: command.limit }),
      }
    }

    assertInteger(command.days, "days", 1, 3_650)
    const cutoff = sqliteTimestamp(new Date(this.#now() - command.days * 86_400_000))
    return {
      enabled: true,
      kind: command.kind,
      deleted: await operation.call(this.#store, {
        kind: command.kind,
        cutoff,
        limit: command.limit,
        preserveFolders: true,
      }),
      cutoff,
      foldersPreserved: true,
    }
  }

  async clearFailures(options: { reason?: string; limit: number }): Promise<ReaderThumbnailFailureCleanupResult> {
    assertInteger(options.limit, "limit", 1, 10_000)
    if (options.reason !== undefined && (!options.reason || options.reason.length > 128)) {
      throw new RangeError("reason must be 1..128 characters when provided")
    }
    const operation = this.#store?.clearFailures
    if (!operation) return { enabled: false }
    return {
      enabled: true,
      deleted: await operation.call(this.#store, { reason: options.reason, limit: options.limit }),
    }
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
