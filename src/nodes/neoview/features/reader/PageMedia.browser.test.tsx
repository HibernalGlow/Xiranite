import { afterEach, expect, test, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderVideoController } from "../video/ReaderVideoController"
import { PageMedia } from "./PageMedia"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("[neoview.animated-video.browser-controls] opens an animated image with shared playback controls", async () => {
  installImageDecoder(4)
  const controller = new ReaderVideoController()
  await render(
    <div>
      <div data-testid="outside-player" className="size-4" />
      <div className="h-90 w-160">
        <PageMedia page={animatedPage()} media={media(true)} videoController={controller} onVideoListEnded={() => undefined} />
      </div>
    </div>,
  )

  const player = page.getByRole("region", { name: "动图视频播放器" })
  const controls = page.getByRole("group", { name: "动图视频控制栏" })
  await expect.element(player).toBeVisible()
  await player.hover()
  await expect.element(controls).toBeVisible()
  await page.getByTestId("outside-player").hover()
  await expect.poll(() => document.querySelector("[data-reader-animated-video-controls]")?.classList.contains("opacity-0")).toBe(true)
  await player.hover()
  await expect.element(controls).toBeVisible()
  const progress = page.getByRole("slider", { name: "动图进度" })
  await expect.element(progress).toBeVisible()
  await expect.element(progress).toHaveAttribute("aria-valuemax", "4")
  await page.getByRole("button", { name: "暂停" }).click()
  await expect.element(page.getByRole("button", { name: "播放" })).toBeVisible()
  await progress.click()
  await userEvent.keyboard("{End}")
  await expect.poll(() => controller.getSnapshot().currentTime).toBe(4)
  await expect.element(progress).toHaveAttribute("aria-valuenow", "4")
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
    async decode({ frameIndex }: { frameIndex: number }) {
      return { image: { displayWidth: 4, displayHeight: 3, timestamp: frameIndex * 1_000_000, duration: 1_000_000, close: vi.fn() } }
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
