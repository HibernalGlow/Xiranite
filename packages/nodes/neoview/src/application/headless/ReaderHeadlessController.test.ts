import { describe, expect, it, vi } from "vitest"
import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderBookLoadOptions } from "../../ports/ReaderBookLoader.js"
import { CoreReaderService } from "../reader/ReaderService.js"
import { ReaderMediaProgressService } from "../reader/ReaderMediaProgressService.js"
import { ReaderBookMetadataService } from "../metadata/ReaderBookMetadataService.js"
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
      expect(controller.listPages(1, 2).map((page) => page.name)).toEqual(["002.png", "003.png"])
      expect(await controller.next()).toMatchObject({ frame: { anchorPageIndex: 1 }, preload: { generation: 2, direction: "forward" } })
      expect((await controller.goTo(2)).visiblePages[0]?.index).toBe(2)
      expect(await controller.previous()).toMatchObject({ frame: { anchorPageIndex: 1 }, preload: { direction: "backward" } })
      expect(() => controller.listPages(0, 501)).toThrow("limit")
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
