import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderVideoController } from "../video/ReaderVideoController"
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
    expect(video?.controls).toBe(true)
    expect(controller.hasActiveVideo()).toBe(true)
    view.unmount()
    expect(controller.hasActiveVideo()).toBe(false)
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
