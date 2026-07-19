import type { ViewSource } from "../domain/book/book.js"

export interface ReaderPlaylistRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface ReaderPlaylistEntryRecord {
  id: string
  playlistId: string
  source: ViewSource
  name: string
  position: number
  createdAt: number
}

/** Persistent ordered playlists. Implementations must apply structural mutations atomically. */
export interface ReaderPlaylistStore extends AsyncDisposable {
  listPlaylists(): Promise<readonly ReaderPlaylistRecord[]>
  getPlaylist(id: string): Promise<ReaderPlaylistRecord | undefined>
  upsertPlaylist(playlist: ReaderPlaylistRecord): Promise<void>
  deletePlaylist(id: string): Promise<boolean>
  listPlaylistEntries(playlistId: string): Promise<readonly ReaderPlaylistEntryRecord[]>
  appendPlaylistEntries(playlistId: string, entries: readonly ReaderPlaylistEntryRecord[], updatedAt: number): Promise<void>
  deletePlaylistEntries(playlistId: string, entryIds: readonly string[], updatedAt: number): Promise<number>
  replacePlaylistEntryOrder(playlistId: string, entryIds: readonly string[], updatedAt: number): Promise<void>
  close(): Promise<void>
}
