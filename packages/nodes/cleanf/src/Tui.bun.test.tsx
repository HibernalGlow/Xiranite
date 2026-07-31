/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createCleanfInteractionSchema } from "./interaction.js"
import { CleanfTui } from "./Tui.js"
import type { CleanfInput } from "./core.js"

test("CleanF direct TUI renders cleanup sources and launches undo", async () => {
  const received: CleanfInput[] = []
  const setup = await testRender(<CleanfTui definition={{ schema: createCleanfInteractionSchema({ pathsText: "C:/cleanup" }, "zh"), run: async (input) => { received.push(input); return { success: true, message: "完成", data: { totalRemoved: 0, removedDetails: {}, previewFiles: [], skipped: 0, restored: input.action === "undo" ? 1 : undefined } } } }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try {
    await act(async () => setup.renderOnce())
    const frame = setup.captureCharFrame()
    expect(frame).toContain("CLEANF // CLEANUP DECK")
    expect(frame).toContain("清理来源")
    expect(frame).toContain("清理预览")
    expect(frame).toContain("撤销上次清理")
    const undo = setup.renderer.root.findDescendantById("undo-cleanup")
    expect(undo).toBeDefined()
    await act(async () => setup.mockMouse.click(undo!.x + 2, undo!.y + 1))
    await setup.waitFor(() => received.length === 1)
    expect(received[0]).toMatchObject({ action: "undo" })
    const execute = setup.renderer.root.findDescendantById("execute-cleanup")
    expect(execute).toBeDefined()
    await act(async () => setup.mockMouse.click(execute!.x + 2, execute!.y + 1))
    await setup.waitFor(() => received.length === 2)
    expect(received[1]).toMatchObject({ action: "clean", paths: ["C:/cleanup"], preview: true })
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})
