import { describe, expect, it } from "vitest"

import { NeoViewImageProcessingRuntimePolicy, isNeoViewSharpEnabled } from "./SharpRuntimePolicy.js"

describe("SharpRuntimePolicy", () => {
  it("keeps Sharp opt-in while accepting conventional explicit enable values", () => {
    expect(isNeoViewSharpEnabled(undefined)).toBe(false)
    expect(isNeoViewSharpEnabled("0")).toBe(false)
    expect(isNeoViewSharpEnabled("false")).toBe(false)
    expect(isNeoViewSharpEnabled("1")).toBe(true)
    expect(isNeoViewSharpEnabled(" ON ")).toBe(true)
  })

  it("applies fine-grained runtime updates while retaining the emergency Sharp override", () => {
    const policy = new NeoViewImageProcessingRuntimePolicy({
      enabled: true,
      readerTransformEnabled: false,
      jxlTransformEnabled: true,
      wicNativeEnabled: true,
      windowsShellNativeEnabled: true,
      thumbnailTransformEnabled: true,
      folderMosaicEnabled: false,
      sharpFallbackEnabled: false,
      jxlLossless: false,
      jxlQuality: 90,
      thumbnailLossless: false,
      thumbnailQuality: 82,
      mosaicLossless: false,
      mosaicQuality: 82,
    })
    expect(policy.readerTransformEnabled).toBe(false)
    expect(policy.jxlTransformEnabled).toBe(true)
    expect(policy.sharpFallbackEnabled).toBe(false)
    policy.update({ ...policy.snapshot(), enabled: false, sharpFallbackEnabled: true })
    expect(policy.jxlTransformEnabled).toBe(false)
    expect(policy.sharpFallbackEnabled).toBe(false)
  })
})
