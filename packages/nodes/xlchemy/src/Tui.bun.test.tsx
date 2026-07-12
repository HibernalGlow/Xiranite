/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createXlchemyInteractionSchema } from "./interaction.js"
import { XlchemyTui } from "./Tui.js"

test("Xlchemy renders the complete four-section workbench", async () => {
  const schema = createXlchemyInteractionSchema({ pathsText: "D:/images/a.png", format: "JPEG XL" }, "zh")
  const screen = await testRender(<XlchemyTui definition={{ schema, run: async () => ({ success: true, message: "planned", data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 168, height: 42, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    const frame = screen.captureCharFrame()
    expect(frame).toContain("XLCHEMY // IMAGE TRANSCODE")
    expect(frame).toContain("输入与转换")
    expect(frame).toContain("保存与文件")
    expect(frame).toContain("缩小与元数据")
    expect(frame).toContain("高级")
    expect(frame).toContain("最大压缩")
    expect(frame).toContain("DIAGNOSE")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
})
