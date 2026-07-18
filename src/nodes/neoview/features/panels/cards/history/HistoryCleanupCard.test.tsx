import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import HistoryListCard from "../HistoryListCard"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    getTotalSize: () => count * estimateSize(),
    scrollToIndex: vi.fn(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index,
      index,
      size: estimateSize(),
      start: index * estimateSize(),
    })),
  }),
}))

afterEach(cleanup)

describe("HistoryListCard cleanup", () => {
  it("[neoview.history.cleanup-gui] lazy-loads advanced cleanup and refreshes only after success", async () => {
    const listRecent = vi.fn(async () => [{
      bookId: "book-1",
      source: { kind: "archive" as const, path: "D:/books/demo.cbz" },
      displayName: "demo.cbz",
      pageIndex: 0,
      pageCount: 1,
      updatedAt: 1,
    }])
    const cleanupRecents = vi.fn(async () => ({ deleted: 1 }))
    render(<HistoryListCard
      client={{ listRecent, cleanupRecents } as ReaderHttpClient}
      disabled={false}
      onGoTo={vi.fn()}
    />)

    await screen.findByText("demo.cbz")
    fireEvent.click(screen.getByRole("button", { name: "高级清理历史记录" }))
    const dialog = await screen.findByRole("dialog", { name: "高级清理历史记录" })
    const row = within(dialog).getByText("清理最旧记录").closest("div.rounded")!
    fireEvent.click(within(row).getByRole("button", { name: "执行" }))
    fireEvent.click(await screen.findByRole("button", { name: "确认清理" }))

    await waitFor(() => expect(cleanupRecents).toHaveBeenCalledWith({ kind: "oldest", limit: 10 }, expect.any(AbortSignal)))
    await waitFor(() => expect(listRecent).toHaveBeenCalledTimes(2))
  })
})
