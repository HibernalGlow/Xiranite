import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { FindzData, FindzInput } from "@xiranite/node-findz/core"
import type { FindzTask } from "@xiranite/findz-native"
import { Component } from "./Component"
import type { FindzCardState } from "./types"

afterEach(() => cleanup())

test("opens a library and renders the synchronized archive table and treemap", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()

  await expect.poll(() => host.calls.map((call) => call.action)).toEqual(["open_library", "query_archives", "treemap"])
  await expect.element(page.getByTestId("findz-archive-7")).toBeVisible()
  await expect.element(page.getByText("Watching")).toBeVisible()
  await expect.element(page.getByTestId("findz-treemap")).toBeVisible()
})

test("selecting an archive loads its member rows through the structured query", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-members-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByTestId("findz-archive-7").click()

  await expect.poll(() => host.calls.some((call) => call.action === "query_members")).toBe(true)
  await expect.element(page.getByText("pages/cover.png")).toBeVisible()
  await expect.poll(() => host.stateValue.selectedArchiveId).toBe(7)
})

test("moves through archive pages and resets the cursor when returning", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-pagination-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await expect.element(page.getByRole("button", { name: "Next archive page" })).toBeEnabled()
  await page.getByRole("button", { name: "Next archive page" }).click()

  await expect.poll(() => host.calls.filter((call) => call.action === "query_archives").at(-1)?.query?.page?.cursor).toBe("page-2")
  await expect.element(page.getByTestId("findz-archive-8")).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Previous archive page" })).toBeEnabled()
  await page.getByRole("button", { name: "Previous archive page" }).click()
  await expect.poll(() => host.stateValue.pageCursor).toBeUndefined()
  await expect.element(page.getByTestId("findz-archive-7")).toBeVisible()
})

test("resets pagination when searching or changing the sort", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-query-reset-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByRole("button", { name: "Next archive page" }).click()
  await expect.poll(() => host.stateValue.pageCursor).toBe("page-2")

  await page.getByRole("textbox", { name: "Search Findz index" }).fill("cover")
  await expect.poll(() => host.calls.filter((call) => call.action === "query_archives").at(-1)?.query?.page?.cursor).toBeUndefined()

  await page.getByRole("button", { name: "Next archive page" }).click()
  await expect.poll(() => host.stateValue.pageCursor).toBe("page-2")
  await page.getByRole("button", { name: "Size" }).click()
  await expect.poll(() => host.calls.filter((call) => call.action === "query_archives").at(-1)?.query?.page?.cursor).toBeUndefined()
  await expect.poll(() => host.calls.filter((call) => call.action === "query_archives").at(-1)?.query?.sortDesc).toBe(true)
})

test("updates manual image-analysis controls through pause, resume, and cancel", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-task-controls-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByRole("button", { name: "Analyze image headers" }).click()
  await expect.element(page.getByRole("button", { name: "Pause task" })).toBeVisible()

  await page.getByRole("button", { name: "Pause task" }).click()
  await expect.element(page.getByRole("button", { name: "Resume task" })).toBeVisible()
  await page.getByRole("button", { name: "Resume task" }).click()
  await expect.element(page.getByRole("button", { name: "Pause task" })).toBeVisible()
  await page.getByRole("button", { name: "Cancel task" }).click()

  await expect.element(page.getByRole("button", { name: "Cancel task" })).not.toBeInTheDocument()
  await expect.poll(() => host.calls.map((call) => call.action)).toContain("cancel")
})

