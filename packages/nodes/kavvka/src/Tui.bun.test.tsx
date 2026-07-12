/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createKavvkaInteractionSchema } from "./interaction.js"
import { KavvkaTui } from "./Tui.js"

test("Kavvka renders scan, path plan and execution record workbench", async () => {
  const setup = await testRender(<KavvkaTui definition={{ schema: createKavvkaInteractionSchema({ scanRoots: "D:/library" }, "zh"), run: async () => ({ success: true, message: "完成", data: { allCombinedPaths: ["D:/library/gallery;D:/library/#compare"], matchedPaths: ["D:/library/gallery"], processResults: [], scanResults: [{ path: "D:/library/gallery", name: "gallery", root: "D:/library" }], processedCount: 0, movedCount: 0, skippedCount: 0, errorCount: 0, errors: [] } }) }} language="zh" onExit={() => undefined}/>, { width: 142, height: 38, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("KAVVKA // PATH LAB"); expect(frame).toContain("扫描范围"); expect(frame).toContain("候选目录"); expect(frame).toContain("执行记录") } finally { await act(async () => setup.renderer.destroy()) }
})
