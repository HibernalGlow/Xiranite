import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import EmmRawDataCard, { formatEmmRawField } from "./EmmRawDataCard"
import EmmSyncCard from "./EmmSyncCard"
import FavoriteTagsCard from "./FavoriteTagsCard"
import FolderRatingsCard from "./FolderRatingsCard"

afterEach(cleanup)

describe("EMM auxiliary property cards", () => {
  it("[neoview.emm-raw-data.formatting] formats typed values without losing invalid source text", () => {
    expect(formatEmmRawField({ key: "filesize", type: "bytes", value: 1_048_576 })).toBe("1.00 MB")
    expect(formatEmmRawField({ key: "rating", type: "number", value: 4.75 })).toBe("4.8")
    expect(formatEmmRawField({ key: "hiddenBook", type: "boolean", value: false })).toBe("否")
    expect(formatEmmRawField({ key: "posted", type: "timestamp", value: 1_700_000_000 })).toBe(new Date(1_700_000_000_000).toLocaleString("zh-CN"))
    expect(formatEmmRawField({ key: "updatedAt", type: "datetime", value: "invalid-date" })).toBe("invalid-date")
  })

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

  it("[neoview.emm-raw-data.dto] [neoview.emm-raw-data.sort] [neoview.emm-raw-data.raw-view] [neoview.emm-raw-data.copy] [neoview.emm-raw-data.path-action] [neoview.emm-raw-data.url-action] [neoview.emm-raw-data.filter-empty] formats and operates on the bounded raw record", async () => {
    const copyText = vi.fn(async () => undefined)
    const revealSystemPath = vi.fn(async () => undefined)
    const openExternalUrl = vi.fn(async () => undefined)
    const metadata = vi.fn(async () => ({
      ...metadataDto(),
      book: {
        ...metadataDto().book,
        emmRaw: {
          schemaVersion: 1 as const,
          fields: [
            { key: "rating", type: "number" as const, value: 4.75 },
            { key: "filepath", type: "path" as const, value: "D:/books/demo.cbz" },
            { key: "hiddenBook", type: "boolean" as const, value: true },
            { key: "filesize", type: "bytes" as const, value: 1_048_576 },
            { key: "url", type: "url" as const, value: "https://example.com/source" },
          ],
        },
      },
    }))
    const client = { metadata, revealSystemPath, openExternalUrl } as unknown as ReaderHttpClient
    const view = render(<EmmRawDataCard {...context(client)} systemActions={{ copyText }} />)

    expect(await screen.findByText("1.00 MB")).toBeTruthy()
    expect(screen.getByText("4.8")).toBeTruthy()
    expect(screen.getByText("是")).toBeTruthy()
    expect(view.container.querySelector('[data-emm-raw-data-card="true"]')?.getAttribute("data-emm-raw-source")).toBe("raw-v1")
    expect([...view.container.querySelectorAll("[data-emm-raw-field]")].map((row) => row.getAttribute("data-emm-raw-field"))).toEqual(["filepath", "filesize", "hiddenBook", "rating", "url"])

    fireEvent.click(screen.getByRole("button", { name: "字段" }))
    expect([...view.container.querySelectorAll("[data-emm-raw-field]")].map((row) => row.getAttribute("data-emm-raw-field"))).toEqual(["url", "rating", "hiddenBook", "filesize", "filepath"])
    fireEvent.click(screen.getByRole("button", { name: "定位 文件路径" }))
    await waitFor(() => expect(revealSystemPath).toHaveBeenCalledWith("D:/books/demo.cbz", expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole("button", { name: "打开 来源链接" }))
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/source", expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole("button", { name: "复制 文件大小" }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("1048576"))
    fireEvent.click(screen.getByRole("button", { name: "原始 JSON" }))
    expect(screen.getByText(/"filesize": 1048576/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "复制完整 EMM 记录" }))
    await waitFor(() => expect(copyText.mock.calls.at(-1)?.[0]).toContain('"filepath": "D:/books/demo.cbz"'))

    fireEvent.change(screen.getByRole("textbox", { name: "过滤 EMM 字段和值" }), { target: { value: "missing-field" } })
    fireEvent.click(screen.getByRole("button", { name: "格式化表格" }))
    expect(screen.getByText("没有匹配字段")).toBeTruthy()
  })

  it("[neoview.emm-raw-data.retry] retries the shared static metadata request after an error", async () => {
    const metadata = vi.fn()
      .mockRejectedValueOnce(new Error("EMM database unavailable"))
      .mockResolvedValueOnce(metadataDto())
    render(<EmmRawDataCard {...context({ metadata } as unknown as ReaderHttpClient)} />)

    expect((await screen.findByRole("alert")).textContent).toContain("EMM database unavailable")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("artist:Alice")).toBeTruthy()
    expect(metadata).toHaveBeenCalledTimes(2)
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
