import { describe, expect, it } from "vitest"

import {
  DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG,
  parseNeoviewImageProcessingConfig,
  parseNeoviewImageProcessingPatch,
} from "./ReaderImageProcessingConfig.js"

describe("ReaderImageProcessingConfig", () => {
  it("defaults to HTTP reader passthrough with native lossy thumbnails", () => {
    expect(parseNeoviewImageProcessingConfig(undefined)).toEqual(DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG)
  })

  it("reads the canonical section and validates quality bounds", () => {
    expect(parseNeoviewImageProcessingConfig({
      reader_transform_enabled: true,
      jxl_lossless: true,
      jxl_quality: 100,
      folder_mosaic_enabled: true,
    })).toMatchObject({
      readerTransformEnabled: true,
      jxlLossless: true,
      jxlQuality: 100,
      folderMosaicEnabled: true,
    })
    expect(() => parseNeoviewImageProcessingConfig({ thumbnail_quality: 0 })).toThrow("1 to 100")
  })

  it("projects a strict camelCase PATCH into sectioned snake_case TOML", () => {
    expect(parseNeoviewImageProcessingPatch({ imageProcessing: {
      windowsShellNativeEnabled: false,
      thumbnailLossless: false,
      thumbnailQuality: 76,
      sharpFallbackEnabled: true,
    } })).toEqual({
      patch: { imageProcessing: {
        windowsShellNativeEnabled: false,
        thumbnailLossless: false,
        thumbnailQuality: 76,
        sharpFallbackEnabled: true,
      } },
      tomlPatch: { image: { processing: {
        windows_shell_native_enabled: false,
        thumbnail_lossless: false,
        thumbnail_quality: 76,
        sharp_fallback_enabled: true,
      } } },
    })
    expect(() => parseNeoviewImageProcessingPatch({ imageProcessing: { unknown: true } })).toThrow("Unknown")
  })
})
