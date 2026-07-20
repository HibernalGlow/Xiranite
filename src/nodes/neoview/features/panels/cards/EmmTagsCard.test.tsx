import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import EmmTagsCard from "./EmmTagsCard"

afterEach(cleanup)

describe("EmmTagsCard", () => {
  it("[neoview.emm-tags.card] [neoview.emm-tags.accessibility] preserves translated labels, original tooltips and count", async () => {
    const metadata = vi.fn(async () => metadataDto([
      { namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" },
      { namespace: "female", tag: "glasses" },
    ]))
    render(<EmmTagsCard {...context(clientWith(metadata), session())} />)

    const list = await screen.findByRole("list", { name: "EMM 标签" })
    expect(within(list).getByText("爱丽丝").closest("li")?.title).toBe("Alice")
    expect(within(list).getByText("glasses").closest("li")?.hasAttribute("title")).toBe(false)
    expect(screen.getByRole("status").textContent).toContain("共 2 个标签")
    expect(metadata).toHaveBeenCalledOnce()
  })

  it("[neoview.emm-tags.card] keeps no-book, missing-record and empty-tag states distinct", async () => {
    const metadata = vi.fn(async () => metadataDto())
    const view = render(<EmmTagsCard {...context(clientWith(metadata), undefined)} />)
    expect(screen.getByText(/未打开书籍/)).toBeTruthy()
    expect(metadata).not.toHaveBeenCalled()

    view.rerender(<EmmTagsCard {...context(clientWith(metadata), session())} />)
    expect(await screen.findByText(/无 EMM 数据/)).toBeTruthy()

    const emptyMetadata = vi.fn(async () => metadataDto([]))
    view.rerender(<EmmTagsCard {...context(clientWith(emptyMetadata), { ...session(), sessionId: "reader-empty" })} />)
    expect(await screen.findByText("暂无标签")).toBeTruthy()
  })

  it("[neoview.emm-tags.lifecycle] [neoview.emm-tags.performance] does no hidden work and ignores page generations", async () => {
    const metadata = vi.fn(async () => metadataDto([{ namespace: "artist", tag: "Alice" }]))
    const current = session()
    const view = render(<EmmTagsCard {...context(clientWith(metadata), current, false)} />)
    expect(metadata).not.toHaveBeenCalled()

    const client = clientWith(metadata)
    view.rerender(<EmmTagsCard {...context(client, current)} />)
    await screen.findByText("Alice")
    view.rerender(<EmmTagsCard {...context(client, { ...current, frame: { ...current.frame, generation: 99 } })} />)
    await Promise.resolve()
    expect(metadata).toHaveBeenCalledOnce()
  })

  it("[neoview.emm-tags.lifecycle] retries failures and aborts the stable request on unmount", async () => {
    let signal: AbortSignal | undefined
    const metadata = vi.fn().mockRejectedValueOnce(new Error("EMM unavailable")).mockImplementation((_sessionId: string, requestSignal?: AbortSignal) => {
      signal = requestSignal
      return new Promise<ReaderMetadataDto>(() => undefined)
    })
    const view = render(<EmmTagsCard {...context(clientWith(metadata), session())} />)
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))
    await waitFor(() => expect(metadata).toHaveBeenCalledTimes(2))
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})

function context(client: ReaderHttpClient, currentSession?: ReaderSessionDto, panelActive = true) {
  return { client, session: currentSession, panelActive, disabled: false, onGoTo: vi.fn() }
}

function clientWith(metadata: NonNullable<ReaderHttpClient["metadata"]>): ReaderHttpClient {
  return { metadata } as ReaderHttpClient
}

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-emm-tags",
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

function metadataDto(tags?: NonNullable<NonNullable<ReaderMetadataDto["book"]["emm"]>["tags"]>): ReaderMetadataDto {
  return {
    book: {
      bookId: "book-1",
      displayName: "demo.cbz",
      sourceKind: "archive",
      sourcePath: "D:/books/demo.cbz",
      pageCount: 10,
      currentPage: 2,
      ...(tags === undefined ? {} : { emm: { tags } }),
    },
  }
}
