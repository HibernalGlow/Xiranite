/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import type { TerminalTaskQueueController } from "@xiranite/cli-runtime/terminal"
import { createClipmInteractionSchema } from "./interaction.js"
import { ClipmTui } from "./Tui.js"

test("ClipM TUI renders the native action workbench and task entry", async () => {
  const setup = await testRender(
    <ClipmTui
      definition={{ schema: createClipmInteractionSchema({ path: "D:/Comics" }, "en"), run: async () => ({ success: true, message: "Ready" }) }}
      language="en"
      taskQueue={emptyTaskQueue()}
      onExit={() => undefined}
    />,
    { width: 128, height: 36, useMouse: true },
  )
  try {
    await act(async () => setup.renderOnce())
    const frame = setup.captureCharFrame()
    expect(frame).toContain("CLIPM // PREFERENCE CONTROL PLANE")
    expect(frame).toContain("Parameters")
    expect(frame).toContain("TASKS F6")
    expect(frame).toContain("CONFIRM")
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})

function emptyTaskQueue(): TerminalTaskQueueController {
  return {
    available: true,
    list: async () => [],
    pause: async () => undefined,
    resume: async () => undefined,
    cancel: async () => undefined,
    run: async () => ({ success: true, message: "Ready" }),
  }
}
