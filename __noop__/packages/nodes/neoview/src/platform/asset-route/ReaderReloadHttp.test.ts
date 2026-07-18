import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader session reload HTTP", () => {
  it("[neoview.control.reload] replaces a session only after reopening and preserves the anchor page identity", async () => {
    const directory = await fixtureDirectory(["1.png", "2.png", "3.png"])
    const controller = createController()
    try {
      const opened = await open(controller, directory, 1)
      expect(opened.visiblePages[0]?.name).toBe("2.png")

      await writeFixture(join(directory, "0.png"))
      const response = (await controller.handle(jsonRequest(`/reader/s/${opened.sessionId}/reload`, {})))!
      expect(response.status).toBe(201)
      const reloaded = await response.json() as ReaderSessionDto
      expect(reloaded.sessionId).not.toBe(opened.sessionId)
      expect(reloaded.book.pageCount).toBe(4)
      expect(reloaded.frame.anchorPageIndex).toBe(2)
      expect(reloaded.visiblePages[0]?.name).toBe("2.png")
      expect((await controller.handle(authorizedRequest(`/reader/s/${opened.sessionId}`)))?.status).toBe(404)
      expect((await controller.handle(authorizedRequest(`/reader/s/${reloaded.sessionId}`)))?.status).toBe(200)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.reload-rollback] leaves the active session untouched when reopening fails", async () => {
    const directory = await fixtureDirectory(["1.png", "2.png"])
    const controller = createController()
    try {
      const opened = await open(controller, directory, 1)
      vi.spyOn(CoreReaderService.prototype, "openViewSource").mockRejectedValueOnce(new Error("reload failed"))

      const response = (await controller.handle(jsonRequest(`/reader/s/${opened.sessionId}/reload`, {})))!
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "reload failed" })
      const retained = (await controller.handle(authorizedRequest(`/reader/s/${opened.sessionId}`)))!
      expect(retained.status).toBe(200)
      await expect(retained.json()).resolves.toMatchObject({
        sessionId: opened.sessionId,
        frame: { anchorPageIndex: 1 },
        visiblePages: [{ name: "2.png" }],
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.reload-validation] rejects unknown fields without replacing the session", async () => {
    const directory = await fixtureDirectory(["1.png"])
    const controller = createController()
    try {
      const opened = await open(controller, directory, 0)
      expect((await controller.handle(jsonRequest(`/reader/s/${opened.sessionId}/reload`, { path: directory })))?.status).toBe(400)
      expect((await controller.handle(authorizedRequest(`/reader/s/${opened.sessionId}`)))?.status).toBe(200)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function createController(): ReaderHttpController {
  return new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token", progressStore: false })
}

async function open(controller: ReaderHttpController, path: string, initialPage: number): Promise<ReaderSessionDto> {
  const response = (await controller.handle(jsonRequest("/reader/sessions", { path, initialPage })))!
  expect(response.status).toBe(201)
  return response.json() as Promise<ReaderSessionDto>
}

async function fixtureDirectory(names: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-reload-"))
  roots.push(directory)
  await Promise.all(names.map((name) => writeFixture(join(directory, name))))
  return directory
}

function writeFixture(path: string): Promise<void> {
  return writeFile(path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))
}

function jsonRequest(path: string, body: unknown): Request {
  return authorizedRequest(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

function authorizedRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("x-xiranite-token", "reader-token")
  return new Request(`http://127.0.0.1:41000${path}`, { ...init, headers })
}
