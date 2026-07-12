/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createBandiaInteractionSchema } from "./interaction.js"
import { BandiaTui } from "./Tui.js"
test("Bandia renders input queue, command chamber and mapping output", async () => { const setup = await testRender(<BandiaTui definition={{ schema: createBandiaInteractionSchema({ paths: "D:/in/book.zip" }, "zh"), run: async () => ({ success: true, message: "完成", data: { action: "extract", extractedCount: 1, compressedCount: 0, failedCount: 0, totalCount: 1, exportedCount: 0, pathMappings: [{ archivePath: "D:/in/book.zip", extractedPath: "D:/in/[extract] book" }], results: [{ kind: "extract", sourcePath: "D:/in/book.zip", outputPath: "D:/in/[extract] book", success: true, durationMs: 10 }] } }) }} language="zh" onExit={() => undefined}/>, { width: 142, height: 38, useMouse: true }); try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("BANDIA // ARCHIVE PIPELINE"); expect(frame).toContain("输入队列"); expect(frame).toContain("命令舱"); expect(frame).toContain("映射输出") } finally { await act(async () => setup.renderer.destroy()) } })
