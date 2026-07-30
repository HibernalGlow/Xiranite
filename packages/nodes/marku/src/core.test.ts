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
  const diff = createUnifiedDiff("a\nkeep\nstable\n", "b\nkeep\nstable\n", "x.md")
  expect(diff).toContain("--- a/x.md")
  expect(diff).toContain("-a")
  expect(diff).toContain("+b")
  expect(diff).toContain(" keep")
  expect(diff).not.toContain("-keep")
  expect(diff).not.toContain("+keep")
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

const replaceStep = (id: string, from: string, to: string) => ({
  id,
  module: "content_replace",
  config: { patterns: [{ from, to }] },
})

test("workflow runs editor text through steps in order without touching paths", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "alpha\n" })
  const workflow = { id: "wf", name: "seq", steps: [replaceStep("s1", "alpha", "beta"), replaceStep("s2", "beta", "gamma")] }

  const result = await runMarku({ action: "workflow", workflow, inputText: "alpha\n", paths: ["/doc/a.md"] }, runtime)

  expect(result.success).toBe(true)
  expect(result.data?.outputText).toBe("gamma\n")
  expect(result.data?.workflow?.sources).toHaveLength(1)
  expect(result.data?.workflow?.sources[0]?.steps.map((step) => step.outputText)).toEqual(["beta\n", "gamma\n"])
  expect(runtime.files.get("/doc/a.md")).toBe("alpha\n")
})

test("workflow processes files independently and writes final outputs with undo", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "alpha\n", "/doc/b.md": "beta\n" })
  const workflow = { id: "wf", name: "pipeline", steps: [replaceStep("s1", "alpha", "beta"), replaceStep("s2", "beta", "gamma")] }

  const result = await runMarku({ action: "workflow", workflow, paths: ["/doc"], dryRun: false }, runtime)

  expect(result.success).toBe(true)
  expect(result.data?.filesProcessed).toBe(2)
  expect(result.data?.filesChanged).toBe(2)
  // Sources never feed one another: b.md starts from its own original text.
  expect(runtime.files.get("/doc/a.md")).toBe("gamma\n")
  expect(runtime.files.get("/doc/b.md")).toBe("gamma\n")
  expect(result.data?.undoId).toBeTruthy()

  const undo = await runMarku({ action: "undo" }, runtime)
  expect(undo.success).toBe(true)
  expect(runtime.files.get("/doc/a.md")).toBe("alpha\n")
  expect(runtime.files.get("/doc/b.md")).toBe("beta\n")
})

test("workflow dry-run returns diffs without writing or recording undo", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "alpha\n" })
  const workflow = { id: "wf", name: "dry", steps: [replaceStep("s1", "alpha", "beta")] }

  const result = await runMarku({ action: "workflow", workflow, paths: ["/doc/a.md"], dryRun: true }, runtime)

  expect(result.success).toBe(true)
  expect(result.data?.diffs[0]?.changed).toBe(true)
  expect(result.data?.undoId).toBe("")
  expect(runtime.files.get("/doc/a.md")).toBe("alpha\n")
  expect(runtime.files.has("/history/undo.json")).toBe(false)
})

test("workflow with an unknown module fails validation before any evaluation or write", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "alpha\n" })
  const workflow = { id: "wf", name: "guarded", steps: [replaceStep("s1", "alpha", "beta"), { id: "s2", module: "boom_module", config: {} }] }

  const result = await runMarku({ action: "workflow", workflow, paths: ["/doc"], dryRun: false }, runtime)

  expect(result.success).toBe(false)
  expect(result.message).toContain("unknown module: boom_module")
  expect(result.data?.workflow).toBeUndefined()
  expect(runtime.files.get("/doc/a.md")).toBe("alpha\n")
})

test("workflow step failure stops later sources and retains prior results without writing", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "ok\n", "/doc/b.md": "ok\n", "/doc/c.md": "ok\n" })
  const workflow = {
    id: "wf",
    name: "stop",
    steps: [{ id: "s1", module: "content_replace", config: { patterns: [{ from: "ok", to: "x", regex: true, flags: "@invalid" }] } }],
  }

  const result = await runMarku({ action: "workflow", workflow, paths: ["/doc"], dryRun: false }, runtime)

  expect(result.success).toBe(false)
  expect(result.message).toContain("Step 1 (content_replace) failed")
  // Evaluation stopped at the first failing source (a.md, sorted first); nothing was written.
  expect(result.data?.workflow?.sources).toHaveLength(1)
  expect(runtime.files.get("/doc/a.md")).toBe("ok\n")
  expect(runtime.files.get("/doc/c.md")).toBe("ok\n")
})

test("workflow write failure keeps the undo record and reports the exact path", async () => {
  const runtime = createMemoryRuntime({ "/doc/a.md": "alpha\n", "/doc/b.md": "alpha\n" })
  const originalWrite = runtime.writeText.bind(runtime)
  runtime.writeText = async (path: string, content: string) => {
    if (path === "/doc/b.md") throw new Error("disk full")
    await originalWrite(path, content)
  }
  const workflow = { id: "wf", name: "partial", steps: [replaceStep("s1", "alpha", "beta")] }

  const result = await runMarku({ action: "workflow", workflow, paths: ["/doc"], dryRun: false }, runtime)

  expect(result.success).toBe(false)
  expect(result.message).toBe("Write failed at /doc/b.md: disk full")
  expect(result.data?.undoId).toBeTruthy()

  runtime.writeText = originalWrite
  const undo = await runMarku({ action: "undo", undoId: result.data?.undoId }, runtime)
  expect(undo.success).toBe(true)
  expect(runtime.files.get("/doc/a.md")).toBe("alpha\n")
  expect(runtime.files.get("/doc/b.md")).toBe("alpha\n")
})

test("workflow rejects empty definitions and missing sources", async () => {
  const runtime = createMemoryRuntime({})
  const empty = await runMarku({ action: "workflow", workflow: { id: "wf", name: "empty", steps: [] } }, runtime)
  expect(empty.success).toBe(false)
  expect(empty.message).toContain("no steps")

  const missing = await runMarku({ action: "workflow" }, runtime)
  expect(missing.success).toBe(false)
  expect(missing.message).toContain("missing or malformed")

  const noSource = await runMarku({ action: "workflow", workflow: { id: "wf", name: "x", steps: [replaceStep("s1", "a", "b")] } }, runtime)
  expect(noSource.success).toBe(false)
  expect(noSource.message).toBe("No input paths or text provided.")
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
