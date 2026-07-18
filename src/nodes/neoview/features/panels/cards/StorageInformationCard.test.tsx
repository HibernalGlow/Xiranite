import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ReaderHttpClient,
  ReaderMetadataDto,
  ReaderSessionDto,
  ReaderStorageDiagnosticsDto,
} from "../../../adapters/reader-http-client"
import StorageInformationCard from "./StorageInformationCard"

afterEach(cleanup)

describe("StorageInformationCard", () => {
  it("[neoview.storage-information.metadata-retry] shows metadata failure and retries the metadata request", async () => {
    const metadata = vi.fn()
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockResolvedValueOnce(metadataDto())
    const diagnostics = vi.fn(async () => diagnosticsDto())

    render(<StorageInformationCard {...context(clientWith(metadata, diagnostics), session())} />)

    expect((await screen.findByRole("alert")).textContent).toContain("metadata unavailable")
    fireEvent.click(screen.getByRole("button"))

    expect(await screen.findByText("D:/books/pages/001.jpg")).toBeTruthy()
    expect(metadata).toHaveBeenCalledTimes(2)
    expect(diagnostics).toHaveBeenCalledOnce()
  })

  it("[neoview.storage-information.diagnostics-retry] keeps page data visible while retrying diagnostics", async () => {
    const diagnostics = vi.fn()
      .mockRejectedValueOnce(new Error("diagnostics unavailable"))
      .mockResolvedValueOnce(diagnosticsDto())
    const metadata = vi.fn(async () => metadataDto())

    render(<StorageInformationCard {...context(clientWith(metadata, diagnostics), session())} />)

    expect(await screen.findByText("D:/books/pages/001.jpg")).toBeTruthy()
    expect((await screen.findByRole("alert")).textContent).toContain("diagnostics unavailable")
    fireEvent.click(screen.getByRole("button"))

    expect(await screen.findByText("64.00 KB")).toBeTruthy()
    expect(metadata).toHaveBeenCalledOnce()
    expect(diagnostics).toHaveBeenCalledTimes(2)
  })

  it("[neoview.storage-information.inactive-cancel] does no work while hidden and cancels activation requests when hidden again", async () => {
    let metadataSignal: AbortSignal | undefined
    let diagnosticsSignal: AbortSignal | undefined
    const metadata = vi.fn((_sessionId: string, signal?: AbortSignal) => {
      metadataSignal = signal
      return new Promise<ReaderMetadataDto>(() => undefined)
    })
    const diagnostics = vi.fn((signal?: AbortSignal) => {
      diagnosticsSignal = signal
      return new Promise<ReaderStorageDiagnosticsDto>(() => undefined)
    })
    const client = clientWith(metadata, diagnostics)
    const currentSession = session()
    const view = render(<StorageInformationCard {...context(client, currentSession)} panelActive={false} />)

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(metadata).not.toHaveBeenCalled()
    expect(diagnostics).not.toHaveBeenCalled()

    view.rerender(<StorageInformationCard {...context(client, currentSession)} panelActive />)
    expect(await screen.findByLabelText(/\u6b63\u5728\u52a0\u8f7d\u5b58\u50a8\u4fe1\u606f/)).toBeTruthy()
    await waitFor(() => {
      expect(metadata).toHaveBeenCalledOnce()
      expect(diagnostics).toHaveBeenCalledOnce()
    })

    view.rerender(<StorageInformationCard {...context(client, currentSession)} panelActive={false} />)
    expect(metadataSignal?.aborted).toBe(true)
    expect(diagnosticsSignal?.aborted).toBe(true)

    view.rerender(<StorageInformationCard {...context(client, currentSession)} panelActive />)
    await waitFor(() => {
      expect(metadata).toHaveBeenCalledTimes(2)
      expect(diagnostics).toHaveBeenCalledTimes(2)
    })
  })
})

function context(client: ReaderHttpClient, currentSession: ReaderSessionDto) {
  return { client, session: currentSession, disabled: false, onGoTo: vi.fn() }
}

function clientWith(
  metadata: NonNullable<ReaderHttpClient["metadata"]>,
  diagnostics: NonNullable<ReaderHttpClient["diagnostics"]>,
): ReaderHttpClient {
  return {
    config: vi.fn(),
    updateSidebarLayout: vi.fn(),
    updateCardLayout: vi.fn(),
    updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(),
    open: vi.fn(),
    listPages: vi.fn(),
    navigate: vi.fn(),
    goTo: vi.fn(),
    updateSessionOptions: vi.fn(),
    close: vi.fn(),
    metadata,
    diagnostics,
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
    },
    page: {
      index: 1,
      name: "001.jpg",
      displayPath: "D:/books/pages/001.jpg",
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 2 * 1_048_576,
      timeSource: "filesystem",
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
