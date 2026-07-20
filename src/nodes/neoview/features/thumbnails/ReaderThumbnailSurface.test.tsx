import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderThumbnailSurface } from "./ReaderThumbnailSurface"

afterEach(cleanup)

describe("ReaderThumbnailSurface", () => {
  it("[neoview.shared-thumbnail.fit] preserves the requested fit and degrades after an image error", () => {
    const view = render(<ReaderThumbnailSurface url="/thumbnail.webp" kind="page" fit="contain" className="size-16" />)
    const surface = view.container.querySelector<HTMLElement>('[data-reader-thumbnail-surface="true"]')!
    const image = view.container.querySelector<HTMLImageElement>("img")!

    expect(surface.dataset.thumbnailFit).toBe("contain")
    expect(surface.dataset.thumbnailState).toBe("ready")
    expect(image.className).toContain("object-contain")
    fireEvent.error(image)
    expect(surface.dataset.thumbnailState).toBe("error")
    expect(view.container.querySelector("img")).toBeNull()
  })

  it("[neoview.shared-thumbnail.grid] repacks successful images without cropped tiles or empty slots", () => {
    const urls = ["/one.webp", "/two.webp", "/three.webp", "/four.webp"]
    const view = render(<ReaderThumbnailSurface urls={urls} kind="folder" fit="cover" className="size-24" />)
    const grid = view.container.querySelector<HTMLElement>("[data-thumbnail-grid-count]")!

    expect(grid.dataset.thumbnailGridCount).toBe("4")
    expect(grid.dataset.thumbnailGridColumns).toBe("2")
    expect(grid.dataset.thumbnailGridRows).toBe("2")
    expect([...view.container.querySelectorAll("img")].every((image) => image.className.includes("object-contain"))).toBe(true)

    fireEvent.error(view.container.querySelectorAll("img")[1]!)
    expect(grid.dataset.thumbnailGridCount).toBe("3")
    expect(grid.dataset.thumbnailGridColumns).toBe("2")
    expect(grid.dataset.thumbnailGridRows).toBe("2")
    expect(view.container.querySelectorAll("img")).toHaveLength(3)

    view.rerender(<ReaderThumbnailSurface urls={["/replacement.webp"]} kind="folder" className="size-24" />)
    expect(view.container.querySelector<HTMLImageElement>("img")?.src).toContain("/replacement.webp")
  })

  it("[neoview.shared-thumbnail.loading] exposes a named loading state without an image request", () => {
    const view = render(<ReaderThumbnailSurface kind="folder" loading className="size-16" />)
    expect(screen.getByLabelText("正在加载缩略图")).toBeTruthy()
    expect(view.container.querySelector("img")).toBeNull()
  })
})
