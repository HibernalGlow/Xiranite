import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanupDirectories: string[] = []
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderHttpController", () => {
  it("[neoview.control.session] opens, pages, navigates and closes without exposing local paths", async () => {
    const directory = await createBookDirectory()
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const unauthorized = await controller.handle(jsonRequest("/reader/sessions", { path: directory }, false))
      expect(unauthorized?.status).toBe(401)

      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory, initialPage: 1 })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      expect(session.book).toMatchObject({ displayName: expect.any(String), pageCount: 3 })
      expect(session.frame.anchorPageIndex).toBe(1)
      expect(session.visiblePages[0]?.name).toBe("2.jpg")
      expect(JSON.stringify(session)).not.toContain(directory)

      const pagesResponse = (await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/pages?cursor=1&limit=1`,
      )))!
      const pageList = await pagesResponse.json() as { pages: Array<{ name: string; assetUrl: string }>; nextCursor: number }
      expect(pageList.pages.map((page) => page.name)).toEqual(["2.jpg"])
      expect(pageList.nextCursor).toBe(2)
      expect(pageList.pages[0]!.assetUrl).toContain("token=reader-token")

      const asset = (await controller.handle(new Request(pageList.pages[0]!.assetUrl)))!
      expect(new Uint8Array(await asset.arrayBuffer())).toEqual(Uint8Array.of(2))

      const navigated = (await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/navigate`,
        { action: "next" },
      )))!
      expect((await navigated.json() as { frame: { anchorPageIndex: number } }).frame.anchorPageIndex).toBe(2)

      const closed = (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))!
      expect(closed.status).toBe(204)
      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`)))?.status).toBe(404)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.validation] rejects malformed open and navigation payloads", async () => {
    const directory = await createBookDirectory()
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: "" })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: directory, initialPage: -1 })))?.status).toBe(400)
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const { sessionId } = await opened.json() as ReaderSessionDto
      expect((await controller.handle(jsonRequest(`/reader/s/${sessionId}/navigate`, { action: "goTo" })))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.image.transform-http] streams a native transform through the controller response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-transform-"))
    cleanupDirectories.push(directory)
    await writeFile(join(directory, "page.png"), ONE_PIXEL_PNG)
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const session = await opened.json() as ReaderSessionDto
      const url = new URL(session.visiblePages[0]!.assetUrl)
      url.searchParams.set("width", "1")
      url.searchParams.set("format", "webp")
      const response = (await controller.handle(new Request(url)))!
      const bytes = Buffer.from(await response.arrayBuffer())
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/webp")
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function createBookDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-control-"))
  cleanupDirectories.push(directory)
  await Promise.all([
    writeFile(join(directory, "1.jpg"), Uint8Array.of(1)),
    writeFile(join(directory, "2.jpg"), Uint8Array.of(2)),
    writeFile(join(directory, "3.jpg"), Uint8Array.of(3)),
  ])
  return directory
}

function jsonRequest(path: string, body: unknown, authorized = true): Request {
  return authorizedRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, authorized)
}

function authorizedRequest(path: string, init: RequestInit = {}, authorized = true): Request {
  const headers = new Headers(init.headers)
  if (authorized) headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
