import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { InputBindingsEditor } from "./InputBindingsSettingsCard"

test("[neoview.bindings.repeat-policy-editor] exposes a default-off repeat switch for every binding device", async () => {
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [{
          id: "mouse-binding",
          action: "reader.next-page",
          context: "reader",
          enabled: true,
          input: { device: "mouse", button: 3, action: "click" },
        }] }}
        onSave={vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))}
      />
    </div>,
  )

  const repeatSwitch = page.getByRole("switch", { name: "忽略重复输入" })
  await expect.element(repeatSwitch).toHaveAttribute("data-state", "unchecked")
  await repeatSwitch.click()
  await expect.element(repeatSwitch).toHaveAttribute("data-state", "checked")
})
