import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRecentDto } from "../../../adapters/reader-http-client"
import DailyTrendCard from "./DailyTrendCard"

afterEach(cleanup)

describe("DailyTrendCard", () => {
  it("[neoview.insights.daily-trend.gui] loads a bounded history window and renders the weekly trend", async () => {
    const now = Date.now()
    const items: ReaderRecentDto[] = [
      recent("a", now),
      recent("b", now - 24 * 60 * 60 * 1_000),
      recent("c", now - 2 * 24 * 60 * 60 * 1_000),
    ]
    const listRecent = vi.fn(async () => items)
    const client = { listRecent } as unknown as ReaderHttpClient

    render(<DailyTrendCard client={client} disabled={false} panelActive />)

    await waitFor(() => expect(listRecent).toHaveBeenCalledWith(0, 500, expect.any(AbortSignal)))
    expect(screen.getByText(/本周共/)).toBeTruthy()
    expect(screen.getByLabelText("近 7 日阅读趋势柱状图")).toBeTruthy()
    expect(document.querySelector('[data-neoview-card="daily-trend"]')).toBeTruthy()
  })

  it("[neoview.insights.daily-trend.lifecycle] performs no network work while inactive and retries after failure", async () => {
    const listRecent = vi.fn(async () => {
      throw new Error("history unavailable")
    })
    const client = { listRecent } as unknown as ReaderHttpClient

    const view = render(<DailyTrendCard client={client} disabled={false} panelActive={false} />)
    expect(listRecent).not.toHaveBeenCalled()
    expect(screen.getByText("打开洞察面板后显示近 7 日趋势")).toBeTruthy()

    view.rerender(<DailyTrendCard client={client} disabled={false} panelActive />)
    await screen.findByRole("alert")
    listRecent.mockResolvedValueOnce([recent("a", Date.now())])
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(document.querySelector('[data-neoview-card="daily-trend"]')).toBeTruthy())
  })
})

function recent(bookId: string, updatedAt: number): ReaderRecentDto {
  return {
    bookId,
    displayName: bookId,
    pageIndex: 0,
    pageCount: 1,
    updatedAt,
    source: { kind: "archive", path: `D:/books/${bookId}.cbz` },
  }
}
