import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { FindzData, FindzInput } from "@xiranite/node-findz/core"
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

type TestHost = NodeHostApi<FindzCardState, Partial<FindzCardState>> & {
  stateValue: FindzCardState
  calls: FindzInput[]
}

function createHost(initial: FindzCardState): TestHost {
  const host = {
    stateValue: { ...initial },
    calls: [] as FindzInput[],
    state: {
      getData: () => host.stateValue,
      patchData: (patch: Partial<FindzCardState>) => { host.stateValue = { ...host.stateValue, ...patch } },
    },
    runner: {
      run: async <TInput, TData>(_nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        const request = input as FindzInput
        host.calls.push(request)
        return { success: true, message: "ok", data: responseFor(request) as TData }
      },
    },
  }
  return host as unknown as TestHost
}

function responseFor(input: FindzInput): FindzData {
  if (input.action === "open_library") return { action: input.action, library: { libraryId: "library-1", root: "D:/library", databasePath: "D:/index.sqlite", archiveCount: 1, memberCount: 1, watcherHealth: "healthy", analysisPolicy: "image-header-v1" } }
  if (input.action === "query_archives") return { action: input.action, archives: { total: 1, items: [{ id: 7, relativePath: "sample.cbz", size: 4_096, modifiedAt: "2026-07-27T00:00:00Z", scanState: "indexed", memberCount: 1, imageMemberCount: 1, analyzedImageCount: 0, compressedImageBytes: 4_000, averageImageBytes: 0, averageBytesPerMegapixel: 0, medianBytesPerMegapixel: 0, anomalyCount: 0, estimatedSavingsBytes: 0 }] } }
  if (input.action === "query_members") return { action: input.action, members: { total: 1, items: [{ id: 8, archiveId: 7, memberPath: "pages/cover.png", compressedSize: 4_000, uncompressedSize: 4_000, compressionMethod: 8, crc32: 1, extension: "png", imageCandidate: true, nestedArchive: false, encrypted: false, estimatedSavingsBytes: 0 }] } }
  if (input.action === "treemap") return { action: input.action, treemap: { id: "root", name: "Library", value: 4_096, color: 0, children: [{ id: "archive:7", name: "sample.cbz", value: 4_096, color: 0, archiveId: 7 }] } }
  return { action: input.action ?? "query_archives" }
}
