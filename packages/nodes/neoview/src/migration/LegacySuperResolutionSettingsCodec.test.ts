import { describe, expect, it } from "vitest"

import { LegacySuperResolutionSettingsCodec } from "./LegacySuperResolutionSettingsCodec.js"

describe("LegacySuperResolutionSettingsCodec", () => {
  const codec = new LegacySuperResolutionSettingsCodec()

  it("[neoview.super-resolution.legacy-preferences] separates UI preferences from provider capability", () => {
    const decoded = codec.decodeNativeImage({
      enableSuperResolution: false,
      currentImageUpscaleEnabled: true,
      superResolutionModel: "MODEL_REALESRGAN_ANIMAVIDEOV3_UP2X",
    }, "nativeSettings.image")

    expect(decoded.preferencesPatch).toEqual({
      schema_version: 1,
      current_image_upscale_enabled: true,
      default_model_id: "realesr-animevideov3",
      default_scale: 2,
      default_tta: false,
    })
    expect(JSON.stringify(decoded)).not.toContain("provider")
  })

  it("[neoview.super-resolution.legacy-conditions] preserves expressions and only emits executable actions", () => {
    const decoded = codec.decodePanel({
      autoUpscaleEnabled: true,
      preUpscaleEnabled: false,
      preloadPages: 5,
      backgroundConcurrency: 2,
      selectedModel: "MODEL_REALCUGAN_SE_UP3X_DENOISE2X",
      scale: 3,
      conditionsList: [{
        id: "cos-condition",
        name: "COS",
        enabled: true,
        priority: 1,
        match: {
          maxPixels: 12.5,
          dimensionMode: "or",
          regexBookPath: ".*02cos.*",
          matchInnerPath: true,
          metadata: { artist: { operator: "contains", value: "alice" } },
        },
        action: {
          model: "MODEL_REALESRGAN_X4PLUS_ANIME_UP4X",
          scale: 4,
          tileSize: 256,
          tileEnabled: true,
          noiseLevel: 0,
          gpuId: 1,
          useCache: true,
        },
      }, {
        id: "skip-large",
        name: "Skip large",
        enabled: true,
        priority: 2,
        match: { minWidth: 4_096 },
        action: { skip: true, useCache: false },
      }, {
        id: "unresolved",
        name: "MangaJaNai",
        enabled: true,
        priority: 3,
        match: {},
        action: { model: "MANGAJANAI_AUTO_X2", scale: 2 },
      }],
    }, "extended.upscalePanelSettings")

    expect(decoded.preferencesPatch).toMatchObject({
      schema_version: 1,
      auto_upscale_enabled: true,
      pre_upscale_enabled: false,
      preload_pages: 5,
      background_concurrency: 2,
      default_model_id: "realcugan",
      default_scale: 3,
      default_noise: 2,
      conditions: [{
        id: "cos-condition",
        match: {
          max_megapixels: 12.5,
          dimension_mode: "or",
          book_path_regex: ".*02cos.*",
          match_inner_path: true,
          metadata: { artist: { operator: "contains", value: "alice" } },
        },
        action: {
          skip: false,
          model_id: "realesrgan-x4plus-anime",
          scale: 4,
          tile_size: 256,
          tile_enabled: true,
          noise: 0,
          gpu_id: "1",
          use_cache: true,
          tta: false,
        },
      }, {
        id: "skip-large",
        action: { skip: true, use_cache: false },
      }],
    })
    expect(decoded.preferencesPatch.conditions).toHaveLength(2)
    expect(decoded.entries).toContainEqual(expect.objectContaining({
      sourcePath: "extended.upscalePanelSettings.conditionsList[2].action.model",
      disposition: "unknown",
    }))
  })

  it("[neoview.super-resolution.legacy-validation] rejects invalid ranges and regular expressions", () => {
    const decoded = codec.decodePanel({
      backgroundConcurrency: 0,
      conditionsList: [{
        id: "bad-regex",
        name: "bad",
        enabled: true,
        priority: 0,
        match: { regexBookPath: "[" },
        action: { skip: true },
      }],
    }, "rawLocalStorage.pyo3_upscale_settings")

    expect(decoded.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "rawLocalStorage.pyo3_upscale_settings.backgroundConcurrency", disposition: "invalid" }),
      expect.objectContaining({ sourcePath: "rawLocalStorage.pyo3_upscale_settings.conditionsList[0]", disposition: "invalid" }),
    ]))
  })
})
