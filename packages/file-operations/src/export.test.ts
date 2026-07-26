import { describe, expect, it } from "vitest"

import { exportFileDeletions } from "./export.js"
import type { FileDeletionRecord } from "./types.js"

const exportedAt = Date.UTC(2026, 6, 26, 1, 2, 3)
const record: FileDeletionRecord = {
  id: "delete-1",
  transactionId: "transaction-1",
  transactionIndex: 0,
  nodeId: "neoview",
  componentId: "component-1",
  workspaceId: "workspace-1",
  sourcePath: "D:\\Books\\A, B | C.cbz",
  deletionKind: "trash",
  pathKind: "file",
  size: 42,
  deletedAt: Date.UTC(2026, 6, 25, 1, 2, 3),
  state: "trashed",
  restoreAvailable: true,
  receipt: {
    original: { kind: "trash", sourcePath: "D:\\Books\\A, B | C.cbz" },
    inverse: { kind: "trash", sourcePath: "D:\\Books\\A, B | C.cbz" },
    guard: { path: "D:\\Books\\A, B | C.cbz", kind: "file", size: 42, mtimeMs: 1, ctimeMs: 2, device: 3, inode: 4 },
    providerData: {
      kind: "trash-rs",
      item: { id: "$R-test", name: "A, B | C.cbz", originalParent: "D:\\Books", timeDeleted: 123 },
    },
  },
}

describe("exportFileDeletions", () => {
  it("writes one self-describing JSON object per line", () => {
    const result = exportFileDeletions([record], "jsonl", exportedAt)
    expect(result).toMatchObject({ contentType: "application/x-ndjson; charset=utf-8", extension: "jsonl", recordCount: 1 })
    expect(JSON.parse(result.content.trim())).toMatchObject({
      schemaVersion: 1,
      exportedAt,
      id: "delete-1",
      nodeId: "neoview",
      sourcePath: record.sourcePath,
    })
  })

  it("uses a CSV serializer for commas, quotes and full paths", () => {
    const result = exportFileDeletions([record], "csv", exportedAt)
    expect(result.content.charCodeAt(0)).toBe(0xfeff)
    expect(result.content).toContain('"D:\\Books\\A, B | C.cbz"')
    expect(result.content).toContain("deletedAtIso")
    expect(result.content).toContain("$R-test")
  })

  it("produces a readable Markdown summary grouped by node", () => {
    const result = exportFileDeletions([record], "markdown", exportedAt)
    expect(result).toMatchObject({ contentType: "text/markdown; charset=utf-8", extension: "md", recordCount: 1 })
    expect(result.content).toContain("# Xiranite File Deletion History")
    expect(result.content).toContain("- neoview: 1")
    expect(result.content).toContain("D:\\Books\\A, B \\| C.cbz")
  })
})
