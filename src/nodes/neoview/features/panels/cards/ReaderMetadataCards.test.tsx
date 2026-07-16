import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto, ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"
import BookInformationCard from "./BookInformationCard"
import ImageInformationCard from "./ImageInformationCard"
import StorageInformationCard from "./StorageInformationCard"
import TimeInformationCard from "./TimeInformationCard"
import { InfoPanelActions } from "../InfoPanelActions"
import { formatStorageBytes } from "./reader-metadata-format"

afterEach(cleanup)

describe("Reader metadata cards", () => {
  it("[neoview.book-information.states] shows loading for an active session and zero DOM without one", () => {
    const metadata = vi.fn(() => new Promise<ReaderMetadataDto>(() => undefined))
    const active = render(<BookInformationCard {...panelContext(clientWith(metadata), session())} />)
    expect(screen.getByLabelText("正在加载书籍信息")).toBeTruthy()
    active.unmount()
    const inactive = render(<BookInformationCard {...panelContext(clientWith(metadata), undefined)} />)
    expect(inactive.container.innerHTML).toBe("")
  })

  it("[neoview.time-information.states] shows loading for an active session and zero DOM without one", () => {
    const metadata = vi.fn(() => new Promise<ReaderMetadataDto>(() => undefined))
    const active = render(<TimeInformationCard {...panelContext(clientWith(metadata), session())} />)
    expect(screen.getByLabelText("正在加载时间信息")).toBeTruthy()
    active.unmount()

    const inactive = render(<TimeInformationCard {...panelContext(clientWith(metadata), undefined)} />)
    expect(inactive.container.innerHTML).toBe("")
  })

  it("[neoview.storage-information.states] performs zero work without a session and exposes the active loading state", () => {
    const metadata = vi.fn(() => new Promise<ReaderMetadataDto>(() => undefined))
    const diagnostics = vi.fn(() => new Promise<ReaderStorageDiagnosticsDto>(() => undefined))
    const client = clientWith(metadata, diagnostics)
    const inactive = render(<StorageInformationCard {...panelContext(client, undefined)} />)
    expect(inactive.container.innerHTML).toBe("")
    expect(metadata).not.toHaveBeenCalled()
    expect(diagnostics).not.toHaveBeenCalled()
    inactive.rerender(<StorageInformationCard {...panelContext(client, session())} />)
    expect(screen.getByLabelText("正在加载存储信息")).toBeTruthy()
  })

  it("[neoview.metadata.cards] shares one lazy metadata request across four independently dockable cards", async () => {
    const metadata = vi.fn(async () => metadataDto())
    const context = panelContext(clientWith(metadata), session())
    render(
      <>
        <BookInformationCard {...context} />
        <ImageInformationCard {...context} />
        <StorageInformationCard {...context} />
        <TimeInformationCard {...context} />
        <InfoPanelActions context={context} />
      </>,
    )

    await waitFor(() => expect(metadata).toHaveBeenCalledOnce())
    expect(await screen.findByText("demo.cbz")).toBeTruthy()
    expect(screen.getByText("1920 x 1080")).toBeTruthy()
    expect(screen.getAllByText("2.00 MB").length).toBeGreaterThan(0)
    expect(screen.getByText("D:/books/pages/001.jpg")).toBeTruthy()
    expect(screen.getByText("访问时间")).toBeTruthy()
    expect(screen.getByText("文件系统")).toBeTruthy()
  })

  it("[neoview.metadata.cancel] aborts the shared request when the final metadata card unmounts", async () => {
    let signal: AbortSignal | undefined
    const metadata = vi.fn((_sessionId: string, requestSignal?: AbortSignal) => {
      signal = requestSignal
      return new Promise<ReaderMetadataDto>(() => undefined)
    })
    const context = panelContext(clientWith(metadata), session())
    const view = render(<><BookInformationCard {...context} /><ImageInformationCard {...context} /></>)
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce())
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("[neoview.storage-information.legacy-fields] preserves path and size while separating bounded resource metrics", async () => {
    const value = metadataDto()
    value.page = { ...value.page!, byteLength: 1_024 }
    value.book.byteLength = 0
    const diagnostics = vi.fn(async () => diagnosticsDto())
    render(<StorageInformationCard {...panelContext(clientWith(vi.fn(async () => value), diagnostics), session())} />)

    expect(await screen.findByText("D:/books/pages/001.jpg")).toBeTruthy()
    expect(screen.getByText("1.00 KB")).toBeTruthy()
    expect(screen.getByText("0 B")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "资源占用" })).toBeTruthy()
    expect(screen.getByText("64.00 KB")).toBeTruthy()
    expect(screen.getByText("32.00 KB")).toBeTruthy()
    expect(screen.getByText("16.00 KB")).toBeTruthy()
    expect(screen.getByText("8.00 KB")).toBeTruthy()
    expect(diagnostics).toHaveBeenCalledOnce()
  })

  it("[neoview.storage-information.format] freezes legacy byte boundaries and invalid-value degradation", () => {
    expect(formatStorageBytes(undefined)).toBe("—")
    expect(formatStorageBytes(-1)).toBe("—")
    expect(formatStorageBytes(0)).toBe("0 B")
    expect(formatStorageBytes(1_023)).toBe("1023 B")
    expect(formatStorageBytes(1_024)).toBe("1.00 KB")
    expect(formatStorageBytes(1_048_576)).toBe("1.00 MB")
    expect(formatStorageBytes(1_073_741_824)).toBe("1.00 GB")
  })

  it("[neoview.storage-information.diagnostics-retry] keeps legacy data visible and retries only failed resource diagnostics", async () => {
    const diagnostics = vi.fn()
      .mockRejectedValueOnce(new Error("diagnostics unavailable"))
      .mockResolvedValueOnce(diagnosticsDto())
    const metadata = vi.fn(async () => metadataDto())
    render(<StorageInformationCard {...panelContext(clientWith(metadata, diagnostics), session())} />)

    expect(await screen.findByText("D:/books/pages/001.jpg")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("diagnostics unavailable")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("64.00 KB")).toBeTruthy()
    expect(metadata).toHaveBeenCalledOnce()
    expect(diagnostics).toHaveBeenCalledTimes(2)
  })

  it("[neoview.storage-information.partial-metrics] renders unavailable cache metrics as em dashes without hiding zero bytes", async () => {
    const diagnostics = vi.fn(async (): Promise<ReaderStorageDiagnosticsDto> => ({
      schemaVersion: 1,
      assets: { presentation: null, thumbnails: null },
      presentationDiskCache: { enabled: false },
      solidArchiveCache: { retainedBytes: 0 },
    }))
    render(<StorageInformationCard {...panelContext(clientWith(vi.fn(async () => metadataDto()), diagnostics), session())} />)

    await screen.findByText("D:/books/pages/001.jpg")
    expect(screen.getAllByText("—")).toHaveLength(3)
    expect(screen.getByText("0 B")).toBeTruthy()
  })

  it("[neoview.storage-information.diagnostics-cancel] aborts the one-shot diagnostics request on unmount", async () => {
    let signal: AbortSignal | undefined
    const diagnostics = vi.fn((requestSignal?: AbortSignal) => {
      signal = requestSignal
      return new Promise<ReaderStorageDiagnosticsDto>(() => undefined)
    })
    const view = render(<StorageInformationCard {...panelContext(clientWith(vi.fn(async () => metadataDto()), diagnostics), session())} />)
    await waitFor(() => expect(diagnostics).toHaveBeenCalledOnce())
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("[neoview.book-information.legacy-fields] displays translated and original titles without duplicating Storage size", async () => {
    const value = metadataDto()
    value.book.emm = { translatedTitle: "译名" }
    render(<BookInformationCard {...panelContext(clientWith(vi.fn(async () => value)), session())} />)

    expect(await screen.findByText("译名")).toBeTruthy()
    expect(screen.getByText("原名")).toBeTruthy()
    expect(screen.getByText("demo.cbz")).toBeTruthy()
    expect(screen.getByText("压缩包")).toBeTruthy()
    expect(screen.queryByText("源大小")).toBeNull()
    expect(screen.queryByText("10.00 MB")).toBeNull()
  })

  it("[neoview.book-information.zero-pages] renders an em dash and avoids duplicate equal titles", async () => {
    const value = metadataDto()
    value.book.pageCount = 0
    value.book.currentPage = 0
    value.book.progressPercent = undefined
    value.book.emm = { translatedTitle: "demo.cbz" }
    render(<BookInformationCard {...panelContext(clientWith(vi.fn(async () => value)), session())} />)

    expect(await screen.findByText("0 / 0")).toBeTruthy()
    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.queryByText("原名")).toBeNull()
  })

  it("[neoview.book-information.retry] retries a failed metadata request", async () => {
    const metadata = vi.fn().mockRejectedValueOnce(new Error("book unavailable")).mockResolvedValueOnce(metadataDto())
    render(<BookInformationCard {...panelContext(clientWith(metadata), session())} />)
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByText("demo.cbz")).toBeTruthy()
    expect(metadata).toHaveBeenCalledTimes(2)
  })

  it("[neoview.book-information.generation-stale] ignores a translated title from an obsolete frame generation", async () => {
    let resolveFirst!: (value: ReaderMetadataDto) => void
    const first = new Promise<ReaderMetadataDto>((resolve) => { resolveFirst = resolve })
    const current = metadataDto()
    current.book.emm = { translatedTitle: "当前译名" }
    const metadata = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(current)
    const initial = session()
    const context = panelContext(clientWith(metadata), initial)
    const view = render(<BookInformationCard {...context} />)
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce())

    view.rerender(<BookInformationCard {...panelContext(context.client, { ...initial, frame: { ...initial.frame, generation: 4 } })} />)
    expect(await screen.findByText("当前译名")).toBeTruthy()
    const stale = metadataDto()
    stale.book.emm = { translatedTitle: "过期译名" }
    resolveFirst(stale)
    await Promise.resolve()
    expect(screen.queryByText("过期译名")).toBeNull()
    expect(screen.getByText("当前译名")).toBeTruthy()
  })

  it("[neoview.time-information.archive-source] keeps unavailable archive entry times unknown", async () => {
    const value = metadataDto()
    value.page = {
      ...value.page!,
      timeSource: "archive-entry",
      createdAtMs: undefined,
      modifiedAtMs: 1_704_164_646_000,
      accessedAtMs: undefined,
    }
    render(<TimeInformationCard {...panelContext(clientWith(vi.fn(async () => value)), session())} />)

    expect(await screen.findByText("压缩包条目")).toBeTruthy()
    expect(screen.getAllByText("—")).toHaveLength(2)
    expect(screen.getByText(new Date(1_704_164_646_000).toLocaleString("zh-CN"))).toBeTruthy()
  })

  it("[neoview.time-information.retry] retries one failed shared metadata request", async () => {
    const metadata = vi.fn()
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockResolvedValueOnce(metadataDto())
    render(<TimeInformationCard {...panelContext(clientWith(metadata), session())} />)

    const retry = await screen.findByRole("button", { name: "重试" })
    expect(screen.getByRole("alert").textContent).toContain("metadata unavailable")
    fireEvent.click(retry)
    expect(await screen.findByText("文件系统")).toBeTruthy()
    expect(metadata).toHaveBeenCalledTimes(2)
  })

  it("[neoview.time-information.generation-stale] ignores metadata from an obsolete frame generation", async () => {
    let resolveFirst!: (value: ReaderMetadataDto) => void
    const first = new Promise<ReaderMetadataDto>((resolve) => { resolveFirst = resolve })
    const current = metadataDto()
    current.page = { ...current.page!, timeSource: "archive-entry", modifiedAtMs: 1_704_164_646_000 }
    const metadata = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(current)
    const initial = session()
    const context = panelContext(clientWith(metadata), initial)
    const view = render(<TimeInformationCard {...context} />)
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce())

    const next = { ...initial, frame: { ...initial.frame, generation: initial.frame.generation + 1 } }
    view.rerender(<TimeInformationCard {...panelContext(context.client, next)} />)
    expect(await screen.findByText("压缩包条目")).toBeTruthy()
    resolveFirst(metadataDto())
    await Promise.resolve()
    expect(screen.getByText("压缩包条目")).toBeTruthy()
    expect(metadata).toHaveBeenCalledTimes(2)
  })
})

