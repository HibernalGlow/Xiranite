import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
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
