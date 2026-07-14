import { describe, expect, test, vi } from "vitest"
import { filterAndSortGroups, normalizeCzkawkaInput, runCzkawka, smartSelect, type CzkawkaRuntime } from "./core.js"

function runtime(): CzkawkaRuntime {
  return {
    scanDuplicates: vi.fn(async () => ({ groups: [{ files: [{ path: "D:/a.bin", size: 12, modifiedDate: 1, hash: "x" }, { path: "D:/b.bin", size: 12, modifiedDate: 2, hash: "x" }] }], messages: "ok", stopped: false })),
    scanBasic: vi.fn(async () => ({ entries: [{ path: "D:/empty.tmp", size: 0, modifiedDate: 1 }], messages: "ok", stopped: false })),
    scanMedia: vi.fn(async () => ({ groups: [{ entries: [{ path: "D:/a.jpg", size: 20, modifiedDate: 1, width: 100, height: 80 }, { path: "D:/b.jpg", size: 21, modifiedDate: 1, width: 100, height: 80 }] }], messages: "ok", stopped: false })),
    removePath: vi.fn(async () => undefined), movePath: vi.fn(async () => undefined), writeText: vi.fn(async () => undefined), ensureDirectory: vi.fn(async () => undefined),
    join: (...parts) => parts.join("/"), dirname: (path) => path.slice(0, path.lastIndexOf("/")), basename: (path) => path.slice(path.lastIndexOf("/") + 1),
  }
}

describe("czkawka TypeScript orchestration", () => {
  test("normalizes safe defaults", () => {
    const value = normalizeCzkawkaInput({})
    expect(value.tool).toBe("duplicate-files")
    expect(value.dryRun).toBe(true)
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