function panelContext(client: ReaderHttpClient, currentSession: ReaderSessionDto | undefined) {
  return { client, session: currentSession, disabled: false, onGoTo: vi.fn() }
}

function clientWith(
  metadata: NonNullable<ReaderHttpClient["metadata"]>,
  diagnostics: NonNullable<ReaderHttpClient["diagnostics"]> = vi.fn(async () => diagnosticsDto()),
): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), metadata, diagnostics,
  }
}

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 10 },
    frame: {
      generation: 3,
      anchorPageIndex: 1,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-1", pageIndex: 1, side: "single" }],
      pageCount: 10,
      atStart: false,
      atEnd: false,
    },
    visiblePages: [],
  }
}

function metadataDto(): ReaderMetadataDto {
  return {
    book: {
      bookId: "book-1",
      displayName: "demo.cbz",
      sourceKind: "archive",
      sourcePath: "D:/books/demo.cbz",
      pageCount: 10,
      currentPage: 2,
      progressPercent: 20,
      byteLength: 10 * 1_048_576,
      createdAtMs: 1_700_000_000_000,
      modifiedAtMs: 1_700_000_100_000,
      accessedAtMs: 1_700_000_200_000,
    },
    page: {
      index: 1,
      name: "001.jpg",
      displayPath: "D:/books/pages/001.jpg",
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 2 * 1_048_576,
      dimensions: { width: 1920, height: 1080 },
      timeSource: "filesystem",
      createdAtMs: 1_700_000_000_000,
      modifiedAtMs: 1_700_000_100_000,
      accessedAtMs: 1_700_000_200_000,
    },
  }
}

function diagnosticsDto(): ReaderStorageDiagnosticsDto {
  return {
    schemaVersion: 1,
    assets: {
      presentation: { bytes: 64 * 1_024 },
      thumbnails: { cachedBytes: 32 * 1_024 },
    },
    presentationDiskCache: { enabled: true, bytes: 8 * 1_024 },
    solidArchiveCache: { retainedBytes: 16 * 1_024 },
  }
}
