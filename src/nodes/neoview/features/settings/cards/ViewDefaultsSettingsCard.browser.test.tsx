import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS } from "@xiranite/node-neoview/ui-core"

import { ViewDefaultsSettingsCard } from "./ViewDefaultsSettingsCard"

test("[neoview.settings.mouse-cursor] edits cursor auto-hide and timing through the view-defaults patch contract", async () => {
  const save = vi.fn(async () => undefined)
  await render(<ViewDefaultsSettingsCard viewDefaults={{
    fitMode: "fit",
    pageMode: "single",
    mouseCursor: DEFAULT_READER_MOUSE_CURSOR_SETTINGS,
  }} onChange={save} />)

  await page.getByRole("switch", { name: "自动隐藏鼠标光标" }).click()
  await expect.poll(() => save).toHaveBeenCalledWith({ mouseCursor: { autoHide: false } })

  const delay = page.getByRole("spinbutton", { name: "光标隐藏延迟" })
  await delay.fill("1.4")
  document.querySelector<HTMLInputElement>("[aria-label='光标隐藏延迟']")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
  await expect.poll(() => save).toHaveBeenLastCalledWith({ mouseCursor: { hideDelay: 1.4 } })
})
