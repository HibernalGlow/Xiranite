import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createReaderColorFilterStore } from "../../color-filter/ReaderColorFilterStore"
import DockedColorFilterCard, { ColorFilterCard } from "./ColorFilterCard"

afterEach(cleanup)

describe("ColorFilterCard", () => {
  it("[neoview.color-filter.states] keeps the legacy controls available without a book", async () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const view = render(<ColorFilterCard store={store} />)
    expect(screen.getAllByRole("slider")).toHaveLength(5)
    expect(Array.from(view.container.querySelectorAll("[data-reader-card-control-group]"), (group) => group.getAttribute("data-reader-card-control-group"))).toEqual([
      "filters",
      "effects",
    ])
    fireEvent.click(screen.getByRole("switch", { name: "着色" }))
    expect(await screen.findByLabelText("着色预设")).toBeTruthy()
    expect(screen.getByText("仅黑白图像")).toBeTruthy()
    expect(view.container.querySelector('[data-reader-card-control-group="colorize"]')).toBeTruthy()
  })

  it("previews a slider and commits once for a keyboard step", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)
    const brightness = screen.getByRole("slider", { name: "亮度" })
    fireEvent.keyDown(brightness, { key: "ArrowRight" })
    expect(store.getSnapshot().brightness).toBe(101)
    await waitFor(() => expect(persist).toHaveBeenCalledOnce())
  })

  it("[neoview.color-filter.retry] retries a failed save from the visible error state", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementation(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)
    fireEvent.click(screen.getByRole("switch", { name: "反色" }))
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it("[neoview.color-filter.pending-edit] keeps controls usable while a serialized save is pending", () => {
    const store = createReaderColorFilterStore({ persist: async () => new Promise(() => undefined) })
    render(<ColorFilterCard store={store} />)

    fireEvent.click(screen.getByRole("switch", { name: "反色" }))

    expect(screen.getByRole("switch", { name: "负片" }).hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByRole("switch", { name: "负片" }))
    expect(store.getSnapshot()).toMatchObject({ invert: true, negative: true })
  })

  it("[neoview.color-filter.lifecycle] does not subscribe to the control store while its panel is inactive", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const subscribe = vi.spyOn(store, "subscribe")
    render(<DockedColorFilterCard colorFilter={store} panelActive={false} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(document.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("settles the save state under React Strict Mode", async () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<StrictMode><ColorFilterCard store={store} /></StrictMode>)

    fireEvent.click(screen.getByRole("switch", { name: "反色" }))

    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(screen.getByRole("switch", { name: "反色" }).getAttribute("data-state")).toBe("checked")
  })
})
