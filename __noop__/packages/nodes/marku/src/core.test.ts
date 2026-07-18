import { expect, test } from "vitest"
import type { MarkuDirEntry, MarkuPathInfo, MarkuRuntime } from "./core.js"
import { applyMarkuModule, createUnifiedDiff, runMarku } from "./core.js"

test("markt converts headings to lists", () => {
  const output = applyMarkuModule("markt", "# Title\n## Child\n", { mode: "h2l", indent: 2 })
  expect(output).toBe("- Title\n  - Child\n")
})

test("content replace supports JSON patterns", () => {
  const output = applyMarkuModule("content_replace", "hello world", { patterns: JSON.stringify([{ from: "world", to: "marku" }]) })
  expect(output).toBe("hello marku")
})

test("creates unified diff for changed text", () => {
  const diff = createUnifiedDiff("a\n", "b\n", "x.md")
  expect(diff).toContain("--- a/x.md")
  expect(diff).toContain("-a")
  expect(diff).toContain("+b")
})

test("runs file dry-run without writing", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "# A\n# A\n" })
  const result = await runMarku({ module: "content_dedup", paths: ["/doc/a.md"], dryRun: true }, runtime)
  expect(result.success).toBe(true)
  expect(result.data?.filesChanged).toBe(1)
  expect(runtime.files.get("/doc/a.md")).toBe("# A\n# A\n")
})

test("writes files and can undo", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "# A\n# A\n" })
  const result = await runMarku({ module: "content_dedup", paths: ["/doc/a.md"], dryRun: false }, runtime)
  expect(result.data?.filesChanged).toBe(1)
  expect(runtime.files.get("/doc/a.md")).toBe("# A\n")
  const undo = await runMarku({ action: "undo" }, runtime)
  expect(undo.success).toBe(true)
  expect(runtime.files.get("/doc/a.md")).toBe("# A\n# A\n")
})

function createMemoryRuntime(seed: Record<string, string>): MarkuRuntime & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed))
  const dirs = new Set<string>(["/"])
  for (const path of files.keys()) dirs.add(dirname(path))

  return {
    files,
    async pathInfo(path: string): Promise<MarkuPathInfo> {
      return { path, exists: files.has(path) || dirs.has(path), isFile: files.has(path), isDirectory: dirs.has(path) }
    },
    async listDir(path: string): Promise<MarkuDirEntry[]> {
      const prefix = path.endsWith("/") ? path : `${path}/`
      const names = new Set<string>()
      for (const file of files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0])
      }
      return [...names].map((name) => {
        const child = join(path, name)
        return { name, path: child, isFile: files.has(child), isDirectory: dirs.has(child) }
      })
    },
    async readText(path: string): Promise<string | null> {
      return files.get(path) ?? null
    },
    async writeText(path: string, content: string): Promise<void> {
      files.set(path, content)
      dirs.add(dirname(path))
    },
    join,
    dirname,
    basename,
    now: () => new Date("2026-01-01T00:00:00Z"),
    randomId: () => "abc123",
    defaultHistoryPath: () => "/history/undo.json",
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
