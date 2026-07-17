import { mkdtemp, readdir, rm } from "node:fs/promises"
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

describe("Reader archive media Range", () => {
  it("[neoview.media.archive-range] materializes an archive video once for GUI seek requests and releases it with the session", async () => {
    const videoBytes = Uint8Array.from({ length: 32 }, (_, index) => index)
    const archive = await createZipFixture({
      name: "media.cbz",
      entries: [{ path: "media/clip.mp4", bytes: videoBytes, level: 6 }],
    })
    cleanupArchives.push(archive)
    const tempDirectory = await mkdtemp(join(tmpdir(), "xiranite-neoview-media-range-"))
    cleanupDirectories.push(tempDirectory)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      archiveTempDirectory: tempDirectory,
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: archive.path })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      expect(session.visiblePages[0]).toMatchObject({ mediaKind: "video", byteLength: videoBytes.byteLength })

      const head = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl, { method: "HEAD" })))!
      expect(head.status).toBe(200)
      expect(head.headers.get("accept-ranges")).toBe("bytes")
      expect(head.headers.get("content-length")).toBe(String(videoBytes.byteLength))
      expect(await readdir(tempDirectory)).toHaveLength(1)

      const range = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl, {
        headers: { range: "bytes=7-13" },
      })))!
      expect(range.status).toBe(206)
      expect(range.headers.get("content-range")).toBe(`bytes 7-13/${videoBytes.byteLength}`)
      expect(new Uint8Array(await range.arrayBuffer())).toEqual(videoBytes.slice(7, 14))
      expect(await readdir(tempDirectory)).toHaveLength(1)

      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect(await readdir(tempDirectory)).toEqual([])
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function jsonRequest(path: string, body: unknown): Request {
  return authorizedRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
