import { describe, expect, test } from "vitest"
import type { MoveaDirEntry, MoveaRuntime } from "./core.js"
import { buildMoveaMoveTargets, isNumberedFolder, matchMoveaArchiveToFolders, runMovea } from "./core.js"

describe("movea core", () => {
  test("detects numbered folders and archive matches", () => {
    expect(isNumberedFolder("1. comics")).toBe(true)
    expect(isNumberedFolder("[02] books")).toBe(true)
    expect(isNumberedFolder("loose folder")).toBe(false)
    expect(matchMoveaArchiveToFolders("book.zip", ["2. misc", "1. doujinshi"], ["book"])).toEqual(["1. doujinshi", "2. misc"])
  })

  test("builds move targets from file and folder plan", () => {
    const targets = buildMoveaMoveTargets("artist", "root/artist", { "a.zip": "1. comics", "folder_loose": "2. misc" }, { join: (...parts) => parts.join("/") })
    expect(targets.map((item) => [item.itemName, item.itemType, item.targetPath])).toEqual([
      ["a.zip", "file", "root/artist/1. comics/a.zip"],
      ["loose", "folder", "root/artist/2. misc/loose"],
    ])
  })

  test("scans first-level folders and classifies movable entries", async () => {
    const runtime = memoryRuntime({
      root: [
        dir("artist", "root/artist"),
        dir("blacklisted", "root/blacklisted"),
      ],
      "root/artist": [
        dir("1. doujinshi", "root/artist/1. doujinshi"),
        dir("loose", "root/artist/loose"),
        file("book.zip", "root/artist/book.zip"),
      ],
    })
    const result = await runMovea({ action: "scan", rootPath: "root", blacklist: ["blacklisted"] }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.totalFolders).toBe(1)
    expect(result.data?.scanResults.artist?.archives).toEqual(["book.zip"])
    expect(result.data?.scanResults.artist?.movableFolders).toEqual(["loose"])
  })

  test("keeps archive folders even when no target subfolder exists", async () => {
    const runtime = memoryRuntime({
      root: [dir("artist", "root/artist")],
      "root/artist": [
        dir("loose", "root/artist/loose"),
        file("book.zip", "root/artist/book.zip"),
      ],
    })
    const result = await runMovea({ action: "scan", rootPath: "root" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.totalFolders).toBe(1)
    expect(result.data?.totalArchives).toBe(1)
    expect(result.data?.scanResults.artist?.subfolders).toEqual([])
    expect(result.data?.scanResults.artist?.warning).toBe("No target folder matched.")
  })

  test("runs dry-run move without touching runtime moves", async () => {
    const moves: string[] = []
    const runtime = memoryRuntime({ root: [dir("artist", "root/artist")], "root/artist": [] }, moves)
    const result = await runMovea({
      action: "move_single",
      rootPath: "root",
      level1Name: "artist",
      movePlan: { "book.zip": "1. doujinshi" },
      dryRun: true,
    }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.moveSuccess).toBe(1)
    expect(moves).toEqual([])
  })
})

function dir(name: string, path: string): MoveaDirEntry {
  return { name, path, isDirectory: true, isFile: false }
}

function file(name: string, path: string): MoveaDirEntry {
  return { name, path, isDirectory: false, isFile: true }
}

function memoryRuntime(tree: Record<string, MoveaDirEntry[]>, moves: string[] = []): MoveaRuntime {
  return {
    exists: async (path) => path in tree || Object.values(tree).some((entries) => entries.some((entry) => entry.path === path)),
    listDir: async (path) => tree[path] ?? [],
    ensureDir: async () => {},
    movePath: async (source, target) => { moves.push(`${source}->${target}`) },
    join: (...parts) => parts.join("/"),
    dirname: (path) => path.split("/").slice(0, -1).join("/"),
  }
}
