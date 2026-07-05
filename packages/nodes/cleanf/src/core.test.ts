import { describe, expect, test } from "bun:test"
import type { CleanfItem } from "./core.js"
import { parseExcludeKeywords, planCleanf, runCleanf } from "./core.js"

const items: CleanfItem[] = [
  { path: "root/keep.txt", name: "keep.txt", type: "file", parentPath: "root", depth: 1 },
  { path: "root/a.bak", name: "a.bak", type: "file", parentPath: "root", depth: 1 },
  { path: "root/temp_cache", name: "temp_cache", type: "dir", parentPath: "root", depth: 1 },
  { path: "root/empty", name: "empty", type: "dir", parentPath: "root", depth: 1 },
  { path: "root/nested", name: "nested", type: "dir", parentPath: "root", depth: 1 },
  { path: "root/nested/child", name: "child", type: "dir", parentPath: "root/nested", depth: 2 },
]

describe("cleanf core", () => {
  test("parses exclude keywords", () => {
    expect(parseExcludeKeywords("node_modules, .git,,temp")).toEqual(["node_modules", ".git", "temp"])
  })

  test("plans pattern and empty-folder cleanup", () => {
    const plan = planCleanf(items, { presets: ["empty_folders", "backup_files", "temp_folders"] })

    expect(plan.targets.map((target) => target.path)).toContain("root/a.bak")
    expect(plan.targets.map((target) => target.path)).toContain("root/temp_cache")
    expect(plan.targets.map((target) => target.path)).toContain("root/empty")
    expect(plan.targets.map((target) => target.path)).toContain("root/nested/child")
    expect(plan.targets.map((target) => target.path)).toContain("root/nested")
  })

  test("runs preview without removing", async () => {
    const result = await runCleanf(
      { paths: ["root"], presets: ["backup_files"], preview: true },
      {
        scanPath: async () => items,
        removeTargets: async () => ({ removed: 0, skipped: 0 }),
      },
    )

    expect(result.success).toBe(true)
    expect(result.data?.previewFiles).toEqual(["root/a.bak"])
  })
})
