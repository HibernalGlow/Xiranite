import { describe, expect, it, vi } from "vitest"

import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import { ReaderBookMetadataService } from "./ReaderBookMetadataService.js"

describe("ReaderBookMetadataService", () => {
  it("[neoview.book-information.shared-contract] [neoview.emm-tags.metadata] [neoview.emm-tags.translation] returns bounded source identity and translated EMM tags", async () => {
    const readDirectoryEmmRecords = vi.fn(async (paths: readonly string[]) => new Map([
      [paths[0]!, {
        emmJson: JSON.stringify({ translated_title: "译名", tags: [{ namespace: "artist", tag: "Alice" }] }),
        manualTags: JSON.stringify([{ namespace: "manual", tag: "favorite" }]),
        rawFields: [{ key: "filepath", type: "path" as const, value: "D:\\books\\demo.pdf" }],
      }],
    ]))
    const translate = vi.fn(async () => new Map([["artist\0alice", "爱丽丝"]]))
    const service = new ReaderBookMetadataService(store(readDirectoryEmmRecords), { translate })

    await expect(service.load(book({ kind: "document", path: "D:/books/demo.pdf", format: "pdf" }))).resolves.toEqual({
      bookId: "book-1",
      displayName: "demo.pdf",
      sourcePath: "D:/books/demo.pdf",
      sourceKind: "document",
      sourceFormat: "pdf",
      pageCount: 2,
      emmRaw: { schemaVersion: 1, fields: [{ key: "filepath", type: "path", value: "D:\\books\\demo.pdf" }] },
      emm: {
        translatedTitle: "译名",
        tags: [
          { namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" },
          { namespace: "manual", tag: "favorite" },
        ],
      },
    })
    expect(readDirectoryEmmRecords).toHaveBeenCalledWith(["D:\\books\\demo.pdf"], undefined, { includeRaw: true })
    expect(translate).toHaveBeenCalledWith([
      { category: "artist", tag: "Alice" },
      { category: "manual", tag: "favorite" },
    ], undefined)
  })

  it("[neoview.book-information.emm-degrade] keeps book metadata available without a valid EMM record", async () => {
    const service = new ReaderBookMetadataService(store(async () => new Map([
      ["D:\\books\\demo.cbz", { emmJson: "broken" }],
    ])))
    const metadata = await service.load(book({ kind: "archive", path: "D:/books/demo.cbz" }))
    expect(metadata).toMatchObject({
      sourceKind: "archive",
      sourceFormat: undefined,
    })
    expect(metadata).not.toHaveProperty("emm")
  })

  it("[neoview.book-information.emm-cancel] propagates cancellation without publishing partial EMM", async () => {
    const controller = new AbortController()
    const service = new ReaderBookMetadataService(store(async (_paths, signal) => {
      controller.abort()
      signal?.throwIfAborted()
      return new Map()
    }))
    await expect(service.load(book({ kind: "archive", path: "D:/books/demo.cbz" }), controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("[neoview.emm-tags.metadata] keeps validated tags when the optional translation source fails", async () => {
    const service = new ReaderBookMetadataService(store(async (paths) => new Map([
      [paths[0]!, { emmJson: JSON.stringify({ tags: [{ namespace: "artist", tag: "Alice" }] }) }],
    ])), { translate: vi.fn(async () => { throw new Error("translation unavailable") }) })
    await expect(service.load(book({ kind: "archive", path: "D:/books/demo.cbz" }))).resolves.toMatchObject({
      emm: { tags: [{ namespace: "artist", tag: "Alice" }] },
    })
  })
})

function store(readDirectoryEmmRecords: ReaderDirectoryEmmRecordStore["readDirectoryEmmRecords"]): ReaderDirectoryEmmRecordStore {
  return { directoryEmmAvailable: true, readDirectoryEmmRecords }
}

function book(source: ReaderBook["source"]): ReaderBook {
  return {
    id: "book-1",
    displayName: source.path.split("/").at(-1)!,
    source,
    pages: [page(0), page(1)],
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  }
}

function page(index: number): ReaderBook["pages"][number] {
  return {
    id: `page-${index}`,
    index,
    name: `${index + 1}.jpg`,
    sourcePath: `${index + 1}.jpg`,
    mediaKind: "image",
    contentVersion: "v1",
    content: { load: async () => { throw new Error("unused") } },
  }
}
