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

  it("[neoview.shared-thumbnail.loading] exposes a named loading state without an image request", () => {
    const view = render(<ReaderThumbnailSurface kind="folder" loading className="size-16" />)
    expect(screen.getByLabelText("正在加载缩略图")).toBeTruthy()
    expect(view.container.querySelector("img")).toBeNull()
  })
})
