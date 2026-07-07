import { describe, expect, test } from "vitest"
import type { SeriexDirEntry, SeriexRuntime } from "./core.js"
import { findSeriesGroups, parseSeriexConfigText, runSeriex, validateSeriesName } from "./core.js"

describe("seriex core", () => {
  test("parses TOML-like config values", () => {
    const config = parseSeriexConfigText(`
formats = ["zip", "mp4"]
archive_formats = ["zip"]
prefix = "#"
add_prefix = false
known_series_dirs = ["D:/Series"]
`)
    expect(config.formats).toEqual([".mp4", ".zip"])
    expect(config.archiveFormats).toEqual([".zip"])
    expect(config.prefix).toBe("#")
    expect(config.addPrefix).toBe(false)
    expect(config.knownSeriesDirs).toEqual(["D:/Series"])
  })

  test("validates and groups series names", () => {
    expect(validateSeriesName("Alpha 01")).toBe("Alpha")
    const groups = findSeriesGroups(["/x/Alpha 01.zip", "/x/Alpha 02.zip", "/x/Beta 01.zip", "/x/Beta 02.zip"])
    expect(groups.Alpha).toHaveLength(2)
    expect(groups.Beta).toHaveLength(2)
  })

  test("plans two series in one directory", async () => {
    const runtime = memoryRuntime({
      root: [
        file("Alpha 01.zip", "root/Alpha 01.zip"),
        file("Alpha 02.zip", "root/Alpha 02.zip"),
        file("Beta 01.zip", "root/Beta 01.zip"),
        file("Beta 02.zip", "root/Beta 02.zip"),
      ],
    })
    const result = await runSeriex({ action: "plan", directoryPath: "root" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.totalSeries).toBe(2)
    expect(Object.keys(result.data?.plan.root ?? {}).sort()).toEqual(["[#s]Alpha", "[#s]Beta"])
  })

  test("applies plan and records moves", async () => {
    const moves: string[] = []
    const runtime = memoryRuntime({
      root: [
        file("Alpha 01.zip", "root/Alpha 01.zip"),
        file("Alpha 02.zip", "root/Alpha 02.zip"),
        file("Beta 01.zip", "root/Beta 01.zip"),
        file("Beta 02.zip", "root/Beta 02.zip"),
      ],
    }, moves)
    const result = await runSeriex({ action: "execute", directoryPath: "root" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(4)
    expect(moves.some((move) => move.includes("[#s]Alpha"))).toBe(true)
  })
})

function dir(name: string, path: string): SeriexDirEntry {
  return { name, path, isDirectory: true, isFile: false }
}

function file(name: string, path: string): SeriexDirEntry {
  return { name, path, isDirectory: false, isFile: true }
}

function memoryRuntime(tree: Record<string, SeriexDirEntry[]>, moves: string[] = []): SeriexRuntime {
  return {
    exists: async (path) => path in tree || Object.values(tree).some((entries) => entries.some((entry) => entry.path === path)) || moves.some((move) => move.endsWith(`->${path}`)),
    listDir: async (path) => tree[path] ?? [],
    ensureDir: async (path) => { tree[path] ??= [] },
    movePath: async (source, target) => { moves.push(`${source}->${target}`) },
    readText: async () => null,
    join: (...parts) => parts.join("/"),
    dirname: (path) => path.split("/").slice(0, -1).join("/"),
    basename: (path) => path.split("/").at(-1) ?? path,
  }
}
