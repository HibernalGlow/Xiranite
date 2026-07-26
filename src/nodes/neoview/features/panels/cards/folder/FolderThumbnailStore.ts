import { isManagedFolderThumbnailUrl } from "./FolderThumbnailProbe"

export interface FolderThumbnailSnapshot {
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets: ReadonlyMap<string, readonly string[]>
  thumbnailProfiles: ReadonlyMap<string, string>
}

export type FolderThumbnailAvailability =
  | "missing"
  | "checking"
  | "generating"
  | "ready"
  | "unavailable"
  | "failed"

export interface FolderThumbnailEntrySnapshot {
  availability: FolderThumbnailAvailability
  revision: number
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
}

type FolderThumbnailDemandHandler = (paths: ReadonlySet<string>, force: boolean) => void

const MISSING_ENTRY_SNAPSHOT: FolderThumbnailEntrySnapshot = Object.freeze({ availability: "missing", revision: 0 })
const MAX_STALE_RECOVERIES = 1
let thumbnailStoreSequence = 0

export class FolderThumbnailStore {
  readonly queryScope = ++thumbnailStoreSequence
  readonly #pathListeners = new Map<string, Set<() => void>>()
  readonly #listeners = new Set<() => void>()
  readonly #entrySnapshots = new Map<string, FolderThumbnailEntrySnapshot>()
  readonly #availability = new Map<string, FolderThumbnailAvailability>()
  readonly #revisions = new Map<string, number>()
  readonly #activeCounts = new Map<string, number>()
  readonly #registrationTokens = new Map<string, number>()
  readonly #staleRecoveries = new Map<string, number>()
  readonly #pendingDemands = new Map<string, boolean>()
  #demandHandler?: FolderThumbnailDemandHandler
  #demandQueued = false
  #snapshot: FolderThumbnailSnapshot = emptyFolderThumbnailSnapshot()

  snapshot(): FolderThumbnailSnapshot {
    return this.#snapshot
  }

  entry(path?: string): FolderThumbnailEntrySnapshot {
    if (!path) return MISSING_ENTRY_SNAPSHOT
    return this.#entrySnapshots.get(path) ?? MISSING_ENTRY_SNAPSHOT
  }

  size(): number {
    return this.#snapshot.thumbnailUrls.size
  }

