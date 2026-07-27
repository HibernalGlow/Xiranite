import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderVideoController } from "../video/ReaderVideoController"
import { PageMedia } from "./PageMedia"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("[neoview.animated-video.browser-controls] opens an animated image with shared playback controls", async () => {
  installImageDecoder(2)
  await render(<PageMedia page={animatedPage()} media={media(true)} videoController={new ReaderVideoController()} onVideoListEnded={() => undefined} />)

  await expect.element(page.getByRole("region", { name: "动图视频播放器" })).toBeVisible()
  await expect.element(page.getByRole("group", { name: "动图视频控制栏" })).toBeVisible()
  await page.getByRole("button", { name: "暂停" }).click()
  await expect.element(page.getByRole("button", { name: "播放" })).toBeVisible()
})

test("[neoview.animated-video.browser-static-fallback] leaves a static candidate on the existing image renderer", async () => {
  installImageDecoder(1)
  await render(<PageMedia page={animatedPage()} media={media(true)} videoController={new ReaderVideoController()} onVideoListEnded={() => undefined} />)

  await expect.poll(() => document.querySelector("img")?.getAttribute("src")).toBe("/reader/animated.gif")
  expect(document.querySelector("[data-reader-animated-video-player]")) .toBeNull()
})

function installImageDecoder(frameCount: number): void {
  const context = { clearRect: vi.fn(), drawImage: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/gif" } })))
  vi.stubGlobal("ImageDecoder", class {
    static isTypeSupported = vi.fn(async () => true)
    readonly completed = Promise.resolve()
    readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount } }
    async decode() {
      return { image: { displayWidth: 4, displayHeight: 3, duration: 100_000, close: vi.fn() } }
    }
    close() {}
  })
}

function animatedPage(): ReaderPageDto {
  return {
    id: "animated-page",
    index: 0,
    name: "animated.gif",
    mediaKind: "animated-image",
    contentVersion: "v1",
    assetUrl: "/reader/animated.gif",
  }
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
