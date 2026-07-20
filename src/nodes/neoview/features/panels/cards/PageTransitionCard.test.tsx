import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createReaderPageTransitionStore } from "../../page-transition/ReaderPageTransitionStore"
import DockedPageTransitionCard, { PageTransitionCard } from "./PageTransitionCard"

afterEach(cleanup)

describe("PageTransitionCard", () => {
  it("[neoview.page-transition.states] keeps the animation switch available without a book", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    const view = render(<PageTransitionCard store={store} />)
    expect(screen.getByRole("switch", { name: "启用翻页动画" }).hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByRole("switch", { name: "启用翻页动画" }))
    expect(screen.getByLabelText("动画类型")).toBeTruthy()
    expect(Array.from(view.container.querySelectorAll("[data-reader-card-control-group]"), (group) => group.getAttribute("data-reader-card-control-group"))).toEqual([
      "transition-settings",
      "transition-preview",
    ])
  })

  it("[neoview.page-transition.preview] previews locally without persisting or navigating", () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true })
    render(<PageTransitionCard store={store} />)
    const preview = screen.getByRole("button", { name: "预览翻页动画" })
    fireEvent.pointerEnter(preview)
    expect((preview as HTMLElement).style.transform).toBe("scale(0.95)")
    fireEvent.pointerLeave(preview)
    expect((preview as HTMLElement).style.transform).toBe("scale(1)")
    expect(persist).not.toHaveBeenCalled()
  })

  it("previews duration and commits once for a keyboard step", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true })
    render(<PageTransitionCard store={store} />)
    const slider = screen.getByRole("slider", { name: "动画时长" })
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(store.getSnapshot().duration).toBe(10)
    await waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(persist.mock.calls[0]?.[0].duration).toBe(10)
  })

  it("[neoview.page-transition.pending-edit] surfaces a pending save without locking the animation controls", () => {
    const store = createReaderPageTransitionStore({ persist: async () => new Promise(() => undefined) })
    render(<PageTransitionCard store={store} />)

    fireEvent.click(screen.getByRole("switch", { name: "启用翻页动画" }))

    expect(screen.getByText("正在保存...", { exact: true })).toBeTruthy()
    expect(screen.getByLabelText("动画类型").hasAttribute("disabled")).toBe(false)
  })

  it("[neoview.page-transition.retry] rolls back a failed save and retries the same command explicitly", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("config disk unavailable"))
      .mockImplementation(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    const view = render(<PageTransitionCard store={store} />)

    fireEvent.click(view.container.querySelector('[role="switch"]')!)

    const alert = await screen.findByRole("alert")
    expect(store.getSnapshot().enabled).toBe(false)
    fireEvent.click(alert.querySelector("button")!)

    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(store.getSnapshot().enabled).toBe(true)
  })

  it("keeps the resident Card mounted while its panel is inactive", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<DockedPageTransitionCard pageTransition={store} panelActive={false} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("switch", { name: "启用翻页动画" }).hasAttribute("disabled")).toBe(false)
    expect(document.querySelector('[data-neoview-card="page-transition"]')?.getAttribute("data-panel-active")).toBe("false")
  })

  it("keeps the enabled value and settles the save state under React Strict Mode", async () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<StrictMode><PageTransitionCard store={store} /></StrictMode>)

    const toggle = screen.getByRole("switch", { name: "启用翻页动画" })
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(toggle.getAttribute("data-state")).toBe("checked")
  })
})
