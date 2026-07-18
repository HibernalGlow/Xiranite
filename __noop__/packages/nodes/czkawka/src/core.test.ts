import { describe, expect, test, vi } from "vitest"
import { filterAndSortGroups, normalizeCzkawkaInput, runCzkawka, smartSelect, type CzkawkaRuntime } from "./core.js"

function runtime(): CzkawkaRuntime {
  return {
    scanDuplicates: vi.fn(async () => ({ groups: [{ files: [{ path: "D:/a.bin", size: 12, modifiedDate: 1, hash: "x" }, { path: "D:/b.bin", size: 12, modifiedDate: 2, hash: "x" }] }], messages: "ok", stopped: false })),
    scanBasic: vi.fn(async () => ({ entries: [{ path: "D:/empty.tmp", size: 0, modifiedDate: 1 }], messages: "ok", stopped: false })),
    scanMedia: vi.fn(async () => ({ groups: [{ entries: [{ path: "D:/a.jpg", size: 20, modifiedDate: 1, width: 100, height: 80 }, { path: "D:/b.jpg", size: 21, modifiedDate: 1, width: 100, height: 80 }] }], messages: "ok", stopped: false })),
    pathExists: vi.fn(async (path) => path.startsWith("D:/")), removePath: vi.fn(async () => undefined), copyPath: vi.fn(async () => undefined), movePath: vi.fn(async () => undefined), writeText: vi.fn(async () => undefined), ensureDirectory: vi.fn(async () => undefined),
    join: (...parts) => parts.filter(Boolean).join("/"), dirname: (path) => path.slice(0, path.lastIndexOf("/")), basename: (path) => path.slice(path.lastIndexOf("/") + 1), relativeDirectoryFromRoot: (path) => path.slice(3, path.lastIndexOf("/")),
  }
}

