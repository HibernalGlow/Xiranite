import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import HistoryListCard from "./HistoryListCard"

afterEach(cleanup)

describe("HistoryListCard", () => {
  it("[neoview.history.inactive-zero-work] keeps a resident shell without requesting history while hidden", async () => {
    const listRecent = vi.fn(async () => [])
    render(<HistoryListCard {...context(listRecent)} panelActive={false} />)

    expect(screen.getByTestId("history-card"))
    expect(screen.getByText("暂无阅读历史")).toBeTruthy()
    expect(screen.getByTestId("history-card").getAttribute("data-history-state")).toBe("inactive")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listRecent).not.toHaveBeenCalled()
  })

  it("[neoview.history.empty] starts the shared history source when activated", async () => {
    const listRecent = vi.fn(async () => [])
    render(<HistoryListCard {...context(listRecent)} />)

    await waitFor(() => expect(listRecent).toHaveBeenCalledOnce())
    expect(screen.getByText("暂无阅读历史")).toBeTruthy()
    expect(screen.getByTestId("history-card").getAttribute("data-history-state")).toBe("ready")
  })
})

function context(listRecent: NonNullable<ReaderHttpClient["listRecent"]>) {
  return {
    client: { listRecent } as ReaderHttpClient,
    disabled: false,
    onGoTo: vi.fn(),
    onOpen: vi.fn(),
    historyListPreferences: { viewMode: "compact" as const },
  }
}
