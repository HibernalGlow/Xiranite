import { expect, test } from "bun:test"
import type { CrashuDirEntry, CrashuPathInfo, CrashuRuntime } from "./core.js"
import { compareFolderNames, loadTargets, matchSimilarFolders, normalizeFolderName, runCrashu } from "./core.js"

test("normalizes folder names and compares aliases", () => {
  expect(normalizeFolderName("Circle - Project [RJ123456]")).toBe("circle project rj123456")
  const comparison = compareFolderNames("Circle Project [Alt Name]", "Alt Name")
  expect(comparison.similarity).toBe(1)
  expect(comparison.matchDim).toBe("exact")
})

test("loads target child directories from target path", async () => {
  const runtime = createMemoryRuntime({
    "/src": ["Circle Project"],
    "/targets": ["Circle Project CN", "Other"],
  })
  const targets = await loadTargets({ targetPath: "/targets", targetNames: [] }, runtime)
  expect(targets.map((item) => item.name)).toEqual(["Circle Project CN", "Other"])
})

test("matches source folders above threshold", async () => {
  const sources = [{ name: "Circle Project", path: "/src/Circle Project", sourceRoot: "/src" }]
  const targets = [{ name: "Circle Project CN", path: "/targets/Circle Project CN" }]
  const matches = matchSimilarFolders(sources, targets, 0.6)
  expect(matches).toHaveLength(1)
  expect(matches[0].targetFullpath).toBe("/targets/Circle Project CN")
})

test("plans and moves matched folders", async () => {
  const runtime = createMemoryRuntime({
    "/src": ["Circle Project"],
    "/targets": ["Circle Project CN"],
    "/dest": [],
  })
  const result = await runCrashu({
    action: "move",
    sourcePaths: ["/src"],
    targetPath: "/targets",
    destinationPath: "/dest",
    autoMove: true,
  }, runtime)

  expect(result.success).toBe(true)
  expect(result.data?.movedCount).toBe(1)
  expect(result.data?.pairsFile).toBe("/dest/folder_pairs.json")
  expect(runtime.operations).toContain("move:/src/Circle Project->/dest/Circle Project CN/Circle Project")
})

test("reports validation errors", async () => {
  const runtime = createMemoryRuntime({})
  const result = await runCrashu({ action: "scan", sourcePaths: ["/missing"], targetNames: ["x"] }, runtime)
  expect(result.success).toBe(false)
  expect(result.data?.errorCount).toBe(1)
})

function createMemoryRuntime(tree: Record<string, string[]>): CrashuRuntime & { operations: string[] } {
  const dirs = new Set<string>(Object.keys(tree))
  for (const [root, children] of Object.entries(tree)) {
    dirs.add(root)
    for (const child of children) dirs.add(join(root, child))
  }
  const operations: string[] = []

  return {
    operations,
    async pathInfo(path: string): Promise<CrashuPathInfo> {
      return { path, exists: dirs.has(path), isFile: false, isDirectory: dirs.has(path) }
    },
    async listDir(path: string): Promise<CrashuDirEntry[]> {
      return (tree[path] ?? []).map((name) => ({ name, path: join(path, name), isFile: false, isDirectory: true }))
    },
    async ensureDir(path: string): Promise<void> {
      dirs.add(path)
    },
    async movePath(source: string, target: string): Promise<void> {
      operations.push(`move:${source}->${target}`)
      dirs.delete(source)
      dirs.add(target)
      dirs.add(dirname(target))
    },
    async deletePath(path: string): Promise<void> {
      operations.push(`delete:${path}`)
      dirs.delete(path)
    },
    async writeText(path: string, content: string): Promise<void> {
      operations.push(`write:${path}:${content.length}`)
      dirs.add(dirname(path))
    },
    join,
    dirname,
    basename,
  }
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
