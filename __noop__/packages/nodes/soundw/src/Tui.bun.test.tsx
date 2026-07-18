/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import type { NodeRunResult } from "@xiranite/contract"
import type { SoundwData, SoundwInput } from "./core.js"
import { createSoundwInteractionSchema } from "./interaction.js"
import { SoundwTui } from "./Tui.js"

describe("SoundW direct OpenTUI screen", () => {
  test("uses mouse actions and renders animated command state without a real SoundSwitch process", async () => {
    let received: SoundwInput | undefined
    const definition = { schema: createSoundwInteractionSchema({}, "zh"), run: async (input: SoundwInput, onEvent: (event: { type: "log"; message: string }) => void): Promise<NodeRunResult<SoundwData>> => { received = input; onEvent({ type: "log", message: "Running SoundSwitch mute" }); return { success: true, message: "fake SoundSwitch completed", data: { installed: true, command: ["mute"], output: "microphone muted", profiles: [], muteState: "muted", errors: [] } } } }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => { setup = await testRender(<SoundwTui definition={definition} language="zh" onExit={() => undefined} />, { width: 132, height: 32, useMouse: true }) })
    const click = async (id: string) => { const target = setup.renderer.root.findDescendantById(id); expect(target).toBeDefined(); await act(async () => setup.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2)))); await act(async () => setup.flush()) }
    try {
      await act(async () => setup.renderOnce()); const first = setup.captureCharFrame(); expect(first).toContain("SOUNDW // RECORDING ROUTE"); expect(first).toContain("设备矩阵"); expect(first).toContain("预设卡片"); expect(first).toContain("CLI PATH OVERRIDE")
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 540)); await setup.flush() }); expect(setup.captureCharFrame()).not.toBe(first)
      await click("field-action-mute"); await setup.waitFor(() => received !== undefined); expect(received).toMatchObject({ action: "mute" }); expect(setup.captureCharFrame()).toContain("fake SoundSwitch completed")
      await click("tab-logs"); expect(setup.captureCharFrame()).toContain("Running SoundSwitch")
    } finally { await act(async () => setup.renderer.destroy()) }
  })
})
