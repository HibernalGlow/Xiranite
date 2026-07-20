import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import EmmRawDataCard from "./EmmRawDataCard"
import EmmSyncCard from "./EmmSyncCard"
import FavoriteTagsCard from "./FavoriteTagsCard"
import FolderRatingsCard from "./FolderRatingsCard"

afterEach(cleanup)

describe("EMM auxiliary property cards", () => {
  it("[neoview.emm-cards.lifecycle] does no work while all cards are hidden", () => {
    const client = { metadata: vi.fn(), suggestDirectoryEmmTags: vi.fn(), openDirectoryBrowser: vi.fn() } as unknown as ReaderHttpClient
    render(<><EmmSyncCard {...context(client, false)} /><EmmRawDataCard {...context(client, false)} /><FavoriteTagsCard {...context(client, false)} /><FolderRatingsCard {...context(client, false)} /></>)
    expect(client.metadata).not.toHaveBeenCalled()
    expect(client.suggestDirectoryEmmTags).not.toHaveBeenCalled()
    expect(client.openDirectoryBrowser).not.toHaveBeenCalled()
  })

  it("[neoview.emm-sync.direct-source] and raw data share one static metadata request", async () => {
    const metadata = vi.fn(async () => metadataDto())
    const client = { metadata } as unknown as ReaderHttpClient
    render(<><EmmSyncCard {...context(client)} /><EmmRawDataCard {...context(client)} /></>)
    expect(await screen.findByText("外部 EMM 数据已连接")).toBeTruthy()
    expect(screen.getByText("artist:Alice")).toBeTruthy()
    expect(metadata).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByRole("textbox", { name: "过滤 EMM 字段和值" }), { target: { value: "artist" } })
    expect(screen.queryByText("filepath")).toBeNull()
  })

  it("[neoview.favorite-tags.card] renders bounded translated suggestions", async () => {
    const suggestDirectoryEmmTags = vi.fn(async () => [{ category: "artist", tag: "Alice", translatedTag: "爱丽丝", favorite: true }])
    render(<FavoriteTagsCard {...context({ suggestDirectoryEmmTags } as unknown as ReaderHttpClient)} />)
    expect(await screen.findByText("爱丽丝")).toBeTruthy()
    expect(suggestDirectoryEmmTags).toHaveBeenCalledWith(32, expect.any(AbortSignal))
  })

  it("[neoview.folder-ratings.card] batches the current directory and closes its private browser session", async () => {
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = {
      metadata: vi.fn(async () => metadataDto()),
      openDirectoryBrowser: vi.fn(async () => ({ sessionId: "ratings", entries: [], cursor: 0, total: 2 })),
      listDirectoryBrowser: vi.fn(async () => ({
        sessionId: "ratings", entries: [{ path: "D:/books/a.cbz", name: "a.cbz", kind: "file", readerSupported: true, rating: 4 }, { path: "D:/books/b.cbz", name: "b.cbz", kind: "file", readerSupported: true, rating: 5 }], cursor: 0, total: 2,
      })),
      closeDirectoryBrowser,
    } as unknown as ReaderHttpClient
    render(<FolderRatingsCard {...context(client)} />)
    expect(await screen.findByText("4.50")).toBeTruthy()
    expect(client.openDirectoryBrowser).toHaveBeenCalledWith("D:/books", expect.any(AbortSignal), "emm-folder-ratings", false)
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("ratings"))
  })
})

function context(client: ReaderHttpClient, panelActive = true) {
  return { client, session: session(), panelActive, disabled: false, onGoTo: vi.fn() }
}

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-emm-aux",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 10 },
    frame: { generation: 1, anchorPageIndex: 0, direction: "left-to-right", layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true }, pages: [], pageCount: 10, atStart: true, atEnd: false },
    visiblePages: [],
  }
}

function metadataDto(): ReaderMetadataDto {
  return { book: { bookId: "book-1", displayName: "demo.cbz", sourceKind: "archive", sourcePath: "D:/books/demo.cbz", pageCount: 10, currentPage: 1, emm: { translatedTitle: "Demo", tags: [{ namespace: "artist", tag: "Alice" }] } } }
}
