import { describe, expect, test } from "bun:test"
import type { TrenameDirEntry, TrenamePathInfo, TrenameRuntime } from "./core.js"
import { countPending, countReady, countTotal, parseRenameJson, runTrename, scanTrenamePaths, stringifyRenameJson } from "./core.js"

describe("trename core", () => {
  test("scans folders into rename JSON and respects excludes", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/work/gallery/a.jpg")
    runtime.file("/work/gallery/readme.txt")
    runtime.file("/work/gallery/sub/b.png")

    const scan = await scanTrenamePaths(["/work/gallery"], {
      includeHidden: false,
      includeRoot: true,
      excludeExts: [".txt"],
      excludePatterns: [],
      mode: "normal",
    }, runtime)

    expect(scan.basePath).toBe("/work")
    expect(countTotal(scan.renameJson)).toBe(4)
    expect(countPending(scan.renameJson)).toBe(4)
    expect(stringifyRenameJson(scan.renameJson, true)).toContain('"src_dir": "gallery"')
    expect(stringifyRenameJson(scan.renameJson, true)).not.toContain("readme.txt")
  })

  test("imports and counts ready targets", async () => {
    const json = JSON.stringify({ root: [{ src_dir: "gallery", tgt_dir: "", children: [{ src: "a.jpg", tgt: "A.jpg" }] }] })
    const parsed = parseRenameJson(json)
    expect(countTotal(parsed)).toBe(2)
    expect(countPending(parsed)).toBe(1)
    expect(countReady(parsed)).toBe(1)
  })

  test("validates target conflicts and plans dry-run rename", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/work/a.jpg")
    runtime.file("/work/existing.jpg")
    const json = JSON.stringify({ root: [{ src: "a.jpg", tgt: "existing.jpg" }] })

    const result = await runTrename({ action: "rename", jsonContent: json, basePath: "/work" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(0)
    expect(result.data?.skippedCount).toBe(1)
    expect(result.data?.conflicts[0]?.type).toBe("target_exists")
    expect(runtime.moves.length).toBe(0)
  })

  test("renames files and records undo batches", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/work/a.jpg")
    const json = JSON.stringify({ root: [{ src: "a.jpg", tgt: "A.jpg" }] })

    const renamed = await runTrename({ action: "rename", jsonContent: json, basePath: "/work", dryRun: false, undoPath: "/undo.json" }, runtime)
    expect(renamed.success).toBe(true)
    expect(renamed.data?.successCount).toBe(1)
    expect(renamed.data?.operationId).toBe("batch001")
    expect(runtime.moves[0]).toEqual(["/work/a.jpg", "/work/A.jpg"])

    const undone = await runTrename({ action: "undo", batchId: "batch001", undoPath: "/undo.json" }, runtime)
    expect(undone.success).toBe(true)
    expect(undone.data?.successCount).toBe(1)
    expect(runtime.moves[1]).toEqual(["/work/A.jpg", "/work/a.jpg"])
  })

  test("leak mode keeps archives without known prefixes", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/work/box/2024.01 done.zip")
    runtime.file("/work/box/raw pack.zip")
    runtime.file("/work/box/image.png")

    const result = await runTrename({ action: "scan", path: "/work/box", mode: "leak", compact: true }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.jsonContent).toContain("raw pack.zip")
    expect(result.data?.jsonContent).not.toContain("2024.01 done.zip")
    expect(result.data?.jsonContent).not.toContain("image.png")
  })
})

type MemoryItem = { type: "dir" | "file"; text: string; createdMs: number; modifiedMs: number }

function createMemoryRuntime() {
  const items: Record<string, MemoryItem> = { "/": dirItem() }
  const runtime: TrenameRuntime & {
    moves: string[][]
    file: (path: string, text?: string) => void
  } = {
    moves: [],
    file(path: string, text = "") {
      ensureDir(dirname(path))
      items[normalize(path)] = { type: "file", text, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_000_000 }
    },
    async pathInfo(path): Promise<TrenamePathInfo> {
      const item = items[normalize(path)]
      return {
        path: normalize(path),
        exists: Boolean(item),
        isFile: item?.type === "file",
        isDirectory: item?.type === "dir",
        size: item?.text.length ?? 0,
        createdMs: item?.createdMs ?? 0,
        modifiedMs: item?.modifiedMs ?? 0,
      }
    },
    async listDir(path): Promise<TrenameDirEntry[]> {
      const root = normalize(path)
      return Object.entries(items)
        .filter(([itemPath]) => itemPath !== root && dirname(itemPath) === root)
        .map(([itemPath, item]) => ({ name: basename(itemPath), path: itemPath, isFile: item.type === "file", isDirectory: item.type === "dir", size: item.text.length }))
    },
    async readText(path) {
      const item = items[normalize(path)]
      if (!item) throw new Error(`missing file: ${path}`)
      return item.text
    },
    async writeText(path, content) {
      runtime.file(path, content)
    },
    async ensureDir(path) {
      ensureDir(path)
    },
    async movePath(source, target) {
      runtime.moves.push([normalize(source), normalize(target)])
      const from = normalize(source)
      const to = normalize(target)
      const moving = Object.entries(items).filter(([path]) => path === from || path.startsWith(`${from}/`))
      if (!moving.length) throw new Error(`missing source: ${source}`)
      for (const [path] of moving) delete items[path]
      for (const [path, item] of moving) items[to + path.slice(from.length)] = { ...item }
    },
    join: (...parts) => normalize(parts.filter(Boolean).join("/")),
    dirname,
    basename,
    resolve: normalize,
    defaultUndoPath: () => "/undo.json",
    now: () => "2026-01-01T00:00:00.000Z",
    randomId: () => "batch001",
  }

  function ensureDir(path: string) {
    const normalized = normalize(path)
    if (items[normalized]) return
    ensureDir(dirname(normalized))
    items[normalized] = dirItem()
  }

  return runtime
}

function dirItem(): MemoryItem {
  return { type: "dir", text: "", createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_000_000 }
}

function normalize(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return normalized || "/"
}

function dirname(path: string): string {
  const normalized = normalize(path)
  if (normalized === "/") return "/"
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

function basename(path: string): string {
  const normalized = normalize(path)
  if (normalized === "/") return ""
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}
