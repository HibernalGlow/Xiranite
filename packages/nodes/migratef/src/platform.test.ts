import { afterEach, describe, expect, test } from "vitest"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { runMigratef } from "./core.js"
import { createNodeMigratefRuntime } from "./platform.js"

const RUN_ROOT = resolve("artifacts/test-runs/migratef-relative-target")
const cases = new Set<string>()

afterEach(async () => {
  for (const path of cases) await rm(path, { recursive: true, force: true })
  cases.clear()
})

describe("migratef platform relative merge", () => {
  test("creates a parent-relative target, merges an existing directory, and undoes without removing original target files", async () => {
    const root = join(RUN_ROOT, randomUUID())
    const source = join(root, "incoming", "library", "series")
    const target = join(root, "archive", "series")
    const historyPath = join(root, "migratef.undo.json")
    cases.add(root)
    await mkdir(join(source, "nested"), { recursive: true })
    await mkdir(join(target, "nested"), { recursive: true })
    await writeFile(join(source, "new.txt"), "new", "utf8")
    await writeFile(join(source, "nested", "page.txt"), "page", "utf8")
    await writeFile(join(target, "existing.txt"), "existing", "utf8")
    await writeFile(join(target, "nested", "existing-nested.txt"), "nested-existing", "utf8")

    const runtime = createNodeMigratefRuntime()
    const moved = await runMigratef({
      action: "move",
      mode: "direct",
      sourcePaths: [source],
      targetPath: "../../archive",
      relativeTargetBase: "source-parent",
      mergeExistingDirectories: true,
      historyPath,
    }, runtime)

    expect(moved).toMatchObject({ success: true, data: { migratedCount: 2, skippedCount: 0, errorCount: 0 } })
    await expect(access(source)).rejects.toThrow()
    await expect(readFile(join(target, "existing.txt"), "utf8")).resolves.toBe("existing")
    await expect(readFile(join(target, "nested", "existing-nested.txt"), "utf8")).resolves.toBe("nested-existing")
    await expect(readFile(join(target, "new.txt"), "utf8")).resolves.toBe("new")
    await expect(readFile(join(target, "nested", "page.txt"), "utf8")).resolves.toBe("page")

    const undone = await runMigratef({ action: "undo", historyPath }, runtime)

    expect(undone.success).toBe(true)
    await expect(readFile(join(source, "new.txt"), "utf8")).resolves.toBe("new")
    await expect(readFile(join(source, "nested", "page.txt"), "utf8")).resolves.toBe("page")
    await expect(readFile(join(target, "existing.txt"), "utf8")).resolves.toBe("existing")
    await expect(readFile(join(target, "nested", "existing-nested.txt"), "utf8")).resolves.toBe("nested-existing")
    await expect(access(join(target, "new.txt"))).rejects.toThrow()
    await expect(access(join(target, "nested", "page.txt"))).rejects.toThrow()
  })
})
