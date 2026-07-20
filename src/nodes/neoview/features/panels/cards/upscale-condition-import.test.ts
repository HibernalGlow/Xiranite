import { describe, expect, it } from "vitest"

import { parseUpscaleConditionImport } from "./upscale-condition-import"

describe("parseUpscaleConditionImport", () => {
  it("imports current condition arrays and normalizes priorities", () => {
    const result = parseUpscaleConditionImport(JSON.stringify({ preferences: { conditions: [{
      id: "current",
      name: "Current",
      enabled: true,
      priority: 9,
      match: { maxMegapixels: 12.4, dimensionMode: "or" },
      action: { skip: false, modelId: "realesr-animevideov3", scale: 2 },
    }] } }))

    expect(result).toEqual({
      warnings: [],
      conditions: [expect.objectContaining({ id: "current", priority: 0 })],
    })
  })

  it("converts legacy backup fields and reports unsupported models", () => {
    const result = parseUpscaleConditionImport(JSON.stringify([
      {
        id: "skip",
        name: "Skip",
        enabled: true,
        priority: 0,
        match: { minPixels: 15, regexBookPath: "book", dimensionMode: "or" },
        action: { model: "MODEL_REALESRGAN_X4PLUS_UP4X", scale: 1, tileSize: 0, noiseLevel: -1, gpuId: 0, skip: true },
      },
      {
        id: "anime",
        name: "Anime",
        enabled: true,
        priority: 1,
        match: { maxPixels: 12.4, dimensionMode: "or" },
        action: { model: "MODEL_REALESRGAN_ANIMAVIDEOV3_UP2X", scale: 2, tileSize: 0, noiseLevel: -1, gpuId: 0, skip: false },
      },
      {
        id: "unsupported",
        name: "Unsupported",
        enabled: false,
        priority: 2,
        match: { dimensionMode: "or" },
        action: { model: "MODEL_WAIFU2X_PHOTO_UP2X_DENOISE0X", scale: 2, skip: false },
      },
    ]))

    expect(result.conditions).toHaveLength(2)
    expect(result.conditions[0]).toMatchObject({
      id: "skip",
      priority: 0,
      match: { minMegapixels: 15, bookPathRegex: "book" },
      action: { skip: true, tileSize: undefined, noise: -1, gpuId: "0" },
    })
    expect(result.conditions[1]).toMatchObject({
      id: "anime",
      priority: 1,
      match: { maxMegapixels: 12.4 },
      action: { skip: false, modelId: "realesr-animevideov3", scale: 2, tileSize: undefined },
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("MODEL_WAIFU2X_PHOTO_UP2X_DENOISE0X")
  })
})
