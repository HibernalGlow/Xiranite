import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRecentDto } from "../../../adapters/reader-http-client"
import ReadingHeatmapCard from "./ReadingHeatmapCard"

afterEach(cleanup)

describe("ReadingHeatmapCard", () => {
  it("[neoview.insights.heatmap.gui] renders weekday/hour heat cells from recent history", async () => {
    const stamp = new Date(2026, 6, 20, 9, 0, 0).getTime()
    const items: ReaderRecentDto[] = [
      recent("a", stamp),
      recent("b", stamp + 60_000),
    ]
    const listRecent = vi.fn(async () => items)
    const client = { listRecent } as unknown as ReaderHttpClient
    render(<ReadingHeatmapCard client={client} disabled={false} panelActive />)
    await waitFor(() => expect(listRecent).toHaveBeenCalledWith(0, 500, expect.any(AbortSignal)))
    expect(screen.getByLabelText("星期与小时阅读热力图")).toBeTruthy()
    expect(document.querySelector('[data-neoview-card="reading-heatmap"]')).toBeTruthy()
  })

  it("[neoview.insights.heatmap.lifecycle] stays idle while inactive", () => {
    const listRecent = vi.fn(async () => [])
    const client = { listRecent } as unknown as ReaderHttpClient
    render(<ReadingHeatmapCard client={client} disabled={false} panelActive={false} />)
    expect(listRecent).not.toHaveBeenCalled()
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
