/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createSameaInteractionSchema } from "./interaction.js"
import { SameaTui } from "./Tui.js"

test("SameA plans from one direct command click and renders archive rows", async () => {
  let action: string | undefined
  const schema = createSameaInteractionSchema({ pathsText: "D:/archives" }, "zh")
  const screen = await testRender(<SameaTui definition={{ schema, run: async (input) => { action = input.action; return { success: true, message: "planned", data: { action: "plan", centralize: false, minOccurrences: 1, items: [{ rootPath: "D:/archives", sourcePath: "D:/archives/[Alice] set.zip", targetPath: "D:/archives/Alice/[Alice] set.zip", sourceName: "[Alice] set.zip", artistKey: "alice", artistName: "Alice", status: "ready" }], groups: [{ key: "alice", name: "Alice", targetDir: "D:/archives/Alice", count: 1, status: "ready" }], scannedCount: 1, detectedCount: 1, readyCount: 1, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [] } } } }} language="zh" onExit={() => undefined} />, { width: 150, height: 42, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("SAMEA // EXTRACTOR PROTOCOL")
    const button = screen.renderer.root.findDescendantById("samea-command-plan")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "plan")
    await screen.waitFor(() => screen.captureCharFrame().includes("[Alice] set.zip"))
    expect(screen.captureCharFrame()).toContain("Alice")
  } finally { await act(async () => screen.renderer.destroy()) }
})
