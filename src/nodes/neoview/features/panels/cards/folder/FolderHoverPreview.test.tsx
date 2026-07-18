import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FolderHoverPreview } from "./FolderHoverPreview"

describe("FolderHoverPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("[neoview.folder.hover-preview-delay] reveals only after the configured delay and reuses the opaque URL", () => {
    const { container } = render(
      <FolderHoverPreview enabled delayMs={500} thumbnailUrl="http://thumbnail.test/cover.webp" label="cover.cbz">
        <button type="button">cover</button>
      </FolderHoverPreview>,
    )
    const anchor = container.querySelector<HTMLElement>('[data-folder-hover-preview-anchor="true"]')!
    fireEvent.mouseEnter(anchor)
    act(() => vi.advanceTimersByTime(499))
    expect(screen.queryByRole("tooltip")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    const tooltip = screen.getByRole("tooltip")
    expect(tooltip.getAttribute("aria-label")).toBe("cover.cbz preview")
    expect(tooltip.querySelector("img")?.getAttribute("src")).toBe("http://thumbnail.test/cover.webp")
  })

  it("[neoview.folder.hover-preview-cancel] cancels on leave, scroll and disable", () => {
    const { container, rerender } = render(
      <FolderHoverPreview enabled delayMs={200} thumbnailUrl="thumb.webp" label="cover.cbz">
        <button type="button">cover</button>
      </FolderHoverPreview>,
    )
    const anchor = container.querySelector<HTMLElement>('[data-folder-hover-preview-anchor="true"]')!
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.mouseEnter(anchor)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole("tooltip")).toBeTruthy()
    act(() => { window.dispatchEvent(new Event("scroll")) })
    expect(screen.queryByRole("tooltip")).toBeNull()
    rerender(
      <FolderHoverPreview enabled={false} delayMs={200} thumbnailUrl="thumb.webp" label="cover.cbz">
        <button type="button">cover</button>
      </FolderHoverPreview>,
    )
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("[neoview.folder.hover-preview-geometry] stays near the anchor in a 420x360 viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 420 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 })
    const { container } = render(
      <FolderHoverPreview enabled delayMs={0} thumbnailUrl="thumb.webp" label="cover.cbz">
        <button type="button">cover</button>
      </FolderHoverPreview>,
    )
    const anchor = container.querySelector<HTMLElement>('[data-folder-hover-preview-anchor="true"]')!
    Object.defineProperty(anchor, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 160, right: 220, top: 140, bottom: 190, width: 60, height: 50 }),
    })
    fireEvent.mouseEnter(anchor)
    act(() => vi.advanceTimersByTime(0))
    const tooltip = screen.getByRole("tooltip")
    const left = Number.parseFloat(tooltip.style.left)
    const top = Number.parseFloat(tooltip.style.top)
    const width = Number.parseFloat(tooltip.style.width)
    const height = Number.parseFloat(tooltip.style.maxHeight)
    expect(width).toBeLessThanOrEqual(240)
    expect(height).toBeLessThan(320)
    expect(left).toBeGreaterThan(8)
    expect(top).toBeGreaterThan(8)
    expect(left).toBeLessThan(220)
    expect(top).toBeLessThan(180)
  })
})
