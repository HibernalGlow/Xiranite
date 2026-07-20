import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRecentDto } from "../../../adapters/reader-http-client"
import ReadingStreakCard from "./ReadingStreakCard"

afterEach(cleanup)

describe("ReadingStreakCard", () => {
  it("[neoview.insights.reading-streak.gui] shows current/longest streak from history", async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1_000
    const items: ReaderRecentDto[] = [
      recent("a", now),
      recent("b", now - day),
      recent("c", now - 2 * day),
    ]
    const listRecent = vi.fn(async () => items)
    const client = { listRecent } as unknown as ReaderHttpClient

    render(<ReadingStreakCard client={client} disabled={false} panelActive />)

    await waitFor(() => expect(listRecent).toHaveBeenCalledWith(0, 500, expect.any(AbortSignal)))
    expect(screen.getByText("当前连续")).toBeTruthy()
    expect(screen.getByText("最长连续")).toBeTruthy()
    expect(document.querySelector('[data-neoview-card="reading-streak"]')).toBeTruthy()
  })

  it("[neoview.insights.reading-streak.lifecycle] stays idle while the panel is inactive", () => {
    const listRecent = vi.fn(async () => [])
    const client = { listRecent } as unknown as ReaderHttpClient
    render(<ReadingStreakCard client={client} disabled={false} panelActive={false} />)
    expect(listRecent).not.toHaveBeenCalled()
    expect(screen.getByText("打开洞察面板后显示连续阅读")).toBeTruthy()
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
