/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import sharp from "sharp"

import { createZipFixture } from "../../test/fixture-builders/create-zip-fixture.js"
import { createRarFixture, resolveRarFixtureExecutable } from "../../test/fixture-builders/create-rar-fixture.js"
import type { OpenHeadlessReaderInput } from "../core.js"
import { createNeoviewTuiDefinition } from "../interaction.js"
import { createReaderHeadlessController } from "../platform.js"
import { NeoviewTui } from "../Tui.js"

const rarExecutable = await resolveRarFixtureExecutable()
const testEncryptedRar = rarExecutable ? test : test.skip

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

testEncryptedRar("[neoview.tui.encrypted-rar] renders a real header-encrypted solid CBR through the default controller", async () => {
  const pageBytes = await sharp({
    create: { width: 8, height: 12, channels: 4, background: "#a33c67" },
  }).png().toBuffer()
  const fixture = await createRarFixture({
    executablePath: rarExecutable!,
    password: "fixture-secret",
    solid: true,
    encryptHeaders: true,
    entries: [{ path: "pages/001.png", bytes: pageBytes }],
  })
  const password = new TextEncoder().encode("fixture-secret")
  try {
    await expectRealSourceRenders(fixture.path, "001.png", [{ rawPassword: password }], 15_000)
    expect(password).toEqual(new TextEncoder().encode("fixture-secret"))
  } finally {
    password.fill(0)
    await fixture.cleanup()
  }
}, 20_000)

async function expectRealSourceRenders(
  path: string,
  pageName: string,
  defaultArchivePasswords?: OpenHeadlessReaderInput["archivePasswords"],
  waitMs = 5_000,
): Promise<void> {
  const definition = createNeoviewTuiDefinition("zh")
  definition.schema.initialValues.path = path
  const controller = await createReaderHeadlessController({ progressStore: false })
  const open = controller.open.bind(controller)
  const openSettled = Promise.withResolvers<void>()
  controller.open = async (input) => {
    const result = await open(input)
    setTimeout(openSettled.resolve, 0)
    return result
  }
  const screen = await testRender(
    <NeoviewTui
      definition={definition}
      language="zh"
      onExit={() => undefined}
      imageBackend="half-block"
      createController={async () => controller}
      defaultArchivePasswords={defaultArchivePasswords}
    />,
    { width: 132, height: 34, useMouse: true },
  )
  try {
    await act(async () => screen.renderOnce())
    const open = screen.renderer.root.findDescendantById("open")
    expect(open).toBeDefined()
    await act(async () => screen.mockMouse.click(open!.x + 1, open!.y + Math.max(0, Math.floor(open!.height / 2))))
    await act(async () => {
      await openSettled.promise
      await screen.flush()
    })
    await act(async () => waitUntil(async () => {
      await screen.flush()
      return screen.captureCharFrame().includes(pageName)
    }, () => screen.captureCharFrame(), waitMs))
    await act(async () => waitUntil(async () => {
      await screen.flush()
      return screen.captureCharFrame().includes("▀")
    }, () => screen.captureCharFrame(), waitMs))
    expect(screen.captureCharFrame()).toContain("1 / 1")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, describe: () => string, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the TUI condition: ${describe()}`)
    await Bun.sleep(10)
  }
}
