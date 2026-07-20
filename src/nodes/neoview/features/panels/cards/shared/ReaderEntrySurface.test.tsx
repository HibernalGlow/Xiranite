import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderEntrySurface } from "./ReaderEntrySurface"
import { readerLibraryListLayout, readerLibraryMediaClassName } from "./readerLibraryEntryLayout"

afterEach(cleanup)

describe("ReaderEntrySurface", () => {
  it("[neoview.shared-entry.variants] freezes the shared library entry geometry", () => {
    const { rerender } = render(<ReaderEntrySurface variant="compact" primary="A" />)
    const surface = screen.getByText("A").closest<HTMLElement>('[data-reader-entry-surface="true"]')!
    expect(surface.className).toContain("h-[34px]")

    rerender(<ReaderEntrySurface variant="content" primary="A" media={<span data-media />} />)
    expect(surface.className).toContain("h-[76px]")
    expect(surface.querySelector("[data-media]")).toBeTruthy()
    expect(surface.querySelector("[data-reader-entry-media]")).toBeTruthy()

    rerender(<ReaderEntrySurface variant="banner" primary="A" media={<span data-media />} />)
    expect(surface.className).toContain("h-full")
    expect(surface.querySelector("button")?.className).toContain("grid-cols-[minmax(7rem,42%)_minmax(0,1fr)]")

    rerender(<ReaderEntrySurface variant="thumbnail" primary="A" media={<span data-media />} current />)
    expect(surface.className).toContain("h-full")
    expect(surface.dataset.current).toBe("true")
  })

  it("[neoview.shared-entry.interaction] keeps actions outside the primary entry button", () => {
    const activate = vi.fn()
    render(
      <ReaderEntrySurface
        variant="content"
        primary="Book"
        leading={<input aria-label="Select" type="checkbox" />}
        trailing={<button type="button">Remove</button>}
        buttonProps={{ onClick: activate, "aria-label": "Open Book" }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open Book" }))
    expect(activate).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Open Book" }).querySelector("button")).toBeNull()
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy()
  })
})

describe("readerLibraryEntryLayout", () => {
  it("[neoview.shared-entry.layout] keeps virtual-list pitch aligned with surface heights", () => {
    expect(readerLibraryListLayout("compact")).toEqual({ itemSize: 34, columns: 1, gap: 0 })
    expect(readerLibraryListLayout("content")).toEqual({ itemSize: 76, columns: 1, gap: 0 })

    const narrowBanner = readerLibraryListLayout("banner", 300)
    expect(narrowBanner.columns).toBe(1)
    expect(narrowBanner.itemSize).toBeGreaterThanOrEqual(136)

    const wideBanner = readerLibraryListLayout("banner", 640)
    expect(wideBanner.columns).toBeGreaterThanOrEqual(2)
    expect(wideBanner.itemSize).toBeGreaterThan(narrowBanner.itemSize)

    const narrowThumb = readerLibraryListLayout("thumbnail", 280)
    expect(narrowThumb.columns).toBeGreaterThanOrEqual(1)
    expect(narrowThumb.itemSize).toBeGreaterThanOrEqual(160)

    const wideThumb = readerLibraryListLayout("thumbnail", 480)
    expect(wideThumb.columns).toBeGreaterThanOrEqual(3)
    expect(wideThumb.itemSize).toBeGreaterThanOrEqual(narrowThumb.itemSize)

    expect(readerLibraryMediaClassName("content")).toBe("size-16")
    expect(readerLibraryMediaClassName("banner")).toContain("size-full")
    expect(readerLibraryMediaClassName("compact")).toContain("size-7")
  })
})
