import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type ReaderColorFilterSettings } from "@xiranite/node-neoview/color-filter"

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

  it("[neoview.color-filter.rollback] [neoview.color-filter.retry] exposes a failed save and retries the rolled-back mutation", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementation(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)

    fireEvent.click(screen.getByRole("checkbox", { name: "上色" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk full"))
    expect(store.getSnapshot().colorizeEnabled).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy())
    expect(store.getSnapshot().colorizeEnabled).toBe(true)
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it("[neoview.color-filter.states] disables controls while a save is pending", async () => {
    let resolvePersist: (() => void) | undefined
    const persist = vi.fn((settings: ReaderColorFilterSettings) => new Promise<ReaderColorFilterSettings>((resolve) => {
      resolvePersist = () => resolve(settings)
    }))
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)

    fireEvent.click(screen.getByRole("checkbox", { name: "上色" }))
    expect(await screen.findByText("正在保存...")).toBeTruthy()
    expect(screen.getByRole("slider", { name: "亮度" }).hasAttribute("disabled")).toBe(true)

    resolvePersist?.(store.getSnapshot())
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy())
  })

  it("[neoview.color-filter.navigation-independence] stays interactive while Reader navigation is busy", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<DockedColorFilterCard colorFilter={store} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("slider", { name: "亮度" }).hasAttribute("disabled")).toBe(false)
    expect(screen.getByRole("checkbox", { name: "上色" }).getAttribute("data-disabled")).toBeNull()
  })

  it("[neoview.color-filter.inactive-zero-subscription] keeps an empty shell while hidden and subscribes after activation", async () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const subscribe = vi.spyOn(store, "subscribe")
    const context = { colorFilter: store, disabled: false, client: {} as never, onGoTo: () => undefined }
    const view = render(<DockedColorFilterCard {...context} panelActive={false} />)

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(subscribe).not.toHaveBeenCalled()

    view.rerender(<DockedColorFilterCard {...context} panelActive />)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    expect(view.container.querySelector('[data-neoview-card="color-filter"]')).toBeTruthy()
  })

  it("[neoview.color-filter.lifecycle] unsubscribes when the visible Card is unloaded", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const unsubscribe = vi.fn()
    const originalSubscribe = store.subscribe
    const subscribe = vi.spyOn(store, "subscribe").mockImplementation((listener) => {
      const dispose = originalSubscribe(listener)
      return () => { dispose(); unsubscribe() }
    })
    const view = render(<DockedColorFilterCard colorFilter={store} panelActive />)

    expect(subscribe).toHaveBeenCalledOnce()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
