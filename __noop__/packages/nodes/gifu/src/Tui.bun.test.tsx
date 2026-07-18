/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createGifuInteractionSchema } from "./interaction.js"
import { GifuTui } from "./Tui.js"
test("Gifu direct TUI renders sequence input, preview and compile deck", async () => { const setup = await testRender(<GifuTui definition={{ schema: createGifuInteractionSchema({ pathsText: "C:/a.zip" }, "zh"), run: async () => ({ success: true, message: "fake", data: { archives: [], errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true }); try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("GIFU // SEQUENCE LAB"); expect(frame).toContain("输入源"); expect(frame).toContain("序列预览"); expect(frame).toContain("开始动画编译") } finally { await act(async () => setup.renderer.destroy()) } })
