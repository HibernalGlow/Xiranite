import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderMediaConfigDto } from "../../../adapters/reader-http-client"
import AnimatedVideoModeCard from "./AnimatedVideoModeCard"

afterEach(cleanup)

describe("AnimatedVideoModeCard", () => {
  it("[neoview.animated-video.resident] renders the source control hierarchy without a book session", () => {
    render(<AnimatedVideoModeCard media={media()} onMediaChange={vi.fn(async () => media())} />)

    expect(screen.getByRole("switch", { name: "启用动图视频模式" })).toBeTruthy()
    expect((screen.getByRole("textbox", { name: "动图关键词" }) as HTMLTextAreaElement).value).toBe("[#dyna]")
    expect(screen.getByText("FFmpeg", { exact: true })).toBeTruthy()
    expect(screen.getByRole("button", { name: "重新检测 FFmpeg" })).toBeTruthy()
  })

  it("[neoview.animated-video.settings] persists the toggle and normalized keyword list", async () => {
    const onMediaChange = vi.fn(async (patch) => ({ ...media(), ...patch }))
    render(<AnimatedVideoModeCard media={media()} onMediaChange={onMediaChange} />)

    fireEvent.click(screen.getByRole("switch", { name: "启用动图视频模式" }))
    fireEvent.change(screen.getByRole("textbox", { name: "动图关键词" }), { target: { value: " [#GIF], #gif, [#dyna] " } })

    await waitFor(() => expect(onMediaChange).toHaveBeenLastCalledWith({ animatedVideoKeywords: ["[#gif]", "#gif", "[#dyna]"] }))
    expect(onMediaChange).toHaveBeenCalledWith({ animatedVideoEnabled: true })
  })

  it("[neoview.animated-video.ffmpeg] keeps the host probe state honest when no probe is provided", async () => {
    render(<AnimatedVideoModeCard media={media()} />)
    fireEvent.click(screen.getByRole("button", { name: "重新检测 FFmpeg" }))
    await waitFor(() => expect(screen.getByText("当前运行时未提供 FFmpeg 探测")).toBeTruthy())
    expect(screen.getByText("不可用", { exact: true })).toBeTruthy()
  })
})

function media(): ReaderMediaConfigDto {
  return {
    supportedImageFormats: [],
    videoFormats: ["mp4"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled: false,
    animatedVideoKeywords: ["[#dyna]"],
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}
