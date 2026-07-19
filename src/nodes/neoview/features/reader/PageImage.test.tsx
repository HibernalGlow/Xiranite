import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_IMAGE_TRIM } from "@xiranite/node-neoview/image-trim"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { createReaderColorFilterStore } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
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

  it("[neoview.viewer.image-identity] [neoview.image-trim.navigation-stability] keeps the same img while applying trim, measured scale and rotation", () => {
    const source = page()
    const imageTrim = imageTrimPort()
    const view = render(<PageImage page={source} imageTrim={imageTrim} />)
    const image = view.container.querySelector("img")!
    view.rerender(<PageImage page={source} imageTrim={imageTrim} scale={0.5} rotation={90} />)
    expect(view.container.querySelector("img")).toBe(image)
    expect(image.getAttribute("src")).toBe(source.assetUrl)
    expect(image.style.transform).toContain("rotate(90deg)")
    expect(image.style.clipPath).toBe("inset(10% 40% 20% 30%)")
    const box = view.container.querySelector<HTMLElement>('[data-reader-page-box="page-1"]')!
    expect(box.style.width).toBe("3000px")
    expect(box.style.height).toBe("2000px")
  })

  it("[neoview.image-trim.active-physical-page] registers a decoded image only while its physical page owns detection", async () => {
    const unregister = vi.fn()
    const registerImage = vi.fn(() => unregister)
    const imageTrim = imageTrimPort(registerImage)
    const source = page()
    const view = render(<PageImage page={source} imageTrim={imageTrim} imageTrimDetectionActive={false} />)
    const image = view.container.querySelector<HTMLImageElement>("img")!
    image.decode = vi.fn(async () => undefined)

    fireEvent.load(image)
    await waitFor(() => expect(image.dataset.readerPageImageDecoded).toBe(source.id))
    expect(registerImage).not.toHaveBeenCalled()

    view.rerender(<PageImage page={source} imageTrim={imageTrim} imageTrimDetectionActive />)
    await waitFor(() => expect(registerImage).toHaveBeenCalledWith(`${source.id}:${source.contentVersion}:${source.assetUrl}`, image))

    view.rerender(<PageImage page={source} imageTrim={imageTrim} imageTrimDetectionActive={false} />)
    expect(unregister).toHaveBeenCalledOnce()
  })

  it("[neoview.image-trim.clip-path-gui] composes a presentation crop on the committed image without another media node", () => {
    const source = page()
    const view = render(<PageImage
      page={source}
      imageTrim={imageTrimPort()}
      presentationCropInsets={{ top: 0, right: 50, bottom: 0, left: 0 }}
    />)

    const image = view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')!
    expect(image.style.clipPath).toBe("inset(10% 50% 20% 30%)")
    expect(view.container.querySelectorAll("img")).toHaveLength(1)
    expect(view.container.querySelector("canvas")).toBeNull()
  })

  it("[neoview.image-trim.active-image] registers only the decoded committed image and unregisters it without remounting", async () => {
    const unregister = vi.fn()
    const registerImage = vi.fn(() => unregister)
    const imageTrim = {
      subscribe: () => () => undefined,
      getSnapshot: () => undefined,
      registerImage,
    } as unknown as ReaderImageTrimPort
    const source = page()
    const view = render(<PageImage page={source} imageTrim={imageTrim} />)
    const image = view.container.querySelector<HTMLImageElement>("img")!
    image.decode = vi.fn(async () => undefined)

    expect(registerImage).not.toHaveBeenCalled()
    fireEvent.load(image)
    await waitFor(() => expect(registerImage).toHaveBeenCalledWith(`${source.id}:${source.contentVersion}:${source.assetUrl}`, image))

    view.rerender(<PageImage page={source} imageTrim={imageTrim} scale={0.5} rotation={90} />)
    expect(view.container.querySelector("img")).toBe(image)
    expect(registerImage).toHaveBeenCalledOnce()

    view.unmount()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it("[neoview.viewer.seamless-page-swap] retains the committed bitmap until the next page decodes", async () => {
    let finishDecode!: () => void
    const decode = new Promise<void>((resolve) => { finishDecode = resolve })
    const source = page()
    const target = { ...source, id: "page-2", index: 1, contentVersion: "v2", assetUrl: "/reader/page-2" }
    const view = render(<PageImage page={source} />)

    view.rerender(<PageImage page={target} />)
    const committed = view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')!
    const pending = view.container.querySelector<HTMLImageElement>('[data-reader-page-image-pending="page-2"]')!
    pending.decode = vi.fn(() => decode)
    fireEvent.load(pending)

    expect(committed.getAttribute("src")).toBe(source.assetUrl)
    expect(view.container.querySelector('[data-reader-page-image="page-2"]')).toBeNull()

    finishDecode()
    await waitFor(() => expect(view.container.querySelector('[data-reader-page-image="page-2"]')).toBe(pending))
    expect(view.container.querySelector('[data-reader-page-image="page-1"]')).toBeNull()
  })

  it("[neoview.viewer.seamless-upscale-swap] rejects a stale decoded replacement after the target changes", async () => {
    const resolutions: Array<() => void> = []
    const source = page()
    const upscaled = { ...source, contentVersion: "upscaled-v2", assetUrl: "/reader/page-1-upscaled" }
    const restored = { ...source, contentVersion: "original-v3", assetUrl: "/reader/page-1-original" }
    const view = render(<PageImage page={source} />)

    view.rerender(<PageImage page={upscaled} />)
    const stale = view.container.querySelector<HTMLImageElement>('[data-reader-page-image-pending="page-1"]')!
    stale.decode = vi.fn(() => new Promise<void>((resolve) => resolutions.push(resolve)))
    fireEvent.load(stale)

    view.rerender(<PageImage page={restored} />)
    const latest = [...view.container.querySelectorAll<HTMLImageElement>('[data-reader-page-image-pending="page-1"]')]
      .find((image) => image.getAttribute("src") === restored.assetUrl)!
    latest.decode = vi.fn(async () => undefined)
    fireEvent.load(latest)
    await waitFor(() => expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe(restored.assetUrl))

    resolutions.forEach((resolve) => resolve())
    await Promise.resolve()
    expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe(restored.assetUrl)
  })

  it("[neoview.viewer.auto-upscale-swap] promotes and restores decoded sources without clearing the committed image", async () => {
    const source = page()
    const upscalePage = vi.fn(async () => ({
      status: "hit" as const,
      artifactUrl: "/reader/page-1-upscaled",
      contentType: "image/png",
      bytes: 42,
      version: "artifact-v2",
    }))
    const client = { upscalePage } as never
    const enabled = { provider: "opencomic-system" as const, preferences: { autoUpscaleEnabled: true } }
    const disabled = { provider: "opencomic-system" as const, preferences: { autoUpscaleEnabled: false } }
    const view = render(<PageImage page={source} sessionId="reader-1" client={client} superResolution={enabled} />)

    expect(upscalePage).not.toHaveBeenCalled()
    const sourceImage = view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')!
    sourceImage.decode = vi.fn(async () => undefined)
    fireEvent.load(sourceImage)
    await waitFor(() => expect(upscalePage).toHaveBeenCalledWith("reader-1", "page-1", "automatic-current", expect.any(AbortSignal)))
    await waitFor(() => expect(view.container.querySelector('[src="/reader/page-1-upscaled"]')).toBeTruthy())
    const upscaled = view.container.querySelector<HTMLImageElement>('[src="/reader/page-1-upscaled"]')!
    expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe(source.assetUrl)
    upscaled.decode = vi.fn(async () => undefined)
    fireEvent.load(upscaled)
    await waitFor(() => expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe("/reader/page-1-upscaled"))

    view.rerender(<PageImage page={source} sessionId="reader-1" client={client} superResolution={disabled} />)
    const original = [...view.container.querySelectorAll<HTMLImageElement>(`[src="${source.assetUrl}"]`)]
      .find((image) => image.dataset.readerPageImagePending === "page-1")!
    expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe("/reader/page-1-upscaled")
    original.decode = vi.fn(async () => undefined)
    fireEvent.load(original)
    await waitFor(() => expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')?.getAttribute("src")).toBe(source.assetUrl))
  })

  it("[neoview.image-trim.upscale-generation] transfers detection ownership only after the upscaled image decodes", async () => {
    const unregisterOriginal = vi.fn()
    const unregisterUpscaled = vi.fn()
    const registerImage = vi.fn((identity: string) => identity.includes(":upscale:") ? unregisterUpscaled : unregisterOriginal)
    const imageTrim = imageTrimPort(registerImage)
    const source = page()
    const upscalePage = vi.fn(async () => ({
      status: "hit" as const,
      artifactUrl: "/reader/page-1-upscaled",
      contentType: "image/png",
      bytes: 42,
      version: "artifact-v2",
    }))
    const client = { upscalePage } as never
    const enabled = { provider: "opencomic-system" as const, preferences: { autoUpscaleEnabled: true } }
    const view = render(<PageImage page={source} imageTrim={imageTrim} sessionId="reader-1" client={client} superResolution={enabled} />)
    const original = view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')!
    original.decode = vi.fn(async () => undefined)

    fireEvent.load(original)
    await waitFor(() => expect(registerImage).toHaveBeenCalledWith(`${source.id}:${source.contentVersion}:${source.assetUrl}`, original))
    await waitFor(() => expect(view.container.querySelector('[src="/reader/page-1-upscaled"]')).toBeTruthy())
    const upscaled = view.container.querySelector<HTMLImageElement>('[src="/reader/page-1-upscaled"]')!
    expect(registerImage).toHaveBeenCalledOnce()
    upscaled.decode = vi.fn(async () => undefined)

    fireEvent.load(upscaled)
    await waitFor(() => expect(registerImage).toHaveBeenCalledWith(`${source.id}:${source.contentVersion}:upscale:artifact-v2:/reader/page-1-upscaled`, upscaled))
    expect(unregisterOriginal).toHaveBeenCalledOnce()
    expect(unregisterUpscaled).not.toHaveBeenCalled()

    view.rerender(<PageImage page={source} imageTrim={imageTrim} imageTrimDetectionActive sessionId="reader-1" client={client} superResolution={enabled} scale={0.5} rotation={90} />)
    expect(view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')).toBe(upscaled)
    expect(upscaled.style.clipPath).toBe("inset(10% 40% 20% 30%)")
    expect(upscaled.style.transform).toContain("rotate(90deg)")
    expect(registerImage).toHaveBeenCalledTimes(2)
  })

  it("[neoview.viewer.auto-upscale-cancel] aborts stale enhancement work as soon as navigation changes the source page", async () => {
    const source = page()
    const target = { ...source, id: "page-2", index: 1, contentVersion: "v2", assetUrl: "/reader/page-2" }
    let upscaleSignal: AbortSignal | undefined
    const upscalePage = vi.fn((_sessionId: string, _pageId: string, _mode: string, signal: AbortSignal) => {
      upscaleSignal = signal
      return new Promise<never>(() => undefined)
    })
    const client = { upscalePage } as never
    const enabled = { provider: "opencomic-system" as const, preferences: { autoUpscaleEnabled: true } }
    const view = render(<PageImage page={source} sessionId="reader-1" client={client} superResolution={enabled} />)
    const sourceImage = view.container.querySelector<HTMLImageElement>('[data-reader-page-image="page-1"]')!
    sourceImage.decode = vi.fn(async () => undefined)
    fireEvent.load(sourceImage)
    await waitFor(() => expect(upscalePage).toHaveBeenCalledOnce())

    view.rerender(<PageImage page={target} sessionId="reader-1" client={client} superResolution={enabled} />)

    await waitFor(() => expect(upscaleSignal?.aborted).toBe(true))
    expect(upscalePage).toHaveBeenCalledTimes(1)
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

function imageTrimPort(registerImage = vi.fn(() => () => undefined)): ReaderImageTrimPort {
  const snapshot = {
    ...DEFAULT_READER_IMAGE_TRIM,
    enabled: true,
    top: 10,
    right: 40,
    bottom: 20,
    left: 30,
  }
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    registerImage,
  } as unknown as ReaderImageTrimPort
}
