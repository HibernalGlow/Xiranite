import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader preload telemetry HTTP", () => {
  it("[neoview.preload.telemetry-http] accepts current outcomes, rejects stale generations and aggregates sanitized diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-preload-http-"))
    cleanup.push(directory)
    await Promise.all([0, 1, 2, 3].map((index) => writeFile(join(directory, `${index}.jpg`), Uint8Array.of(index))))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "preload-token",
      progressStore: false,
    })
    try {
      const openedResponse = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const opened = await openedResponse.json() as ReaderSessionDto
      const generation = opened.preload!.generation
      const pageId = opened.preload!.candidates[0]!.pageIds[0]!
      const endpoint = `/reader/s/${opened.sessionId}/preload-events`
      const invalid = (await controller.handle(jsonRequest(endpoint, {
        generation,
        events: [
          { pageId, outcome: "started", metrics: { ttfbMs: 4 } },
          { pageId, outcome: "ready", metrics: { retainedBytes: -1 } },
        ],
      })))!
      expect(invalid.status).toBe(400)
      const accepted = (await controller.handle(jsonRequest(endpoint, {
        generation,
        events: [
          { pageId, outcome: "started", metrics: { ttfbMs: 12.5, activeLeases: 2 } },
          { pageId, outcome: "ready", metrics: { decodeMs: 7.25, retainedBytes: 4096, activeLeases: 1 } },
        ],
      })))!
      expect(accepted.status).toBe(202)
      await expect(accepted.json()).resolves.toEqual({ generation, accepted: 2, rejected: 0, stale: 0 })

      const sessionDiagnostics = (await controller.handle(authorizedRequest(`/reader/diagnostics?sessionId=${opened.sessionId}`)))!
      await expect(sessionDiagnostics.json()).resolves.toMatchObject({
        reader: { sessionPreload: { generation, pages: [{ pageIndex: 1, outcome: "ready" }] } },
      })

      const duplicate = (await controller.handle(jsonRequest(endpoint, {
        generation,
        events: [{ pageId, outcome: "ready" }],
      })))!
      expect(duplicate.status).toBe(400)

      const navigated = (await controller.handle(jsonRequest(`/reader/s/${opened.sessionId}/navigate`, { action: "next" })))!
      const next = await navigated.json() as { preload: NonNullable<ReaderSessionDto["preload"]> }
      expect(next.preload.generation).toBeGreaterThan(generation)
      const stale = (await controller.handle(jsonRequest(endpoint, {
        generation,
        events: [{ pageId, outcome: "cancelled" }],
      })))!
      expect(stale.status).toBe(409)

      const diagnostics = (await controller.handle(authorizedRequest("/reader/diagnostics")))!
      const snapshot = await diagnostics.json() as Record<string, unknown>
      expect(snapshot).toMatchObject({
        reader: { preload: {
          sessions: 1,
          active: 0,
          started: 1,
          ready: 1,
          cancelled: 0,
          staleReports: 1,
          duplicateReports: 1,
          performance: {
            ttfbSamples: 1,
            totalTtfbMs: 12.5,
            maxTtfbMs: 12.5,
            decodeSamples: 1,
            totalDecodeMs: 7.25,
            maxDecodeMs: 7.25,
            retainedByteSamples: 1,
            totalRetainedBytes: 4096,
            maxRetainedBytes: 4096,
            leaseSamples: 2,
            totalActiveLeases: 3,
            maxActiveLeases: 2,
          },
        } },
      })
      expect(JSON.stringify(snapshot)).not.toContain(pageId)
      expect(JSON.stringify(snapshot)).not.toContain(directory)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function jsonRequest(path: string, body: unknown): Request {
  return authorizedRequest(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "preload-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
