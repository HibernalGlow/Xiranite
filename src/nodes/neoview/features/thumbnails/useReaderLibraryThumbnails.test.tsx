import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../adapters/reader-http-client"
import { useReaderLibraryThumbnails, type ReaderLibraryThumbnailItem } from "./useReaderLibraryThumbnails"

const firstItem: ReaderLibraryThumbnailItem = {
  id: "one",
  path: "D:/books/one.cbz",
  kind: "file",
  previewCount: 1,
}

describe("useReaderLibraryThumbnails", () => {
  it("[neoview.bookmark.thumbnail-lease] releases compact and list scopes without reusing a context id", async () => {
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly ReaderLibraryThumbnailItem[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({ id: item.id, thumbnailUrl: `/thumbnail/${item.id}`, contentVersion: "v1" })),
    }))
    const releases: string[] = []
    let resolveFirstRelease: (() => void) | undefined
    const releaseLibraryThumbnailContext = vi.fn((contextId: string) => new Promise<void>((resolve) => {
      releases.push(contextId)
      resolveFirstRelease ??= resolve
      if (releases.length > 1) resolve()
    }))
    const client = { registerLibraryThumbnails, releaseLibraryThumbnailContext } as ReaderHttpClient
    const view = renderHook(
      ({ owner, items }) => useReaderLibraryThumbnails(client, owner, items),
      { initialProps: { owner: "bookmark:all", items: [firstItem] as readonly ReaderLibraryThumbnailItem[] } },
    )

    await waitFor(() => expect(view.result.current.urls.get("one")).toBe("/thumbnail/one"))
    const firstContext = registerLibraryThumbnails.mock.calls[0]![0]

    view.rerender({ owner: "bookmark:all", items: [] })
    await waitFor(() => expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(firstContext))
    expect(view.result.current.urls.get("one")).toBe("/thumbnail/one")

    view.rerender({ owner: "bookmark:reading", items: [firstItem] })
    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledTimes(2))
    const secondContext = registerLibraryThumbnails.mock.calls[1]![0]
    expect(secondContext).not.toBe(firstContext)

    await act(async () => resolveFirstRelease?.())
    expect(view.result.current.urls.get("one")).toBe("/thumbnail/one")
    view.unmount()
    await waitFor(() => expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(secondContext))
  })

  it("[neoview.bookmark.thumbnail-stale] aborts a stale registration and ignores its late batch", async () => {
    let resolveFirst: ((value: { contextId: string; generation: number; items: { id: string; thumbnailUrl: string; contentVersion: string }[] }) => void) | undefined
    let firstSignal: AbortSignal | undefined
    const registerLibraryThumbnails = vi.fn((contextId: string, generation: number, _items: readonly ReaderLibraryThumbnailItem[], signal: AbortSignal) => {
      if (!resolveFirst) {
        firstSignal = signal
        return new Promise<{ contextId: string; generation: number; items: { id: string; thumbnailUrl: string; contentVersion: string }[] }>((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({ contextId, generation, items: [{ id: "two", thumbnailUrl: "/thumbnail/two", contentVersion: "v2" }] })
    })
    const client = {
      registerLibraryThumbnails,
      releaseLibraryThumbnailContext: vi.fn(async () => undefined),
    } as ReaderHttpClient
    const view = renderHook(
      ({ items }) => useReaderLibraryThumbnails(client, "bookmark:all", items),
      { initialProps: { items: [firstItem] as readonly ReaderLibraryThumbnailItem[] } },
    )
    const secondItem = { ...firstItem, id: "two", path: "D:/books/two.cbz" }

    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledOnce())
    view.rerender({ items: [secondItem] })
    await waitFor(() => expect(view.result.current.urls.get("two")).toBe("/thumbnail/two"))
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => resolveFirst?.({
      contextId: registerLibraryThumbnails.mock.calls[0]![0],
      generation: 1,
      items: [{ id: "one", thumbnailUrl: "/thumbnail/stale", contentVersion: "stale" }],
    }))
    expect(view.result.current.urls.has("one")).toBe(false)
    expect(view.result.current.urls.get("two")).toBe("/thumbnail/two")
  })

  it("[neoview.bookmark.thumbnail-refresh-client] marks one registration as refresh and resolves after the new URL is published", async () => {
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly ReaderLibraryThumbnailItem[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({
        id: item.id,
        thumbnailUrl: `/thumbnail/${item.id}/${items.some((candidate) => candidate.id === item.id && candidate.refresh) ? "refreshed" : "cached"}`,
        contentVersion: "v1",
      })),
    }))
    const client = {
      registerLibraryThumbnails,
      releaseLibraryThumbnailContext: vi.fn(async () => undefined),
    } as ReaderHttpClient
    const items = [firstItem] as readonly ReaderLibraryThumbnailItem[]
    const view = renderHook(() => useReaderLibraryThumbnails(client, "bookmark:all", items))

    await waitFor(() => expect(view.result.current.urls.get("one")).toBe("/thumbnail/one/cached"))
    let refreshPromise: Promise<void> | undefined
    act(() => { refreshPromise = view.result.current.refresh("one") })
    await refreshPromise
    await waitFor(() => expect(view.result.current.urls.get("one")).toBe("/thumbnail/one/refreshed"))

    expect(registerLibraryThumbnails).toHaveBeenCalledTimes(2)
    expect(registerLibraryThumbnails.mock.calls[1]?.[2]).toEqual([{ ...firstItem, refresh: true }])
  })

  it("[neoview.library.thumbnail-url-sets] publishes multi-tile URL sets from registration batches", async () => {
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly ReaderLibraryThumbnailItem[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({
        id: item.id,
        thumbnailUrl: `/thumbnail/${item.id}/a`,
        thumbnailUrls: [`/thumbnail/${item.id}/a`, `/thumbnail/${item.id}/b`],
        contentVersion: "v1",
      })),
    }))
    const client = {
      registerLibraryThumbnails,
      releaseLibraryThumbnailContext: vi.fn(async () => undefined),
    } as ReaderHttpClient
    const folderItem: ReaderLibraryThumbnailItem = {
      id: "folder",
      path: "D:/books/folder",
      kind: "folder",
      previewCount: 4,
    }
    const view = renderHook(() => useReaderLibraryThumbnails(client, "history", [folderItem]))

    await waitFor(() => expect(view.result.current.urls.get("folder")).toBe("/thumbnail/folder/a"))
    expect(view.result.current.urlSets.get("folder")).toEqual([
      "/thumbnail/folder/a",
      "/thumbnail/folder/b",
    ])
  })
})
