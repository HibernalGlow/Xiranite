/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createLinedupInteractionSchema, runLinedupInteraction } from "./interaction.js"
import { LinedupTui } from "./Tui.js"

test("LinedUp filters with one direct button", async () => {
  let runs = 0
  const schema = createLinedupInteractionSchema({ sourceText: "INFO started\nDEBUG loading\nERROR failed", filterText: "DEBUG" }, "zh")
  const screen = await testRender(<LinedupTui definition={{ schema, run: async (input) => { runs += 1; return runLinedupInteraction(input) } }} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("LINEDUP // TEXT FILTER")
    expect(screen.renderer.root.findDescendantById("field-action")).toBeUndefined()
    const button = screen.renderer.root.findDescendantById("run-filter")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await screen.waitFor(() => runs === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("× DEBUG loading"))
    expect(screen.captureCharFrame()).toContain("✓ INFO started")
  } finally { await act(async () => screen.renderer.destroy()) }
})
