import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderEntrySurface } from "./ReaderEntrySurface"

afterEach(cleanup)

describe("ReaderEntrySurface", () => {
  it("[neoview.shared-entry.variants] freezes the shared Folder entry geometry", () => {
    const { rerender } = render(<ReaderEntrySurface variant="compact" primary="A" />)
    const surface = screen.getByText("A").closest<HTMLElement>('[data-reader-entry-surface="true"]')!
    expect(surface.className).toContain("h-[34px]")

    rerender(<ReaderEntrySurface variant="content" primary="A" media={<span data-media />} />)
    expect(surface.className).toContain("h-[76px]")
    expect(surface.querySelector("[data-media]")).toBeTruthy()

    rerender(<ReaderEntrySurface variant="banner" primary="A" />)
    expect(surface.className).toContain("h-24")

    rerender(<ReaderEntrySurface variant="thumbnail" primary="A" current />)
    expect(surface.className).toContain("h-36")
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
