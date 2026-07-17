import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  parseNeoviewMediaPatch,
  parseNeoviewRuntimeConfig,
} from "../../application/config/ReaderRuntimeConfig.js"
import { createReaderHttpController } from "../../platform.js"
import { loadNeoviewRuntimeConfig } from "./loadNeoviewRuntimeConfig.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader media runtime config", () => {
  it("[neoview.media.settings-schema] parses legacy-mapped TOML fields and emits one canonical patch", () => {
    expect(parseNeoviewRuntimeConfig({
      image: {
        supported_formats: ["jpg", "comicimage"],
        video_formats: ["mp4", "comicvideo"],
        media_mime_types: { comicimage: "image/webp", comicvideo: "video/mp4" },
        auto_play_animated_images: false,
        video_min_playback_rate: 0.5,
        video_max_playback_rate: 8,
        video_playback_rate_step: 0.5,
      },
      reader: { subtitle: { font_size: 1.5, color: "#FFFF00", bg_opacity: 0.8, bottom: 8 } },
    }).media).toEqual({
      supportedImageFormats: ["jpg", "comicimage"],
      videoFormats: ["mp4", "comicvideo"],
      mediaMimeTypes: { comicimage: "image/webp", comicvideo: "video/mp4" },
      autoPlayAnimatedImages: false,
      videoMinPlaybackRate: 0.5,
      videoMaxPlaybackRate: 8,
      videoPlaybackRateStep: 0.5,
      subtitle: { fontSize: 1.5, color: "#ffff00", backgroundOpacity: 0.8, bottomPercent: 8 },
    })

    expect(parseNeoviewMediaPatch({ media: {
      supportedImageFormats: ["jpg", "comicimage"],
      videoFormats: ["mp4", "comicvideo"],
      mediaMimeTypes: { comicimage: "image/webp", comicvideo: "video/mp4" },
      autoPlayAnimatedImages: false,
      videoMinPlaybackRate: 0.5,
      videoMaxPlaybackRate: 8,
      videoPlaybackRateStep: 0.5,
      subtitle: { fontSize: 1.5, color: "#ffff00", backgroundOpacity: 0.8, bottomPercent: 8 },
    } }).tomlPatch).toEqual({
      image: {
        supported_formats: ["jpg", "comicimage"],
        video_formats: ["mp4", "comicvideo"],
        media_mime_types: { comicimage: "image/webp", comicvideo: "video/mp4" },
        auto_play_animated_images: false,
        video_min_playback_rate: 0.5,
        video_max_playback_rate: 8,
        video_playback_rate_step: 0.5,
      },
      reader: { subtitle: { font_size: 1.5, color: "#ffff00", bg_opacity: 0.8, bottom: 8 } },
    })
    expect(() => parseNeoviewMediaPatch({ media: { videoMinPlaybackRate: 9, videoMaxPlaybackRate: 8 } })).toThrow("must not be less")
    expect(() => parseNeoviewMediaPatch({ media: { subtitle: { color: "red" } } })).toThrow("#RGB")
    expect(() => parseNeoviewMediaPatch({ media: { videoFormats: ["unknown"] } })).toThrow("explicit video/* MIME")
  })

  it("[neoview.media.settings-http] persists non-destructively and validates concurrent patches against the latest TOML state", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-media-config-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.image]",
      "future_image_option = \"keep\"",
      "[nodes.neoview.reader.subtitle]",
      "future_subtitle_option = \"keep\"",
      "",
    ].join("\n"), "utf8")
    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43126",
      token: "runtime-token",
      configPath,
      legacyThumbnailDatabasePath: false,
    })
    try {
      const initial = await request(controller, "GET")
      expect(await initial.json()).toMatchObject({ media: {
        autoPlayAnimatedImages: true,
        videoMinPlaybackRate: 0.25,
        videoMaxPlaybackRate: 16,
        videoPlaybackRateStep: 0.25,
        subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
      } })

      const [minimum, invalidMaximum] = await Promise.all([
        request(controller, "PATCH", { media: { videoMinPlaybackRate: 8 } }),
        request(controller, "PATCH", { media: { videoMaxPlaybackRate: 4 } }),
      ])
      expect(minimum.status).toBe(200)
      expect(invalidMaximum.status).toBe(400)
      expect(await invalidMaximum.json()).toMatchObject({ error: expect.stringContaining("must not be less") })

      const updated = await request(controller, "PATCH", { media: {
        autoPlayAnimatedImages: false,
        videoMaxPlaybackRate: 12,
        videoPlaybackRateStep: 0.5,
        subtitle: { fontSize: 1.5, color: "#ffff00", backgroundOpacity: 0.8, bottomPercent: 8 },
      } })
      expect(updated.status).toBe(200)
      expect(await updated.json()).toMatchObject({ media: {
        autoPlayAnimatedImages: false,
        videoMinPlaybackRate: 8,
        videoMaxPlaybackRate: 12,
        videoPlaybackRateStep: 0.5,
        subtitle: { fontSize: 1.5, color: "#ffff00", backgroundOpacity: 0.8, bottomPercent: 8 },
      } })
      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain("[nodes.neoview.image]")
      expect(toml).toContain("future_image_option = \"keep\"")
      expect(toml).toContain("video_min_playback_rate = 8")
      expect(toml).toContain("video_max_playback_rate = 12")
      expect(toml).toContain("[nodes.neoview.reader.subtitle]")
      expect(toml).toContain("future_subtitle_option = \"keep\"")
      expect(toml).toContain("font_size = 1.5")
      expect((await loadNeoviewRuntimeConfig({ configPath })).media).toMatchObject({
        autoPlayAnimatedImages: false,
        videoMinPlaybackRate: 8,
        videoMaxPlaybackRate: 12,
        subtitle: { color: "#ffff00", bottomPercent: 8 },
      })

      const customPath = join(root, "cover.comicimage")
      await writeFile(customPath, Uint8Array.of(1, 2, 3))
      const current = await (await request(controller, "GET")).json() as { media: {
        supportedImageFormats: string[]
        videoFormats: string[]
        mediaMimeTypes: Record<string, string>
      } }
      const formats = await request(controller, "PATCH", { media: {
        supportedImageFormats: [...current.media.supportedImageFormats, "comicimage"],
        videoFormats: current.media.videoFormats,
        mediaMimeTypes: { ...current.media.mediaMimeTypes, comicimage: "image/webp" },
      } })
      expect(formats.status).toBe(200)
      const browser = await readerRequest(controller, "/reader/browser/sessions", "POST", { path: root })
      expect(browser.status).toBe(201)
      expect(await browser.json()).toMatchObject({
        entries: expect.arrayContaining([expect.objectContaining({
          name: "cover.comicimage",
          readerSupported: true,
        })]),
      })
      const opened = await readerRequest(controller, "/reader/sessions", "POST", { path: customPath })
      expect(opened.status).toBe(201)
      const openedBody = await opened.json() as { sessionId: string }
      const pages = await readerRequest(controller, `/reader/s/${encodeURIComponent(openedBody.sessionId)}/pages`, "GET")
      expect(await pages.json()).toMatchObject({ pages: [{ name: "cover.comicimage", mimeType: "image/webp" }] })
      await readerRequest(controller, `/reader/s/${encodeURIComponent(openedBody.sessionId)}`, "DELETE")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function request(
  controller: Awaited<ReturnType<typeof createReaderHttpController>>,
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<Response> {
  return readerRequest(controller, "/reader/config", method, body)
}

function readerRequest(
  controller: Awaited<ReturnType<typeof createReaderHttpController>>,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<Response> {
  return controller.handle(new Request(`http://127.0.0.1:43126${path}`, {
    method,
    headers: {
      "x-xiranite-token": "runtime-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).then((response) => response!)
}
