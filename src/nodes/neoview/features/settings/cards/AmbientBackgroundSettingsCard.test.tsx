import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AmbientBackgroundSettingsCard } from "./AmbientBackgroundSettingsCard"

afterEach(cleanup)

const background = {
  color: "#000000",
  mode: "solid" as const,
  ambient: { style: "vibrant" as const, speed: 8, blur: 80, opacity: 0.8 },
  aurora: { showRadialGradient: true },
  spotlight: { color: "white" },
}

describe("AmbientBackgroundSettingsCard", () => {
  it("[neoview.ambient-background.gui] exposes the legacy mode controls and conditional settings", async () => {
    const onChange = vi.fn(async () => undefined)
    render(<AmbientBackgroundSettingsCard background={background} onChange={onChange} />)

    expect(screen.getByRole("heading", { name: "动态背景" })).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "启用动态背景" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /流光溢彩/ })).toBeTruthy()
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("data-background-mode"))).toHaveLength(5)

    fireEvent.click(screen.getByRole("button", { name: /流光溢彩/ }))
    expect(await screen.findByText("流光溢彩设置")).toBeTruthy()
    expect(screen.getByRole("slider", { name: "动画速度" })).toBeTruthy()
    fireEvent.change(screen.getByRole("slider", { name: "动画速度" }), { target: { value: "12" } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ mode: "ambient" }))
    expect(onChange).toHaveBeenCalledWith({ ambient: { speed: 12 } })
  })

  it("[neoview.ambient-background.preview-lifecycle] keeps previews bounded to the selected mode", () => {
    const onChange = vi.fn(async () => undefined)
    render(<AmbientBackgroundSettingsCard background={{ ...background, mode: "spotlight" }} onChange={onChange} />)
    expect(screen.getByTestId("ambient-background-spotlight-preview")).toBeTruthy()
    expect(screen.queryByTestId("ambient-background-preview")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "重置设置" }))
    expect(onChange).toHaveBeenCalledWith({ mode: "solid", ambient: { style: "vibrant", speed: 8, blur: 80, opacity: 0.8 }, aurora: { showRadialGradient: true }, spotlight: { color: "white" } })
  })
})
