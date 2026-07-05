import { describe, expect, test } from "bun:test"
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
      createSymlink: async () => {},
      movePath: async () => {},
      readConfig: async () => config,
      writeConfig: async (content) => { config = content },
    }

    const result = await runLinku({ action: "create", path: "source", target: "link" }, runtime)

    expect(result.success).toBe(true)
    expect(parseLinkRecords(config)[0]?.link).toBe("link")
  })
})
