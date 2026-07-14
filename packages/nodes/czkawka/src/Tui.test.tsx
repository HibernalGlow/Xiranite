/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "vitest"
import { act } from "react"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { CzkawkaTui } from "./Tui.js"

test("Czkawka TUI renders eleven scanners and responds to mouse", async () => {
  const schema = createCzkawkaInteractionSchema({ includedDirectoriesText: "D:/media" }, "zh")
  const screen = await testRender(<CzkawkaTui definition={{ schema, run: async () => ({ success: true, message: "done", data: { action: "scan", tool: "duplicate-files", groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 } }) }} language="zh" onExit={() => undefined} />, { width: 150, height: 42, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("CZKAWKA // FILE FORENSICS")
    expect(screen.captureCharFrame()).toContain("相似图片")
    expect(screen.captureCharFrame()).toContain("扫描")
    const tabs = screen.renderer.root.findDescendantById("czkawka-input-tabs")
    expect(tabs).toBeDefined()
    await act(async () => screen.mockMouse.click(tabs!.x + Math.max(1, Math.floor(tabs!.width / 2)), tabs!.y))
    expect(createCzkawkaInteractionSchema({ action: "move", selectedPathsText: "D:/a.bin", destinationDirectory: "E:/Review", copyMode: true }, "zh").toInput({ action: "move", tool: "duplicate-files", selectedPathsText: "D:/a.bin", destinationDirectory: "E:/Review", copyMode: true })).toMatchObject({ action: "move", copyMode: true, selectedPaths: ["D:/a.bin"] })
  } finally { await act(async () => screen.renderer.destroy()) }
})
