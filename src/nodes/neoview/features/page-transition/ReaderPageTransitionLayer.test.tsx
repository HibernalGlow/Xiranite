import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderPageTransitionStore } from "./ReaderPageTransitionStore"
import { ReaderPageTransitionLayer } from "./ReaderPageTransitionLayer"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("ReaderPageTransitionLayer", () => {
  it("[neoview.page-transition.runtime] derives exact next/prev direction and keeps the child image", async () => {
    vi.useFakeTimers()
    const store = enabledStore()
    const view = render(<ReaderPageTransitionLayer pageIndex={2} store={store}><img src="/page.jpg" /></ReaderPageTransitionLayer>)
    const image = view.container.querySelector("img")

    view.rerender(<ReaderPageTransitionLayer pageIndex={3} store={store}><img src="/page.jpg" /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.dataset.readerPageTransitionDirection).toBe("next")
    expect(layer.style.transition).toContain("transform")
    expect(view.container.querySelector("img")).toBe(image)

    view.rerender(<ReaderPageTransitionLayer pageIndex={1} store={store}><img src="/page.jpg" /></ReaderPageTransitionLayer>)
    expect(layer.dataset.readerPageTransitionDirection).toBe("prev")
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.runAllTimers())
    expect(layer.dataset.readerPageTransitionDirection).toBeUndefined()
  })

  it("[neoview.page-transition.reduced-motion] suppresses animation without changing the preference", async () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true } as MediaQueryList)),
    })
    const store = enabledStore()
    const view = render(<ReaderPageTransitionLayer pageIndex={4} store={store}><span /></ReaderPageTransitionLayer>)
    view.rerender(<ReaderPageTransitionLayer pageIndex={5} store={store}><span /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.dataset.readerPageTransitionDirection).toBeUndefined()
    expect(layer.style.transition).toBe("")
    expect(store.getSnapshot().enabled).toBe(true)
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia })
  })

  it("[neoview.page-transition.lifecycle] skips initial and unchanged frames and releases its timer", () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
    const store = enabledStore()
    const view = render(<ReaderPageTransitionLayer pageIndex={7} store={store}><span /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.dataset.readerPageTransitionDirection).toBeUndefined()
    view.rerender(<ReaderPageTransitionLayer pageIndex={7} store={store}><span /></ReaderPageTransitionLayer>)
    expect(vi.getTimerCount()).toBe(0)
    view.rerender(<ReaderPageTransitionLayer pageIndex={8} store={store}><span /></ReaderPageTransitionLayer>)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

function enabledStore() {
  const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
  store.preview({ enabled: true, type: "slide", duration: 200, easing: "easeOutQuad" })
  return store
}
