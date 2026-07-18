/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createEncodebInteractionSchema } from "./interaction.js"
import { EncodebTui } from "./Tui.js"
test("EncodeB renders source paths, encoding strategy and repair mappings", async () => { const setup = await testRender(<EncodebTui definition={{ schema: createEncodebInteractionSchema({ paths: "D:/archive/record.dat" }, "zh"), run: async () => ({ success: true, message: "预览完成", data: { matches: [], processed: 0, mappings: [{ src: "D:/archive/µ¦▒.txt", dst: "D:/archive/中文.txt", type: "file", depth: 1 }] } }) }} language="zh" onExit={() => undefined}/>, { width: 142, height: 38, useMouse: true }); try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("ENCODEB // RECOVERY LAB"); expect(frame).toContain("输入路径"); expect(frame).toContain("编码策略"); expect(frame).toContain("修复映射") } finally { await act(async () => setup.renderer.destroy()) } })
