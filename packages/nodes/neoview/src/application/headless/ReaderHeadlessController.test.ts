import { describe, expect, it, vi } from "vitest"
import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderBookLoadOptions } from "../../ports/ReaderBookLoader.js"
import type { ReaderBookSettingsRecord, ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore, ReaderEmmOverrides } from "../../ports/ReaderEmmOverrideStore.js"
import { CoreReaderService } from "../reader/ReaderService.js"
import { ReaderMediaProgressService } from "../reader/ReaderMediaProgressService.js"
import { ReaderBookSettingsService } from "../reader/ReaderBookSettingsService.js"
import type { ReaderAdjacentBookService } from "../reader/ReaderAdjacentBookService.js"
import { ReaderBookMetadataService } from "../metadata/ReaderBookMetadataService.js"
import { ReaderEmmMetadataService } from "../metadata/ReaderEmmMetadataService.js"
import { ReaderHeadlessController } from "./ReaderHeadlessController.js"

describe("ReaderHeadlessController", () => {
  it("[neoview.headless.session] opens and replaces books without exposing source paths", async () => {
    const closed: string[] = []
    const loadOptions: ReaderBookLoadOptions[] = []
    const service = new CoreReaderService(async (source, options = {}) => {
      loadOptions.push(options)
      return book(String("path" in source ? source.path : source.kind), closed)
    })
    const controller = new ReaderHeadlessController(service)
    const password = new Uint8Array([115, 101, 99, 114, 101, 116])
    try {
      const first = await controller.open({
        path: "D:/private/first.cbz",
        entryPaths: ["nested.cbz"],
        archivePasswords: [{ rawPassword: password }],
      })
      expect(first.book).toEqual({ displayName: "first.cbz", pageCount: 3, sourceKind: "archive", sourceFormat: undefined, translatedTitle: undefined })
      expect(JSON.stringify(first)).not.toContain("D:/private")
      expect(loadOptions[0]?.archivePasswords?.[0]?.rawPassword).toBe(password)

      await controller.open({ path: "D:/private/second.cbz" })
      expect(closed).toEqual(["D:/private/first.cbz"])
    } finally {
      password.fill(0)
      await controller[Symbol.asyncDispose]()
    }
    expect(closed).toEqual(["D:/private/first.cbz", "D:/private/second.cbz"])
  })

  it("[neoview.headless.navigation] shares frame navigation and bounded page listings", async () => {
    const controller = controllerFor("D:/book.cbz")
    try {
      const opened = await controller.open({ path: "D:/book.cbz" })
      expect(opened.preload).toMatchObject({ generation: 1, direction: "forward" })
      expect(opened.visiblePages[0]?.timestamps).toEqual({ source: "archive-entry", createdAtMs: 1_700_000_000_000, modifiedAtMs: 1_700_000_100_000, accessedAtMs: 1_700_000_200_000 })
      expect(controller.listPages(1, 2).map((page) => page.name)).toEqual(["002.png", "003.png"])
      expect(await controller.next()).toMatchObject({ frame: { anchorPageIndex: 1 }, preload: { generation: 2, direction: "forward" } })
      expect((await controller.goTo(2)).visiblePages[0]?.index).toBe(2)
      expect(await controller.previous()).toMatchObject({ frame: { anchorPageIndex: 1 }, preload: { direction: "backward" } })
      expect(() => controller.listPages(0, 501)).toThrow("limit")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.headless.adjacent-book] resolves and atomically replaces a sibling book through the shared service", async () => {
    const closed: string[] = []
    const resolve = vi.fn(async () => ({ path: "D:/Library/Book 2", name: "Book 2", index: 1, total: 2 }))
    const service = new CoreReaderService(async (source) => book("path" in source ? source.path : source.kind, closed))
    const controller = new ReaderHeadlessController(
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      { resolve } as unknown as ReaderAdjacentBookService,
    )
    try {
      await controller.open({ path: "D:/Library/Book 1" })
      const next = await controller.openAdjacent("next", { field: "name", order: "asc", directoriesFirst: true })
      expect(next?.book.displayName).toBe("Book 2")
      expect(closed).toEqual(["D:/Library/Book 1"])
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        source: { kind: "archive", path: "D:/Library/Book 1" },
        direction: "next",
        sort: { field: "name", order: "asc", directoriesFirst: true },
      }), undefined)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-information.headless-contract] shares one bounded EMM title load across inspect and navigation", async () => {
    const readDirectoryEmmRecords = vi.fn(async (paths: readonly string[]) => new Map([
      [paths[0]!, { emmJson: JSON.stringify({ translated_title: "译名", tags: [{ tag: "hidden" }] }) }],
    ]))
    const service = new CoreReaderService(async (source) => book(source.path, []))
    const controller = new ReaderHeadlessController(
      service,
      undefined,
      undefined,
      new ReaderBookMetadataService({ directoryEmmAvailable: true, readDirectoryEmmRecords }),
    )
    try {
      const opened = await controller.open({ path: "D:/private/book.cbz" })
      expect(opened.book).toEqual({ displayName: "book.cbz", pageCount: 3, sourceKind: "archive", sourceFormat: undefined, translatedTitle: "译名" })
      expect(JSON.stringify(opened)).not.toContain("D:/private")
      expect(JSON.stringify(opened)).not.toContain("tags")
      await controller.next()
      controller.inspect()
      expect(readDirectoryEmmRecords).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm.headless-contract] shares revisioned overrides and refreshes translated book metadata", async () => {
    const overrides = memoryEmmStore()
    const readDirectoryEmmRecords = vi.fn(async (paths: readonly string[]) => {
      const record = await overrides.getEmmOverride(paths[0]!)
      return new Map([[paths[0]!, {
        emmJson: JSON.stringify({ translated_title: record?.overrides.translatedTitle ?? "旧译名" }),
      }]])
    })
    const controller = new ReaderHeadlessController(
      new CoreReaderService(async (source) => book(source.path, [])),
      undefined,
      undefined,
      new ReaderBookMetadataService({ directoryEmmAvailable: true, readDirectoryEmmRecords }),
      undefined,
      undefined,
      new ReaderEmmMetadataService(overrides),
    )
    try {
      expect((await controller.open({ path: "D:/private/book.cbz" })).book.translatedTitle).toBe("旧译名")
      await expect(controller.getEmmMetadata()).resolves.toEqual({
        revision: 0,
        overrides: {},
        inherited: ["rating", "manualTags", "translatedTitle"],
        updatedAt: undefined,
      })
      const updated = await controller.updateEmmMetadata(0, {
        rating: 5,
        manualTags: [{ namespace: "artist", tag: "Alice" }],
        translatedTitle: "新译名",
      })
      expect(updated.metadata).toMatchObject({ revision: 1, overrides: { rating: 5, translatedTitle: "新译名" } })
      expect(updated.reader.book.translatedTitle).toBe("新译名")
      await expect(controller.updateEmmMetadata(0, { rating: 4 })).rejects.toMatchObject({
        name: "ReaderEmmMetadataRevisionConflict",
        actualRevision: 1,
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.headless.page-stream] streams a page and closes its owned source", async () => {
    const close = vi.fn(async () => undefined)
    const controller = controllerFor("D:/book.cbz", close)
    try {
      await controller.open({ path: "D:/book.cbz" })
      const output = await controller.openPageStream(1)
      expect(output.page).toMatchObject({ index: 1, name: "002.png", mimeType: "image/png" })
      expect(output.byteLength).toBe(3)
      const bytes = new Uint8Array(await new Response(output.stream).arrayBuffer())
      expect([...bytes]).toEqual([1, 2, 3])
      await output.close()
      await output.close()
      expect(close).toHaveBeenCalledTimes(1)
      await expect(controller.openPageStream(3)).rejects.toThrow("out of range")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.super-resolution.headless] delegates the open page without exposing its source path", async () => {
    const dispose = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({
      decision: { kind: "run" as const, reason: "default-policy", modelId: "model", scale: 2, useCache: true },
      result: {
        sourcePath: "D:/private/book.cbz::2.png",
        destinationPath: "D:/output/page.png",
        modelId: "model",
        engine: "upscayl" as const,
        scale: 2,
        width: 200,
        height: 300,
        elapsedMs: 10,
      },
    }))
    const controller = new ReaderHeadlessController(
      new CoreReaderService(async () => book("D:/private/book.cbz", [])),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        run,
        inspect: async () => ({ available: false, reason: "test", models: [], engines: [] }),
        [Symbol.asyncDispose]: dispose,
      },
    )
    try {
      await controller.open({ path: "D:/private/book.cbz" })
      const output = await controller.upscalePage({ pageIndex: 1, destinationPath: "D:/output/page.png" })
      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        page: expect.objectContaining({ id: "page-1", entryPath: "2.png" }),
        bookPath: "D:/private/book.cbz",
        trigger: "manual",
      }), {})
      expect(output).toMatchObject({ result: { destinationPath: "D:/output/page.png", width: 200, height: 300 } })
      expect(JSON.stringify(output)).not.toContain("sourcePath")
      await expect(controller.upscalePage({ pageIndex: 3, destinationPath: "D:/output/page.png" })).rejects.toThrow("out of range")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("[neoview.headless.media-progress] shares restore and durable updates with CLI/TUI", async () => {
    const saved = vi.fn(async () => undefined)
    const mediaProgress = new ReaderMediaProgressService({
      getMediaProgress: vi.fn(async () => ({
        bookId: "opaque-book",
        position: 5,
        duration: 20,
        completed: false,
        updatedAt: 1,
      })),
      saveMediaProgress: saved,
    }, () => 2, 60_000)
    const service = new CoreReaderService(async () => videoBook("D:/clip.mp4"))
    const controller = new ReaderHeadlessController(service, undefined, mediaProgress)
    try {
      await controller.open({ path: "D:/clip.mp4" })
      await expect(controller.getMediaProgress()).resolves.toMatchObject({ position: 5, duration: 20 })
      await expect(controller.updateMediaProgress({
        position: 10,
        duration: 20,
        completed: false,
      }, { flush: true })).resolves.toMatchObject({ position: 10, updatedAt: 2 })
      expect(saved).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-settings.headless] shares restored values, CAS updates and frame projection with GUI", async () => {
    const store = memoryBookSettingsStore({
      bookId: "opaque-book",
      overrides: { direction: "right-to-left", rating: 4 },
      revision: 2,
      updatedAt: 10,
    })
    const service = new CoreReaderService(async () => book("D:/book.cbz", []), undefined, {}, undefined, store)
    const controller = new ReaderHeadlessController(service, undefined, undefined, undefined, {
      service: new ReaderBookSettingsService(store, () => 20),
      defaults: { favorite: false, rating: 0, direction: "left-to-right", pageMode: "single", horizontalBook: true },
    })
    try {
      expect((await controller.open({ path: "D:/book.cbz" })).frame.direction).toBe("right-to-left")
      await expect(controller.getBookSettings()).resolves.toMatchObject({
        revision: 2,
        overrides: { direction: "right-to-left", rating: 4 },
        effective: { direction: "right-to-left", pageMode: "single", horizontalBook: true },
      })
      const updated = await controller.updateBookSettings(2, {
        favorite: true,
        direction: null,
        pageMode: "double",
        horizontalBook: true,
      })
      expect(updated.settings).toMatchObject({
        revision: 3,
        overrides: { favorite: true, rating: 4, pageMode: "double", horizontalBook: true },
        effective: { direction: "left-to-right", pageMode: "double", horizontalBook: true },
      })
      expect(updated.reader.frame).toMatchObject({
        direction: "left-to-right",
        layout: { pageMode: "double", treatWidePageAsSingle: true },
      })

      await expect(controller.updateBookSettings(2, { rating: 5 })).rejects.toMatchObject({
        name: "ReaderBookSettingsRevisionConflict",
        actualRevision: 3,
      })
      expect(controller.inspect().frame).toEqual(updated.reader.frame)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-settings.headless-rollback] restores the confirmed frame when persistence fails", async () => {
    const store = memoryBookSettingsStore()
    store.saveBookSettings = vi.fn(async () => { throw new Error("write failed") })
    const controller = new ReaderHeadlessController(
      new CoreReaderService(async () => book("D:/book.cbz", [])),
      undefined,
      undefined,
      undefined,
      {
        service: new ReaderBookSettingsService(store),
        defaults: { favorite: false, rating: 0, direction: "left-to-right", pageMode: "single", horizontalBook: true },
      },
    )
    try {
      const opened = await controller.open({ path: "D:/book.cbz" })
      await expect(controller.updateBookSettings(0, {
        direction: "right-to-left",
        pageMode: "double",
      })).rejects.toThrow("write failed")
      expect(controller.inspect().frame).toMatchObject({
        anchorPageIndex: opened.frame.anchorPageIndex,
        direction: opened.frame.direction,
        layout: opened.frame.layout,
        pages: opened.frame.pages,
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("rejects use after disposal and invalid archive stacks", async () => {
    const controller = controllerFor("D:/book.cbz")
    await expect(controller.open({ path: "D:/book.cbz", entryPaths: [] })).rejects.toThrow("entry paths")
    await controller[Symbol.asyncDispose]()
    await expect(controller.open({ path: "D:/book.cbz" })).rejects.toThrow("closed")
  })

  it("keeps the newly adopted session usable when closing the previous book fails", async () => {
    let loadCount = 0
    const service = new CoreReaderService(async () => {
      loadCount += 1
      const value = book(`D:/book-${loadCount}.cbz`, [])
      if (loadCount === 1) value.close = async () => { throw new Error("old close failed") }
      return value
    })
    const controller = new ReaderHeadlessController(service)
    await controller.open({ path: "D:/book-1.cbz" })
    await expect(controller.open({ path: "D:/book-2.cbz" })).rejects.toThrow("old close failed")
    expect(controller.inspect().book.displayName).toBe("book-2.cbz")
    await controller[Symbol.asyncDispose]()
  })
})

function controllerFor(path: string, onSourceClose = vi.fn(async () => undefined)): ReaderHeadlessController {
  return new ReaderHeadlessController(new CoreReaderService(async () => book(path, [], onSourceClose)))
}

function book(path: string, closed: string[], onSourceClose = vi.fn(async () => undefined)): ReaderBook {
  const displayName = path.replace(/\\/g, "/").split("/").at(-1) ?? path
  return {
    id: "opaque-book",
    source: { kind: "archive", path },
    displayName,
    pages: [0, 1, 2].map((index) => ({
      id: `page-${index}`,
      index,
      name: `${String(index + 1).padStart(3, "0")}.png`,
      sourcePath: path,
      entryPath: `${index + 1}.png`,
      mediaKind: "image" as const,
      mimeType: "image/png",
      byteLength: 3,
      contentVersion: `v${index}`,
      timestamps: { source: "archive-entry" as const, createdAtMs: 1_700_000_000_000, modifiedAtMs: 1_700_000_100_000, accessedAtMs: 1_700_000_200_000 },
      content: {
        load: async (): Promise<PageSource> => ({
          byteLength: 3,
          contentType: "image/png",
          rangeSupported: false,
          open: async () => new ReadableStream({
            start(streamController) {
              streamController.enqueue(Uint8Array.of(index, index + 1, index + 2))
              streamController.close()
            },
          }),
          close: onSourceClose,
          [Symbol.asyncDispose]: onSourceClose,
        }),
      },
    })),
    async close() {
      closed.push(path)
    },
    async [Symbol.asyncDispose]() {
      await this.close()
    },
  }
}

function videoBook(path: string): ReaderBook {
  const value = book(path, [])
  return {
    ...value,
    pages: [{
      ...value.pages[0]!,
      name: "clip.mp4",
      entryPath: undefined,
      mediaKind: "video",
      mimeType: "video/mp4",
    }],
  }
}

function memoryBookSettingsStore(initial?: ReaderBookSettingsRecord): ReaderBookSettingsStore {
  let record = initial
  return {
    getBookSettings: vi.fn(async () => record),
    saveBookSettings: vi.fn(async (bookId, overrides, expectedRevision, updatedAt) => {
      if ((record?.revision ?? 0) !== expectedRevision) return undefined
      record = { bookId, overrides, revision: expectedRevision + 1, updatedAt }
      return record
    }),
    importBookSettings: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0 })),
  }
}

function memoryEmmStore(): ReaderEmmOverrideStore {
  let record: ReaderEmmOverrideRecord | undefined
  return {
    getEmmOverride: vi.fn(async (path) => record?.path === path ? record : undefined),
    saveEmmOverride: vi.fn(async (path, overrides: ReaderEmmOverrides, expectedRevision, updatedAt) => {
      if ((record?.revision ?? 0) !== expectedRevision) return undefined
      record = { path, overrides, revision: expectedRevision + 1, updatedAt }
      return record
    }),
  }
}
