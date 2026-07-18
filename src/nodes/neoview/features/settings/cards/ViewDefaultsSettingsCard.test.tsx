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

  it("shows persistence failures and allows the next edit to retry", async () => {
    const onChange = vi.fn()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(undefined)
    render(
      <ViewDefaultsSettingsCard viewDefaults={{ fitMode: "fit", pageMode: "single" }} onChange={onChange} />,
    )

    const fitMode = screen.getByRole("combobox") as HTMLSelectElement
    fireEvent.change(fitMode, { target: { value: "fit-height" } })

    expect((await screen.findByRole("alert")).textContent).toContain("write failed")
    await waitFor(() => expect(fitMode.disabled).toBe(false))

    fireEvent.change(fitMode, { target: { value: "original" } })

    await waitFor(() => expect(onChange).toHaveBeenNthCalledWith(2, { fitMode: "original" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
