import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { ReaderMemoryPressureMonitor } from "../memory/ReaderMemoryPressureMonitor.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader preload context HTTP", () => {
  it("[neoview.preload.context-http] combines validated viewport facts with server-owned resource pressure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-preload-context-"))
    cleanup.push(directory)
    await Promise.all([0, 1, 2, 3].map((index) => writeFile(join(directory, `${index}.jpg`), Uint8Array.of(index))))
    const scheduler = {
      snapshot: () => ({
        cpu: pool(0),
        io: pool(275),
        gpu: pool(0),
      }),
    } as unknown as ResourceScheduler
    const monitor = new ReaderMemoryPressureMonitor({
      criticalAvailableBytes: 100,
      elevatedAvailableBytes: 300,
      recoveryAvailableBytes: 600,
      sampleIntervalMs: 0,
      availableMemory: () => 200,
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "preload-context-token",
      progressStore: false,
      resourceScheduler: scheduler,
      memoryPressureMonitor: monitor,
    })
    try {
      const opened = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      monitor.sample()
      const initialFrameGeneration = opened.frame.generation
      const initialPreloadGeneration = opened.preload!.generation
      const endpoint = `/reader/s/${opened.sessionId}/preload-context`
      const response = (await controller.handle(jsonRequest(endpoint, {
        mode: "continuous",
        velocityPagesPerSecond: 0.5,
        stableForMs: 500,
        focused: true,
      }, "PATCH")))!
      expect(response.status).toBe(200)
      const updated = await response.json() as { preload: NonNullable<ReaderSessionDto["preload"]> }
      expect(updated.preload).toMatchObject({
        mode: "continuous",
        velocityPagesPerSecond: 0.5,
        stableForMs: 500,
        focused: true,
        admission: "paused",
        queueWaitMs: 275,
        memoryPressure: "elevated",
        frameGeneration: initialFrameGeneration,
      })
      expect(updated.preload.generation).toBeGreaterThan(initialPreloadGeneration)

      expect((await controller.handle(jsonRequest(endpoint, { queueWaitMs: 0 }, "PATCH")))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(endpoint, { velocityPagesPerSecond: Number.NaN }, "PATCH")))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(endpoint, { stableForMs: -1 }, "PATCH")))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function pool(oldestQueuedWaitMs: number) {
  return {
    active: 0,
    queued: 0,
    queuedByPriority: { view: 0, ahead: 0, background: 0, batch: 0 },
    oldestQueuedWaitMs,
  }
}

function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(new URL(path, "http://127.0.0.1:41000"), {
    method,
    headers: { "content-type": "application/json", "x-xiranite-token": "preload-context-token" },
    body: JSON.stringify(body),
  })
}
