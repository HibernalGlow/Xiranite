import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderColorFilterStore } from "../../color-filter/ReaderColorFilterStore"
import DockedColorFilterCard, { ColorFilterCard } from "./ColorFilterCard"

afterEach(cleanup)

describe("ColorFilterCard", () => {
  it("[neoview.color-filter.ui] preserves the compact legacy controls and conditional colorize options", async () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<ColorFilterCard store={store} />)

    expect(screen.queryByLabelText("上色预设")).toBeNull()
    fireEvent.click(screen.getByText("上色"))
    expect(await screen.findByLabelText("上色预设")).toBeTruthy()
    expect(screen.getByText("仅黑白图像")).toBeTruthy()
    expect(screen.getAllByRole("slider")).toHaveLength(5)
    expect(screen.getByRole("button", { name: "重置所有滤镜" })).toBeTruthy()
  })

  it("[neoview.color-filter.slider-commit] previews a slider without writing and commits once at pointer end", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)
    const brightness = screen.getByRole("slider", { name: "亮度" })

    fireEvent.change(brightness, { target: { value: "125" } })
    expect(store.getSnapshot().brightness).toBe(125)
    expect(persist).not.toHaveBeenCalled()
    fireEvent.pointerUp(brightness, { pointerId: 1 })
    await waitFor(() => expect(persist).toHaveBeenCalledOnce())
  })

  it("[neoview.color-filter.navigation-independence] stays interactive while Reader navigation is busy", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<DockedColorFilterCard colorFilter={store} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("slider", { name: "亮度" }).hasAttribute("disabled")).toBe(false)
    expect(screen.getByRole("checkbox", { name: "上色" }).getAttribute("data-disabled")).toBeNull()
  })
})
