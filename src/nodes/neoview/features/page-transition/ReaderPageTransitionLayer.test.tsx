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
  it("[neoview.page-transition.runtime] [neoview.image-trim.animation] derives exact next/prev direction without taking crop ownership from the child image", async () => {
    vi.useFakeTimers()
    const store = enabledStore()
    const view = render(<ReaderPageTransitionLayer pageIndex={2} store={store}><img src="/page.jpg" style={{ clipPath: "inset(10% 20% 30% 40%)", transform: "rotate(90deg)" }} /></ReaderPageTransitionLayer>)
    const image = view.container.querySelector("img")

    view.rerender(<ReaderPageTransitionLayer pageIndex={3} store={store}><img src="/page.jpg" style={{ clipPath: "inset(10% 20% 30% 40%)", transform: "rotate(90deg)" }} /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.dataset.readerPageTransitionDirection).toBe("next")
    expect(layer.style.transition).toContain("transform")
    expect(view.container.querySelector("img")).toBe(image)
    expect(image?.style.clipPath).toBe("inset(10% 20% 30% 40%)")
    expect(image?.style.transform).toBe("rotate(90deg)")
    expect(layer.style.transform).not.toBe(image?.style.transform)

    view.rerender(<ReaderPageTransitionLayer pageIndex={1} store={store}><img src="/page.jpg" style={{ clipPath: "inset(10% 20% 30% 40%)", transform: "rotate(90deg)" }} /></ReaderPageTransitionLayer>)
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

  it("fills the reader viewport when it owns a full-surface renderer", () => {
    const view = render(<ReaderPageTransitionLayer pageIndex={0} fill><span /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.className).toContain("h-full")
    expect(layer.className).toContain("min-h-0")
    expect(layer.className).toContain("w-full")
  })

  it("[neoview.slideshow.fade-transition] applies a compositor-only slideshow fade without requiring the general transition setting", () => {
    vi.useFakeTimers()
    const view = render(<ReaderPageTransitionLayer pageIndex={1} slideshowFade><img src="/page-1.jpg" /></ReaderPageTransitionLayer>)
    const image = view.container.querySelector("img")
    view.rerender(<ReaderPageTransitionLayer pageIndex={2} slideshowFade><img src="/page-2.jpg" /></ReaderPageTransitionLayer>)
    const layer = view.container.querySelector<HTMLElement>("[data-reader-page-transition-layer]")!
    expect(layer.dataset.readerPageTransitionSource).toBe("slideshow")
    expect(layer.dataset.readerPageTransitionType).toBe("slideshow-fade")
    expect(layer.style.transition).toBe("opacity 180ms ease-out")
    expect(layer.style.transform).toBe("")
    expect(view.container.querySelector("img")).toBe(image)
    act(() => vi.runAllTimers())
    expect(layer.dataset.readerPageTransitionSource).toBeUndefined()
    expect(layer.style.opacity).toBe("")
  })
})

function enabledStore() {
  const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
  store.preview({ enabled: true, type: "slide", duration: 200, easing: "easeOutQuad" })
  return store
}
