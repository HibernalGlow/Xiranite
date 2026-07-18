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
