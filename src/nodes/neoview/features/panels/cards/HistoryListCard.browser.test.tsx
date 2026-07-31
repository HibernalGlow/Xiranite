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

test("[neoview.history.auto-cleanup-show-gui] cleans confirmed missing paths before refreshing a shown History Card", async () => {
  const cleanup = deferred<{ kind: "recents"; scanned: number; missing: number; unknown: number; deleted: number; truncated: boolean }>()
  const listRecent = vi.fn(async () => [recentHistory("current")])
  const cleanupInvalidLibrary = vi.fn(() => cleanup.promise)
  const client = { listRecent, cleanupInvalidLibrary } as ReaderHttpClient
  const preferences = {
    viewMode: "compact" as const,
    autoCleanup: { enabled: true, trigger: "on-show" as const, intervalMinutes: 60 },
  }
  const card = (panelVisible: boolean) => (
    <div style={{ width: 720, height: 520 }}>
      <HistoryListCard
        client={client}
        disabled={false}
        panelActive
        panelVisible={panelVisible}
        historyListPreferences={preferences}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />
    </div>
  )

  const view = await render(card(false))
  await view.rerender(card(true))

  await expect.poll(() => cleanupInvalidLibrary).toHaveBeenCalledWith("recents", expect.any(AbortSignal))
  expect(listRecent).toHaveBeenCalledOnce()

  cleanup.resolve({ kind: "recents", scanned: 8, missing: 1, unknown: 2, deleted: 1, truncated: false })

  await expect.poll(() => listRecent).toHaveBeenCalledTimes(2)
  await expect.element(page.getByRole("status")).toHaveTextContent("已自动清理 1 条失效历史记录")
})

test("[neoview.history.auto-cleanup-settings-gui] persists the automatic scan switch, trigger, and interval", async () => {
  const onHistoryListPreferences = vi.fn(async (patch) => ({
    viewMode: "compact" as const,
    autoCleanup: {
      enabled: patch.autoCleanup?.enabled ?? false,
      trigger: patch.autoCleanup?.trigger ?? "on-show" as const,
      intervalMinutes: patch.autoCleanup?.intervalMinutes ?? 60,
    },
  }))
  const client = {
    listRecent: vi.fn(async () => []),
    cleanupRecents: vi.fn(async () => ({ deleted: 0 })),
    cleanupInvalidLibrary: vi.fn(async () => ({ kind: "recents" as const, scanned: 0, missing: 0, unknown: 0, deleted: 0, truncated: false })),
  } as ReaderHttpClient

  await render(
    <div style={{ width: 720, height: 520 }}>
      <HistoryListCard
        client={client}
        disabled={false}
        panelActive
        panelVisible
        historyListPreferences={{ viewMode: "compact", autoCleanup: { enabled: false, trigger: "on-show", intervalMinutes: 60 } }}
        onHistoryListPreferences={onHistoryListPreferences}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />
    </div>,
  )

  await page.getByRole("button", { name: "高级清理历史记录" }).click()
  await page.getByRole("switch", { name: "自动清理失效历史" }).click()
  await expect.poll(() => onHistoryListPreferences).toHaveBeenCalledWith({ autoCleanup: { enabled: true } })

  await page.getByRole("combobox", { name: "历史自动清理扫描方式" }).selectOptions("interval")
  await expect.poll(() => onHistoryListPreferences).toHaveBeenCalledWith({ autoCleanup: { trigger: "interval" } })

  await page.getByRole("combobox", { name: "历史自动清理扫描周期" }).selectOptions("360")
  await expect.poll(() => onHistoryListPreferences).toHaveBeenCalledWith({ autoCleanup: { intervalMinutes: 360 } })
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
