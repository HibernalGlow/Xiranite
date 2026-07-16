/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import sharp from "sharp"

import { createZipFixture } from "../../test/fixture-builders/create-zip-fixture.js"
import { createNeoviewTuiDefinition } from "../interaction.js"
import { createReaderHeadlessController } from "../platform.js"
import { NeoviewTui } from "../Tui.js"

test("[neoview.tui.archive] renders a real CBZ page through the existing archive provider", async () => {
  const pageBytes = await sharp({
    create: { width: 8, height: 12, channels: 4, background: "#4f6fc4" },
  }).png().toBuffer()
  const fixture = await createZipFixture({
    name: "prototype.cbz",
    entries: [{ path: "pages/001.png", bytes: pageBytes, level: 6 }],
  })
  try {
    await expectRealSourceRenders(fixture.path, "001.png")
  } finally {
    await fixture.cleanup()
  }
})

async function expectRealSourceRenders(path: string, pageName: string): Promise<void> {
  const definition = createNeoviewTuiDefinition("zh")
  definition.schema.initialValues.path = path
  const screen = await testRender(
    <NeoviewTui
      definition={definition}
      language="zh"
      onExit={() => undefined}
      imageBackend="half-block"
      createController={() => createReaderHeadlessController({ progressStore: false })}
    />,
    { width: 132, height: 34, useMouse: true },
  )
  try {
    await act(async () => screen.renderOnce())
    const open = screen.renderer.root.findDescendantById("open")
    expect(open).toBeDefined()
    await act(async () => screen.mockMouse.click(open!.x + 1, open!.y + Math.max(0, Math.floor(open!.height / 2))))
    await act(async () => screen.flush())
    await act(async () => waitUntil(() => screen.captureCharFrame().includes(pageName), () => screen.captureCharFrame()))
    await act(async () => waitUntil(() => screen.captureCharFrame().includes("▀"), () => screen.captureCharFrame()))
    expect(screen.captureCharFrame()).toContain("1 / 1")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
}

async function waitUntil(predicate: () => boolean, describe: () => string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the TUI condition: ${describe()}`)
    await Bun.sleep(10)
  }
}
