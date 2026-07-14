import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { PageImage } from "./PageImage"

describe("PageImage", () => {
  it("[neoview.react.presentation-img] keeps the DOM img chain while selecting a transformed asset URL", () => {
    const view = render(<PageImage page={page()} viewport={{ width: 800, height: 600, dpr: 1 }} visiblePageCount={1} />)
    const image = view.container.querySelector("img")!
    expect(image.tagName).toBe("IMG")
    expect(new URL(image.getAttribute("src")!).searchParams.get("format")).toBe("webp")
    expect(document.querySelector("canvas")).toBeNull()
  })

  it("[neoview.react.presentation-fallback] falls back to the original asset when native transform fails", () => {
    const source = page()
    const view = render(<PageImage page={source} viewport={{ width: 800, height: 600, dpr: 1 }} visiblePageCount={1} />)
    const image = view.container.querySelector("img")!
    expect(image.getAttribute("src")).not.toBe(source.assetUrl)
    fireEvent.error(image)
    expect(image.getAttribute("src")).toBe(source.assetUrl)
    fireEvent.error(image)
    expect(image.getAttribute("src")).toBe(source.assetUrl)
  })
})

function page(): ReaderPageDto {
  return {
    id: "page-1",
    index: 0,
    name: "001.jpg",
    mediaKind: "image",
    mimeType: "image/jpeg",
    byteLength: 5 * 1024 * 1024,
    dimensions: { width: 4000, height: 6000 },
    contentVersion: "v1",
    assetUrl: "http://127.0.0.1:41000/reader/page-1?version=v1&token=secret",
  }
}
