import { afterEach, describe, expect, it } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const archives: ZipFixture[] = []

afterEach(async () => {
  await Promise.all(archives.splice(0).map((archive) => archive.cleanup()))
})

describe("Reader runtime diagnostics HTTP", () => {
  it("[neoview.diagnostics.runtime-http] reports owner snapshots and releases them with their sessions", async () => {
    const archive = await createZipFixture()
    archives.push(archive)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "runtime-diagnostics-token",
      progressStore: false,
    })
    try {
      const reader = await (await controller.handle(jsonRequest("/reader/sessions", { path: archive.path })))!.json() as ReaderSessionDto
      const browser = await (await controller.handle(jsonRequest("/reader/browser/sessions", { path: archive.directory })))!.json() as { sessionId: string }
      const active = await diagnostics(controller)
      expect(active).toMatchObject({
        reader: {
          activeSessions: 1,
          runtimeResources: {
            archiveProviders: 1,
            archiveIndexEntries: 3,
            archiveIndexPayloadBytes: expect.any(Number),
            archiveActiveExtractions: 0,
          },
          browserMemory: {
            sessions: 1,
            listingEntries: expect.any(Number),
            listingPayloadBytes: expect.any(Number),
          },
        },
      })

      expect((await controller.handle(request(`/reader/s/${reader.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect((await controller.handle(request(`/reader/browser/s/${browser.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      const released = await diagnostics(controller)
      expect(released).toMatchObject({
        reader: {
          activeSessions: 0,
          runtimeResources: { archiveProviders: 0, archiveIndexEntries: 0, archiveIndexPayloadBytes: 0, archiveActiveExtractions: 0 },
          browserMemory: { sessions: 0, listingEntries: 0, listingPayloadBytes: 0 },
        },
      })
      expect(JSON.stringify(active)).not.toContain(archive.path)
      expect(JSON.stringify(active)).not.toContain(reader.visiblePages[0]?.id)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function diagnostics(controller: ReaderHttpController): Promise<Record<string, unknown>> {
  return (await (await controller.handle(request("/reader/diagnostics")))!.json()) as Record<string, unknown>
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "runtime-diagnostics-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
