/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createSynctInteractionSchema } from "./interaction.js"
import { SynctTui } from "./Tui.js"

test("Synct renders chronological flow and plans in one click", async () => {
  let action: string | undefined
  const schema = createSynctInteractionSchema({ pathsText: "D:/incoming/telemetry_log_001.dat" }, "zh")
  const screen = await testRender(<SynctTui definition={{ schema, run: async (input) => { action = input.action; return { success: true, message: "planned", data: { action: input.action ?? "plan", sourceMode: input.sourceMode ?? "files", formatKey: input.formatKey ?? "year_month", items: [{ sourcePath: "D:/incoming/telemetry_log_001.dat", targetPath: "D:/incoming/2023-11/telemetry_log_001.dat", sourceName: "telemetry_log_001.dat", targetRelative: "2023-11/telemetry_log_001.dat", kind: "file", timestamp: "2023-11-15T00:00:00.000Z", status: "ready" }], scannedCount: 1, readyCount: 1, movedCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [] } } } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("SYNCT // CHRONOLOGICAL FLOW")
    expect(screen.captureCharFrame()).toContain("来源队列")
    expect(screen.captureCharFrame()).toContain("归档路径规划")
    const plan = screen.renderer.root.findDescendantById("synct-command-plan")
    expect(plan).toBeDefined()
    await act(async () => screen.mockMouse.click(plan!.x + 2, plan!.y + Math.max(0, Math.floor((plan!.height - 1) / 2))))
    await screen.waitFor(() => action === "plan")
    await screen.waitFor(() => screen.captureCharFrame().includes("归档路径规划 · 1"))
    expect(screen.captureCharFrame()).toContain("2023-11/telemetry_log_001.dat")
  } finally { await act(async () => screen.renderer.destroy()) }
})
