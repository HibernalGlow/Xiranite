import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SolidArchiveCache, type CacheableSolidArchiveMaterializer } from "../archives/sevenzip/SolidArchiveCache.js"
import { ReaderMemoryPressureMonitor } from "../memory/ReaderMemoryPressureMonitor.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderHttpController memory pressure", () => {
  it("[neoview.memory-pressure.solid-http] evicts idle solid L0 without delaying or cancelling the visible page", async () => {
    const solidCache = new SolidArchiveCache({ maxBytes: 100 })
    const materializer = new FakeMaterializer()
    materializer.isComplete = true
    const lease = await solidCache.acquire({
      fingerprint: "idle-solid",
      sourceIdentity: "idle.7z",
      materializedBytes: 60,
      create: () => materializer,
    })
    await lease.release()
    const monitor = new ReaderMemoryPressureMonitor({
      criticalAvailableBytes: 200,
      elevatedAvailableBytes: 400,
      recoveryAvailableBytes: 800,
      sampleIntervalMs: 0,
      reliefIntervalMs: 10,
      availableMemory: () => 100,
      now: () => 0,
    })
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-pressure-http-"))
    cleanup.push(directory)
    await writeFile(join(directory, "page.jpg"), Uint8Array.of(1, 2, 3))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "pressure-token",
      progressStore: false,
      solidArchiveCache: solidCache,
      memoryPressureMonitor: monitor,
    })
    try {
      const opened = (await controller.handle(request("/reader/sessions", {
        method: "POST",
        body: JSON.stringify({ path: directory }),
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      const visible = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl)))!
      expect(visible.status).toBe(200)
      expect(new Uint8Array(await visible.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
      await expect.poll(() => solidCache.snapshot().retainedBytes).toBe(0)
      expect(materializer.close).toHaveBeenCalledOnce()

      const diagnostics = (await controller.handle(request("/reader/diagnostics")))!
      await expect(diagnostics.json()).resolves.toMatchObject({
        assets: { memoryPressure: { level: "critical", criticalReliefs: 1 } },
        solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 100 },
      })
    } finally {
      await controller[Symbol.asyncDispose]()
      await solidCache.close()
    }
  })
})

class FakeMaterializer implements CacheableSolidArchiveMaterializer {
  isComplete = false
  readonly close = vi.fn(async () => undefined)
  async pathFor(entryId: string): Promise<string> { return entryId }
  [Symbol.asyncDispose](): Promise<void> { return this.close() }
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "pressure-token")
  if (init.body) headers.set("content-type", "application/json")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
