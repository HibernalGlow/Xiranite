import { describe, expect, it, vi } from "vitest"

import type { ReaderPlaylistStore } from "../../ports/ReaderPlaylistStore.js"
import { ReaderPlaylistService } from "./ReaderPlaylistService.js"

describe("ReaderPlaylistService", () => {
  it("[neoview.playlist.core] creates, renames and appends stable ordered sources", async () => {
    const store = createStore()
    store.getPlaylist.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "reading", name: "Reading", createdAt: 10, updatedAt: 10 })
    store.listPlaylists.mockResolvedValue([])
    store.listPlaylistEntries.mockResolvedValue([])
    const service = new ReaderPlaylistService(store, () => 20, (() => {
      const ids = ["reading", "entry-1", "entry-2"]
      return () => ids.shift()!
    })())

    await expect(service.save({ name: " Reading " })).resolves.toEqual({ id: "reading", name: "Reading", createdAt: 20, updatedAt: 20 })
    await expect(service.save({ id: "reading", name: "Now reading", createdAt: 10 })).resolves.toEqual({
      id: "reading", name: "Now reading", createdAt: 10, updatedAt: 20,
    })
    await expect(service.append("reading", [
      { source: { kind: "archive", path: "D:/books/one.cbz" }, name: "One" },
      { source: { kind: "directory", path: "D:/books/two" }, name: "Two" },
    ])).resolves.toEqual([
      expect.objectContaining({ id: "entry-1", position: 0, name: "One" }),
      expect.objectContaining({ id: "entry-2", position: 1, name: "Two" }),
    ])
    expect(store.appendPlaylistEntries).toHaveBeenCalledWith("reading", expect.any(Array), 20)
  })

  it("[neoview.playlist.order] requires an exact non-duplicated order and never writes a partial reorder", async () => {
    const store = createStore()
    store.listPlaylistEntries.mockResolvedValue([
      entry("first", 0),
      entry("second", 1),
    ])
    const service = new ReaderPlaylistService(store, () => 30)

    await expect(service.reorder("reading", ["second", "first"])).resolves.toBeUndefined()
    expect(store.replacePlaylistEntryOrder).toHaveBeenCalledWith("reading", ["second", "first"], 30)
    await expect(service.reorder("reading", ["first", "missing"])).rejects.toThrow("every existing entry")
    await expect(service.reorder("reading", ["first", "first"])).rejects.toThrow("duplicate")
    expect(store.replacePlaylistEntryOrder).toHaveBeenCalledTimes(1)
  })

  it("[neoview.playlist.bounds] rejects invalid names, sources, duplicate entry ids and capacity overruns", async () => {
    const store = createStore()
    store.getPlaylist.mockResolvedValue({ id: "reading", name: "Reading", createdAt: 1, updatedAt: 1 })
    store.listPlaylistEntries.mockResolvedValue([{ ...entry("old", 0) }])
    const service = new ReaderPlaylistService(store, () => 40, () => "old")

    await expect(service.save({ name: " " })).rejects.toThrow("playlist name")
    await expect(service.append("reading", [{ id: "new", source: { kind: "path", path: "" }, name: "Bad" }])).rejects.toThrow("source")
    await expect(service.append("reading", [{ id: "old", source: { kind: "path", path: "D:/book.cbz" }, name: "Duplicate" }])).rejects.toThrow("already exists")
  })
})

function entry(id: string, position: number) {
  return {
    id,
    playlistId: "reading",
    source: { kind: "path" as const, path: `D:/books/${id}.cbz` },
    name: id,
    position,
    createdAt: 1,
  }
}

function createStore(): ReaderPlaylistStore & Record<string, ReturnType<typeof vi.fn>> {
  return {
    listPlaylists: vi.fn(),
    getPlaylist: vi.fn(),
    upsertPlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
    listPlaylistEntries: vi.fn(),
    appendPlaylistEntries: vi.fn(),
    deletePlaylistEntries: vi.fn(),
    replacePlaylistEntryOrder: vi.fn(),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
  } as unknown as ReaderPlaylistStore & Record<string, ReturnType<typeof vi.fn>>
}
