import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { FileDeletionQuery, FileDeletionRecord } from "@xiranite/api/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import i18n from "@/i18n"
import { FileDeletionHistoryView } from "./FileDeletionHistoryView"

const backend = vi.hoisted(() => ({
  records: [] as FileDeletionRecord[],
  list: vi.fn(async (query: FileDeletionQuery) => ({
    items: backend.records.filter((record) => matchesQuery(record, query)),
    nextCursor: null,
  })),
  listNodes: vi.fn(async () => ["neoview", "czkawka"]),
  restore: vi.fn(async (id: string) => {
    const current = backend.records.find((record) => record.id === id)
    if (!current) throw new Error(`Missing deletion record: ${id}`)
    const restored = { ...current, state: "restored" as const, restoreAvailable: false, restoredAt: Date.now() }
    backend.records = backend.records.map((record) => record.id === id ? restored : record)
    return { record: restored, historyPersisted: true }
  }),
  download: vi.fn(),
}))

vi.mock("@/backend/fileDeletionClient", () => ({
  listFileDeletions: backend.list,
  listFileDeletionNodes: backend.listNodes,
  restoreFileDeletion: backend.restore,
  downloadFileDeletionHistory: backend.download,
}))

beforeEach(() => {
  backend.list.mockImplementation(async (query: FileDeletionQuery) => ({
    items: backend.records.filter((record) => matchesQuery(record, query)),
    nextCursor: null,
  }))
})

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  backend.records = records()
  await i18n.changeLanguage("zh")
})

test("filters cross-node deletion history, restores a recoverable row, and exports the active view", async () => {
  backend.records = records()
  await i18n.changeLanguage("en")
  await render(<HistoryHarness />)

  await expect.element(page.getByText("D:\\library\\recoverable.cbz", { exact: true })).toBeVisible()
  await expect.element(page.getByText("D:\\duplicates\\permanent.bin", { exact: true })).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Restore D:\\duplicates\\permanent.bin" })).toBeDisabled()

  await selectOption("Filter by node", "czkawka")
  await expect.poll(() => backend.list.mock.calls.at(-1)?.[0]?.nodeId).toBe("czkawka")
  await expect.element(page.getByText("D:\\duplicates\\permanent.bin", { exact: true })).toBeVisible()
  expect(page.getByText("D:\\library\\recoverable.cbz", { exact: true }).query()).toBeNull()

  await selectOption("Filter by node", "All nodes")
  await selectOption("Filter by restore state", "Recoverable only")
  await expect.poll(() => backend.list.mock.calls.at(-1)?.[0]?.restoreAvailable).toBe(true)
  await expect.element(page.getByText("D:\\library\\recoverable.cbz", { exact: true })).toBeVisible()
  expect(page.getByText("D:\\duplicates\\permanent.bin", { exact: true }).query()).toBeNull()

  await selectOption("Filter by restore state", "All states")
  await page.getByRole("button", { name: "Restore D:\\library\\recoverable.cbz" }).click()
  await expect.poll(() => backend.restore.mock.calls.at(-1)?.[0]).toBe("recoverable-1")
  await expect.element(page.getByText("Restored", { exact: true })).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Restore D:\\library\\recoverable.cbz" })).toBeDisabled()

  await page.getByRole("button", { name: "Export" }).click()
  await page.getByRole("menuitem", { name: "Markdown" }).click()
  expect(backend.download).toHaveBeenCalledWith("markdown", {
    nodeId: undefined,
    state: undefined,
    restoreAvailable: undefined,
  })

  const panel = document.querySelector<HTMLElement>('[data-testid="history-panel"]')
  expect(panel).not.toBeNull()
  expect(panel!.scrollWidth).toBeLessThanOrEqual(panel!.clientWidth)
})

test("stops interval polling after older deletion pages are loaded", async () => {
  const firstPage = Array.from({ length: 80 }, (_, index) => deletionRecord(`first-${index}`))
  const secondPage = [deletionRecord("second-page")]
  backend.list.mockImplementation(async (query: FileDeletionQuery) => query.cursor
    ? { items: secondPage, nextCursor: null }
    : { items: firstPage, nextCursor: "second-page-cursor" })

  await render(<HistoryHarness />)
  await expect.element(page.getByTestId("file-deletion-history-list")).toBeVisible()
  const list = document.querySelector<HTMLElement>('[data-testid="file-deletion-history-list"]')
  expect(list).not.toBeNull()
  list!.scrollTo({ top: list!.scrollHeight })

  await expect.poll(() => backend.list.mock.calls.some(([query]) => query.cursor === "second-page-cursor")).toBe(true)
  const requestCount = backend.list.mock.calls.length
  await new Promise((resolve) => setTimeout(resolve, 2_200))
  expect(backend.list).toHaveBeenCalledTimes(requestCount)
})

function HistoryHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <div data-testid="history-panel" className="h-[640px] w-[320px] overflow-hidden border">
        <FileDeletionHistoryView />
      </div>
    </QueryClientProvider>
  )
}

async function selectOption(label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

function matchesQuery(record: FileDeletionRecord, query: FileDeletionQuery): boolean {
  return (!query.nodeId || record.nodeId === query.nodeId)
    && (query.restoreAvailable === undefined || record.restoreAvailable === query.restoreAvailable)
    && (!query.state || record.state === query.state)
}

function records(): FileDeletionRecord[] {
  return [
    {
      id: "recoverable-1",
      nodeId: "neoview",
      componentId: "reader-1",
      workspaceId: "workspace-alpha",
      sourcePath: "D:\\library\\recoverable.cbz",
      deletionKind: "trash",
      pathKind: "file",
      size: 4_096,
      deletedAt: Date.UTC(2026, 6, 26, 12, 0, 0),
      state: "trashed",
      restoreAvailable: true,
    },
    {
      id: "permanent-1",
      nodeId: "czkawka",
      sourcePath: "D:\\duplicates\\permanent.bin",
      deletionKind: "delete",
      pathKind: "file",
      size: 2_048,
      deletedAt: Date.UTC(2026, 6, 26, 11, 30, 0),
      state: "permanent",
      restoreAvailable: false,
    },
  ]
}

function deletionRecord(id: string): FileDeletionRecord {
  return {
    ...records()[0]!,
    id,
    sourcePath: `D:\\history\\${id}.cbz`,
  }
}
