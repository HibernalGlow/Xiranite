import { describe, expect, test } from "vitest"
import type { LinkuRuntime } from "./core.js"
import { dumpLinkRecords, parseLinkRecords, runLinku, upsertLinkRecord } from "./core.js"

describe("linku core", () => {
  test("round-trips link records", () => {
    const records = [{ link: "C:/link", target: "D:/target", type: "directory", createdAt: "now" }]
    expect(parseLinkRecords(dumpLinkRecords(records))).toEqual(records)
  })

  test("upserts by link path", () => {
    const records = upsertLinkRecord(
      [{ link: "C:/link", target: "old", type: "file", createdAt: "1" }],
      { link: "c:/LINK", target: "new", type: "file", createdAt: "2" },
    )
    expect(records).toHaveLength(1)
    expect(records[0]?.target).toBe("new")
  })

  test("creates a link and records it", async () => {
    let config = ""
    const runtime: LinkuRuntime = {
      pathInfo: async (path) => ({ path, exists: path === "source", kind: path === "source" ? "dir" : "missing", isSymlink: false }),
      removeSymlink: async () => {},
      createSymlink: async () => {},
      movePath: async () => {},
      readConfig: async () => config,
      writeConfig: async (content) => { config = content },
    }

    const result = await runLinku({ action: "create", path: "source", target: "link" }, runtime)

    expect(result.success).toBe(true)
    expect(parseLinkRecords(config)[0]?.link).toBe("link")
  })

  test("imports only live legacy links by default", async () => {
    const live = { link: "C:/linked", target: "D:/target", type: "directory", createdAt: "live" }
    const missing = { link: "C:/missing", target: "D:/missing", type: "directory", createdAt: "missing" }
    let currentConfig = ""
    const runtime: LinkuRuntime = {
      pathInfo: async (path) => {
        if (path === live.link) {
          return { path, exists: true, kind: "other", isSymlink: true, linkTarget: "d:/TARGET", targetExists: true }
        }
        if (path === live.target) return { path, exists: true, kind: "dir", isSymlink: false }
        return { path, exists: false, kind: "missing", isSymlink: false }
      },
      removeSymlink: async () => {},
      createSymlink: async () => {},
      movePath: async () => {},
      readConfig: async (path) => path === "legacy.toml" ? dumpLinkRecords([live, missing]) : currentConfig,
      writeConfig: async (content) => { currentConfig = content },
    }

    const result = await runLinku({ action: "import", path: "legacy.toml" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.importedCount).toBe(1)
    expect(result.data?.skippedCount).toBe(1)
    expect(parseLinkRecords(currentConfig)).toEqual([live])
  })

  test("can retain invalid legacy links when explicitly requested", async () => {
    const missing = { link: "C:/missing", target: "D:/missing", type: "directory", createdAt: "missing" }
    let currentConfig = ""
    const runtime: LinkuRuntime = {
      pathInfo: async (path) => ({ path, exists: false, kind: "missing", isSymlink: false }),
      removeSymlink: async () => {},
      createSymlink: async () => {},
      movePath: async () => {},
      readConfig: async (path) => path === "legacy.toml" ? dumpLinkRecords([missing]) : currentConfig,
      writeConfig: async (content) => { currentConfig = content },
    }

    const result = await runLinku({ action: "import", path: "legacy.toml", includeInvalid: true }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.importedCount).toBe(1)
    expect(result.data?.skippedCount).toBe(0)
    expect(parseLinkRecords(currentConfig)).toEqual([missing])
  })

  test("restores a live record and removes it from configuration", async () => {
    const record = { link: "C:/original", target: "D:/relocated", type: "directory", createdAt: "now" }
    let config = dumpLinkRecords([record])
    const calls: string[] = []
    const runtime: LinkuRuntime = {
      pathInfo: async (path) => ({ path, exists: true, kind: "dir", isSymlink: path === record.link }),
      isLiveLinkRecord: async () => true,
      removeSymlink: async (path) => { calls.push(`remove:${path}`) },
      createSymlink: async () => {},
      movePath: async (source, target) => { calls.push(`move:${source}:${target}`) },
      readConfig: async () => config,
      writeConfig: async (content) => { config = content },
    }

    const result = await runLinku({ action: "restore", path: record.link }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.restoredCount).toBe(1)
    expect(result.data?.links).toEqual([])
    expect(calls).toEqual([`remove:${record.link}`, `move:${record.target}:${record.link}`])
    expect(parseLinkRecords(config)).toEqual([])
  })

  test("does not alter an invalid recorded link during restore", async () => {
    const record = { link: "C:/original", target: "D:/relocated", type: "directory", createdAt: "now" }
    const config = dumpLinkRecords([record])
    const runtime: LinkuRuntime = {
      pathInfo: async (path) => ({ path, exists: false, kind: "missing", isSymlink: false }),
      isLiveLinkRecord: async () => false,
      removeSymlink: async () => { throw new Error("must not remove") },
      createSymlink: async () => {},
      movePath: async () => {},
      readConfig: async () => config,
      writeConfig: async () => { throw new Error("must not write") },
    }

    const result = await runLinku({ action: "restore", path: record.link }, runtime)

    expect(result.success).toBe(false)
    expect(result.message).toContain("not valid")
  })
})
