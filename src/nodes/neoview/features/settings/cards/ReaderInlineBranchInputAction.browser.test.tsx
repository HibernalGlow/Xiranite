import { DEFAULT_READER_INPUT_BINDINGS, DEFAULT_READER_RADIAL_MENU_CONFIG, type ReaderInputBinding } from "@xiranite/node-neoview/ui-core"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderInputBindingsPatch, ReaderRadialMenuPatch } from "../../../adapters/reader-http-client"
import { InputBindingsEditor } from "./InputBindingsSettingsCard"
import { RadialMenuSettingsEditor } from "./RadialMenuSettingsEditor"

test("[neoview.folder.inline-branch-input-binding] exposes the inline-branch toggle to operation bindings", async () => {
  const save = vi.fn(async (patch: { bindings?: ReaderInputBinding[]; reset?: "defaults" }) => ({ bindings: patch.bindings ?? [] }))
  await render(<InputBindingsEditor value={DEFAULT_READER_INPUT_BINDINGS} onSave={save} />)

  await page.getByRole("textbox", { name: "搜索操作绑定" }).fill("分支文件夹就地展开")
  const action = page.getByRole("option", { name: "分支文件夹就地展开" })
  await expect.element(action).toBeVisible()
  await action.click()
  await page.getByRole("button", { name: "添加绑定" }).click()
  await page.getByRole("menuitem", { name: "鼠标", exact: true }).click()
  await expect.poll(() => save).toHaveBeenCalledOnce()
  expect(save.mock.calls[0]?.[0].bindings).toContainEqual(expect.objectContaining({ action: "folder.toggle-inline-branch-expansion" }))
})

test("[neoview.folder.inline-branch-radial] persists the inline-branch toggle as a radial action binding", async () => {
  const save = vi.fn(async (patch: ReaderRadialMenuPatch["radialMenu"], _bindings: ReaderInputBindingsPatch["inputBindings"]) => patch.config ?? DEFAULT_READER_RADIAL_MENU_CONFIG)
  await render(
    <div style={{ width: 960 }}>
      <RadialMenuSettingsEditor value={DEFAULT_READER_RADIAL_MENU_CONFIG} inputBindings={DEFAULT_READER_INPUT_BINDINGS} onSave={save} />
    </div>,
  )

  await page.getByRole("button", { name: "添加一级槽位 0" }).click()
  await page.getByRole("combobox", { name: "动作" }).selectOptions("folder.toggle-inline-branch-expansion")
  await page.getByRole("button", { name: "保存" }).click()
  await expect.poll(() => save).toHaveBeenCalledOnce()
  expect(save.mock.calls[0]?.[1]?.bindings).toContainEqual(expect.objectContaining({
    action: "folder.toggle-inline-branch-expansion",
    input: { device: "radial", menuId: "default", itemId: expect.any(String) },
  }))
})
