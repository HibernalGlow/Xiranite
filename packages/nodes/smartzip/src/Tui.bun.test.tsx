/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createSmartZipInteractionSchema } from "./interaction.js"
import { SmartZipTui } from "./Tui.js"
test("SmartZip direct TUI renders queue, operation chamber and execution drawer", async () => { const setup = await testRender(<SmartZipTui definition={{ schema: createSmartZipInteractionSchema({}, "zh"), run: async () => ({ success: true, message: "fake", data: { config: { sevenZipDir: "", passwords: [], archiveExtensions: [], contextMenu: true, sendTo: true }, selectedPaths: [], archiveCount: 0, errors: [] } }) }} language="zh" onExit={() => undefined} />, { width: 128, height: 32, useMouse: true }); try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("SMARTZIP // OPERATION CHAMBER"); expect(frame).toContain("路径队列"); expect(frame).toContain("Operation chamber"); expect(frame).toContain("运行 SmartZip") } finally { await act(async () => setup.renderer.destroy()) } })
