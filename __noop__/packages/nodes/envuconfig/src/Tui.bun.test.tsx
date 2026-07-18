/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createEnvuConfigInteractionSchema } from "./interaction.js"
import { EnvuConfigTui } from "./Tui.js"
test("EnvUConfig renders ledger and scans once", async () => {
  let action: string | undefined
  const schema = createEnvuConfigInteractionSchema({ root: "D:/EnvU" }, "zh")
  const screen = await testRender(<EnvuConfigTui definition={{ schema, run: async (input) => {
    action = input.action
    return { success: true, message: "found", data: { files: [{ path: "D:/EnvU/config/system.yaml", relativePath: "config/system.yaml", group: "CONFIG", size: 18000, modifiedMs: 0 }], operations: [], manifestPath: "", fileCount: 1, totalSize: 18000, errors: [] } }
  } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("ENVU CONFIG // CONFIGURATION LEDGER")
    const button = screen.renderer.root.findDescendantById("envuconfig-command-scan")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "scan")
    await screen.waitFor(() => screen.captureCharFrame().includes("DETECTED OBJECTS · 1"))
    expect(screen.captureCharFrame()).toContain("config/system.yaml")
  } finally { await act(async () => screen.renderer.destroy()) }
})
