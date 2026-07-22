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
    const client = { metadata: vi.fn(), suggestDirectoryEmmTags: vi.fn(), listManualEmmTags: vi.fn(), openDirectoryBrowser: vi.fn() } as unknown as ReaderHttpClient
    render(<><EmmSyncCard {...context(client, false)} /><EmmRawDataCard {...context(client, false)} /><FavoriteTagsCard {...context(client, false)} /><FolderRatingsCard {...context(client, false)} /></>)
    expect(client.metadata).not.toHaveBeenCalled()
    expect(client.suggestDirectoryEmmTags).not.toHaveBeenCalled()
    expect(client.listManualEmmTags).not.toHaveBeenCalled()
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

  it("[neoview.emm-sync.refresh] coalesces repeated rereads while the external projection is pending", async () => {
    const reread = Promise.withResolvers<ReaderMetadataDto>()
    const metadata = vi.fn()
      .mockResolvedValueOnce(metadataDto())
      .mockReturnValueOnce(reread.promise)
    render(<EmmSyncCard {...context({ metadata } as unknown as ReaderHttpClient)} />)

    expect(await screen.findByText("外部 EMM 数据已连接")).toBeTruthy()
    const refresh = screen.getByRole("button", { name: "重新读取" })
    fireEvent.click(refresh)
    fireEvent.click(refresh)
    expect(metadata).toHaveBeenCalledTimes(2)

    reread.resolve(metadataDto())
    expect(await screen.findByText("外部 EMM 数据已连接")).toBeTruthy()
  })

  it("[neoview.emm-sync.xr-overrides] edits only the current book XR override and refreshes its projection", async () => {
    const metadata = vi.fn()
      .mockResolvedValueOnce(metadataDto())
      .mockResolvedValueOnce(metadataDto())
    const getEmmMetadata = vi.fn(async () => ({ revision: 2, overrides: { rating: 3, translatedTitle: "旧译名" }, inherited: ["manualTags"] as const }))
    const updateEmmMetadata = vi.fn(async () => ({ revision: 3, overrides: { rating: 5, translatedTitle: "新译名" }, inherited: ["manualTags"] as const }))
    render(<EmmSyncCard {...context({ metadata, getEmmMetadata, updateEmmMetadata } as unknown as ReaderHttpClient)} />)

    await screen.findByText("外部 EMM 数据已连接")
    fireEvent.click(screen.getByRole("button", { name: "编辑 XR 覆盖" }))
    expect(await screen.findByLabelText("XR 覆盖评分")).toBeTruthy()
    expect((screen.getByRole("textbox", { name: "XR 覆盖评分" }) as HTMLInputElement).value).toBe("3")
    fireEvent.change(screen.getByRole("textbox", { name: "XR 覆盖评分" }), { target: { value: "5" } })
    fireEvent.change(screen.getByRole("textbox", { name: "XR 覆盖译名" }), { target: { value: "新译名" } })
    fireEvent.click(screen.getByRole("button", { name: "保存覆盖" }))

    await waitFor(() => expect(updateEmmMetadata).toHaveBeenCalledWith("reader-emm-aux", 2, { rating: 5, translatedTitle: "新译名" }))
    await waitFor(() => expect(metadata).toHaveBeenCalledTimes(2))
    expect(getEmmMetadata).toHaveBeenCalledOnce()
  })

  it("[neoview.emm-raw-data.session-replace] aborts stale metadata and publishes only the replacement session", async () => {
    const requests = new Map<string, {
      deferred: ReturnType<typeof Promise.withResolvers<ReaderMetadataDto>>
      signal?: AbortSignal
    }>()
    const metadata = vi.fn((sessionId: string, signal?: AbortSignal) => {
      const deferred = Promise.withResolvers<ReaderMetadataDto>()
      requests.set(sessionId, { deferred, signal })
      return deferred.promise
    })
    const client = { metadata } as unknown as ReaderHttpClient
    const view = render(<EmmRawDataCard {...context(client)} />)
    await waitFor(() => expect(requests.has("reader-emm-aux")).toBe(true))

    view.rerender(<EmmRawDataCard {...context(client)} session={session("reader-emm-next")} />)
    await waitFor(() => {
      expect(requests.has("reader-emm-next")).toBe(true)
      expect(requests.get("reader-emm-aux")?.signal?.aborted).toBe(true)
    })

    requests.get("reader-emm-next")!.deferred.resolve(metadataDto("replacement-value"))
    expect(await screen.findByText("replacement-value")).toBeTruthy()
    requests.get("reader-emm-aux")!.deferred.resolve(metadataDto("stale-value"))
    await Promise.resolve()
    expect(screen.queryByText("stale-value")).toBeNull()
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
    const listManualEmmTags = vi.fn(async () => [{ namespace: "manual", tag: "favorite", count: 3 }])
    render(<FavoriteTagsCard {...context({ suggestDirectoryEmmTags, listManualEmmTags } as unknown as ReaderHttpClient)} />)
    expect(await screen.findByText("爱丽丝")).toBeTruthy()
    expect(suggestDirectoryEmmTags).toHaveBeenCalledWith(32, expect.any(AbortSignal))
    expect(document.querySelector('[title="manual:favorite (3个文件)"]')).toBeTruthy()
    expect(listManualEmmTags).toHaveBeenCalledWith(64, expect.any(AbortSignal))
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

  it("[neoview.folder-ratings.cache-controls] invokes explicit cache commands without changing directory pagination", async () => {
    const rebuildFolderRatingCache = vi.fn(async () => ({ entries: [], updatedAt: 1 }))
    const supplementFolderRatingCache = vi.fn(async () => ({ entries: [], updatedAt: 2 }))
    const client = { metadata: vi.fn(async () => metadataDto()), openDirectoryBrowser: vi.fn(async () => ({ sessionId: "ratings", entries: [], cursor: 0, total: 0 })), listDirectoryBrowser: vi.fn(async () => ({ sessionId: "ratings", entries: [], cursor: 0, total: 0 })), closeDirectoryBrowser: vi.fn(async () => undefined), folderRatingCache: vi.fn(async () => ({ entries: [] })), rebuildFolderRatingCache, supplementFolderRatingCache } as unknown as ReaderHttpClient
    render(<FolderRatingsCard {...context(client)} />)
    await screen.findByText("暂无评分")
    fireEvent.click(screen.getByText("重算"))
    await waitFor(() => expect(rebuildFolderRatingCache).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByPlaceholderText("输入路径补充评分"), { target: { value: "D:/books" } })
    fireEvent.click(screen.getByText("补充"))
    await waitFor(() => expect(supplementFolderRatingCache).toHaveBeenCalledWith("D:/books"))
  })
})

function context(client: ReaderHttpClient, panelActive = true) {
  return { client, session: session(), panelActive, disabled: false, onGoTo: vi.fn() }
}

function session(sessionId = "reader-emm-aux"): ReaderSessionDto {
  return {
    sessionId,
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 10 },
    frame: { generation: 1, anchorPageIndex: 0, direction: "left-to-right", layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true }, pages: [], pageCount: 10, atStart: true, atEnd: false },
    visiblePages: [],
  }
}

function metadataDto(rawValue?: string): ReaderMetadataDto {
  return { book: { bookId: "book-1", displayName: "demo.cbz", sourceKind: "archive", sourcePath: "D:/books/demo.cbz", pageCount: 10, currentPage: 1, emm: { translatedTitle: "Demo", tags: [{ namespace: "artist", tag: "Alice" }] }, ...(rawValue ? { emmRaw: { schemaVersion: 1, fields: [{ key: "session", type: "string", value: rawValue }] } } : {}) } }
}
