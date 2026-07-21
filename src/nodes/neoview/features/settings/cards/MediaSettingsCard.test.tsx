import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ReaderImageProcessingConfigDto,
  ReaderMediaConfigDto,
} from "../../../adapters/reader-http-client"
import { MediaSettingsCard } from "./MediaSettingsCard"

afterEach(cleanup)

describe("MediaSettingsCard image processing", () => {
  it("[neoview.settings.image-processing-controls] writes each feature through the dedicated patch contract", async () => {
    const onImageProcessing = vi.fn(async (patch: Partial<ReaderImageProcessingConfigDto>) => ({
      ...imageProcessing(),
      ...patch,
    }))
    render(
      <MediaSettingsCard
        media={media()}
        onMedia={vi.fn(async () => media())}
        imageProcessing={imageProcessing()}
        onImageProcessing={onImageProcessing}
      />,
    )

    fireEvent.click(screen.getByRole("switch", { name: "普通阅读器转换" }))
    await waitFor(() => expect(onImageProcessing).toHaveBeenCalledWith({ readerTransformEnabled: true }))

    const quality = screen.getByRole("spinbutton", { name: "缩略图质量" })
    fireEvent.change(quality, { target: { value: "67" } })
    fireEvent.blur(quality)
    await waitFor(() => expect(onImageProcessing).toHaveBeenLastCalledWith({ thumbnailQuality: 67 }))
  })

  it("disables subordinate controls when the master switch is off", () => {
    render(
      <MediaSettingsCard
        media={media()}
        onMedia={vi.fn(async () => media())}
        imageProcessing={{ ...imageProcessing(), enabled: false }}
        onImageProcessing={vi.fn(async () => imageProcessing())}
      />,
    )

    expect((screen.getByRole("switch", { name: "启用图像处理" }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole("switch", { name: "JXL 兼容转换" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("spinbutton", { name: "拼图质量" }) as HTMLInputElement).disabled).toBe(true)
  })

  it("clamps quality and exposes persistence failures", async () => {
    const onImageProcessing = vi.fn().mockRejectedValue(new Error("write failed"))
    render(
      <MediaSettingsCard
        media={media()}
        onMedia={vi.fn(async () => media())}
        imageProcessing={imageProcessing()}
        onImageProcessing={onImageProcessing}
      />,
    )

    const quality = screen.getByRole("spinbutton", { name: "JXL 质量" })
    fireEvent.change(quality, { target: { value: "150" } })
    fireEvent.blur(quality)

    await waitFor(() => expect(onImageProcessing).toHaveBeenCalledWith({ jxlQuality: 100 }))
    expect((await screen.findByRole("alert")).textContent).toContain("write failed")
  })
})

function imageProcessing(): ReaderImageProcessingConfigDto {
  return {
    enabled: true,
    readerTransformEnabled: false,
    jxlTransformEnabled: true,
    wicNativeEnabled: true,
    windowsShellNativeEnabled: true,
    thumbnailTransformEnabled: true,
    folderMosaicEnabled: true,
    sharpFallbackEnabled: false,
    jxlLossless: false,
    jxlQuality: 90,
    thumbnailLossless: false,
    thumbnailQuality: 82,
    mosaicLossless: false,
    mosaicQuality: 82,
  }
}

function media(): ReaderMediaConfigDto {
  return {
    supportedImageFormats: ["jpg", "webp", "jxl"],
    videoFormats: ["mp4", "webm"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled: false,
    animatedVideoKeywords: [],
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: {
      fontSize: 24,
      color: "#ffffff",
      backgroundOpacity: 0.7,
      bottomPercent: 5,
    },
  }
}
