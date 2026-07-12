/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createCleanfInteractionSchema } from "./interaction.js"
import { CleanfTui } from "./Tui.js"

test("CleanF direct TUI renders cleanup sources and preview", async () => {
  const setup = await testRender(<CleanfTui definition={{ schema: createCleanfInteractionSchema({ pathsText: "C:/cleanup" }, "zh"), run: async () => ({ success: true, message: "完成", data: { totalRemoved: 0, removedDetails: {}, previewFiles: [], skipped: 0 } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("CLEANF // CLEANUP DECK"); expect(frame).toContain("清理来源"); expect(frame).toContain("清理预览"); expect(frame).toContain("预览清理") } finally { await act(async () => setup.renderer.destroy()) }
})
