import { describe, expect, test } from "vitest"
import type { NameuPathInfo, NameuRuntime } from "./core.js"
import { normalizeArchiveName, runNameu } from "./core.js"

describe("nameu core", () => {
  test("normalizes archive names and appends the artist name", () => {
    const result = normalizeArchiveName("PIXIV FANBOX {3000@PX} [cbr] 作品.zip", "Artist", {
      addArtistName: true,
      excludeKeywords: [],
      forbiddenArtistKeywords: [],
    })

    expect(result).toBe("FANBOX 作品Artist.zip")
  })

  test("builds a multi-folder rename plan", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/library": [{ name: "Artist", path: "/library/Artist", isFile: false, isDirectory: true }],
        "/library/Artist": [{ name: "Book [cbr].zip", path: "/library/Artist/Book [cbr].zip", isFile: true, isDirectory: false }],
      },
    })

    const result = await runNameu({ action: "plan", paths: ["/library"], mode: "multi" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(1)
    expect(result.data?.items[0]).toMatchObject({
      sourceName: "Book [cbr].zip",
      targetName: "BookArtist.zip",
      artistName: "Artist",
      status: "ready",
    })
  })

  test("reports target conflicts without renaming", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/library/Artist": [
          { name: "Book [cbr].zip", path: "/library/Artist/Book [cbr].zip", isFile: true, isDirectory: false },
          { name: "BookArtist.zip", path: "/library/Artist/BookArtist.zip", isFile: true, isDirectory: false },
        ],
      },
    })

    const result = await runNameu({ action: "plan", paths: ["/library/Artist"], mode: "single" }, runtime)

    expect(result.data?.conflictCount).toBe(1)
    expect(result.data?.items.find((item) => item.status === "conflict")?.reason).toBe("target_name_exists")
  })

  test("renames ready entries and preserves timestamps", async () => {
    const renames: Array<[string, string]> = []
    const setTimes: Array<[string, number, number]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/library/Artist": [{ name: "Book [cbr].zip", path: "/library/Artist/Book [cbr].zip", isFile: true, isDirectory: false }],
      },
      renames,
      setTimes,
    })

    const result = await runNameu({ action: "rename", paths: ["/library/Artist"], mode: "single", dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.renamedCount).toBe(1)
    expect(renames).toEqual([["/library/Artist/Book [cbr].zip", "/library/Artist/BookArtist.zip"]])
    expect(setTimes).toEqual([["/library/Artist/BookArtist.zip", 1000, 2000]])
  })
})

function fakeRuntime(options: {
  dirs: Record<string, Array<{ name: string; path: string; isFile: boolean; isDirectory: boolean }>>
  renames?: Array<[string, string]>
  setTimes?: Array<[string, number, number]>
}): NameuRuntime {
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

function infoFor(path: string, dirs: Record<string, Array<{ path: string; isFile: boolean; isDirectory: boolean }>>): NameuPathInfo {
  if (dirs[path]) return { path, exists: true, isFile: false, isDirectory: true, atimeMs: 1000, mtimeMs: 2000 }
  for (const entries of Object.values(dirs)) {
    const entry = entries.find((item) => item.path === path)
    if (entry) return { path, exists: true, isFile: entry.isFile, isDirectory: entry.isDirectory, atimeMs: 1000, mtimeMs: 2000 }
  }
  return { path, exists: false, isFile: false, isDirectory: false, atimeMs: 0, mtimeMs: 0 }
}
