import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_IMAGE_TRIM } from "@xiranite/node-neoview/ui-core"

vi.mock("media-chrome/react", () => import("@/test/media-chrome-react-stub"))

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderVideoController } from "../video/ReaderVideoController"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { createReaderImageTrimStore } from "../image-trim/ReaderImageTrimStore"
import { PageMedia } from "./PageMedia"

describe("PageMedia", () => {
  it("[neoview.bindings.video-surface] renders a native video control target in the video input context", () => {
    const controller = new ReaderVideoController()
    const view = render(<PageMedia
      page={page("video")}
      videoController={controller}
      onVideoListEnded={() => undefined}
    />)

    const video = view.container.querySelector("video")
    expect(video?.getAttribute("src")).toBe("/reader/video")
    expect(video?.dataset.inputContext).toBe("video")
    expect(video?.controls).toBe(false)
    expect(view.container.querySelector("media-controller")).toBeTruthy()
    expect(view.container.querySelector('[data-reader-video-controls="true"]')).toBeTruthy()
    expect(controller.hasActiveVideo()).toBe(true)
    fireEvent.loadedMetadata(video!)
    fireEvent.mouseMove(view.getByRole("region", { name: "视频播放器" }))
    expect(view.getByRole("group", { name: "视频控制栏" }).className).toContain("opacity-100")
    view.unmount()
    expect(controller.hasActiveVideo()).toBe(false)
  })

  it("[neoview.video.lifecycle-react] restores progress, mounts discovered subtitles and flushes on unmount", async () => {
    const updateMediaProgress = vi.fn(async (_sessionId, progress) => ({ ...progress, updatedAt: 2 }))
    const client = {
      subtitleTracks: vi.fn(async () => [{ id: "sub-1", name: "video.zh.srt", format: "srt" as const, contentVersion: "sv1", assetUrl: "/reader/subtitle.vtt" }]),
      mediaProgress: vi.fn(async () => ({ position: 12, duration: 100, completed: false, updatedAt: 1 })),
      updateMediaProgress,
    } as unknown as ReaderHttpClient
    const view = render(<PageMedia
      page={page("video")}
      videoController={new ReaderVideoController()}
      sessionId="session-1"
      client={client}
      media={mediaConfig()}
      onSubtitleConfigChange={async () => undefined}
      onVideoListEnded={() => undefined}
    />)
    const video = view.container.querySelector("video")!
    Object.defineProperty(video, "duration", { configurable: true, value: 100 })
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 })

    await waitFor(() => expect(view.container.querySelector('track[src="/reader/subtitle.vtt"]')).toBeTruthy())
    await waitFor(() => expect(video.currentTime).toBe(12))
    fireEvent.timeUpdate(video)
    await waitFor(() => expect(updateMediaProgress).toHaveBeenCalledWith("session-1", expect.objectContaining({ position: 12, duration: 100 }), false))
    view.unmount()
    await waitFor(() => expect(updateMediaProgress).toHaveBeenCalledWith("session-1", expect.objectContaining({ position: 12, duration: 100 }), true))
  })

  it("keeps image pages on the existing image renderer", () => {
    const view = render(<PageMedia
      page={page("image")}
      videoController={new ReaderVideoController()}
      onVideoListEnded={() => undefined}
    />)
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/reader/image")
    expect(view.container.querySelector("video")).toBeNull()
  })

  it("[neoview.image-trim.media] applies the shared crop contract to animated images on the existing img chain", () => {
    const snapshot = { ...DEFAULT_READER_IMAGE_TRIM, enabled: true, top: 5, right: 10, bottom: 15, left: 20 }
    const imageTrim = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    } as unknown as ReaderImageTrimPort
    const animatedPage = { ...page("image"), name: "animated.gif", mimeType: "image/gif" }
    const view = render(<PageMedia
      page={animatedPage}
      imageTrim={imageTrim}
      videoController={new ReaderVideoController()}
      onVideoListEnded={() => undefined}
    />)

    const image = view.container.querySelector("img")
    expect(image?.getAttribute("src")).toBe("/reader/image")
    expect(image?.style.clipPath).toBe("inset(5% 10% 15% 20%)")
    expect(view.container.querySelector("canvas")).toBeNull()
  })

  it("[neoview.image-trim.video] applies manual crop to video without registering a duplicate image detector", async () => {
    const store = createReaderImageTrimStore({ persist: async (settings) => settings })
    store.hydrate({ ...DEFAULT_READER_IMAGE_TRIM, enabled: true, top: 5, right: 10, bottom: 15, left: 20 })
    const view = render(<PageMedia
      page={{ ...page("video"), mimeType: "video/mp4", dimensions: { width: 1920, height: 1080 } }}
      imageTrim={store}
      scale={0.5}
      rotation={90}
      videoController={new ReaderVideoController()}
      onVideoListEnded={() => undefined}
    />)

    const video = view.container.querySelector("video")!
    expect(video.style.clipPath).toBe("inset(5% 10% 15% 20%)")
    expect(video.style.transform).toContain("rotate(90deg)")
    await expect(store.autoDetect()).resolves.toEqual({ status: "unavailable" })

    await act(async () => store.update({ top: 10 }))
    expect(video.style.clipPath).toBe("inset(10% 10% 15% 20%)")
    expect(view.container.querySelector("canvas")).toBeNull()
    store.dispose()
  })
})

function page(mediaKind: "image" | "video"): ReaderPageDto {
  return {
    id: `page-${mediaKind}`,
    index: 0,
    name: `${mediaKind}.bin`,
    mediaKind,
    contentVersion: "v1",
    assetUrl: `/reader/${mediaKind}`,
  }
}

function mediaConfig(): ReaderMediaConfigDto {
  return {
    supportedImageFormats: [],
    videoFormats: ["mp4"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}
