/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createLinkuInteractionSchema } from "./interaction.js"
import { LinkuTui } from "./Tui.js"

test("LinkU renders topology and lists in one click", async () => {
  let action: string | undefined
  const schema = createLinkuInteractionSchema({}, "zh")
  const screen = await testRender(
    <LinkuTui
      definition={{
        schema,
        run: async (input) => {
          action = input.action
          return {
            success: true,
            message: "listed",
            data: {
              links: [{ link: "D:/links/config", target: "D:/config/system", type: "directory", createdAt: "2026-07-10T19:00:00Z" }],
              created: false,
              recoveredCount: 0,
              failedCount: 0,
            },
          }
        },
      }}
      language="zh"
      onExit={() => undefined}
    />,
    { width: 142, height: 40, useMouse: true },
  )
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("LINKU // ACTIVE TOPOLOGY")
    const button = screen.renderer.root.findDescendantById("linku-command-list")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "list")
    await screen.waitFor(() => screen.captureCharFrame().includes("活动关联 · 1"))
    expect(screen.captureCharFrame()).toContain("D:/config/system")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
})
