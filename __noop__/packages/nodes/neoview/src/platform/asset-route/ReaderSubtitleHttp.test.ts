import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader subtitle HTTP", () => {
  it("[neoview.subtitle.directory-http] discovers a language-suffixed adjacent SRT and serves immutable WebVTT", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-subtitle-directory-"))
    cleanupDirectories.push(directory)
    const videoPath = join(directory, "clip.mp4")
    await writeFile(videoPath, Uint8Array.of(0, 1, 2, 3))
    await writeFile(join(directory, "clip.zh-CN.srt"), "1\n00:00:01,000 --> 00:00:02,500\n你好，Xiranite\n")
    await writeFile(join(directory, "other.srt"), "1\n00:00:00,000 --> 00:00:01,000\n不应匹配\n")

    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const session = await open(controller, videoPath)
      const page = session.visiblePages[0]!
      const response = (await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/subtitles?pageId=${encodeURIComponent(page.id)}`,
      )))!
      expect(response.status).toBe(200)
      const payload = await response.json() as { tracks: Array<{ name: string; format: string; assetUrl: string }> }
      expect(payload.tracks).toHaveLength(1)
      expect(payload.tracks[0]).toMatchObject({ name: "clip.zh-CN.srt", format: "srt" })
      expect(payload.tracks[0]!.assetUrl).not.toContain(directory)

      const asset = (await controller.handle(new Request(payload.tracks[0]!.assetUrl)))!
      expect(asset.status).toBe(200)
      expect(asset.headers.get("content-type")).toBe("text/vtt; charset=utf-8")
      expect(asset.headers.get("cache-control")).toContain("immutable")
      const vtt = await asset.text()
      expect(vtt).toContain("WEBVTT")
      expect(vtt).toContain("00:00:01.000 --> 00:00:02.500")
      expect(vtt).toContain("你好，Xiranite")

      const cached = (await controller.handle(new Request(payload.tracks[0]!.assetUrl, {
        headers: { "if-none-match": asset.headers.get("etag")! },
      })))!
      expect(cached.status).toBe(304)
      expect(await cached.text()).toBe("")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.subtitle.archive-http] converts a same-directory ASS entry without exposing archive paths", async () => {
    const archive = await createZipFixture({
      name: "subtitle.cbz",
      entries: [
        { path: "media/clip.mp4", bytes: Uint8Array.of(0, 1, 2), level: 6 },
        { path: "media/clip.ass", bytes: new TextEncoder().encode(ASS_SUBTITLE), level: 6 },
        { path: "other/clip.srt", bytes: new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nwrong\n"), level: 6 },
      ],
    })
    cleanupArchives.push(archive)
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const session = await open(controller, archive.path)
      const page = session.visiblePages[0]!
      const response = (await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/subtitles?pageId=${encodeURIComponent(page.id)}`,
      )))!
      const payload = await response.json() as { tracks: Array<{ name: string; assetUrl: string }> }
      expect(payload.tracks).toHaveLength(1)
      expect(payload.tracks[0]!.name).toBe("clip.ass")
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(archive.path)
      expect(serialized).not.toContain("media/clip.ass")

      const asset = (await controller.handle(new Request(payload.tracks[0]!.assetUrl)))!
      expect(asset.status).toBe(200)
      const vtt = await asset.text()
      expect(vtt).toContain("WEBVTT")
      expect(vtt).toContain("00:00:01.000 --> 00:00:03.000")
      expect(vtt).toContain("Archive subtitle")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

const ASS_SUBTITLE = `[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Archive subtitle\n`

async function open(controller: ReaderHttpController, path: string): Promise<ReaderSessionDto> {
  const response = (await controller.handle(authorizedRequest("/reader/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })))!
  expect(response.status).toBe(201)
  return response.json() as Promise<ReaderSessionDto>
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
