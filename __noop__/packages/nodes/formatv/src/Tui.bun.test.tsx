/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createFormatvInteractionSchema } from "./interaction.js"
import { FormatvTui } from "./Tui.js"

test("FormatV direct TUI renders source and format plan", async () => {
  const setup = await testRender(<FormatvTui definition={{ schema: createFormatvInteractionSchema({ pathsText: "C:/videos" }, "zh"), run: async () => ({ success: true, message: "完成", data: { normalCount: 0, novCount: 0, prefixedCounts: {}, normalFiles: [], novFiles: [], prefixedFiles: {}, successCount: 0, errorCount: 0, skippedCount: 0, duplicateCount: 0, duplicates: [], prefixedLarger: [], operations: [], reportPath: "", errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("FORMATV // MEDIA FORMAT LAB"); expect(frame).toContain("视频来源"); expect(frame).toContain("格式检查"); expect(frame).toContain("执行检查") } finally { await act(async () => setup.renderer.destroy()) }
})
