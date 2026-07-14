import { describe, expect, test } from "vitest"
import { buildSameaPlan, extractArtist, runSamea } from "./core.js"
import type { SameaDirEntry, SameaRuntime } from "./core.js"

describe("samea core", () => {
  test("extracts circle and artist names from archive brackets", () => {
    expect(extractArtist("[Circle (Artist A)] book.zip", { artistBlacklist: [], regexBlacklist: [] })).toEqual({ key: "circle\u0000artist a", label: "[Circle (Artist A)]" })
  })

  test("plans matching archives into artist folders without touching unrelated archives", async () => {
    const runtime = fakeRuntime({
      "/archive": [
        file("[Circle (Artist A)] one.zip"),
        file("[Circle (Artist A)] two.rar"),
        file("[Various] collection.7z"),
      ],
    })
    const result = await buildSameaPlan({ ...baseInput, paths: ["/archive"] }, runtime)
    expect(result.readyCount).toBe(2)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: "[Circle (Artist A)] one.zip", targetPath: "/archive/[Circle (Artist A)]/[Circle (Artist A)] one.zip", status: "ready" }),
      expect.objectContaining({ sourceName: "[Various] collection.7z", status: "ignored", reason: "artist_not_detected" }),
    ]))
  })

  test("only moves ready archives after dry run is disabled", async () => {
    const moves: Array<[string, string]> = []
    const runtime = fakeRuntime({ "/archive": [file("[Artist] one.zip"), file("[Artist] two.zip")] }, moves)
    const result = await runSamea({ action: "classify", paths: ["/archive"], dryRun: false }, runtime)
    expect(result.success).toBe(true)
    expect(moves).toEqual([
      ["/archive/[Artist] one.zip", "/archive/[Artist]/[Artist] one.zip"],
      ["/archive/[Artist] two.zip", "/archive/[Artist]/[Artist] two.zip"],
    ])
  })

  test("does not rescan archives inside existing artist group directories", async () => {
    const groupedArchive: SameaDirEntry = { name: "[Artist] old.zip", path: "/archive/[Artist]/[Artist] old.zip", isFile: true, isDirectory: false }
    const runtime = fakeRuntime({
      "/archive": [
        { name: "[Artist]", path: "/archive/[Artist]", isFile: false, isDirectory: true },
        file("[New Artist] new.zip"),
      ],
      "/archive/[Artist]": [groupedArchive],
    })
    const result = await buildSameaPlan({ ...baseInput, paths: ["/archive"], skipGroupedDirectories: true }, runtime)

    expect(result.scannedCount).toBe(1)
    expect(result.items.map((item) => item.sourcePath)).toEqual(["/archive/[New Artist] new.zip"])
  })

  test("treats extracted work directories as movable artist items", async () => {
    const moves: Array<[string, string]> = []
    const runtime = fakeRuntime({
      "/archive": [
        { name: "[Artist] first work", path: "/archive/[Artist] first work", isFile: false, isDirectory: true },
        { name: "[Artist] second work", path: "/archive/[Artist] second work", isFile: false, isDirectory: true },
      ],
    }, moves)
    const result = await runSamea({ action: "classify", paths: ["/archive"], includeDirectories: true, minOccurrences: 2, dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(moves).toEqual([
      ["/archive/[Artist] first work", "/archive/[Artist]/[Artist] first work"],
      ["/archive/[Artist] second work", "/archive/[Artist]/[Artist] second work"],
    ])
  })
})

const baseInput = {
  action: "plan" as const, path: "", listText: "", ignorePathBlacklist: false, minOccurrences: 1, centralize: false, includeDirectories: false, skipGroupedDirectories: false, dryRun: true,
  artistBlacklist: ["various"], pathBlacklist: ["[00画师分类]"], regexBlacklist: [], archiveExtensions: [".zip", ".rar", ".7z"],
}
function file(name: string): SameaDirEntry { return { name, path: `/archive/${name}`, isFile: true, isDirectory: false } }
function fakeRuntime(dirs: Record<string, SameaDirEntry[]>, moves: Array<[string, string]> = []): SameaRuntime {
  return {
    pathInfo: async (path) => {
      if (dirs[path]) return { path, exists: true, isFile: false, isDirectory: true }
      for (const entries of Object.values(dirs)) { const entry = entries.find((item) => item.path === path); if (entry) return { path, exists: true, isFile: entry.isFile, isDirectory: entry.isDirectory } }
      return { path, exists: false, isFile: false, isDirectory: false }
    },
    listDir: async (path) => dirs[path] ?? [], ensureDir: async () => undefined,
    movePath: async (source, target) => { moves.push([source, target]) },
    join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
    dirname: (path) => path.replace(/\/[^/]+$/, "") || "/", basename: (path) => path.split("/").at(-1) ?? path,
  }
}
