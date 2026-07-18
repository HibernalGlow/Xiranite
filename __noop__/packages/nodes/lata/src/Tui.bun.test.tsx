/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createLataInteractionSchema } from "./interaction.js"
import { LataTui } from "./Tui.js"

test("Lata renders task session and plans once", async () => {
  let action: string | undefined
  const schema = createLataInteractionSchema({ taskfilePath: "D:/repo/Taskfile.yml", taskName: "deploy:staging" }, "zh")
  const screen = await testRender(<LataTui definition={{ schema, run: async (input) => {
    action = input.action
    return { success: true, message: "planned", data: { taskfilePath: "D:/repo/Taskfile.yml", tasks: [{ name: "deploy:staging", desc: "Deploy staging", prompt: null, cmds: ["scp bin/lata-core deploy@lata-stg:/opt/lata/"], cmdCount: 1, silent: false, vars: {}, deps: [], sources: [], generates: [] }], selectedTask: "deploy:staging", commandPlan: [{ taskName: "deploy:staging", command: "scp bin/lata-core deploy@lata-stg:/opt/lata/", index: 0 }], commandResults: [], exitCode: 0, errors: [] } }
  } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("LATA // TASKFILE SESSION")
    const button = screen.renderer.root.findDescendantById("lata-command-plan")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "plan")
    await screen.waitFor(() => screen.captureCharFrame().includes("scp bin/lata-core"))
    expect(screen.captureCharFrame()).toContain("deploy:staging")
  } finally { await act(async () => screen.renderer.destroy()) }
})
