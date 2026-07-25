import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

import i18n from "@/i18n"
import { SettingsSearch } from "./SettingsSearch"

describe("SettingsSearch browser behavior", () => {
  test("finds a field by its option keyword and selects its setting anchor", async () => {
    await i18n.changeLanguage("en")
    const onSelect = vi.fn()
    const screen = await render(<SettingsSearch onSelect={onSelect} />)

    const input = screen.getByRole("combobox", { name: /Search settings/ })
    await input.fill("traffic light")

    const result = screen.getByRole("option", { name: /Style.*Operation bar/ })
    await expect.element(result).toBeVisible()
    await result.click()

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "field",
      fieldId: "operation-bar-style",
      sectionId: "workspace",
      stepId: "chrome",
    }))
  })
})
