import { describe, expect, test } from "vitest"
import type { SnfPathInfo, SnfRuntime } from "./core.js"
import { parseNumberedFolder, runSnf } from "./core.js"

describe("snf core", () => {
  test("parses numbered folder names", () => {
    expect(parseNumberedFolder("3. CG")).toEqual({ number: 3, name: "CG" })
    expect(parseNumberedFolder("Folder")).toBeNull()
  })

  test("plans sequence repairs by priority keyword", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/library": [{ name: "Artist", path: "/library/Artist", isDirectory: true }],
        "/library/Artist": [
          { name: "3. CG", path: "/library/Artist/3. CG", isDirectory: true },
          { name: "9. 同人志", path: "/library/Artist/9. 同人志", isDirectory: true },
        ],
      },
    })

    const result = await runSnf({ action: "plan", paths: ["/library"], mode: "library" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(2)
    expect(result.data?.items.map((item) => item.targetName)).toEqual(["1. 同人志", "2. CG"])
  })

  test("leaves continuous sequences unchanged", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/library/Artist": [
          { name: "1. 同人志", path: "/library/Artist/1. 同人志", isDirectory: true },
          { name: "2. CG", path: "/library/Artist/2. CG", isDirectory: true },
        ],
      },
    })

    const result = await runSnf({ action: "plan", paths: ["/library/Artist"], mode: "artist" }, runtime)

    expect(result.data?.unchangedCount).toBe(2)
    expect(result.data?.readyCount).toBe(0)
  })

  test("renames ready entries and keeps timestamps", async () => {
    const renames: Array<[string, string]> = []
    const setTimes: Array<[string, number, number]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/library/Artist": [{ name: "3. CG", path: "/library/Artist/3. CG", isDirectory: true }],
      },
      renames,
      setTimes,
    })

    const result = await runSnf({ action: "rename", paths: ["/library/Artist"], mode: "artist", dryRun: false }, runtime)

    expect(result.data?.renamedCount).toBe(1)
    expect(renames).toEqual([["/library/Artist/3. CG", "/library/Artist/1. CG"]])
    expect(setTimes).toEqual([["/library/Artist/1. CG", 1000, 2000]])
  })
})

function fakeRuntime(options: {
  dirs: Record<string, Array<{ name: string; path: string; isDirectory: boolean }>>
  renames?: Array<[string, string]>
  setTimes?: Array<[string, number, number]>
}): SnfRuntime {
  return {
    pathInfo: async (path) => infoFor(path, options.dirs),
    listDir: async (path) => options.dirs[path] ?? [],
    rename: async (from, to) => { options.renames?.push([from, to]) },
    setTimes: async (path, atimeMs, mtimeMs) => { options.setTimes?.push([path, atimeMs, mtimeMs]) },
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    dirname: (path) => path.replace(/[/\\][^/\\]+$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
  }
}

function infoFor(path: string, dirs: Record<string, Array<{ path: string; isDirectory: boolean }>>): SnfPathInfo {
  if (dirs[path]) return { path, exists: true, isDirectory: true, atimeMs: 1000, mtimeMs: 2000 }
  for (const entries of Object.values(dirs)) {
    const entry = entries.find((item) => item.path === path)
    if (entry) return { path, exists: true, isDirectory: entry.isDirectory, atimeMs: 1000, mtimeMs: 2000 }
  }
  return { path, exists: false, isDirectory: false, atimeMs: 0, mtimeMs: 0 }
}
