/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createBitvInteractionSchema } from "./interaction.js"
import { BitvTui } from "./Tui.js"
test("BitV direct TUI renders the toolbar, source rail, analysis table, and bottom classification strip", async () => { const setup = await testRender(<BitvTui definition={{ schema: createBitvInteractionSchema({ paths: "C:/demo.mp4" }, "zh"), run: async () => ({ success: true, message: "fake", data: { videos: [], operations: [], errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true }); try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("BITV // VIDEO ANALYSIS LAB"); expect(frame).toContain("视频来源"); expect(frame).toContain("码率分析台"); expect(frame).toContain("分类参数闸门") } finally { await act(async () => setup.renderer.destroy()) } })
