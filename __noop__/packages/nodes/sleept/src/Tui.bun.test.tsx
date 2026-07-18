/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"
import { act } from "react"

import type { SleeptInput, SleeptResult } from "./core.js"
import { createSleeptInteractionSchema } from "./interaction.js"
import { SleeptTui } from "./Tui.js"

describe("Sleept direct OpenTUI screen", () => {
  test("uses mouse mode, a live confirmation and animated timer console through a fake executor", async () => {
    let received: SleeptInput | undefined
    const definition = {
      schema: createSleeptInteractionSchema({ dryrun: false }, "zh"),
      run: async (input: SleeptInput): Promise<SleeptResult> => {
        received = input
        return { success: true, message: "fake timer complete", data: { timerStatus: "completed", remainingSeconds: 0, currentCpu: 8.2, currentUpload: 1.2, currentDownload: 3.4 } }
      },
    }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => { setup = await testRender(<SleeptTui definition={definition} language="zh" onExit={() => undefined} />, { width: 132, height: 34, useMouse: true }) })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => setup.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2))))
      await act(async () => setup.flush())
    }
    try {
      await act(async () => setup.renderOnce())
      const initial = setup.captureCharFrame()
      expect(initial).toContain("SLEEPT // SYSTEM TIMER")
      expect(initial).toContain("触发序列")
      expect(initial).toContain("系统待命")
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)); await setup.flush() })
      expect(setup.captureCharFrame()).not.toBe(initial)
      await click("execute")
      expect(setup.captureCharFrame()).toContain("确认真实电源操作")
      await click("confirm-dismiss")
      expect(setup.captureCharFrame()).not.toContain("确认真实电源操作")
      await click("field-action-get_stats")
      await click("execute")
      await setup.waitFor(() => received !== undefined)
      expect(received).toMatchObject({ action: "get_stats" })
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })
})