test("renders empty results and surfaces an unavailable backend", async () => {
  const emptyHost = createHost({ libraryRoot: "D:/library" }, { empty: true })

  await render(<Component compId="findz-empty-browser" host={emptyHost} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await expect.element(page.getByText("0 of 0 indexed archives")).toBeVisible()
  await expect.element(page.getByTestId("findz-treemap-empty")).toBeVisible()

  await cleanup()
  const failingHost = createHost({ libraryRoot: "D:/library" }, { failActions: ["open_library"] })
  await render(<Component compId="findz-error-browser" host={failingHost} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await expect.element(page.getByRole("alert")).toHaveTextContent("Findz native core is unavailable.")
})

type TestHost = NodeHostApi<FindzCardState, Partial<FindzCardState>> & {
  stateValue: FindzCardState
  calls: FindzInput[]
  task?: FindzTask
}

function createHost(initial: FindzCardState, options: { empty?: boolean; failActions?: FindzInput["action"][] } = {}): TestHost {
  const host = {
    stateValue: { ...initial },
    calls: [] as FindzInput[],
    task: undefined as FindzTask | undefined,
    state: {
      getData: () => host.stateValue,
      patchData: (patch: Partial<FindzCardState>) => { host.stateValue = { ...host.stateValue, ...patch } },
    },
    runner: {
      run: async <TInput, TData>(_nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        const request = input as FindzInput
        host.calls.push(request)
        if (options.failActions?.includes(request.action)) return { success: false, message: "Findz native core is unavailable." }
        return { success: true, message: "ok", data: responseFor(request, host, options) as TData }
      },
    },
  }
  return host as unknown as TestHost
}

function responseFor(input: FindzInput, host: TestHost, options: { empty?: boolean }): FindzData {
  if (input.action === "open_library") return { action: input.action, library: { libraryId: "library-1", root: "D:/library", databasePath: "D:/index.sqlite", archiveCount: options.empty ? 0 : 1, memberCount: options.empty ? 0 : 1, watcherHealth: "healthy", analysisPolicy: "image-header-v1" } }
  if (input.action === "analyze") {
    host.task = taskFixture("running")
    return { action: input.action, task: host.task }
  }
  if (input.action === "pause" || input.action === "resume" || input.action === "cancel") {
    host.task = taskFixture(input.action === "pause" ? "paused" : input.action === "resume" ? "running" : "cancelled")
    return { action: input.action, task: host.task }
  }
  if (input.action === "task") return { action: input.action, task: host.task }
  if (input.action === "query_archives") {
    if (options.empty) return { action: input.action, archives: { total: 0, items: [] } }
    const secondPage = input.query?.page?.cursor === "page-2"
    return { action: input.action, archives: { total: 2, nextCursor: secondPage ? undefined : "page-2", items: [{ id: secondPage ? 8 : 7, relativePath: secondPage ? "second.cbz" : "sample.cbz", size: 4_096, modifiedAt: "2026-07-27T00:00:00Z", scanState: "indexed", memberCount: 1, imageMemberCount: 1, analyzedImageCount: 0, compressedImageBytes: 4_000, averageImageBytes: 0, averageBytesPerMegapixel: 0, medianBytesPerMegapixel: 0, anomalyCount: 0, estimatedSavingsBytes: 0 }] } }
  }
  if (input.action === "query_members") return { action: input.action, members: { total: 1, items: [{ id: 8, archiveId: 7, memberPath: "pages/cover.png", compressedSize: 4_000, uncompressedSize: 4_000, compressionMethod: 8, crc32: 1, extension: "png", imageCandidate: true, nestedArchive: false, encrypted: false, estimatedSavingsBytes: 0 }] } }
  if (input.action === "treemap") return { action: input.action, treemap: { id: "root", name: "Library", value: 4_096, color: 0, children: options.empty ? [] : [{ id: "archive:7", name: "sample.cbz", value: 4_096, color: 0, archiveId: 7 }] } }
  return { action: input.action ?? "query_archives" }
}

function taskFixture(status: FindzTask["status"]): FindzTask {
  return { id: "task-1", libraryId: "library-1", kind: "analysis", status, totalArchives: 2, doneArchives: 1, totalMembers: 4, doneMembers: 2, skippedMembers: 0, failedMembers: 0, message: "Analyzing image headers." }
}