describe("czkawka TypeScript orchestration", () => {
  test("normalizes safe defaults", () => {
    const value = normalizeCzkawkaInput({})
    expect(value.tool).toBe("duplicate-files")
    expect(value.dryRun).toBe(true)
    expect(value.deleteMode).toBe("trash")
    expect(value.conflictPolicy).toBe("skip")
    expect(value.hashType).toBe("blake3")
    expect(value.threadCount).toBe(0)
    expect(value.similarImagesHashSize).toBe(16)
    expect(value.similarVideosCropDetect).toBe("letterbox")
    expect(value.musicCheckType).toBe("tags")
    expect(value.brokenImage).toBe(true)
    expect(value.saveAlsoAsJson).toBe(false)
    expect(value.deleteOutdatedCache).toBe(true)
    expect(value.duplicateMinimalHashCacheSizeKiB).toBe(256)
    expect(value.duplicateMinimalPrehashCacheSizeKiB).toBe(256)
  })

  test("clamps cache thresholds and trims custom folders", () => {
    const value = normalizeCzkawkaInput({ cacheFolderPath: "  D:/cache  ", configFolderPath: " D:/config ", duplicateMinimalHashCacheSizeKiB: 0, duplicateMinimalPrehashCacheSizeKiB: 2_000_000 })
    expect(value.cacheFolderPath).toBe("D:/cache")
    expect(value.configFolderPath).toBe("D:/config")
    expect(value.duplicateMinimalHashCacheSizeKiB).toBe(1)
    expect(value.duplicateMinimalPrehashCacheSizeKiB).toBe(1024 * 1024)
  })

  test("maps duplicate groups and reclaimable bytes", async () => {
    const result = await runCzkawka({ includedDirectories: ["D:/"] }, runtime())
    expect(result.success).toBe(true)
    expect(result.data?.groupCount).toBe(1)
    expect(result.data?.reclaimableBytes).toBe(12)
  })

  test("forwards continuous native progress as bounded node events", async () => {
    const adapter = runtime()
    vi.mocked(adapter.scanDuplicates).mockImplementation(async (_input, onProgress) => {
      onProgress?.({ stage: "hashFiles", stageIndex: 1, stageCount: 3, entriesChecked: 25, entriesTotal: 100, bytesChecked: 0, bytesTotal: 0 })
      return { groups: [], messages: "ok", stopped: false }
    })
    const events: Array<{ progress?: number; message?: string }> = []
    await runCzkawka({ includedDirectories: ["D:/"] }, adapter, (event) => events.push(event))
    expect(events).toContainEqual(expect.objectContaining({ progress: 43, message: "hash Files 25/100" }))
    expect(events.at(-1)).toMatchObject({ progress: 100, message: "Finished duplicate-files." })
  })

  test("honors cancellation before entering native code", async () => {
    const adapter = runtime()
    adapter.isCancelled = () => true
    adapter.waitWhilePaused = vi.fn(async () => undefined)
    const result = await runCzkawka({ includedDirectories: ["D:/"] }, adapter)
    expect(adapter.waitWhilePaused).toHaveBeenCalledOnce()
    expect(adapter.scanDuplicates).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, data: { stopped: true } })
  })

  test("preserves partial results from a stopped native scan", async () => {
    const adapter = runtime()
    vi.mocked(adapter.scanDuplicates).mockResolvedValue({ groups: [{ files: [{ path: "D:/partial.bin", size: 12, modifiedDate: 1 }] }], messages: "stopped", stopped: true })
    const result = await runCzkawka({ includedDirectories: ["D:/"] }, adapter)
    expect(result).toMatchObject({ success: false, data: { stopped: true, fileCount: 1 } })
    expect(result.message).toContain("retained 1 partial")
  })

  test("applies the fork minimum duplicate group size in TypeScript", async () => {
    const result = await runCzkawka({ includedDirectories: ["D:/"], duplicateMinimumGroupSize: 3 }, runtime())
    expect(result.data?.groups).toEqual([])
  })

  test("routes all non-duplicate tool families", async () => {
    const basic = runtime(), media = runtime()
    await runCzkawka({ tool: "empty-files", includedDirectories: ["D:/"] }, basic)
    await runCzkawka({ tool: "similar-images", includedDirectories: ["D:/"] }, media)
    expect(basic.scanBasic).toHaveBeenCalledOnce()
    expect(media.scanMedia).toHaveBeenCalledOnce()
  })

  test("attaches thresholded similar-folder statistics to the shared result", async () => {
    const result = await runCzkawka({ tool: "similar-images", includedDirectories: ["D:/"], similarImagesFolderThreshold: 2 }, runtime())
    expect(result.data?.similarFolders).toEqual([{ path: "D:", count: 2, bytes: 41, groupCount: 1, previewPath: "D:/a.jpg" }])
    const hidden = await runCzkawka({ tool: "similar-images", includedDirectories: ["D:/"], similarImagesFolderThreshold: 3 }, runtime())
    expect(hidden.data?.similarFolders).toEqual([])
  })

  test("keeps destructive actions dry-run by default", async () => {
    const adapter = runtime()
    const result = await runCzkawka({ action: "delete", selectedPaths: ["D:/a.bin"] }, adapter)
    expect(result.data?.entries[0]?.status).toBe("planned")
    expect(adapter.removePath).not.toHaveBeenCalled()
  })

  test("uses the recycle bin for live deletion and preserves empty-folder semantics", async () => {
    const adapter = runtime()
    const result = await runCzkawka({ action: "delete", tool: "empty-folders", selectedPaths: ["D:/empty"], dryRun: false }, adapter)
    expect(result.data?.entries[0]).toMatchObject({ operation: "trash", status: "trashed" })
    expect(adapter.removePath).toHaveBeenCalledWith("D:/empty", { trash: true, emptyFoldersOnly: true })
  })

  test("supports permanent deletion explicitly", async () => {
    const adapter = runtime()
    await runCzkawka({ action: "delete", selectedPaths: ["D:/a.bin"], deleteMode: "permanent", dryRun: false }, adapter)
    expect(adapter.removePath).toHaveBeenCalledWith("D:/a.bin", { trash: false, emptyFoldersOnly: false })
  })

  test("copies files while preserving their root-relative structure", async () => {
    const adapter = runtime()
    const result = await runCzkawka({ action: "move", selectedPaths: ["D:/album/a.jpg"], destinationDirectory: "E:/archive", copyMode: true, preserveStructure: true, dryRun: false }, adapter)
    expect(adapter.copyPath).toHaveBeenCalledWith("D:/album/a.jpg", "E:/archive/album/a.jpg")
    expect(result.data?.entries[0]).toMatchObject({ secondaryPath: "E:/archive/album/a.jpg", operation: "copy", status: "copied" })
  })

  test.each(["skip", "error"] as const)("reports an existing target with the %s policy", async (conflictPolicy) => {
    const adapter = runtime()
    vi.mocked(adapter.pathExists).mockResolvedValue(true)
    const result = await runCzkawka({ action: "move", selectedPaths: ["D:/a.bin"], destinationDirectory: "E:/archive", conflictPolicy, dryRun: false }, adapter)
    expect(result.data?.entries[0]?.status).toBe(conflictPolicy === "skip" ? "skipped" : "error")
    expect(adapter.movePath).not.toHaveBeenCalled()
  })

  test("overwrites an existing target before moving", async () => {
    const adapter = runtime()
    vi.mocked(adapter.pathExists).mockResolvedValue(true)
    await runCzkawka({ action: "move", selectedPaths: ["D:/a.bin"], destinationDirectory: "E:/archive", conflictPolicy: "overwrite", dryRun: false }, adapter)
    expect(adapter.removePath).toHaveBeenCalledWith("E:/archive/a.bin", { trash: false })
    expect(adapter.movePath).toHaveBeenCalledWith("D:/a.bin", "E:/archive/a.bin")
  })

  test("finds a numbered target for rename conflicts during dry-run", async () => {
    const adapter = runtime()
    vi.mocked(adapter.pathExists).mockImplementation(async (path) => path.endsWith("a.bin") || path.endsWith("a (1).bin"))
    const result = await runCzkawka({ action: "move", selectedPaths: ["D:/a.bin"], destinationDirectory: "E:/archive", conflictPolicy: "rename" }, adapter)
    expect(result.data?.entries[0]).toMatchObject({ secondaryPath: "E:/archive/a (2).bin", status: "planned" })
  })

  test("reserves targets across a batch and renames duplicate basenames", async () => {
    const adapter = runtime()
    const result = await runCzkawka({ action: "move", selectedPaths: ["D:/one/a.bin", "D:/two/a.bin"], destinationDirectory: "E:/archive", conflictPolicy: "rename" }, adapter)
    expect(result.data?.entries.map((entry) => entry.secondaryPath)).toEqual(["E:/archive/a.bin", "E:/archive/a (1).bin"])
  })

  test("executes one shared move plan with per-item destination folders", async () => {
    const adapter = runtime()
    const result = await runCzkawka({ action: "move", destinationItems: [{ path: "D:/one/a.bin", destination: "E:/group-1" }, { path: "D:/two/b.bin", destination: "F:/group-2" }], copyMode: true, dryRun: false }, adapter)
    expect(result.data?.entries.map((entry) => entry.secondaryPath)).toEqual(["E:/group-1/a.bin", "F:/group-2/b.bin"])
    expect(adapter.copyPath).toHaveBeenNthCalledWith(1, "D:/one/a.bin", "E:/group-1/a.bin")
    expect(adapter.copyPath).toHaveBeenNthCalledWith(2, "D:/two/b.bin", "F:/group-2/b.bin")
  })

  test("keeps detailed per-item success and error results", async () => {
    const adapter = runtime()
    vi.mocked(adapter.movePath).mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce(undefined)
    const result = await runCzkawka({ action: "move", selectedPaths: ["D:/a.bin", "D:/b.bin"], destinationDirectory: "E:/archive", dryRun: false }, adapter)
    expect(result.success).toBe(false)
    expect(result.data?.entries.map(({ path, secondaryPath, status, error }) => ({ path, secondaryPath, status, error }))).toEqual([
      { path: "D:/a.bin", secondaryPath: "E:/archive/a.bin", status: "error", error: "locked" },
      { path: "D:/b.bin", secondaryPath: "E:/archive/b.bin", status: "moved", error: undefined },
    ])
  })

  test("plans and executes per-item extension corrections with conflict checks", async () => {
    const adapter = runtime()
    vi.mocked(adapter.pathExists).mockImplementation(async (path) => path === "D:/photo.bin")
    const planned = await runCzkawka({ action: "rename", renameItems: [{ path: "D:/photo.bin", properExtension: ".jpg" }] }, adapter)
    expect(planned.data?.entries[0]).toMatchObject({ path: "D:/photo.bin", secondaryPath: "D:/photo.jpg", properExtension: "jpg", operation: "rename", status: "planned" })
    const executed = await runCzkawka({ action: "rename", renameItems: [{ path: "D:/photo.bin", properExtension: "jpg" }], dryRun: false }, adapter)
    expect(executed.data?.entries[0]?.status).toBe("renamed")
    expect(adapter.movePath).toHaveBeenCalledWith("D:/photo.bin", "D:/photo.jpg")
  })

  test("reports extension target conflicts and invalid extensions per item", async () => {
    const conflictRuntime = runtime()
    vi.mocked(conflictRuntime.pathExists).mockResolvedValue(true)
    const conflict = await runCzkawka({ action: "rename", renameItems: [{ path: "D:/photo.bin", properExtension: "jpg" }] }, conflictRuntime)
    expect(conflict.data?.entries[0]).toMatchObject({ status: "skipped", error: "Target already exists." })
    const invalid = await runCzkawka({ action: "rename", renameItems: [{ path: "D:/photo.bin", properExtension: "bad/ext" }] }, runtime())
    expect(invalid.data?.entries[0]).toMatchObject({ status: "error", error: "Invalid proper extension." })
  })

  test("exports full result fields to structured JSON and CSV", async () => {
    const entry = { id: "media:1", groupId: 4, path: "D:/photo.bin", name: "photo.bin", size: 42, modifiedDate: 123, properExtension: "jpg", width: 800, height: 600, similarity: "2", detail: "bad extension" }
    const jsonRuntime = runtime()
    await runCzkawka({ action: "save", tool: "bad-extensions", outputPath: "D:/result.json", exportScope: "visible", exportEntries: [entry], dryRun: false }, jsonRuntime)
    const json = JSON.parse(vi.mocked(jsonRuntime.writeText).mock.calls[0]![1]) as { tool: string; scope: string; entries: Array<Record<string, unknown>> }
    expect(json).toMatchObject({ tool: "bad-extensions", scope: "visible", entries: [{ path: "D:/photo.bin", size: 42, properExtension: "jpg", width: 800, operation: "save", status: "saved" }] })
    const csvRuntime = runtime()
    await runCzkawka({ action: "save", outputPath: "D:/result.csv", outputFormat: "csv", exportEntries: [entry], dryRun: false }, csvRuntime)
    const csvContent = vi.mocked(csvRuntime.writeText).mock.calls[0]![1]
    expect(csvContent).toContain("groupId,path,name,size,modifiedDate")
    expect(csvContent).toContain('"jpg"')
    expect(csvContent).toContain('"bad extension"')
  })

  test("filters and sorts in TypeScript", () => {
    const groups = [{ id: 0, totalBytes: 3, reclaimableBytes: 1, entries: [
      { id: "a", groupId: 0, path: "D:/z.jpg", name: "z.jpg", size: 1, modifiedDate: 2 },
      { id: "b", groupId: 0, path: "D:/a.png", name: "a.png", size: 2, modifiedDate: 1 },
    ] }]
    const result = filterAndSortGroups(groups, { filterText: ".png", sortBy: "path", descending: false })
    expect(result[0]?.entries.map((entry) => entry.name)).toEqual(["a.png"])
  })

  test("migrates group smart-selection behavior", () => {
    const groups = [{ id: 0, totalBytes: 6, reclaimableBytes: 3, entries: [
      { id: "a", groupId: 0, path: "D:/small.bin", name: "small.bin", size: 1, modifiedDate: 1 },
      { id: "b", groupId: 0, path: "D:/large.bin", name: "large.bin", size: 5, modifiedDate: 2 },
    ] }]
    expect(smartSelect(groups, "all-except-biggest")).toEqual(["D:/small.bin"])
    expect(smartSelect(groups, "all-except-oldest")).toEqual(["D:/large.bin"])
  })

  test("always preserves reference entries", () => {
    const groups = [{ id: 0, totalBytes: 6, reclaimableBytes: 5, entries: [
      { id: "ref", groupId: 0, path: "D:/reference.bin", name: "reference.bin", size: 1, modifiedDate: 1, isReference: true },
      { id: "candidate", groupId: 0, path: "D:/candidate.bin", name: "candidate.bin", size: 5, modifiedDate: 2 },
    ] }]
    expect(smartSelect(groups, "all-except-newest")).toEqual(["D:/candidate.bin"])
  })
})
