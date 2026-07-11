/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"
import { act } from "react"

import type { RecycleuInput, RecycleuResult } from "./core.js"
import { createRecycleuInteractionSchema } from "./interaction.js"
import { RecycleuTui } from "./Tui.js"

describe("RecycleU direct OpenTUI screen", () => {
  test("uses mouse controls, editable numbers, and danger confirmation without real cleanup", async () => {
    let captured: RecycleuInput | undefined
    const definition = {
      schema: createRecycleuInteractionSchema({}, "zh"),
      run: async (input: RecycleuInput): Promise<RecycleuResult> => {
        captured = input
        return { success: true, message: "fake complete", data: { timerStatus: "completed", cleanCount: 1, lastCleanTime: "01:00:00", remainingSeconds: 0 } }
      },
    }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(<RecycleuTui definition={definition} language="zh" onExit={() => undefined} />, { width: 120, height: 34, useMouse: true })
    })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => setup.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2))))
      await act(async () => setup.flush())
    }
    try {
      await act(async () => setup.renderOnce())
      expect(setup.captureCharFrame()).toContain("清理控制")
      expect(setup.captureCharFrame()).toContain("循环监控")
      expect(setup.captureCharFrame()).toContain("运行日志")
      const firstMotionFrame = setup.captureCharFrame()
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 460)); await setup.flush() })
      expect(setup.captureCharFrame()).not.toBe(firstMotionFrame)
      expect(setup.captureCharFrame()).toContain("INTERVAL PREVIEW")
      await click("field-action-start")
      await click("field-interval-plus")
      await click("execute")
      expect(setup.captureCharFrame()).toContain("永久清空选定回收站")
      await click("confirm-dismiss")
      expect(captured).toBeUndefined()
      expect(setup.captureCharFrame()).not.toContain("永久清空选定回收站")
      await click("execute")
      await click("confirm-execute")
      await setup.waitFor(() => captured !== undefined)
      expect(captured).toMatchObject({ action: "start", interval: 11, maxCycles: 360 })
      expect(setup.captureCharFrame()).toContain("fake complete")
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })

  test("the mouse stop button cancels an active run", async () => {
    let resolveRun!: (result: RecycleuResult) => void
    let cancelled = false
    const definition = {
      schema: createRecycleuInteractionSchema({ action: "start", interval: 5, maxCycles: 0 }, "zh"),
      run: async () => await new Promise<RecycleuResult>((resolve) => { resolveRun = resolve }),
      cancel: () => {
        cancelled = true
        resolveRun({ success: true, message: "fake cancelled", data: { timerStatus: "cancelled", cleanCount: 0, lastCleanTime: null, remainingSeconds: 4 } })
      },
    }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => { setup = await testRender(<RecycleuTui definition={definition} language="zh" onExit={() => undefined} />, { width: 120, height: 34, useMouse: true }) })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => setup.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2))))
      await act(async () => setup.flush())
    }
    try {
      await act(async () => setup.renderOnce())
      await click("execute")
      await click("confirm-execute")
      await setup.waitFor(() => setup.captureCharFrame().includes("停止"))
      await click("execute")
      await setup.waitFor(() => cancelled)
      expect(setup.captureCharFrame()).toContain("fake cancelled")
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })
})
