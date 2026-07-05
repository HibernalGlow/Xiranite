import { describe, expect, test } from "bun:test"
import type { MigratefDirEntry, MigratefPathInfo, MigratefRuntime } from "./core.js"
import { buildMigratefPlan, dumpMigratefHistory, parseMigratefHistory, preserveRelativeTarget, runMigratef } from "./core.js"

describe("migratef core", () => {
  test("normalizes preserve targets", () => {
    expect(preserveRelativeTarget("C:\\Users\\a\\file.txt")).toBe("Users\\a\\file.txt")
    expect(preserveRelativeTarget("/mnt/a/file.txt")).toBe("mnt/a/file.txt")
  })

  test("round-trips undo history", () => {
    const records = [{ id: "abc", timestamp: "2026-01-01T00:00:00.000Z", description: "move", action: "move" as const, operations: [{ sourcePath: "a", targetPath: "b", action: "move" as const }] }]
    expect(parseMigratefHistory(dumpMigratefHistory(records))).toEqual(records)
  })

  test("builds flat and direct plans", async () => {
    const runtime = memoryRuntime({
      "root": dirInfo("root"),
      "root/a.txt": fileInfo("root/a.txt"),
      "root/nested": dirInfo("root/nested"),
      "root/nested/b.txt": fileInfo("root/nested/b.txt"),
      "target": dirInfo("target"),
    }, {
      root: [fileEntry("a.txt", "root/a.txt"), dirEntry("nested", "root/nested")],
      "root/nested": [fileEntry("b.txt", "root/nested/b.txt")],
      target: [],
    })
    const flat = await buildMigratefPlan({ action: "move", mode: "flat", path: "", sourcePaths: ["root"], targetPath: "target", maxWorkers: 1, batchId: "", historyLimit: 10, historyPath: "", dryRun: true }, runtime)
    expect(flat.map((item) => item.targetPath)).toEqual(["target/a.txt"])
    const direct = await buildMigratefPlan({ action: "move", mode: "direct", path: "", sourcePaths: ["root"], targetPath: "target", maxWorkers: 1, batchId: "", historyLimit: 10, historyPath: "", dryRun: true }, runtime)
    expect(direct[0]?.targetPath).toBe("target/root")
    expect(direct[0]?.kind).toBe("directory")
  })

  test("executes move and undo with history", async () => {
    const moves: string[] = []
    const writes: Record<string, string> = {}
    const runtime = memoryRuntime({
      "root": dirInfo("root"),
      "root/a.txt": fileInfo("root/a.txt"),
      "target": dirInfo("target"),
    }, {
      root: [fileEntry("a.txt", "root/a.txt")],
      target: [],
    }, moves, writes)
    const result = await runMigratef({ action: "move", mode: "flat", sourcePaths: ["root"], targetPath: "target", historyPath: "history.json" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.operationId).toBe("id1")
    expect(moves).toEqual(["root/a.txt->target/a.txt"])
    const undo = await runMigratef({ action: "undo", historyPath: "history.json" }, runtime)
    expect(undo.success).toBe(true)
    expect(moves.at(-1)).toBe("target/a.txt->root/a.txt")
    expect(writes["history.json"]).toContain("\"undone\": true")
  })
})

function fileInfo(path: string): MigratefPathInfo {
  return { path, exists: true, isFile: true, isDirectory: false }
}

function dirInfo(path: string): MigratefPathInfo {
  return { path, exists: true, isFile: false, isDirectory: true }
}

function fileEntry(name: string, path: string): MigratefDirEntry {
  return { name, path, isFile: true, isDirectory: false }
}

function dirEntry(name: string, path: string): MigratefDirEntry {
  return { name, path, isFile: false, isDirectory: true }
}

function memoryRuntime(
  infos: Record<string, MigratefPathInfo>,
  dirs: Record<string, MigratefDirEntry[]>,
  moves: string[] = [],
  writes: Record<string, string> = {},
): MigratefRuntime {
  return {
    pathInfo: async (path) => infos[path] ?? { path, exists: false, isFile: false, isDirectory: false },
    listDir: async (path) => dirs[path] ?? [],
    ensureDir: async () => {},
    copyFile: async (source, target) => { moves.push(`copy:${source}->${target}`) },
    copyDir: async (source, target) => { moves.push(`copydir:${source}->${target}`) },
    movePath: async (source, target) => { moves.push(`${source}->${target}`) },
    deletePath: async (path) => { moves.push(`delete:${path}`) },
    readText: async (path) => writes[path] ?? null,
    writeText: async (path, content) => { writes[path] = content },
    join: (...parts) => parts.join("/"),
    dirname: (path) => path.split("/").slice(0, -1).join("/"),
    basename: (path) => path.split("/").at(-1) ?? path,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    randomId: () => "id1",
    defaultHistoryPath: () => "history.json",
  }
}
