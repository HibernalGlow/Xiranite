import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import BookInformationCard from "./BookInformationCard"
import ImageInformationCard from "./ImageInformationCard"
import StorageInformationCard from "./StorageInformationCard"
import TimeInformationCard from "./TimeInformationCard"

afterEach(cleanup)

describe("Reader metadata cards", () => {
  it("[neoview.metadata.cards] shares one lazy metadata request across four independently dockable cards", async () => {
    const metadata = vi.fn(async () => metadataDto())
    const context = panelContext(clientWith(metadata), session())
    render(
      <>
        <BookInformationCard {...context} />
        <ImageInformationCard {...context} />
        <StorageInformationCard {...context} />
        <TimeInformationCard {...context} />
      </>,
    )

    await waitFor(() => expect(metadata).toHaveBeenCalledOnce())
    expect(await screen.findByText("demo.cbz")).toBeTruthy()
    expect(screen.getByText("1920 x 1080")).toBeTruthy()
    expect(screen.getAllByText("2.00 MB").length).toBeGreaterThan(0)
    expect(screen.getByText("D:/books/pages/001.jpg")).toBeTruthy()
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
})

function panelContext(client: ReaderHttpClient, currentSession: ReaderSessionDto) {
  return { client, session: currentSession, disabled: false, onGoTo: vi.fn() }
}

function clientWith(metadata: NonNullable<ReaderHttpClient["metadata"]>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), metadata,
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
      displayName: "demo.cbz",
      sourceKind: "archive",
      sourcePath: "D:/books/demo.cbz",
      pageCount: 10,
      currentPage: 2,
      progressPercent: 20,
      byteLength: 10 * 1_048_576,
      createdAtMs: 1_700_000_000_000,
      modifiedAtMs: 1_700_000_100_000,
    },
    page: {
      index: 1,
      name: "001.jpg",
      displayPath: "D:/books/pages/001.jpg",
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 2 * 1_048_576,
      dimensions: { width: 1920, height: 1080 },
      createdAtMs: 1_700_000_000_000,
      modifiedAtMs: 1_700_000_100_000,
    },
  }
}
