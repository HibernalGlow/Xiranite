import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { DEFAULT_READER_INPUT_BINDINGS, DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"

import type { ReaderInputBindingsPatch, ReaderRadialMenuPatch } from "../../../adapters/reader-http-client"
import { RadialMenuSettingsEditor } from "./RadialMenuSettingsEditor"

test("[neoview.radial-menu.binding-editor] persists a new radial slot with its linked action binding", async () => {
  const save = vi.fn(async (radial: ReaderRadialMenuPatch["radialMenu"], _bindings: ReaderInputBindingsPatch["inputBindings"]) => radial.config ?? DEFAULT_READER_RADIAL_MENU_CONFIG)
  await render(
    <div style={{ width: 960 }}>
      <RadialMenuSettingsEditor value={DEFAULT_READER_RADIAL_MENU_CONFIG} inputBindings={DEFAULT_READER_INPUT_BINDINGS} onSave={save} />
    </div>,
  )

  await page.getByRole("button", { name: "添加一级槽位 0" }).click()
  await page.getByRole("button", { name: "保存" }).click()
  await expect.poll(() => save.mock.calls.length).toBe(1)
  const bindings = save.mock.calls[0]?.[1]?.bindings
  expect(bindings).toContainEqual(expect.objectContaining({
    action: "reader.next-page",
    input: { device: "radial", menuId: "default", itemId: expect.any(String) },
  }))
})
