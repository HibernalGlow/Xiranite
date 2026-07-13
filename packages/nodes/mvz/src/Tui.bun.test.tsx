/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createMvzInteractionSchema } from "./interaction.js"
import { MvzTui } from "./Tui.js"

test("MVZ renders archive explorer and previews once", async () => {
  let action: string | undefined
  const schema = createMvzInteractionSchema({ fileText: "D:/archive/data.tar.gz//config/system.toml" }, "zh")
  const screen = await testRender(<MvzTui definition={{ schema, run: async (input) => {
    action = input.action
    return { success: true, message: "preview", data: { action: input.action ?? "extract", totalFiles: 1, totalArchives: 1, successCount: 1, failedCount: 0, results: [], preview: [{ archive: "D:/archive/data.tar.gz", action: "extract", files: ["config/system.toml"], count: 1, output: "D:/extraction", command: "7z x archive" }] } }
  } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("MVZ // ARCHIVE EXPLORER")
    const button = screen.renderer.root.findDescendantById("mvz-command-extract")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "extract")
    await screen.waitFor(() => screen.captureCharFrame().includes("COMMIT PREVIEW · 1"))
    expect(screen.captureCharFrame()).toContain("D:/extraction")
  } finally { await act(async () => screen.renderer.destroy()) }
})
