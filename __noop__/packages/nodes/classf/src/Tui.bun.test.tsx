/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createClassfInteractionSchema } from "./interaction.js"
import { ClassfTui } from "./Tui.js"

test("ClassF direct TUI renders source list and classification plan", async () => {
  const setup = await testRender(<ClassfTui definition={{ schema: createClassfInteractionSchema({ pathsText: "C:/reviewed" }, "zh"), run: async () => ({ success: true, message: "完成", data: { action: "plan", transferMode: "move", classifyMode: "auto", items: [], selectedCount: 0, readyCount: 0, movedCount: 0, copiedCount: 0, waitCount: 0, conflictCount: 0, errorCount: 0, errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("CLASSF // TRANSFER CONTROL"); expect(frame).toContain("来源列表"); expect(frame).toContain("分类计划"); expect(frame).toContain("执行分类") } finally { await act(async () => setup.renderer.destroy()) }
})
