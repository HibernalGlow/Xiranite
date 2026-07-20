/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"

import { DevTui, createStaticDevSnapshot } from "./dev-tui-app"
import type { DevTuiController, DevTuiSnapshot } from "./dev-tui-controller"

test("renders and routes development lifecycle actions", async () => {
  const actions: string[] = []
  let snapshot = createStaticDevSnapshot()
  const listeners = new Set<() => void>()
  const update = (patch: Partial<DevTuiSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const controller: DevTuiController = {
    snapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    start: async () => { actions.push("start"); update({ phase: "running", pid: 42, startedAt: Date.now(), message: "running" }) },
    stop: async () => { actions.push("stop"); update({ phase: "stopped", pid: undefined, message: "stopped" }) },
    restart: async () => { actions.push("restart") },
    clearOutput: () => { actions.push("clear") },
    resize: () => undefined,
    scroll: () => undefined,
  }
  let exited = 0
  const setup = await testRender(<DevTui controller={controller} onExit={() => { exited += 1 }} />, { width: 80, height: 24, useMouse: true })
  const click = async (id: string) => {
    const target = setup.renderer.root.findDescendantById(id)!
    await act(async () => setup.mockMouse.click(target.x + 1, target.y + Math.max(0, Math.floor((target.height - 1) / 2))))
    await act(async () => setup.flush())
  }
  try {
    await act(async () => setup.renderOnce())
    expect(setup.captureCharFrame()).toContain("XIRANITE // DEV CONTROL")
    expect(setup.captureCharFrame()).toContain("PTY OUTPUT")
    await click("dev-start")
    await click("dev-restart")
    await click("dev-clear")
    await click("dev-stop")
    await click("dev-exit")
    expect(setup.captureCharFrame()).toContain("Exit stops the managed session")
    await click("dev-exit-confirm")
    expect(actions).toEqual(["start", "restart", "clear", "stop"])
    expect(exited).toBe(1)
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})
