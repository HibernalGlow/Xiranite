import { expect, test } from "bun:test"
import type { RawfilterDirEntry, RawfilterPathInfo, RawfilterRuntime } from "./core.js"
import { buildRawfilterPlan, classifyVariant, createArchive, groupArchivesInDir, normalizeArchiveName, runRawfilter } from "./core.js"

test("normalizes archive names by removing variant markers", () => {
  expect(normalizeArchiveName("Circle - Same Book [Chinese].zip")).toBe("circle same book")
  expect(normalizeArchiveName("Circle - Same Book RAW.rar")).toBe("circle same book")
})

test("classifies translated and raw archive variants", () => {
  expect(classifyVariant("title [Chinese].zip")).toBe("translated")
  expect(classifyVariant("title RAW.zip")).toBe("raw")
  expect(classifyVariant("title.zip")).toBe("unknown")
})

test("plans raw duplicates to trash and extra translations to multi", async () => {
  const runtime = createMemoryRuntime("/work", [
    "Circle - Same Book [Chinese].zip",
    "Circle - Same Book [English].zip",
    "Circle - Same Book RAW.rar",
  ])
  const groups = await groupArchivesInDir("/work", runtime, { nameOnlyMode: false, minSimilarity: 0.82 })
  const plan = await buildRawfilterPlan(groups, "/work", { trashOnly: false, createShortcuts: false }, runtime)

  expect(plan.filter((item) => item.status === "kept")).toHaveLength(1)
  expect(plan.find((item) => item.fileName.includes("RAW"))?.destination).toBe("trash")
  expect(plan.find((item) => item.fileName.includes("English"))?.destination).toBe("multi")
})

test("executes plan with shortcut mode for extra translated versions", async () => {
  const runtime = createMemoryRuntime("/work", [
    "Game [Chinese].zip",
    "Game [English].zip",
  ])
  const result = await runRawfilter({ action: "execute", path: "/work", createShortcuts: true }, runtime)

  expect(result.success).toBe(true)
  expect(result.data?.createdShortcuts).toBe(1)
  expect(runtime.operations).toEqual(["shortcut:/work/Game [English].zip->/work/multi/game/Game [English].url"])
})

test("returns a validation error for a missing directory", async () => {
  const runtime = createMemoryRuntime("/work", [])
  const result = await runRawfilter({ action: "plan", path: "/missing" }, runtime)
  expect(result.success).toBe(false)
  expect(result.data?.errorCount).toBe(1)
})

function createMemoryRuntime(root: string, fileNames: string[]): RawfilterRuntime & { operations: string[] } {
  const files = new Set(fileNames.map((name) => join(root, name)))
  const dirs = new Set([root])
  const operations: string[] = []

  const runtime: RawfilterRuntime & { operations: string[] } = {
    operations,
    async pathInfo(path: string): Promise<RawfilterPathInfo> {
      return { path, exists: files.has(path) || dirs.has(path), isFile: files.has(path), isDirectory: dirs.has(path) }
    },
    async listDir(path: string): Promise<RawfilterDirEntry[]> {
      return [...files]
        .filter((file) => dirname(file) === path)
        .map((file) => ({ name: basename(file), path: file, isFile: true, isDirectory: false }))
    },
    async ensureDir(path: string): Promise<void> {
      dirs.add(path)
    },
    async moveFile(source: string, target: string): Promise<void> {
      operations.push(`move:${source}->${target}`)
      files.delete(source)
      files.add(target)
      dirs.add(dirname(target))
    },
    async createShortcut(source: string, target: string): Promise<void> {
      operations.push(`shortcut:${source}->${target}`)
      files.add(target)
      dirs.add(dirname(target))
    },
    join,
    dirname,
    basename,
  }

  return runtime
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/")
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/")
  return index <= 0 ? "/" : path.slice(0, index)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}
