import { describe, expect, it } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { readerPresentationUrl } from "./presentation-url"

describe("readerPresentationUrl", () => {
  it("[neoview.react.presentation-original] preserves original URLs for unknown dimensions, animation and small reductions", () => {
    const original = page()
    expect(readerPresentationUrl({ ...original, dimensions: undefined }, viewport(), 1)).toBe(original.assetUrl)
    expect(readerPresentationUrl({ ...original, mediaKind: "animated-image" }, viewport(), 1)).toBe(original.assetUrl)
    expect(readerPresentationUrl({ ...original, dimensions: { width: 900, height: 700 } }, viewport(), 1)).toBe(original.assetUrl)
  })

  it("[neoview.react.presentation-transform] requests a quantized DPR-bounded WebP only for material reductions", () => {
    const transformed = new URL(readerPresentationUrl(page(), viewport(800, 600, 3), 1))
    expect(transformed.searchParams.get("width")).toBe("448")
    expect(transformed.searchParams.get("height")).toBe("640")
    expect(transformed.searchParams.get("dpr")).toBe("2")
    expect(transformed.searchParams.get("fit")).toBe("inside")
    expect(transformed.searchParams.get("format")).toBe("webp")
    expect(transformed.searchParams.get("quality")).toBe("82")
    expect(transformed.searchParams.get("token")).toBe("secret")
  })

  it("[neoview.react.presentation-stability] keeps nearby viewport sizes on the same cache key", () => {
    const first = readerPresentationUrl(page(), viewport(800, 600), 1)
    const second = readerPresentationUrl(page(), viewport(806, 604), 1)
    expect(second).toBe(first)
  })

  it("[neoview.react.presentation-double] divides horizontal space between visible pages", () => {
    const transformed = new URL(readerPresentationUrl(page({ dimensions: { width: 2400, height: 3600 } }), viewport(1200, 900), 2))
    expect(transformed.searchParams.get("width")).toBe("640")
    expect(transformed.searchParams.get("height")).toBe("960")
  })
})

function page(overrides: Partial<ReaderPageDto> = {}): ReaderPageDto {
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
    ...overrides,
  }
}

function viewport(width = 800, height = 600, dpr = 1): { width: number; height: number; dpr: number } {
  return { width, height, dpr }
}
