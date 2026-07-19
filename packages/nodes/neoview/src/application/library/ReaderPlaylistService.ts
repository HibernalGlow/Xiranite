import type { ViewSource } from "../../domain/book/book.js"
import type {
  ReaderPlaylistEntryRecord,
  ReaderPlaylistRecord,
  ReaderPlaylistStore,
} from "../../ports/ReaderPlaylistStore.js"

const MAX_PLAYLISTS = 1_000
const MAX_ENTRIES = 10_000
const MAX_MUTATION_ENTRIES = 500

export interface SaveReaderPlaylistInput {
  id?: string
  name: string
  createdAt?: number
}

export interface AppendReaderPlaylistEntryInput {
  id?: string
  source: ViewSource
  name: string
  createdAt?: number
}

/**
 * Application contract for ordered reader playlists. It deliberately owns no
 * database connection: the runtime composition can share its existing store.
 */
export class ReaderPlaylistService {
  constructor(
    private readonly store: ReaderPlaylistStore,
    private readonly clock: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  list(): Promise<readonly ReaderPlaylistRecord[]> {
    return this.store.listPlaylists()
  }

  async save(input: SaveReaderPlaylistInput): Promise<ReaderPlaylistRecord> {
    const now = currentTimestamp(this.clock)
    const id = normalizedId(input.id ?? this.createId(), "playlist id")
    const name = normalizedName(input.name, "playlist name")
    const existing = input.id === undefined ? undefined : await this.store.getPlaylist(id)
    if (!existing && (await this.store.listPlaylists()).length >= MAX_PLAYLISTS) {
      throw new Error(`Reader playlists are limited to ${MAX_PLAYLISTS}.`)
    }
    const playlist: ReaderPlaylistRecord = {
      id,
      name,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    }
    assertTimestamp(playlist.createdAt, "playlist createdAt")
    await this.store.upsertPlaylist(playlist)
    return playlist
  }

  remove(id: string): Promise<boolean> {
    return this.store.deletePlaylist(normalizedId(id, "playlist id"))
  }

  entries(playlistId: string): Promise<readonly ReaderPlaylistEntryRecord[]> {
    return this.store.listPlaylistEntries(normalizedId(playlistId, "playlist id"))
  }

  async append(playlistId: string, inputs: readonly AppendReaderPlaylistEntryInput[]): Promise<readonly ReaderPlaylistEntryRecord[]> {
    const normalizedPlaylistId = normalizedId(playlistId, "playlist id")
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_MUTATION_ENTRIES) {
      throw new Error(`Reader playlist append must contain from 1 to ${MAX_MUTATION_ENTRIES} entries.`)
    }
    if (!await this.store.getPlaylist(normalizedPlaylistId)) throw new Error("Reader playlist does not exist.")
    const existing = await this.store.listPlaylistEntries(normalizedPlaylistId)
    if (existing.length + inputs.length > MAX_ENTRIES) throw new Error(`Reader playlist entries are limited to ${MAX_ENTRIES}.`)
    const ids = new Set(existing.map((entry) => entry.id))
    const now = currentTimestamp(this.clock)
    const entries = inputs.map((input, index) => {
      const id = normalizedId(input.id ?? this.createId(), "playlist entry id")
      if (ids.has(id)) throw new Error(`Reader playlist entry id '${id}' already exists.`)
      ids.add(id)
      const name = normalizedName(input.name, "playlist entry name")
      const createdAt = input.createdAt ?? now
      assertTimestamp(createdAt, "playlist entry createdAt")
      assertSource(input.source)
      return { id, playlistId: normalizedPlaylistId, source: input.source, name, position: existing.length + index, createdAt }
    })
    await this.store.appendPlaylistEntries(normalizedPlaylistId, entries, now)
    return entries
  }

  async removeEntries(playlistId: string, entryIds: readonly string[]): Promise<number> {
    const normalizedPlaylistId = normalizedId(playlistId, "playlist id")
    const ids = normalizedBatchIds(entryIds, "playlist entry removal")
    return this.store.deletePlaylistEntries(normalizedPlaylistId, ids, currentTimestamp(this.clock))
  }

  async reorder(playlistId: string, entryIds: readonly string[]): Promise<void> {
    const normalizedPlaylistId = normalizedId(playlistId, "playlist id")
    const ids = normalizedBatchIds(entryIds, "playlist order", MAX_ENTRIES, true)
    const existing = await this.store.listPlaylistEntries(normalizedPlaylistId)
    if (existing.length !== ids.length || existing.some((entry) => !ids.includes(entry.id))) {
      throw new Error("Reader playlist order must include every existing entry exactly once.")
    }
    await this.store.replacePlaylistEntryOrder(normalizedPlaylistId, ids, currentTimestamp(this.clock))
  }
}

function normalizedBatchIds(value: readonly string[], name: string, maximum = MAX_MUTATION_ENTRIES, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > maximum) {
    throw new Error(`Reader ${name} must contain ${allowEmpty ? `at most ${maximum}` : `from 1 to ${maximum}`} ids.`)
  }
  const ids = value.map((id) => normalizedId(id, `${name} id`))
  if (new Set(ids).size !== ids.length) throw new Error(`Reader ${name} contains duplicate ids.`)
  return ids
}

function normalizedId(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`Reader ${name} must be a string.`)
  const id = value.trim()
  if (!id || id.length > 128 || id.includes("\0")) throw new Error(`Reader ${name} is invalid.`)
  return id
}

function normalizedName(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`Reader ${name} must be a string.`)
  const text = value.trim()
  if (!text || text.length > 512 || text.includes("\0")) throw new Error(`Reader ${name} is invalid.`)
  return text
}

function currentTimestamp(clock: () => number): number {
  const value = clock()
  assertTimestamp(value, "clock")
  return value
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Reader ${name} is invalid.`)
}

function assertSource(value: ViewSource): void {
  if (!value || typeof value !== "object" || typeof value.path !== "string" || !value.path.trim() || value.path.includes("\0")) {
    throw new Error("Reader playlist entry source is invalid.")
  }
}
