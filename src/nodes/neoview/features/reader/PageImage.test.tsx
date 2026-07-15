import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { PageImage } from "./PageImage"

describe("PageImage", () => {
  it("[neoview.react.presentation-img] [neoview.react.presentation-direct] uses the original asset URL on the only DOM img chain", () => {
    const source = page()
    const view = render(<PageImage page={source} />)
    const image = view.container.querySelector("img")!
    expect(image.tagName).toBe("IMG")
    expect(image.getAttribute("src")).toBe(source.assetUrl)
    expect(new URL(image.getAttribute("src")!).searchParams.has("format")).toBe(false)
    expect(document.querySelector("canvas")).toBeNull()
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
