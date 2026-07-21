import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

import type { ReaderPage } from "../../domain/page/page.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { PlatformReaderPageMaterializer } from "./PlatformReaderPageMaterializer.js"

const cleanupDirectories: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformReaderPageMaterializer", () => {
  it("[neoview.clipboard.materialization-platform] streams an archive page to a named temporary lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-clipboard-test-"))
    cleanupDirectories.push(directory)
    let active = 0
    const scheduler: ResourceScheduler = {
      async acquire(request) {
        expect(request).toMatchObject({ resource: "io", priority: "interactive", kind: "neoview.clipboard-materialize" })
        active += 1
        return { release() { active -= 1 } }
      },
    }
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory, resourceScheduler: scheduler })
    const lease = await materializer.materialize(page("nested/001.png", Uint8Array.of(1, 2, 3)), { maxBytes: 3 })

    expect(basename(lease.path)).toBe("001.png")
    expect(new Uint8Array(await readFile(lease.path))).toEqual(Uint8Array.of(1, 2, 3))
    expect(lease.byteLength).toBe(3)
    expect(active).toBe(0)
    const releasing = lease.release()
    expect(lease.release()).toBe(releasing)
    await releasing
    expect(await readdir(directory)).toEqual([])
  })

  it("[neoview.clipboard.materialization-cleanup] removes partial output after a declared length mismatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-clipboard-test-"))
    cleanupDirectories.push(directory)
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory })
    await expect(materializer.materialize({ ...page("bad.png", Uint8Array.of(1, 2, 3)), byteLength: 2 }))
      .rejects.toThrow("more than its declared")
    expect(await readdir(directory)).toEqual([])
  })

  it("[neoview.super-resolution.materialization-avif] transcodes unsupported AVIF input to a native PNG lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-upscale-test-"))
    cleanupDirectories.push(directory)
    const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).avif().toBuffer()
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory, purpose: "super-resolution" })
    const lease = await materializer.materialize({
      ...page("nested/001.avif", avif),
      mimeType: "image/avif",
    })
    expect(basename(lease.path)).toBe("xr-native-input.png")
    expect((await readFile(lease.path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(lease.byteLength).toBeGreaterThan(0)
    await lease.release()
    expect(await readdir(directory)).toEqual([])
  })

  it("[neoview.clipboard.materialization-cancellation] returns promptly and closes a source that loads after cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-clipboard-test-"))
    cleanupDirectories.push(directory)
    const lateSource = Promise.withResolvers<PageSource>()
    const close = vi.fn(async () => undefined)
    const load = vi.fn(() => lateSource.promise)
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory })
    const controller = new AbortController()
    const pending = materializer.materialize({ ...page("late.png", Uint8Array.of(1, 2, 3)), content: { load } }, {
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    controller.abort(new DOMException("page changed", "AbortError"))
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    lateSource.resolve({
      byteLength: 3,
      contentType: "image/png",
      rangeSupported: false,
      open: vi.fn(),
      close,
      [Symbol.asyncDispose]: close,
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(await readdir(directory)).toEqual([])
  })

  it("[neoview.clipboard.materialization-cancellation] returns promptly and cancels a stream that opens after cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-clipboard-test-"))
    cleanupDirectories.push(directory)
    const lateStream = Promise.withResolvers<ReadableStream<Uint8Array>>()
    const streamCancelled = vi.fn()
    const sourceClosed = vi.fn(async () => undefined)
    const open = vi.fn(() => lateStream.promise)
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory })
    const controller = new AbortController()
    const pending = materializer.materialize({
      ...page("late.png", Uint8Array.of(1, 2, 3)),
      content: { load: vi.fn(async () => ({
        byteLength: 3,
        contentType: "image/png",
        rangeSupported: false,
        open,
        close: sourceClosed,
        [Symbol.asyncDispose]: sourceClosed,
      })) },
    }, { signal: controller.signal })

    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    controller.abort(new DOMException("page changed", "AbortError"))
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    expect(sourceClosed).toHaveBeenCalledOnce()
    lateStream.resolve(new ReadableStream<Uint8Array>({ cancel: streamCancelled }))
    await vi.waitFor(() => expect(streamCancelled).toHaveBeenCalledOnce())
    expect(await readdir(directory)).toEqual([])
  })

  it("[neoview.clipboard.materialization-cancellation] cancels a stalled reader and releases temporary resources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-clipboard-test-"))
    cleanupDirectories.push(directory)
    const sourceClosed = vi.fn(async () => undefined)
    const streamCancelled = vi.fn()
    let markPullStarted!: () => void
    const pullStarted = new Promise<void>((resolve) => { markPullStarted = resolve })
    const materializer = new PlatformReaderPageMaterializer({ tempDirectory: directory })
    const controller = new AbortController()
    const pending = materializer.materialize({
      ...page("stalled.png", Uint8Array.of(1, 2, 3)),
      content: { load: vi.fn(async () => ({
        byteLength: 3,
        contentType: "image/png",
        rangeSupported: false,
        async open() {
          return new ReadableStream<Uint8Array>({
            pull() { markPullStarted() },
            cancel: streamCancelled,
          })
        },
        close: sourceClosed,
        [Symbol.asyncDispose]: sourceClosed,
      })) },
    }, { signal: controller.signal })

    await withTimeout(pullStarted, 500)
    controller.abort(new DOMException("page changed", "AbortError"))
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    expect(streamCancelled).toHaveBeenCalledOnce()
    expect(sourceClosed).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  })
})

function page(name: string, bytes: Uint8Array): ReaderPage {
  return {
    id: "page-1",
    index: 0,
    name,
    sourcePath: "C:/book.cbz",
    entryPath: name,
    mediaKind: "image",
    mimeType: "image/png",
    byteLength: bytes.byteLength,
    contentVersion: "v1",
    content: {
      async load() {
        let closed = false
        return {
          byteLength: bytes.byteLength,
          contentType: "image/png",
          rangeSupported: false,
          async open() {
            if (closed) throw new Error("closed")
            return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
          },
          async close() { closed = true },
          async [Symbol.asyncDispose]() { await this.close() },
        }
      },
    },
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Test promise timed out after ${timeoutMs} ms.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
