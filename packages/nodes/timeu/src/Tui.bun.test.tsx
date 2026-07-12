/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import type { TimeuInput, TimeuResult } from "./core.js"
import { createTimeuInteractionSchema } from "./interaction.js"
import { TimeuTui } from "./Tui.js"

test("TimeU direct OpenTUI renders action bar, path queue, ledger, and bottom safety strip", async () => {
  const definition = { schema: createTimeuInteractionSchema({ listText: "C:/demo.txt" }, "zh"), run: async (_input: TimeuInput): Promise<TimeuResult> => ({ success: true, message: "fake plan", data: { plan: [{ path: "C:/demo.txt", operation: "backup", status: "pending" }], records: [], recordPath: "C:/timeu.json", scannedCount: 1, backupCount: 0, restoredCount: 0, skippedCount: 0, errorCount: 0, errors: [] } }) }
  const setup = await testRender(<TimeuTui definition={definition} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("TIMEU // TIMESTAMP LEDGER"); expect(frame).toContain("路径队列"); expect(frame).toContain("时间记录总账"); expect(frame).toContain("执行时间戳任务") } finally { await act(async () => setup.renderer.destroy()) }
})
