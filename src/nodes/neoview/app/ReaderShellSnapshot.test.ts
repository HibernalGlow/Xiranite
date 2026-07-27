import { describe, expect, it } from "vitest"

import { DEFAULT_NEOVIEW_SHELL_CONFIG } from "@xiranite/node-neoview/ui-core"

import {
  createInitialReaderShellConfig,
  normalizeReaderShellSnapshot,
  readerShellSnapshotsEqual,
} from "./ReaderShellSnapshot"

describe("ReaderShellSnapshot", () => {
  it("restores a valid cached layout without sharing mutable objects", () => {
    const cached = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)
    cached.workspace.mode = "edges"
    cached.sidebars.left.width = 417

    const restored = createInitialReaderShellConfig(cached)

    expect(restored.workspace?.mode).toBe("edges")
    expect(restored.sidebars.left.width).toBe(417)
    expect(restored).not.toBe(cached)
    expect(readerShellSnapshotsEqual(restored, cached)).toBe(true)
  })

  it("rejects incomplete cached layouts and keeps the usable swimlane fallback", () => {
    expect(normalizeReaderShellSnapshot({ workspace: { mode: "edges" } })).toBeUndefined()
    expect(createInitialReaderShellConfig({ workspace: { mode: "edges" } }).workspace?.mode).toBe("swimlane")
  })
})
