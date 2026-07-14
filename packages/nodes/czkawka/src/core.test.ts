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
    expect(value.similarImagesHashSize).toBe(16)
    expect(value.similarVideosCropDetect).toBe("letterbox")
    expect(value.musicCheckType).toBe("tags")
    expect(value.brokenImage).toBe(true)
  })

  test("maps duplicate groups and reclaimable bytes", async () => {
    const result = await runCzkawka({ includedDirectories: ["D:/"] }, runtime())
    expect(result.success).toBe(true)
    expect(result.data?.groupCount).toBe(1)
    expect(result.data?.reclaimableBytes).toBe(12)
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
