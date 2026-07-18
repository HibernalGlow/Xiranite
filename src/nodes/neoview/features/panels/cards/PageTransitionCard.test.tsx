import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderPageTransitionStore } from "../../page-transition/ReaderPageTransitionStore"
import DockedPageTransitionCard, { PageTransitionCard } from "./PageTransitionCard"

afterEach(cleanup)

describe("PageTransitionCard", () => {
  it("[neoview.page-transition.ui] preserves the compact conditional legacy hierarchy", async () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<PageTransitionCard store={store} />)
    expect(screen.getByRole("checkbox", { name: "启用翻页动画" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.queryByLabelText("动画类型")).toBeNull()

    fireEvent.click(screen.getByRole("checkbox", { name: "启用翻页动画" }))
    expect(await screen.findByLabelText("动画类型")).toBeTruthy()
    expect(screen.getByLabelText("动画时长").getAttribute("min")).toBe("0")
    expect(screen.getByLabelText("动画时长").getAttribute("max")).toBe("500")
    expect(screen.getByLabelText("缓动函数")).toBeTruthy()
    expect(screen.getByRole("button", { name: "预览翻页动画" })).toBeTruthy()
  })

  it("[neoview.page-transition.slider-commit] previews slider input and commits only on interaction end", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true })
    render(<PageTransitionCard store={store} />)
    const slider = screen.getByLabelText("动画时长")

    fireEvent.change(slider, { target: { value: "120" } })
    fireEvent.change(slider, { target: { value: "240" } })
    expect(persist).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { pointerId: 1 })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(persist.mock.calls[0]?.[0].duration).toBe(240)
  })

  it("[neoview.page-transition.preview] previews without persistence or navigation", () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true, type: "zoom", duration: 300 })
    render(<PageTransitionCard store={store} />)
    const preview = screen.getByRole("button", { name: "预览翻页动画" })
    fireEvent.pointerEnter(preview)
    expect(preview.style.transform).toBe("scale(0.95)")
    expect(preview.style.opacity).toBe("0.7")
    expect(persist).not.toHaveBeenCalled()
  })

  it("[neoview.page-transition.navigation-independence] stays interactive while Reader navigation is busy", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<DockedPageTransitionCard pageTransition={store} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("checkbox", { name: "启用翻页动画" }).getAttribute("data-disabled")).toBeNull()
  })
  it("[neoview.page-transition.inactive-zero-subscription] keeps an empty shell while hidden and subscribes after activation", async () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    const subscribe = vi.spyOn(store, "subscribe")
    const context = { pageTransition: store, disabled: false, client: {} as never, onGoTo: () => undefined }
    const view = render(<DockedPageTransitionCard {...context} panelActive={false} />)

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(subscribe).not.toHaveBeenCalled()

    view.rerender(<DockedPageTransitionCard {...context} panelActive />)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    expect(view.container.querySelector('[data-neoview-card="page-transition"]')).toBeTruthy()
  })
})
