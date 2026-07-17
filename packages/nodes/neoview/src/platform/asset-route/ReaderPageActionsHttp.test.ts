import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"

const directories: string[] = []
const archives: ZipFixture[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(archives.splice(0).map((archive) => archive.cleanup()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader page actions", () => {
  it("[neoview.page-list.action-http] resolves a filesystem page only after an authenticated action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-page-actions-"))
    directories.push(directory)
    const pagePath = join(directory, "page.jpg")
    await writeFile(pagePath, Uint8Array.of(1, 2, 3))
    const run = vi.spyOn(ReaderSystemIntegrationHttpController.prototype, "run").mockResolvedValue(undefined)
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const session = await open(controller, directory)
      const page = session.visiblePages[0]!
      expect(JSON.stringify(page)).not.toContain(pagePath)
      const endpoint = `/reader/s/${session.sessionId}/pages/${encodeURIComponent(page.id)}/actions`

      expect((await controller.handle(jsonRequest(endpoint, { action: "copy" }, false)))?.status).toBe(401)
      const copied = (await controller.handle(jsonRequest(endpoint, { action: "copy" })))!
      expect(copied.status).toBe(200)
      await expect(copied.json()).resolves.toEqual({ path: pagePath })

      expect((await controller.handle(jsonRequest(endpoint, { action: "reveal" })))?.status).toBe(204)
      expect((await controller.handle(jsonRequest(endpoint, { action: "open" })))?.status).toBe(204)
      expect(run).toHaveBeenNthCalledWith(1, "reveal", pagePath, expect.any(AbortSignal))
      expect(run).toHaveBeenNthCalledWith(2, "open", pagePath, expect.any(AbortSignal))
      expect((await controller.handle(jsonRequest(endpoint, { action: "delete" })))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.page-list.archive-actions] materializes archive entries but reveals the archive itself", async () => {
    const archive = await createZipFixture({ entries: [{ path: "pages/cover.jpg", bytes: Uint8Array.of(4, 5, 6) }] })
    archives.push(archive)
    const tempDirectory = await mkdtemp(join(tmpdir(), "xiranite-page-action-materialized-"))
    directories.push(tempDirectory)
    const run = vi.spyOn(ReaderSystemIntegrationHttpController.prototype, "run").mockResolvedValue(undefined)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      archiveTempDirectory: tempDirectory,
    })
    try {
      const session = await open(controller, archive.path)
      const page = session.visiblePages[0]!
      const endpoint = `/reader/s/${session.sessionId}/pages/${encodeURIComponent(page.id)}/actions`
      const copied = (await controller.handle(jsonRequest(endpoint, { action: "copy" })))!
      expect(copied.status).toBe(201)
      const materialized = await copied.json() as { path: string; leaseToken: string }
      expect(materialized.path).toMatch(/cover\.jpg$/)
      expect(new Uint8Array(await readFile(materialized.path))).toEqual(Uint8Array.of(4, 5, 6))

      expect((await controller.handle(jsonRequest(endpoint, { action: "reveal" })))?.status).toBe(204)
      expect(run).toHaveBeenLastCalledWith("reveal", archive.path, expect.any(AbortSignal))
      expect((await controller.handle(jsonRequest(endpoint, { action: "open" })))?.status).toBe(204)
      const openedPath = run.mock.calls.at(-1)?.[1]
      expect(openedPath).not.toBe(archive.path)
      expect(new Uint8Array(await readFile(openedPath!))).toEqual(Uint8Array.of(4, 5, 6))

      for (let index = 0; index < 20; index += 1) {
        expect((await controller.handle(jsonRequest(endpoint, { action: "open" })))?.status).toBe(204)
      }
      expect((await readdir(tempDirectory)).length).toBeLessThanOrEqual(2)
      const entriesBeforeFailure = await readdir(tempDirectory)
      run.mockRejectedValueOnce(new Error("system open failed"))
      expect((await controller.handle(jsonRequest(endpoint, { action: "open" })))?.status).toBe(400)
      expect(await readdir(tempDirectory)).toEqual(entriesBeforeFailure)

      expect((await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/clipboard-materializations/${materialized.leaseToken}`,
        { method: "DELETE" },
      )))?.status).toBe(204)
      await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" }))
      expect(await readdir(tempDirectory)).toEqual([])
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function open(controller: ReaderHttpController, path: string): Promise<ReaderSessionDto> {
  const response = (await controller.handle(jsonRequest("/reader/sessions", { path })))!
  expect(response.status).toBe(201)
  return response.json() as Promise<ReaderSessionDto>
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
