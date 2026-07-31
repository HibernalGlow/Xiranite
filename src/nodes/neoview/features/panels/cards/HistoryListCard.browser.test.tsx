import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import HistoryListCard from "./HistoryListCard"

test("[neoview.history.show-refresh-gui] refreshes an already resident History Card whenever it is shown", async () => {
  const responses = [[recentHistory("before")], [recentHistory("after")]] as const
  let requestIndex = 0
  const listRecent = vi.fn(async () => responses[Math.min(requestIndex++, responses.length - 1)]!)
  const client = { listRecent } as ReaderHttpClient
  const card = (panelVisible: boolean) => (
    <div style={{ width: 720, height: 520 }}>
      <HistoryListCard
        client={client}
        disabled={false}
        panelActive
        panelVisible={panelVisible}
        historyListPreferences={{ viewMode: "compact" }}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />
    </div>
  )

  const view = await render(card(true))

  await expect.element(page.getByText("before.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => listRecent).toHaveBeenCalledOnce()

  await view.rerender(card(false))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(listRecent).toHaveBeenCalledOnce()

  await view.rerender(card(true))

  await expect.poll(() => listRecent).toHaveBeenCalledTimes(2)
  await expect.element(page.getByText("after.cbz", { exact: true })).toBeVisible()
  expect(page.getByText("before.cbz", { exact: true }).query()).toBeNull()
})

function recentHistory(bookId: string) {
  return {
    bookId,
    source: { kind: "archive" as const, path: `D:/books/${bookId}.cbz` },
    displayName: `${bookId}.cbz`,
    pageIndex: 0,
    pageCount: 10,
    updatedAt: 1_700_000_000_000,
  }
}
