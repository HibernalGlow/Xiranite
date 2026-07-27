import { useState } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderMediaConfigDto, ReaderMediaPatchDto } from "../../../adapters/reader-http-client"
import { MediaSettingsCard } from "./MediaSettingsCard"

test("[neoview.media-settings.custom-aliases] persists custom image and video suffixes with their real MIME types", async () => {
  const save = vi.fn()
  await render(<MediaSettingsHarness onSave={save} />)

  await page.getByRole("textbox", { name: "添加图片伪装后缀" }).fill(".wbp")
  await page.getByRole("combobox", { name: "添加图片实际 MIME 类型" }).fill("image/webp")
  await page.getByRole("button", { name: "添加图片格式" }).click()
  await expect.poll(() => save.mock.calls.length).toBe(1)
  expect(save.mock.calls[0]?.[0]).toEqual({
    supportedImageFormats: ["jpg", "wbp"],
    mediaMimeTypes: { wbp: "image/webp" },
  })
  await expect.element(page.getByText(".wbp")).toBeVisible()

  await page.getByRole("textbox", { name: "添加视频伪装后缀" }).fill("nov")
  await page.getByRole("combobox", { name: "添加视频实际 MIME 类型" }).fill("video/mp4")
  await page.getByRole("button", { name: "添加视频格式" }).click()
  await expect.poll(() => save.mock.calls.length).toBe(2)
  expect(save.mock.calls[1]?.[0]).toEqual({
    videoFormats: ["mp4", "nov"],
    mediaMimeTypes: { wbp: "image/webp", nov: "video/mp4" },
  })

  await page.getByRole("button", { name: "移除图片格式 .wbp" }).click()
  await expect.poll(() => save.mock.calls.length).toBe(3)
  expect(save.mock.calls[2]?.[0]).toEqual({
    supportedImageFormats: ["jpg"],
    mediaMimeTypes: { nov: "video/mp4" },
  })
})

test("[neoview.media-settings.animated-video-mode] persists the animated-image playback switch", async () => {
  const save = vi.fn()
  await render(<MediaSettingsHarness onSave={save} />)

  await page.getByRole("switch", { name: "动图视频模式" }).click()
  await expect.poll(() => save.mock.calls.length).toBe(1)
  expect(save.mock.calls[0]?.[0]).toEqual({ animatedVideoEnabled: true })
})

function MediaSettingsHarness({ onSave }: { onSave(patch: ReaderMediaPatchDto["media"]): void }) {
  const [media, setMedia] = useState<ReaderMediaConfigDto>(initialMedia())
  return (
    <MediaSettingsCard
      media={media}
      onMedia={async (patch) => {
        const updated = { ...media, ...patch, subtitle: { ...media.subtitle, ...patch.subtitle } }
        setMedia(updated)
        onSave(patch)
        return updated
      }}
    />
  )
}

function initialMedia(): ReaderMediaConfigDto {
  return {
    supportedImageFormats: ["jpg"],
    videoFormats: ["mp4"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled: false,
    animatedVideoKeywords: [],
    videoControlsPinned: false,
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 24, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}
