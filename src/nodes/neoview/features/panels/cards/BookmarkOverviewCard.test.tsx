import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderLibraryStatisticsDto } from "../../../adapters/reader-http-client"
import BookmarkOverviewCard from "./BookmarkOverviewCard"

afterEach(cleanup)

describe("BookmarkOverviewCard", () => {
  it("[neoview.insights.bookmark-overview.gui] loads library statistics without enumerating bookmarks", async () => {
    const stats: ReaderLibraryStatisticsDto = {
      recentCount: 12,
      bookmarkCount: 8,
      bookmarkListCount: 3,
      mediaProgressCount: 5,
    }
    const libraryStatistics = vi.fn(async () => stats)
    const client = { libraryStatistics } as unknown as ReaderHttpClient

    render(<BookmarkOverviewCard client={client} disabled={false} panelActive />)

    await waitFor(() => expect(libraryStatistics).toHaveBeenCalledWith(expect.any(AbortSignal)))
    expect(screen.getByText("总计书签")).toBeTruthy()
    expect(document.querySelector('[data-neoview-card="bookmark-overview"]')?.textContent).toContain("8")
    expect(document.querySelector('[data-neoview-card="bookmark-overview"]')).toBeTruthy()
  })

  it("[neoview.insights.bookmark-overview.lifecycle] stays idle while inactive and retries after failure", async () => {
    const libraryStatistics = vi.fn(async () => {
      throw new Error("stats unavailable")
    })
    const client = { libraryStatistics } as unknown as ReaderHttpClient
    const view = render(<BookmarkOverviewCard client={client} disabled={false} panelActive={false} />)
    expect(libraryStatistics).not.toHaveBeenCalled()

    view.rerender(<BookmarkOverviewCard client={client} disabled={false} panelActive />)
    await screen.findByRole("alert")
    libraryStatistics.mockResolvedValueOnce({
      recentCount: 1,
      bookmarkCount: 2,
      bookmarkListCount: 1,
      mediaProgressCount: 0,
    })
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(document.querySelector('[data-neoview-card="bookmark-overview"]')).toBeTruthy())
  })
})
