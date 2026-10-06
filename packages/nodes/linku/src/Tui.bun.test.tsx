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
              restoredCount: 0,
              failedCount: 0,
              importedCount: 0,
              skippedCount: 0,
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
    expect(screen.captureCharFrame()).toContain("已还原")
    const button = screen.renderer.root.findDescendantById("linku-command-list")
    expect(button).toBeDefined()
    expect(screen.renderer.root.findDescendantById("linku-command-restore")).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => action === "list")
    await screen.waitFor(() => screen.captureCharFrame().includes("活动关联 · 1"))
    expect(screen.captureCharFrame()).toContain("D:/config/system")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
})

test("LinkU validates and confirms a restore request", () => {
  const schema = createLinkuInteractionSchema({}, "zh")
  const input = { action: "restore" as const, path: "C:/original-link", target: "", configPath: "" }

  expect(schema.validate(schema.initialValues, { ...input, path: "" })).toBe("请输入已记录的原链接路径。")
  expect(schema.isDangerous(input)).toBe(true)
  expect(schema.dangerPrompt(input).title).toBe("确认还原链接")
  expect(schema.result({
    success: true,
    message: "restored",
    data: {
      links: [],
      created: false,
      recoveredCount: 0,
      restoredCount: 1,
      failedCount: 0,
      importedCount: 0,
      skippedCount: 0,
    },
  }).lines).toContain("Restored: 1")
})
