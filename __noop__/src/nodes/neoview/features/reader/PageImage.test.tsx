import { act, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { createReaderColorFilterStore } from "../color-filter/ReaderColorFilterStore"
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

  it("[neoview.viewer.image-identity] keeps the same img while applying measured scale and rotation", () => {
    const source = page()
    const view = render(<PageImage page={source} />)
    const image = view.container.querySelector("img")!
    view.rerender(<PageImage page={source} scale={0.5} rotation={90} />)
    expect(view.container.querySelector("img")).toBe(image)
    expect(image.getAttribute("src")).toBe(source.assetUrl)
    expect(image.style.transform).toContain("rotate(90deg)")
    const box = view.container.querySelector<HTMLElement>('[data-reader-page-box="page-1"]')!
    expect(box.style.width).toBe("3000px")
    expect(box.style.height).toBe("2000px")
  })

  it("[neoview.color-filter.image-identity] applies CSS and declarative SVG without replacing the active image", async () => {
    const source = page()
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const view = render(<PageImage page={source} colorFilter={store} />)
    const image = view.container.querySelector("img")!

    await act(async () => store.update({ colorizeEnabled: true, brightness: 120 }))

    expect(view.container.querySelector("img")).toBe(image)
    expect(image.getAttribute("src")).toBe(source.assetUrl)
    expect(image.style.filter).toContain("url(#neoview-color-filter-")
    expect(image.style.filter).toContain("brightness(120%)")
    expect(view.container.querySelectorAll("svg filter")).toHaveLength(1)
    expect(view.container.querySelector("feFuncR")?.getAttribute("tableValues")).toBeTruthy()
  })

  it("[neoview.color-filter.black-white-detection] samples the loaded image at a bounded 64px size", async () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 120
      pixels[index + 1] = 121
      pixels[index + 2] = 120
      pixels[index + 3] = 255
    }
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: () => ({ data: pixels }),
    } as unknown as CanvasRenderingContext2D)
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const view = render(<PageImage page={page()} colorFilter={store} />)
    const image = view.container.querySelector("img")!
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 4000 })

    await act(async () => store.update({ colorizeEnabled: true, onlyBlackAndWhite: true }))
    act(() => image.dispatchEvent(new Event("load")))

    await waitFor(() => expect(view.container.querySelector('[data-reader-colorize-allowed="true"]')).toBeTruthy())
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 64, 64)
    vi.restoreAllMocks()
  })

  it("[neoview.color-filter.black-white-detection] skips colorization for a colored page but keeps basic filters", async () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 220
      pixels[index + 1] = 40
      pixels[index + 2] = 30
      pixels[index + 3] = 255
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
    } as unknown as CanvasRenderingContext2D)
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    const view = render(<PageImage page={page()} colorFilter={store} />)
    const image = view.container.querySelector("img")!
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 4000 })

    await act(async () => store.update({ colorizeEnabled: true, onlyBlackAndWhite: true, brightness: 120 }))
    act(() => image.dispatchEvent(new Event("load")))

    await waitFor(() => expect(view.container.querySelector('[data-reader-colorize-allowed="false"]')).toBeTruthy())
    expect(image.style.filter).not.toContain("url(")
    expect(image.style.filter).toContain("brightness(120%)")
    vi.restoreAllMocks()
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
