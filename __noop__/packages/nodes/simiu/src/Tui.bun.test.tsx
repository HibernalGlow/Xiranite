/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createSimiuInteractionSchema } from "./interaction.js"
import { SimiuTui } from "./Tui.js"

test("SimiU renders cluster hub and plans once", async () => {
  let action: string | undefined
  const schema = createSimiuInteractionSchema({ rootsText: "D:/images" }, "zh")
  const screen = await testRender(<SimiuTui definition={{ schema, run: async (input) => {
    action = input.action
    return { success: true, message: "planned", data: { batches: [], groups: [{ parentDir: "D:/images/architecture", name: "simiu_set_001", files: ["IMG_A912.jpg", "IMG_A912_EDIT.png"] }], operations: [], imageCount: 2, groupCount: 1, movedCount: 0, skippedCount: 0, errorCount: 0, errors: [] } }
  } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("SIMIU // CLUSTER HUB")
    const button = screen.renderer.root.findDescendantById("simiu-command-plan")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "plan")
    await screen.waitFor(() => screen.captureCharFrame().includes("CLUSTER HUB · 1"))
    expect(screen.captureCharFrame()).toContain("IMG_A912_EDIT.png")
  } finally { await act(async () => screen.renderer.destroy()) }
})
