import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import TimeInformationCard from "./TimeInformationCard"

afterEach(cleanup)

describe("TimeInformationCard lifecycle", () => {
  it("[neoview.time-information.inactive-zero-work] keeps the empty shell without metadata while hidden", async () => {
    const metadata = vi.fn(() => new Promise<ReaderMetadataDto>(() => undefined))
    const client = { metadata } as unknown as ReaderHttpClient
    const currentSession = session()
    const view = render(
      <TimeInformationCard
        client={client}
        session={currentSession}
        panelActive={false}
        disabled={false}
        onGoTo={vi.fn()}
      />,
    )

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(metadata).not.toHaveBeenCalled()

    view.rerender(
      <TimeInformationCard
        client={client}
        session={currentSession}
        panelActive
        disabled={false}
        onGoTo={vi.fn()}
      />,
    )

    expect(await screen.findByLabelText("正在加载时间信息")).toBeTruthy()
    expect(metadata).toHaveBeenCalledOnce()
  })

  it("[neoview.time-information.book-source-fallback] uses book timestamps when the current page has no time projection", async () => {
    const metadata = vi.fn(async (): Promise<ReaderMetadataDto> => ({
      book: {
        bookId: "book-1",
        displayName: "demo",
        sourceKind: "archive",
        sourcePath: "D:/books/demo.cbz",
        pageCount: 1,
        currentPage: 1,
        createdAtMs: 1_700_000_000_000,
        modifiedAtMs: 1_700_000_100_000,
        accessedAtMs: 1_700_000_200_000,
      },
      page: {
        index: 0,
        name: "001.jpg",
        displayPath: "D:/books/001.jpg",
        mediaKind: "image",
      },
    }))
    const client = { metadata } as unknown as ReaderHttpClient

    render(<TimeInformationCard client={client} session={session()} panelActive disabled={false} onGoTo={vi.fn()} />)

    expect(await screen.findByText("\u4e66\u7c4d\u6e90\u6587\u4ef6")).toBeTruthy()
    expect(screen.getByText(new Date(1_700_000_000_000).toLocaleString("zh-CN"))).toBeTruthy()
    expect(screen.getByText("创建时间:", { exact: true }).parentElement?.querySelector("dd")?.textContent).not.toBe("—")
    expect(document.querySelector("[data-time-source='book-source']")).toBeTruthy()
  })
})

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo", pageCount: 1 },
    frame: {
      generation: 1,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [],
  }
}
