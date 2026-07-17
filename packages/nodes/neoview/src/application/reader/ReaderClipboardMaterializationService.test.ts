import { describe, expect, it, vi } from "vitest"

import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPageMaterializer } from "../../ports/ReaderPageMaterializer.js"
import { CoreReaderService } from "./ReaderService.js"
import { ReaderClipboardMaterializationService } from "./ReaderClipboardMaterializationService.js"

describe("ReaderClipboardMaterializationService", () => {
  it("[neoview.clipboard.materialization-service] owns opaque leases and releases them with the session", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = []
    const materializer: ReaderPageMaterializer = {
      async materialize(page) {
        const release = vi.fn(async () => undefined)
        releases.push(release)
        return {
          path: `C:/temp/${page.name}`,
          byteLength: page.byteLength!,
          release,
          [Symbol.asyncDispose]: release,
        }
      },
    }
    const reader = new CoreReaderService(async () => archiveBook())
    const session = await reader.openViewSource({ kind: "archive", path: "C:/book.cbz" })
    const service = new ReaderClipboardMaterializationService(reader, materializer, { maxLeases: 1 })

    const materialized = await service.materialize(session.id, "page-1")
    expect(materialized).toMatchObject({ path: "C:/temp/001.png", byteLength: 3 })
    expect(materialized.token).toMatch(/^[0-9a-f-]{36}$/)
    await expect(service.materialize(session.id, "page-1")).rejects.toThrow("limit reached")
    expect(await service.release(materialized.token, "other-session")).toBe(false)

    await session.close()
    await vi.waitFor(() => expect(releases[0]).toHaveBeenCalledOnce())
    expect(await service.release(materialized.token)).toBe(false)
    await service[Symbol.asyncDispose]()
    await reader[Symbol.asyncDispose]()
  })

  it("[neoview.clipboard.materialization-validation] rejects local pages and entry budgets", async () => {
    const materialize = vi.fn()
    const localReader = new CoreReaderService(async () => archiveBook({ entryPath: undefined }))
    const localSession = await localReader.openViewSource({ kind: "directory", path: "C:/book" })
    const localService = new ReaderClipboardMaterializationService(localReader, { materialize }, { maxEntryBytes: 2 })
    await expect(localService.materialize(localSession.id, "page-1")).rejects.toThrow("Only archive entries")
    expect(materialize).not.toHaveBeenCalled()
    await localService[Symbol.asyncDispose]()
    await localReader[Symbol.asyncDispose]()

    const archiveReader = new CoreReaderService(async () => archiveBook())
    const archiveSession = await archiveReader.openViewSource({ kind: "archive", path: "C:/book.cbz" })
    const archiveService = new ReaderClipboardMaterializationService(archiveReader, { materialize }, { maxEntryBytes: 2 })
    await expect(archiveService.materialize(archiveSession.id, "page-1")).rejects.toThrow("byte clipboard materialization budget")
    expect(materialize).not.toHaveBeenCalled()
    await archiveService[Symbol.asyncDispose]()
    await archiveReader[Symbol.asyncDispose]()
  })

  it("[neoview.clipboard.materialization-session-close] aborts and drains an in-flight session extraction", async () => {
    const materialize = vi.fn((_page: ReaderPage, options?: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
    }))
    const reader = new CoreReaderService(async () => archiveBook())
    const session = await reader.openViewSource({ kind: "archive", path: "C:/book.cbz" })
    const service = new ReaderClipboardMaterializationService(reader, { materialize })

    const outcome = service.materialize(session.id, "page-1").then(
      () => undefined,
      (error: unknown) => error,
    )
    await vi.waitFor(() => expect(materialize).toHaveBeenCalledOnce())
    await service.releaseSession(session.id)
    await expect(outcome).resolves.toBeInstanceOf(Error)
    await expect(service.materialize(session.id, "page-1")).rejects.toThrow("closing")

    await session.close()
    await service[Symbol.asyncDispose]()
    await reader[Symbol.asyncDispose]()
  })
})

function archiveBook(overrides: Partial<ReaderPage> = {}): ReaderBook {
  const close = vi.fn(async () => undefined)
  return {
    id: "book-1",
    source: { kind: "archive", path: "C:/book.cbz" },
    displayName: "book.cbz",
    pages: [{
      id: "page-1",
      index: 0,
      name: "001.png",
      sourcePath: "C:/book.cbz",
      entryPath: "pages/001.png",
      mediaKind: "image",
      mimeType: "image/png",
      byteLength: 3,
      contentVersion: "v1",
      content: { async load() { throw new Error("not used") } },
      ...overrides,
    }],
    close,
    [Symbol.asyncDispose]: close,
  }
}
