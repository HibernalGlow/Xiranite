import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderHttpController", () => {
  it("[neoview.settings.shell-http] protects and returns only normalized shell settings", async () => {
    const updateShellOptions = vi.fn(async (patch) => ({
      showDelayMs: 50,
      hideDelayMs: 200,
      opacity: { top: 80, bottom: 70, sidebar: 60 },
      blur: { top: 1, bottom: 2, sidebar: 3 },
      edges: {
        top: { enabled: true, initialVisible: false, pinned: false, triggerSize: 4 },
        right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 5 },
        bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6 },
        left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 7 },
      },
      sidebars: {
        left: { width: "side" in patch && patch.side === "left" && patch.width ? patch.width : 333, height: "half" as const, customHeight: 100, verticalAlign: 50, horizontalPosition: 0 },
        right: { width: 277, height: "full" as const, customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      },
      panelLayout: {},
      cardLayout: {
        "page-navigation": { panelId: "pageList", visible: true, expanded: "cardId" in patch ? patch.expanded ?? true : true, order: 0 },
      },
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      shellOptions: {
        showDelayMs: 50,
        hideDelayMs: 200,
        opacity: { top: 80, bottom: 70, sidebar: 60 },
        blur: { top: 1, bottom: 2, sidebar: 3 },
        edges: {
          top: { enabled: true, initialVisible: false, pinned: false, triggerSize: 4 },
          right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 5 },
          bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6 },
          left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 7 },
        },
        sidebars: {
          left: { width: 333, height: "half", customHeight: 100, verticalAlign: 50, horizontalPosition: 0 },
          right: { width: 277, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
        },
      },
      updateShellOptions,
    })
    try {
      expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/config")))?.status).toBe(401)
      const response = (await controller.handle(authorizedRequest("/reader/config")))!
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ schemaVersion: 1, shell: { showDelayMs: 50, sidebars: { left: { width: 333 } } } })
      expect(JSON.stringify(body)).not.toMatch(/path|token|password/i)
      const patched = (await controller.handle(jsonRequest("/reader/config", { side: "left", width: 401 }, true, "PATCH")))!
      expect(patched.status).toBe(200)
      expect(await patched.json()).toMatchObject({ shell: { sidebars: { left: { width: 401 } } } })
      expect(updateShellOptions).toHaveBeenCalledWith(
        { side: "left", width: 401 },
        { panels: { sidebars: { left: { width: 401 } } } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", { side: "left", width: 999 }, true, "PATCH")))?.status).toBe(400)
      const cardPatched = (await controller.handle(jsonRequest("/reader/config", { cardId: "page-navigation", expanded: false }, true, "PATCH")))!
      expect(await cardPatched.json()).toMatchObject({ shell: { cardLayout: { "page-navigation": { expanded: false } } } })
      expect(updateShellOptions).toHaveBeenLastCalledWith(
        { cardId: "page-navigation", expanded: false },
        { panels: { card_state: { "page-navigation": { expanded: false } } } },
      )
      const board = {
        board: {
          panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
          cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
        },
      }
      expect((await controller.handle(jsonRequest("/reader/config", board, true, "PATCH")))?.status).toBe(200)
      expect(updateShellOptions).toHaveBeenLastCalledWith(board, {
        panels: {
          panel_state: { pageList: { visible: true, order: 0, position: "left" } },
          card_state: { "book-information": { visible: true, order: 0, panel_id: "pageList" } },
        },
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.thumbnail.http] [neoview.thumbnail.batch-prewarm] publishes thumbnail DTOs and disposes its owned store", async () => {
    const directory = await createBookDirectory()
    const disposeThumbnailStore = vi.fn(async () => undefined)
    const get = vi.fn(async () => ({ bytes: Uint8Array.of(1, 2, 3), contentType: "image/webp" }))
    const getMany = vi.fn(async (keys: readonly string[]) => new Map(keys.map((key) => [key, { bytes: Uint8Array.of(1, 2, 3), contentType: "image/webp" }])))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      thumbnailStore: { get, getMany },
      disposeThumbnailStore,
    })
    const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
    const session = await opened.json() as ReaderSessionDto
    expect(JSON.stringify(session)).not.toContain("thumbnailSource")
    const thumbnailUrl = session.visiblePages[0]?.thumbnailUrl
    expect(thumbnailUrl).toContain(`/reader/s/${session.sessionId}/thumbnail/`)
    expect(thumbnailUrl).not.toContain(directory)
    expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/pages?cursor=0&limit=3`)))?.status).toBe(200)
    const thumbnail = (await controller.handle(new Request(thumbnailUrl!)))!
    expect(new Uint8Array(await thumbnail.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    await controller[Symbol.asyncDispose]()
    expect(getMany).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    expect(disposeThumbnailStore).toHaveBeenCalledOnce()
  })

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
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: directory, entryPaths: [] })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        entryPath: "inner.cbz",
        entryPaths: ["inner.cbz"],
      })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        password: "a",
        archivePasswords: [{ password: "b" }],
      })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        archivePasswords: [{ password: "a" }, { password: "b" }],
      })))?.status).toBe(400)
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const { sessionId } = await opened.json() as ReaderSessionDto
      expect((await controller.handle(jsonRequest(`/reader/s/${sessionId}/navigate`, { action: "goTo" })))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.nested-archive] opens and streams an inner archive without exposing materialized paths", async () => {
    const nestedPassword = "nested-session-secret"
    const inner = await createZipFixture({
      name: "inner.cbz",
      entries: [{ path: "pages/1.png", bytes: ONE_PIXEL_PNG, level: 0, password: nestedPassword }],
    })
    const outer = await createZipFixture({
      name: "outer.cbz",
      entries: [{ path: "nested/inner.cbz", bytes: inner.bytes, level: 6 }],
    })
    cleanupArchives.push(inner, outer)
    const tempDirectory = await mkdtemp(join(tmpdir(), "xiranite-neoview-control-nested-"))
    cleanupDirectories.push(tempDirectory)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      archiveTempDirectory: tempDirectory,
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: outer.path,
        entryPaths: ["nested/inner.cbz"],
        archivePasswords: [{ entryPaths: ["nested/inner.cbz"], password: nestedPassword }],
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      expect(session.book).toMatchObject({ displayName: "inner.cbz", pageCount: 1 })
      expect(JSON.stringify(session)).not.toContain(tempDirectory)
      expect(JSON.stringify(session)).not.toContain(nestedPassword)
      expect(session.visiblePages[0]!.thumbnailUrl).toBeUndefined()
      expect(session.visiblePages[0]!.assetUrl).not.toContain(nestedPassword)
      const asset = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl)))!
      expect(Buffer.from(await asset.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
      await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" }))
      expect(await readdir(tempDirectory)).toEqual([])
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.encrypted-archive] keeps a root ZIP password session-scoped and out of asset URLs", async () => {
    const password = "root-session-secret"
    const archive = await createZipFixture({
      name: "encrypted.cbz",
      entries: [{ path: "pages/1.png", bytes: ONE_PIXEL_PNG, level: 6, password }],
    })
    cleanupArchives.push(archive)
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: archive.path,
        password,
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      const serialized = JSON.stringify(session)
      expect(serialized).not.toContain(password)
      expect(session.visiblePages[0]!.assetUrl).not.toContain(password)
      const asset = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl)))!
      expect(Buffer.from(await asset.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
      await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" }))

      const wrongPassword = "wrong-password-must-not-leak"
      const wrongOpened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: archive.path,
        password: wrongPassword,
      })))!
      const wrongSession = await wrongOpened.json() as ReaderSessionDto
      expect(JSON.stringify(wrongSession)).not.toContain(wrongPassword)
      const wrongAsset = (await controller.handle(new Request(wrongSession.visiblePages[0]!.assetUrl)))!
      await expect(wrongAsset.arrayBuffer()).rejects.not.toThrow(wrongPassword)
      await controller.handle(authorizedRequest(`/reader/s/${wrongSession.sessionId}`, { method: "DELETE" }))
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
      const cached = (await controller.handle(new Request(url)))!
      expect(Buffer.from(await cached.arrayBuffer())).toEqual(bytes)
      expect(cached.headers.get("content-length")).toBe(String(bytes.byteLength))
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

function jsonRequest(path: string, body: unknown, authorized = true, method = "POST"): Request {
  return authorizedRequest(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, authorized)
}

function authorizedRequest(path: string, init: RequestInit = {}, authorized = true): Request {
  const headers = new Headers(init.headers)
  if (authorized) headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
