import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRecentDto } from "../../../adapters/reader-http-client"
import SourceBreakdownCard from "./SourceBreakdownCard"

afterEach(cleanup)

describe("SourceBreakdownCard", () => {
  it("[neoview.insights.source-breakdown.gui] classifies a bounded recent window by source", async () => {
    const items: ReaderRecentDto[] = [
      recent("a", { kind: "archive", path: "D:/a.cbz" }),
      recent("b", { kind: "directory", path: "D:/series" }),
      recent("c", { kind: "media", path: "D:/c.mp4" }),
    ]
    const listRecent = vi.fn(async () => items)
    const client = { listRecent } as unknown as ReaderHttpClient
    render(<SourceBreakdownCard client={client} disabled={false} panelActive />)
    await waitFor(() => expect(listRecent).toHaveBeenCalledWith(0, 500, expect.any(AbortSignal)))
    expect(screen.getByText("压缩包")).toBeTruthy()
    expect(screen.getByText("文件夹")).toBeTruthy()
    expect(document.querySelector('[data-neoview-card="source-breakdown"]')).toBeTruthy()
  })

  it("[neoview.insights.source-breakdown.lifecycle] does no work while inactive", () => {
    const listRecent = vi.fn(async () => [])
    const client = { listRecent } as unknown as ReaderHttpClient
    render(<SourceBreakdownCard client={client} disabled={false} panelActive={false} />)
    expect(listRecent).not.toHaveBeenCalled()
  })
})

function recent(bookId: string, source: ReaderRecentDto["source"]): ReaderRecentDto {
  return {
    bookId,
    displayName: bookId,
    pageIndex: 0,
    pageCount: 1,
    updatedAt: Date.now(),
    source,
  }
}
