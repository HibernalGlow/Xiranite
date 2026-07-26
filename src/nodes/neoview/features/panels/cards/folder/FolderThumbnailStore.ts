export interface FolderThumbnailSnapshot {
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets: ReadonlyMap<string, readonly string[]>
  thumbnailProfiles: ReadonlyMap<string, string>
}

export interface FolderThumbnailEntrySnapshot {
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
}

const EMPTY_ENTRY_SNAPSHOT: FolderThumbnailEntrySnapshot = Object.freeze({})

export class FolderThumbnailStore {
  readonly #pathListeners = new Map<string, Set<() => void>>()
  readonly #listeners = new Set<() => void>()
  readonly #entrySnapshots = new Map<string, FolderThumbnailEntrySnapshot>()
  #snapshot: FolderThumbnailSnapshot = emptyFolderThumbnailSnapshot()

  snapshot(): FolderThumbnailSnapshot {
    return this.#snapshot
  }

  entry(path?: string): FolderThumbnailEntrySnapshot {
    if (!path) return EMPTY_ENTRY_SNAPSHOT
    return this.#entrySnapshots.get(path) ?? EMPTY_ENTRY_SNAPSHOT
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

  replace(snapshot: FolderThumbnailSnapshot): void {
    const previous = this.#snapshot
    this.#snapshot = snapshot
    const paths = new Set([
      ...previous.thumbnailUrls.keys(),
      ...previous.thumbnailUrlSets.keys(),
      ...snapshot.thumbnailUrls.keys(),
      ...snapshot.thumbnailUrlSets.keys(),
    ])
    for (const path of paths) {
      const previousEntry = this.#entrySnapshots.get(path) ?? EMPTY_ENTRY_SNAPSHOT
      const nextEntry = entrySnapshot(snapshot, path)
      if (sameEntrySnapshot(previousEntry, nextEntry)) continue
      if (nextEntry === EMPTY_ENTRY_SNAPSHOT) this.#entrySnapshots.delete(path)
      else this.#entrySnapshots.set(path, nextEntry)
      for (const listener of this.#pathListeners.get(path) ?? []) listener()
    }
    for (const listener of this.#listeners) listener()
  }
}

export function emptyFolderThumbnailSnapshot(): FolderThumbnailSnapshot {
  return {
    thumbnailUrls: new Map(),
    thumbnailUrlSets: new Map(),
    thumbnailProfiles: new Map(),
  }
}

function entrySnapshot(snapshot: FolderThumbnailSnapshot, path: string): FolderThumbnailEntrySnapshot {
  const thumbnailUrl = snapshot.thumbnailUrls.get(path)
  const thumbnailUrls = snapshot.thumbnailUrlSets.get(path)
  return thumbnailUrl || thumbnailUrls ? { thumbnailUrl, thumbnailUrls } : EMPTY_ENTRY_SNAPSHOT
}

function sameEntrySnapshot(left: FolderThumbnailEntrySnapshot, right: FolderThumbnailEntrySnapshot): boolean {
  if (left.thumbnailUrl !== right.thumbnailUrl) return false
  if (left.thumbnailUrls === right.thumbnailUrls) return true
  if (!left.thumbnailUrls || !right.thumbnailUrls || left.thumbnailUrls.length !== right.thumbnailUrls.length) return false
  return left.thumbnailUrls.every((url, index) => url === right.thumbnailUrls?.[index])
}
