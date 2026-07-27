import { describe, expect, it } from "vitest"

import type { ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"
import { shouldOpenAnimatedImageAsVideo } from "./animated-image-video-mode"

describe("shouldOpenAnimatedImageAsVideo", () => {
  it("[neoview.animated-video.match] requires the switch and accepts animated types, APNG, and explicit markers", () => {
    expect(shouldOpenAnimatedImageAsVideo(page("animated-image", "motion.gif"), media(false))).toBe(false)
    expect(shouldOpenAnimatedImageAsVideo(page("animated-image", "motion.gif"), media(true))).toBe(true)
    expect(shouldOpenAnimatedImageAsVideo(page("image", "motion.apng"), media(true))).toBe(true)
    expect(shouldOpenAnimatedImageAsVideo(page("image", "[#dyna] motion.webp.wbp"), media(true))).toBe(true)
    expect(shouldOpenAnimatedImageAsVideo(page("image", "cover.webp"), media(true))).toBe(false)
  })
})

function page(mediaKind: ReaderPageDto["mediaKind"], name: string): ReaderPageDto {
  return { id: name, index: 0, name, mediaKind, contentVersion: "v1", assetUrl: "/reader/asset" }
}

function media(animatedVideoEnabled: boolean): ReaderMediaConfigDto {
  return {
    supportedImageFormats: [],
    videoFormats: ["mp4"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled,
    animatedVideoKeywords: ["[#dyna]"],
    videoControlsPinned: false,
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}
