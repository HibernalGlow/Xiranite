import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ViewDefaultsSettingsCard } from "./ViewDefaultsSettingsCard"

afterEach(cleanup)

describe("ViewDefaultsSettingsCard", () => {
  it("[neoview.settings.view-defaults-card] edits normalized fit and page mode defaults through one contract", async () => {
    const onChange = vi.fn(async () => undefined)
    const { rerender } = render(
      <ViewDefaultsSettingsCard viewDefaults={{ fitMode: "fit", pageMode: "single" }} onChange={onChange} />,
    )

    fireEvent.change(screen.getByRole("combobox", { name: "默认缩放模式" }), { target: { value: "fit-height" } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ fitMode: "fit-height" }))

    rerender(<ViewDefaultsSettingsCard viewDefaults={{ fitMode: "fit-height", pageMode: "single" }} onChange={onChange} />)
    const doublePage = screen.getByRole("button", { name: "双页" }) as HTMLButtonElement
    await waitFor(() => expect(doublePage.disabled).toBe(false))
    fireEvent.click(doublePage)
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ pageMode: "double" }))
  })
})