  subscribe(path: string | undefined, listener: () => void): () => void {
    if (!path) return () => undefined
    const listeners = this.#pathListeners.get(path) ?? new Set()
    listeners.add(listener)
    this.#pathListeners.set(path, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.#pathListeners.delete(path)
    }
  }

  subscribeAll(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  activate(path?: string): () => void {
    if (!path) return () => undefined
    const count = this.#activeCounts.get(path) ?? 0
    this.#activeCounts.set(path, count + 1)
    if (count === 0) this.#activatePath(path)
    return () => this.#deactivate(path)
  }

  setDemandHandler(handler: FolderThumbnailDemandHandler | undefined): void {
    this.#demandHandler = handler
    if (!handler) {
      this.#pendingDemands.clear()
      return
    }
    for (const path of this.#activeCounts.keys()) {
      if (!this.#candidateUrls(path).length) this.#queueDemand(path, false)
    }
    const pending = this.#pendingDemands.entries().next().value as [string, boolean] | undefined
    if (pending) this.#queueDemand(pending[0], pending[1])
  }

  beginRegistration(paths: ReadonlySet<string>, token: number, resetRecovery = false): void {
    for (const path of paths) {
      this.#registrationTokens.set(path, token)
      this.#pendingDemands.delete(path)
      if (resetRecovery) this.#staleRecoveries.delete(path)
      if (this.#availability.get(path) !== "ready") this.#setAvailability(path, "checking")
    }
  }

  completeRegistration(
    snapshot: FolderThumbnailSnapshot,
    requestedPaths: ReadonlySet<string>,
    returnedPaths: ReadonlySet<string>,
    token: number,
  ): void {
    this.replace(snapshot)
    for (const path of requestedPaths) {
      if (this.#registrationTokens.get(path) !== token) continue
      this.#registrationTokens.delete(path)
      if (!returnedPaths.has(path)) {
        this.#markUnavailable(path)
        continue
      }
      this.#incrementRevision(path)
      this.#setAvailability(path, this.#managedUrls(path).length ? "checking" : "ready")
    }
  }

  cancelRegistration(paths: ReadonlySet<string>, token: number, failed = false, requeueCancelled = true): void {
    for (const path of paths) {
      if (this.#registrationTokens.get(path) !== token) continue
      this.#registrationTokens.delete(path)
      if (failed) {
        this.#setAvailability(path, "failed")
      } else if (!this.#candidateUrls(path).length) {
        this.#setAvailability(path, "missing")
        if (requeueCancelled && this.#activeCounts.has(path)) this.#queueDemand(path, false)
      }
    }
  }

  reportProbeReady(path: string, revision: number): void {
    if (this.#currentRevision(path) !== revision) return
    this.#staleRecoveries.delete(path)
    this.#setAvailability(path, "ready")
  }

  reportProbeError(path: string, revision: number, recoverable: boolean): void {
    if (this.#currentRevision(path) !== revision) return
    if (!recoverable) {
      this.#setAvailability(path, "failed")
      return
    }
    const recoveries = this.#staleRecoveries.get(path) ?? 0
    if (recoveries >= MAX_STALE_RECOVERIES) {
      this.#markUnavailable(path)
      return
    }
    this.#staleRecoveries.set(path, recoveries + 1)
    this.#queueDemand(path, true)
  }

  replace(snapshot: FolderThumbnailSnapshot): void {
    const previous = this.#snapshot
    this.#snapshot = snapshot
    const paths = new Set([
      ...previous.thumbnailUrls.keys(),
      ...previous.thumbnailUrlSets.keys(),
      ...snapshot.thumbnailUrls.keys(),
      ...snapshot.thumbnailUrlSets.keys(),
      ...this.#activeCounts.keys(),
    ])
    for (const path of paths) {
      if (thumbnailCandidateKey(previous, path) !== thumbnailCandidateKey(snapshot, path)) {
        this.#staleRecoveries.delete(path)
        this.#incrementRevision(path)
        const candidates = this.#candidateUrls(path)
        if (candidates.length) this.#setAvailability(path, this.#managedUrls(path).length ? "checking" : "ready")
        else if (this.#activeCounts.has(path) && this.#demandHandler) this.#queueDemand(path, false)
        else this.#setAvailability(path, "missing")
      }
      this.#publishEntry(path)
    }
    for (const listener of this.#listeners) listener()
  }

  stop(): void {
    this.#pendingDemands.clear()
    this.#staleRecoveries.clear()
  }

  invalidateManagedEntries(): void {
    const paths = new Set([
      ...this.#snapshot.thumbnailUrls.keys(),
      ...this.#snapshot.thumbnailUrlSets.keys(),
    ])
    for (const path of paths) {
      if (!this.#managedUrls(path).length) continue
      this.#staleRecoveries.delete(path)
      this.#incrementRevision(path)
      this.#setAvailability(path, "checking")
    }
  }

  #activatePath(path: string): void {
    const candidates = this.#candidateUrls(path)
    if (!candidates.length) {
      if (this.#availability.get(path) === "unavailable") this.#staleRecoveries.delete(path)
      this.#queueDemand(path, false)
      return
    }
    const availability = this.#availability.get(path)
    if ((availability === "unavailable" || availability === "failed") && this.#managedUrls(path).length) {
      this.#staleRecoveries.delete(path)
      this.#incrementRevision(path)
      this.#setAvailability(path, "checking")
    }
  }

  #deactivate(path: string): void {
    const count = this.#activeCounts.get(path)
    if (!count) return
    if (count > 1) this.#activeCounts.set(path, count - 1)
    else this.#activeCounts.delete(path)
    if (count === 1) this.#pendingDemands.delete(path)
  }

  #queueDemand(path: string, force: boolean): void {
    if (this.#registrationTokens.has(path)) return
    this.#pendingDemands.set(path, (this.#pendingDemands.get(path) ?? false) || force)
    this.#setAvailability(path, "checking")
    if (!this.#demandHandler || this.#demandQueued) return
    this.#demandQueued = true
    queueMicrotask(() => {
      this.#demandQueued = false
      const handler = this.#demandHandler
      if (!handler || !this.#pendingDemands.size) return
      const demands = [...this.#pendingDemands]
      this.#pendingDemands.clear()
      handler(new Set(demands.map(([path]) => path)), demands.some(([, candidateForce]) => candidateForce))
    })
  }

  #markUnavailable(path: string): void {
    this.#pendingDemands.delete(path)
    this.#setAvailability(path, "unavailable")
  }

  #candidateUrls(path: string): readonly string[] {
    const urls = this.#snapshot.thumbnailUrlSets.get(path)
    const primary = this.#snapshot.thumbnailUrls.get(path)
    return [...new Set(urls?.length ? urls : primary ? [primary] : [])]
  }

  #managedUrls(path: string): readonly string[] {
    return this.#candidateUrls(path).filter(isManagedFolderThumbnailUrl)
  }

  #currentRevision(path: string): number {
    return this.#revisions.get(path) ?? 0
  }

  #incrementRevision(path: string): void {
    this.#revisions.set(path, this.#currentRevision(path) + 1)
    this.#publishEntry(path)
  }

  #setAvailability(path: string, availability: FolderThumbnailAvailability): void {
    if (this.#availability.get(path) === availability) return
    this.#availability.set(path, availability)
    this.#publishEntry(path)
  }

  #publishEntry(path: string): void {
    const previous = this.#entrySnapshots.get(path) ?? MISSING_ENTRY_SNAPSHOT
    const next = this.#createEntry(path)
    if (sameEntrySnapshot(previous, next)) return
    if (next === MISSING_ENTRY_SNAPSHOT) this.#entrySnapshots.delete(path)
    else this.#entrySnapshots.set(path, next)
    for (const listener of this.#pathListeners.get(path) ?? []) listener()
  }

  #createEntry(path: string): FolderThumbnailEntrySnapshot {
    const availability = this.#availability.get(path) ?? "missing"
    const revision = this.#currentRevision(path)
    const thumbnailUrls = this.#candidateUrls(path)
    if (!thumbnailUrls.length && availability === "missing" && revision === 0) return MISSING_ENTRY_SNAPSHOT
    return {
      availability,
      revision,
      ...(thumbnailUrls.length ? { thumbnailUrl: thumbnailUrls[0], thumbnailUrls } : {}),
    }
  }
}

export function emptyFolderThumbnailSnapshot(): FolderThumbnailSnapshot {
  return {
    thumbnailUrls: new Map(),
    thumbnailUrlSets: new Map(),
    thumbnailProfiles: new Map(),
  }
}

export function folderThumbnailIsLoading(availability: FolderThumbnailAvailability): boolean {
  return availability === "checking" || availability === "generating"
}

function thumbnailCandidateKey(snapshot: FolderThumbnailSnapshot, path: string): string {
  const urls = snapshot.thumbnailUrlSets.get(path)
  return (urls?.length ? urls : snapshot.thumbnailUrls.has(path) ? [snapshot.thumbnailUrls.get(path)!] : []).join("\0")
}

function sameEntrySnapshot(left: FolderThumbnailEntrySnapshot, right: FolderThumbnailEntrySnapshot): boolean {
  if (left.availability !== right.availability || left.revision !== right.revision || left.thumbnailUrl !== right.thumbnailUrl) return false
  if (left.thumbnailUrls === right.thumbnailUrls) return true
  if (!left.thumbnailUrls || !right.thumbnailUrls || left.thumbnailUrls.length !== right.thumbnailUrls.length) return false
  return left.thumbnailUrls.every((url, index) => url === right.thumbnailUrls?.[index])
}
