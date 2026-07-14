import { act, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useReaderViewport } from "./useReaderViewport"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useReaderViewport", () => {
  it("[neoview.react.presentation-resize] measures before paint and settles resize bursts once", () => {
    vi.useFakeTimers()
    let width = 800
    let height = 600
    let resizeCallback!: () => void
    const disconnect = vi.fn()
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      toJSON: () => ({}),
    }))
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallback = callback }
      observe() {}
      disconnect = disconnect
    })
    vi.stubGlobal("devicePixelRatio", 1.5)

    const view = render(<ViewportFixture />)
    expect(screen.getByTestId("viewport").textContent).toBe("800x600@1.5")
    width = 900
    height = 700
    act(() => resizeCallback())
    act(() => vi.advanceTimersByTime(119))
    expect(screen.getByTestId("viewport").textContent).toBe("800x600@1.5")
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId("viewport").textContent).toBe("900x700@1.5")
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

function ViewportFixture() {
  const ref = useRef<HTMLDivElement>(null)
  const viewport = useReaderViewport(ref)
  return <div ref={ref} data-testid="viewport">{viewport.width}x{viewport.height}@{viewport.dpr}</div>
}
