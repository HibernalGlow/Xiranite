import { describe, expect, test } from "vitest"
import type { ClassqDirEntry, ClassqPathInfo, ClassqRuntime, ClassqTransferMode } from "./core.js"
import { findKeywordFolders, runClassq } from "./core.js"

describe("classq core", () => {
  test("finds keyword folders recursively", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/root": [{ name: "series", path: "/root/series", isFile: false, isDirectory: true }],
        "/root/series": [{ name: "already", path: "/root/series/already", isFile: false, isDirectory: true }],
        "/root/series/already": [],
      },
    })

    const found = await findKeywordFolders("/root", "already", runtime)

    expect(found.map((item) => item.path)).toEqual(["/root/series/already"])
  })

  test("plans sibling items into the wait folder", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/root": [
          { name: "already", path: "/root/already", isFile: false, isDirectory: true },
          { name: "pending.zip", path: "/root/pending.zip", isFile: true, isDirectory: false },
          { name: "extra", path: "/root/extra", isFile: false, isDirectory: true },
        ],
        "/root/already": [],
        "/root/extra": [],
      },
    })

    const result = await runClassq({ action: "plan", paths: ["/root"], keyword: "already", waitKeyword: "wait" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.keywordCount).toBe(1)
    expect(result.data?.readyCount).toBe(2)
    expect(result.data?.items.map((item) => [item.stage, item.sourceName, item.targetRelative])).toEqual([
      ["keyword", "already", "wait"],
      ["wait", "pending.zip", "wait/pending.zip"],
      ["wait", "extra", "wait/extra"],
    ])
  })

  test("reports existing wait targets as conflicts", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/root": [
          { name: "already", path: "/root/already", isFile: false, isDirectory: true },
          { name: "pending.zip", path: "/root/pending.zip", isFile: true, isDirectory: false },
        ],
        "/root/already": [],
      },
      existing: new Set(["/root/wait/pending.zip"]),
    })

    const result = await runClassq({ action: "plan", paths: ["/root"] }, runtime)

    expect(result.data?.conflictCount).toBe(1)
    expect(result.data?.items.find((item) => item.status === "conflict")?.reason).toBe("target_exists")
  })

  test("applies live wait transfers", async () => {
    const transfers: Array<[string, string, ClassqTransferMode]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/root": [
          { name: "already", path: "/root/already", isFile: false, isDirectory: true },
          { name: "pending.zip", path: "/root/pending.zip", isFile: true, isDirectory: false },
        ],
        "/root/already": [],
      },
      transfers,
    })

    const result = await runClassq({ action: "classify", paths: ["/root"], dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(1)
    expect(transfers).toEqual([["/root/pending.zip", "/root/wait/pending.zip", "move"]])
  })
})

function fakeRuntime(options: {
  dirs: Record<string, ClassqDirEntry[]>
  existing?: Set<string>
  transfers?: Array<[string, string, ClassqTransferMode]>
}): ClassqRuntime {
  return {
    pathInfo: async (path) => infoFor(path, options.dirs, options.existing ?? new Set()),
    listDir: async (path) => options.dirs[path] ?? [],
    ensureDir: async () => undefined,
    transfer: async (source, target, mode) => { options.transfers?.push([source, target, mode]) },
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    dirname: (path) => path.replace(/[/\\][^/\\]+$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
}

function infoFor(path: string, dirs: Record<string, ClassqDirEntry[]>, existing: Set<string>): ClassqPathInfo {
  if (dirs[path]) return { path, exists: true, isFile: false, isDirectory: true }
  if (existing.has(path)) return { path, exists: true, isFile: true, isDirectory: false }
  for (const entries of Object.values(dirs)) {
    const entry = entries.find((item) => item.path === path)
    if (entry) return { path, exists: true, isFile: entry.isFile, isDirectory: entry.isDirectory }
  }
  return { path, exists: false, isFile: false, isDirectory: false }
}
