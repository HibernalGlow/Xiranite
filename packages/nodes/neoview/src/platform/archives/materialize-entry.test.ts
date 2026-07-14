import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ResourceScheduler, ResourceTaskRequest } from "../../ports/ResourceScheduler.js"
import type { ArchiveEntry, ArchiveProvider } from "../../ports/ArchiveProvider.js"
import { MemoryArchiveProvider } from "../../testing/MemoryArchiveProvider.js"
import { materializeArchiveEntry } from "./materialize-entry.js"

const cleanupDirectories: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("materializeArchiveEntry", () => {
  it("[neoview.archive.materialize-lease] streams to an opaque temporary lease and releases idempotently", async () => {
    const directory = await createTempDirectory()
    const provider = new MemoryArchiveProvider([{ path: "nested/book.cbz", bytes: Uint8Array.of(1, 2, 3) }], { chunkSize: 1 })
    const [entry] = await provider.list()
    const scheduler = new RecordingScheduler()
    const lease = await materializeArchiveEntry(provider, entry!, {
      tempDirectory: directory,
      resourceScheduler: scheduler,
    })
    expect(lease.path).not.toContain("nested")
    expect(new Uint8Array(await readFile(lease.path))).toEqual(Uint8Array.of(1, 2, 3))
    expect(scheduler.requests).toContainEqual({
      resource: "io",
      kind: "neoview.archive-materialize",
      priority: "interactive",
    })
    expect(scheduler.active).toBe(0)
    const releasing = lease.release()
    expect(lease.release()).toBe(releasing)
    await releasing
    expect(await readdir(directory)).toEqual([])
    await provider.close()
  })

  it("[neoview.archive.materialize-limits] rejects budgets and provider length mismatches without residue", async () => {
    const directory = await createTempDirectory()
    const provider = new MemoryArchiveProvider([{ path: "nested/book.cbz", bytes: Uint8Array.of(1, 2, 3) }])
    const [entry] = await provider.list()
    const scheduler = new RecordingScheduler()
    await expect(materializeArchiveEntry(provider, entry!, {
      tempDirectory: directory,
      maxBytes: 2,
      resourceScheduler: scheduler,
    })).rejects.toThrow("exceeding the 2 byte budget")
    expect(scheduler.requests).toEqual([])
    await expect(materializeArchiveEntry(provider, { ...entry!, uncompressedSize: 2 }, {
      tempDirectory: directory,
      resourceScheduler: scheduler,
    })).rejects.toThrow("more than its declared 2 bytes")
    expect(scheduler.active).toBe(0)
    expect(await readdir(directory)).toEqual([])
    await provider.close()
  })

  it("[neoview.archive.materialize-cancellation] aborts an active copy and removes the partial file", async () => {
    const directory = await createTempDirectory()
    const scheduler = new RecordingScheduler()
    const abort = new AbortController()
    const entry: ArchiveEntry = {
      id: "blocked",
      path: "nested/book.cbz",
      kind: "file",
      uncompressedSize: 2,
    }
    const provider = blockingProvider(entry)
    const materializing = materializeArchiveEntry(provider, entry, {
      signal: abort.signal,
      tempDirectory: directory,
      resourceScheduler: scheduler,
    })
    const rejected = expect(materializing).rejects.toThrow("navigation changed")
    await expect.poll(() => scheduler.active).toBe(1)
    abort.abort(new Error("navigation changed"))
    await rejected
    expect(scheduler.active).toBe(0)
    expect(await readdir(directory)).toEqual([])
  })
})

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-materialize-test-"))
  cleanupDirectories.push(directory)
  return directory
}

class RecordingScheduler implements ResourceScheduler {
  readonly requests: ResourceTaskRequest[] = []
  active = 0

  async acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<{ release(): void }> {
    signal?.throwIfAborted()
    this.requests.push({ ...request })
    this.active += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.active -= 1
      },
    }
  }
}

function blockingProvider(entry: ArchiveEntry): ArchiveProvider {
  return {
    sourcePath: "memory://blocked",
    capabilities: { solid: false, randomAccess: true, entryRange: false, materialization: "never" },
    async list() { return [entry] },
    async openEntry(_entryId, options = {}) {
      let emitted = false
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(options.signal?.reason)
          options.signal?.addEventListener("abort", abort, { once: true })
        },
        pull(controller) {
          if (emitted) return new Promise<void>(() => {})
          emitted = true
          controller.enqueue(Uint8Array.of(1))
        },
      })
    },
    async close() {},
    async [Symbol.asyncDispose]() {},
  }
}
