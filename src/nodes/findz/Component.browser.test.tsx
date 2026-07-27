import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { FindzData, FindzInput } from "@xiranite/node-findz/core"
import type { FindzTask } from "@xiranite/findz-native"
import { Component } from "./Component"
import type { FindzCardState } from "./types"
import i18n, { changeLanguage } from "@/i18n"

beforeEach(async () => { await changeLanguage("en") })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test("opens a library and renders the synchronized archive table and treemap", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()

  await expect.poll(() => host.calls.map((call) => call.action)).toEqual(["open_library", "query_archives", "treemap"])
  await expect.element(page.getByTestId("findz-archive-7")).toBeVisible()
  await expect.element(page.getByText("Watching")).toBeVisible()
  await expect.element(page.getByTestId("findz-treemap")).toBeVisible()
})

test("uses the shared swimlane controls and persists collapsed lane state", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-swimlane-browser" host={host} />)

  await expect.element(page.getByTestId("findz-lane-board")).toBeVisible()
  await expect.element(page.getByTestId("findz-lane-source")).toBeVisible()
  await expect.element(page.getByTestId("findz-lane-results")).toBeVisible()
  await expect.element(page.getByTestId("findz-lane-analysis")).toBeVisible()
  await page.getByRole("button", { name: "Collapse Source lane" }).click()

  await expect.poll(() => host.stateValue.workspace?.sourceCollapsed).toBe(true)
  await expect.element(page.getByRole("button", { name: "Restore Source lane" })).toBeVisible()
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

test("expands folder rows before revealing their archive hierarchy", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-folders-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  const folder = page.getByTestId("findz-folder-series")
  await expect.element(folder).toHaveAttribute("aria-expanded", "true")

  await folder.click()
  await expect.element(folder).toHaveAttribute("aria-expanded", "false")
  await expect.element(page.getByTestId("findz-archive-7")).not.toBeInTheDocument()
  await folder.click()
  await expect.element(page.getByTestId("findz-archive-7")).toBeVisible()
})

test("reopens collapsed folder ancestors for an archive selected from the treemap", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-treemap-reveal-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByTestId("findz-archive-7").click()
  const folder = page.getByTestId("findz-folder-series")
  await folder.click()
  await expect.element(page.getByTestId("findz-archive-7")).not.toBeInTheDocument()

  await page.getByTestId("findz-treemap-node-archive-7").click()
  await expect.element(folder).toHaveAttribute("aria-expanded", "true")
  await expect.element(page.getByTestId("findz-archive-7")).toHaveAttribute("data-state", "selected")
})

