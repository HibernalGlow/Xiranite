import { describe, expect, test } from "vitest"
import type { ClassfDirEntry, ClassfPathInfo, ClassfRuntime, ClassfTransferMode } from "./core.js"
import { inferCommonParent, runClassf } from "./core.js"

describe("classf core", () => {
  test("infers a common parent from selected paths", () => {
    expect(inferCommonParent(["/set/a.zip", "/set/b.zip"], pathRuntime)).toBe("/set")
    expect(inferCommonParent(["/set/a.zip", "/other/b.zip"], pathRuntime)).toBeUndefined()
  })

  test("builds auto already and wait plans", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/set": [
          { name: "selected.zip", path: "/set/selected.zip", isFile: true, isDirectory: false },
          { name: "other.zip", path: "/set/other.zip", isFile: true, isDirectory: false },
          { name: "already", path: "/set/already", isFile: false, isDirectory: true },
        ],
      },
    })

    const result = await runClassf({ action: "plan", paths: ["/set/selected.zip"], classifyMode: "auto" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(2)
    expect(result.data?.waitCount).toBe(1)
    expect(result.data?.items.map((item) => [item.stage, item.targetRelative])).toEqual([
      ["already", "already/selected.zip"],
      ["wait", "wait/other.zip"],
    ])
  })

  test("does not classify a directory input's parent in auto mode", async () => {
    const transfers: Array<[string, string, ClassfTransferMode]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/workspace": [
          { name: "src", path: "/workspace/src", isFile: false, isDirectory: true },
          { name: "unrelated", path: "/workspace/unrelated", isFile: false, isDirectory: true },
        ],
        "/workspace/src": [{ name: "inside.ts", path: "/workspace/src/inside.ts", isFile: true, isDirectory: false }],
      },
      transfers,
    })

    const result = await runClassf({ action: "plan", paths: ["/workspace/src"], classifyMode: "auto" }, runtime)

    expect(result.success).toBe(false)
    expect(result.message).toContain("would classify its parent")
    expect(result.data?.baseDir).toBeUndefined()
    expect(result.data?.items).toEqual([expect.objectContaining({ sourcePath: "/workspace/src", kind: "folder", reason: "Auto mode needs selected items inside this directory; a single directory path would classify its parent." })])

    const liveResult = await runClassf({ action: "classify", paths: ["/workspace/src"], classifyMode: "auto", dryRun: false }, runtime)

    expect(liveResult.success).toBe(false)
    expect(transfers).toEqual([])
  })

  test("requires a target when classification is off", async () => {
    const runtime = fakeRuntime({ dirs: { "/set": [{ name: "a.zip", path: "/set/a.zip", isFile: true, isDirectory: false }] } })

    const result = await runClassf({ action: "plan", paths: ["/set/a.zip"], classifyMode: "off" }, runtime)

    expect(result.success).toBe(false)
    expect(result.data?.errorCount).toBe(1)
    expect(result.data?.items[0]?.reason).toBe("target_required")
  })

  test("applies live move transfers", async () => {
    const transfers: Array<[string, string, ClassfTransferMode]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/set": [{ name: "selected.zip", path: "/set/selected.zip", isFile: true, isDirectory: false }],
      },
      transfers,
    })

    const result = await runClassf({ action: "classify", paths: ["/set/selected.zip"], classifyMode: "only", dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(1)
    expect(transfers).toEqual([["/set/selected.zip", "/set/already/selected.zip", "move"]])
  })
})

const pathRuntime = {
  dirname: (path: string) => path.replace(/[/\\][^/\\]+$/, "") || ".",
}

function fakeRuntime(options: {
  dirs: Record<string, ClassfDirEntry[]>
  existing?: Set<string>
  transfers?: Array<[string, string, ClassfTransferMode]>
}): ClassfRuntime {
  return {
    pathInfo: async (path) => infoFor(path, options.dirs, options.existing ?? new Set()),
    listDir: async (path) => options.dirs[path] ?? [],
    ensureDir: async () => undefined,
    transfer: async (source, target, mode) => { options.transfers?.push([source, target, mode]) },
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    dirname: pathRuntime.dirname,
    basename: (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
}

function infoFor(path: string, dirs: Record<string, ClassfDirEntry[]>, existing: Set<string>): ClassfPathInfo {
  if (dirs[path]) return { path, exists: true, isFile: false, isDirectory: true }
  if (existing.has(path)) return { path, exists: true, isFile: true, isDirectory: false }
  for (const entries of Object.values(dirs)) {
    const entry = entries.find((item) => item.path === path)
    if (entry) return { path, exists: true, isFile: entry.isFile, isDirectory: entry.isDirectory }
  }
  return { path, exists: false, isFile: false, isDirectory: false }
}
