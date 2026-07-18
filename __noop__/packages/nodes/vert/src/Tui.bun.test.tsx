/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createVertInteractionSchema } from "./interaction.js"
import { VertTui } from "./Tui.js"
test("VERT renders conversion, engines, and output panels", async () => { const view = await testRender(<VertTui definition={{ schema: createVertInteractionSchema({ paths: "D:/media/demo.png", targetFormat: "webp" }, "zh"), run: async () => ({ success: true, message: "计划", data: { capabilities: { wasm: true }, commands: [], commandResults: [], selectedPaths: [], outputPaths: [], errors: [], wasmFallbackRequired: false } }) }} language="zh" onExit={() => undefined} />, { width: 150, height: 38, useMouse: true }); try { await act(async () => view.renderOnce()); const frame = view.captureCharFrame(); expect(frame).toContain("VERT // UNIVERSAL CONVERTER"); expect(frame).toContain("转换队列"); expect(frame).toContain("本机引擎"); expect(frame).toContain("输出与日志") } finally { await act(async () => view.renderer.destroy()) } })