test("scrolls the selected archive row into the hierarchy viewport", async () => {
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView")
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-scroll-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByTestId("findz-archive-7").click()

  await expect.poll(() => scrollIntoView.mock.calls.length).toBeGreaterThan(0)
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" })
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

test("ignores an obsolete archive response after the visible query changes", async () => {
  const host = createHost({ libraryRoot: "D:/library" })
  const runner = host.runner!
  const defaultRun = runner.run
  let archiveQueryCount = 0
  let resolveStaleQuery: (() => void) | undefined
  runner.run = async <TInput, TData>(nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
    const request = input as FindzInput
    if (request.action !== "query_archives") return await defaultRun(nodeId, input)
    host.calls.push(request)
    archiveQueryCount++
    if (archiveQueryCount === 1) {
      return await new Promise<NodeRunResult<TData>>((resolve) => {
        resolveStaleQuery = () => resolve({ success: true, message: "ok", data: {
          action: "query_archives",
          archives: { total: 1, items: [archiveFixture(7, "series/stale.cbz")] },
        } as TData })
      })
    }
    return {
      success: true,
      message: "ok",
      data: { action: "query_archives", archives: { total: 1, items: [archiveFixture(8, "fresh.cbz")] } } as TData,
    }
  }

  await render(<Component compId="findz-stale-query-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await expect.poll(() => archiveQueryCount).toBe(1)
  await page.getByRole("textbox", { name: "Search Findz index" }).fill("fresh")
  await expect.poll(() => archiveQueryCount).toBe(2)
  await expect.element(page.getByTestId("findz-archive-8")).toBeVisible()

  resolveStaleQuery?.()
  await expect.element(page.getByTestId("findz-archive-8")).toBeVisible()
  await expect.element(page.getByTestId("findz-archive-7")).not.toBeInTheDocument()
})

test("updates manual image-analysis controls through pause, resume, and cancel", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-task-controls-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByRole("button", { name: "Analyze image headers" }).click()
  await expect.element(page.getByRole("button", { name: "Pause task" })).toBeVisible()
  await expect.element(page.getByTestId("findz-task-progressbar")).toBeVisible()

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

test("passes the visible structured rule tree through the archive query", async () => {
  const rules: FindzCardState["rules"] = {
    format: "xiranite-rule-tree/v1",
    version: 1,
    root: { id: "findz-root", kind: "group", combinator: "all", not: false, children: [{ id: "actual-format", kind: "condition", field: "actualFormat", operator: "equal", value: "png" }] },
  }
  const host = createHost({ libraryRoot: "D:/library", rules })

  await render(<Component compId="findz-rule-tree-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByRole("button", { name: "Advanced filters" }).click()

  await expect.element(page.getByText("Actual format")).toBeVisible()
  await expect.poll(() => host.calls.find((call) => call.action === "query_archives")?.query?.rules).toEqual(rules)
})

test("changes the treemap area metric through the accessible selector", async () => {
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-metric-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByRole("combobox", { name: "Treemap area metric" }).click()
  await page.getByRole("option", { name: "Anomaly count" }).click()

  await expect.poll(() => host.stateValue.areaBy).toBe("anomalyCount")
  await expect.poll(() => host.calls.filter((call) => call.action === "treemap").at(-1)?.areaBy).toBe("anomalyCount")
})

test("synchronizes table selection with treemap nodes and drills into folder aggregates", async () => {
  const host = createHost({ libraryRoot: "D:/library" })
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView")

  await render(<Component compId="findz-treemap-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()

  const archiveNode = page.getByTestId("findz-treemap-node-archive-7")
  await expect.element(archiveNode).toHaveAttribute("data-findz-selected", "false")
  await archiveNode.click()
  await expect.poll(() => host.calls.filter((call) => call.action === "query_members").length).toBeGreaterThan(0)
  await expect.element(page.getByTestId("findz-archive-7")).toHaveAttribute("data-state", "selected")
  await expect.element(archiveNode).toHaveAttribute("data-findz-zoomed", "true")
  await expect.poll(() => scrollIntoView.mock.calls.length).toBeGreaterThan(0)

  await page.getByTestId("findz-treemap-caption-folder-series").dblClick()
  await expect.poll(() => host.stateValue.pathPrefix).toBe("series")
  await expect.poll(() => host.calls.filter((call) => call.action === "query_archives").at(-1)?.pathPrefix).toBe("series")
})

test("renders a direct unsupported archive state", async () => {
  const host = createHost({ libraryRoot: "D:/library" }, { unsupported: true })

  await render(<Component compId="findz-unsupported-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()

  await expect.element(page.getByText("Unsupported archive")).toBeVisible()
})

test("retries a selected budget-exceeded member with the deep analysis scope", async () => {
  const host = createHost({ libraryRoot: "D:/library" }, { budgetExceeded: true })

  await render(<Component compId="findz-deep-retry-browser" host={host} />)
  await page.getByRole("button", { name: "Open library" }).click()
  await page.getByTestId("findz-archive-7").click()
  await page.getByRole("button", { name: "Retry metadata with a deeper read" }).click()

  await expect.poll(() => host.calls.filter((call) => call.action === "analyze").at(-1)?.analysisScope).toEqual({ kind: "members", memberIds: [8], deepRetry: true })
})

test("renders the workspace controls in Chinese after switching language", async () => {
  await changeLanguage("zh")
  const host = createHost({ libraryRoot: "D:/library" })

  await render(<Component compId="findz-zh-browser" host={host} />)
  await expect.element(page.getByRole("button", { name: "打开库" })).toBeVisible()
  await expect.element(page.getByPlaceholder("本地 ZIP / CBZ 库根目录")).toBeVisible()
  await expect.element(page.getByTestId("findz-query-lane")).toHaveAccessibleName("查询与筛选")
  await expect.element(page.getByTestId("findz-scope-lane")).toHaveAccessibleName("索引范围")
  await expect.element(page.getByTestId("findz-results-lane")).toBeVisible()
  await expect.element(page.getByTestId("findz-treemap-lane")).toBeVisible()
  await expect.element(page.getByRole("heading", { name: "矩形图" })).toBeVisible()
  expect(i18n.t("findz.workspace.treemap", { ns: "module" })).toBe("矩形图")
})

type TestHost = NodeHostApi<FindzCardState, Partial<FindzCardState>> & {
  stateValue: FindzCardState
  calls: FindzInput[]
  task?: FindzTask
}

function createHost(initial: FindzCardState, options: { empty?: boolean; unsupported?: boolean; budgetExceeded?: boolean; failActions?: FindzInput["action"][] } = {}): TestHost {
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

function responseFor(input: FindzInput, host: TestHost, options: { empty?: boolean; unsupported?: boolean; budgetExceeded?: boolean }): FindzData {
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
    return { action: input.action, archives: { total: 2, nextCursor: secondPage ? undefined : "page-2", items: [{ id: secondPage ? 8 : 7, relativePath: secondPage ? "second.cbz" : "series/sample.cbz", size: 4_096, modifiedAt: "2026-07-27T00:00:00Z", scanState: options.unsupported ? "unsupported_archive" : "indexed", errorCode: options.unsupported ? "unsupported_archive" : "", memberCount: 1, imageMemberCount: 1, analyzedImageCount: 0, compressedImageBytes: 4_000, averageImageBytes: 0, averageBytesPerMegapixel: 0, medianBytesPerMegapixel: 0, anomalyCount: 0, estimatedSavingsBytes: 0 }] } }
  }
  if (input.action === "query_members") return { action: input.action, members: { total: 1, items: [{ id: 8, archiveId: 7, memberPath: "pages/cover.png", nestingDepth: 1, compressedSize: 4_000, uncompressedSize: 4_000, compressionMethod: 8, crc32: 1, extension: "png", imageCandidate: true, nestedArchive: false, metadataStatus: options.budgetExceeded ? "metadata_budget_exceeded" : undefined, metadataErrorCode: options.budgetExceeded ? "metadata_budget_exceeded" : undefined, estimatedSavingsBytes: 0 }] } }
  if (input.action === "treemap") return { action: input.action, treemap: { id: "root", name: "Library", value: 8_192, color: 0, children: options.empty ? [] : [{ id: "folder:series", name: "series", value: 4_096, color: 0, children: [{ id: "archive:7", name: "sample.cbz", value: 4_096, color: 0, archiveId: 7 }] }, { id: "archive:8", name: "second.cbz", value: 4_096, color: 0, archiveId: 8 }] } }
  return { action: input.action ?? "query_archives" }
}

function taskFixture(status: FindzTask["status"]): FindzTask {
  return { id: "task-1", libraryId: "library-1", kind: "analysis", status, totalArchives: 2, doneArchives: 1, totalMembers: 4, doneMembers: 2, skippedMembers: 0, failedMembers: 0, message: "Analyzing image headers." }
}

function archiveFixture(id: number, relativePath: string) {
  return {
    id,
    relativePath,
    size: 4_096,
    modifiedAt: "2026-07-27T00:00:00Z",
    scanState: "indexed",
    memberCount: 1,
    imageMemberCount: 1,
    analyzedImageCount: 0,
    compressedImageBytes: 4_000,
    averageImageBytes: 0,
    averageBytesPerMegapixel: 0,
    medianBytesPerMegapixel: 0,
    anomalyCount: 0,
    estimatedSavingsBytes: 0,
  }
}
