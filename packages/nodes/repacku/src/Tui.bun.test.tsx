/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createRepackuInteractionSchema } from "./interaction.js"
import { RepackuTui } from "./Tui.js"

test("RepackU direct TUI renders path matrix and operation plan", async () => {
  const setup = await testRender(<RepackuTui definition={{ schema: createRepackuInteractionSchema({ pathsText: "C:/incoming" }, "zh"), run: async () => ({ success: true, message: "完成", data: { configPath: "", totalFolders: 0, entireCount: 0, selectiveCount: 0, skipCount: 0, plannedCount: 0, compressedCount: 0, failedCount: 0, skippedCount: 0, totalOperations: 0, galleryCount: 0, folderTree: null, operations: [], errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true })
  try {
    await act(async () => setup.renderOnce())
    const frame = setup.captureCharFrame()
    expect(frame).toContain("REPACKU // PACKING WORKBENCH")
    expect(frame).toContain("路径矩阵")
    expect(frame).toContain("重打包计划")
    expect(frame).toContain("开始重打包")
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})
