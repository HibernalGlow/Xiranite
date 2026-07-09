import { describe, expect, test } from "vitest"
import type { SynctDirEntry, SynctPathInfo, SynctRuntime } from "./core.js"
import { buildDateDirectory, extractTimestamp, runSynct } from "./core.js"

describe("synct core", () => {
  test("extracts timestamps from dated names", () => {
    expect(extractTimestamp("IMG_2026-07-10.png")?.toISOString()).toBe("2026-07-10T00:00:00.000Z")
    expect(extractTimestamp("scan_260710.jpg")?.toISOString()).toBe("2026-07-10T00:00:00.000Z")
    expect(extractTimestamp("2026.07 batch")?.toISOString()).toBe("2026-07-01T00:00:00.000Z")
  })

  test("builds nested date directories", () => {
    const date = new Date(Date.UTC(2026, 6, 10))
    expect(buildDateDirectory("/archive", date, "nested_y_m_d", fakePathRuntime)).toBe("/archive/2026/07/10")
    expect(buildDateDirectory("/archive", date, "year_month_day", fakePathRuntime)).toBe("/archive/2026-07-10")
  })

  test("plans files into archive folders and reports conflicts", async () => {
    const runtime = fakeRuntime({
      dirs: {
        "/downloads": [
          { name: "IMG_2026-07-10.png", path: "/downloads/IMG_2026-07-10.png", isFile: true, isDirectory: false },
          { name: "IMG_2026-07-11.png", path: "/downloads/IMG_2026-07-11.png", isFile: true, isDirectory: false },
        ],
      },
      existing: new Set(["/downloads/archive/2026-07/IMG_2026-07-11.png"]),
    })

    const result = await runSynct({ action: "plan", paths: ["/downloads"], archiveFolder: true }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(1)
    expect(result.data?.conflictCount).toBe(1)
    expect(result.data?.items[0]).toMatchObject({
      sourceName: "IMG_2026-07-10.png",
      targetRelative: "2026-07/IMG_2026-07-10.png",
      status: "ready",
    })
  })

  test("moves ready folder entries and syncs child file times", async () => {
    const moves: Array<[string, string]> = []
    const times: Array<[string, number, number]> = []
    const runtime = fakeRuntime({
      dirs: {
        "/work": [{ name: "Project_2026-07-10", path: "/work/Project_2026-07-10", isFile: false, isDirectory: true }],
        "/work/Project_2026-07-10": [{ name: "note.txt", path: "/work/Project_2026-07-10/note.txt", isFile: true, isDirectory: false }],
      },
      moves,
      times,
    })

    const result = await runSynct({
      action: "archive",
      paths: ["/work"],
      sourceMode: "folders",
      formatKey: "nested_y_m",
      dryRun: false,
      syncFolderFileTimes: true,
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(1)
    expect(moves).toEqual([["/work/Project_2026-07-10", "/work/2026/07/Project_2026-07-10"]])
    expect(times).toEqual([["/work/Project_2026-07-10/note.txt", 1783641600000, 1783641600000]])
  })
})

const fakePathRuntime = {
  join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}

function fakeRuntime(options: {
  dirs: Record<string, SynctDirEntry[]>
  existing?: Set<string>
  moves?: Array<[string, string]>
  times?: Array<[string, number, number]>
}): SynctRuntime {
  return {
    pathInfo: async (path) => infoFor(path, options.dirs, options.existing ?? new Set()),
    listDir: async (path) => options.dirs[path] ?? [],
    ensureDir: async () => undefined,
    move: async (from, to) => { options.moves?.push([from, to]) },
    setTimes: async (path, atimeMs, mtimeMs) => { options.times?.push([path, atimeMs, mtimeMs]) },
    join: fakePathRuntime.join,
    dirname: (path) => path.replace(/[/\\][^/\\]+$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
}

function infoFor(path: string, dirs: Record<string, SynctDirEntry[]>, existing: Set<string>): SynctPathInfo {
  if (dirs[path]) return info(path, false, true)
  if (existing.has(path)) return info(path, true, false)
  for (const entries of Object.values(dirs)) {
    const entry = entries.find((item) => item.path === path)
    if (entry) return info(path, entry.isFile, entry.isDirectory)
  }
  return { path, exists: false, isFile: false, isDirectory: false, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }
}

function info(path: string, isFile: boolean, isDirectory: boolean): SynctPathInfo {
  return { path, exists: true, isFile, isDirectory, atimeMs: 1000, mtimeMs: 2000, ctimeMs: 1783641600000 }
}
