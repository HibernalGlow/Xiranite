import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "../../application/reader/ReaderService.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader adjacent-book HTTP", () => {
  it("[neoview.control.expanded-adjacent-book] advances within an expanded branch from its actual selected entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-expanded-adjacent-http-"))
    roots.push(root)
    const series = join(root, "series")
    const first = join(series, "Book 1")
    const second = join(series, "Book 2")
    const third = join(series, "Book 3")
    await Promise.all([mkdir(first, { recursive: true }), mkdir(second, { recursive: true }), mkdir(third, { recursive: true })])
    await Promise.all([
      writeFile(join(first, "1.jpg"), Uint8Array.of(1)),
      writeFile(join(second, "1.jpg"), Uint8Array.of(2)),
      writeFile(join(third, "1.jpg"), Uint8Array.of(3)),
    ])
    const controller = createController()
    try {
      const opened = await request(controller, "/reader/sessions", "POST", {
        path: second,
        provenance: {
          browserOriginPath: root,
          browserOriginEntryPath: second,
          browserOriginTraversalFrames: [
            { directoryPath: root, currentEntryPath: series },
            { directoryPath: series, currentEntryPath: second },
          ],
        },
      })
      expect(opened.status).toBe(201)
      const current = await opened.json() as { sessionId: string }

      const switched = await request(controller, `/reader/s/${current.sessionId}/adjacent-book`, "POST", { direction: "next" })
      expect(switched.status).toBe(201)
      const adjacent = await switched.json() as {
        book: { displayName: string }
        activationIdentity: { activatedEntryPath: string; traversalFrames?: readonly { directoryPath: string; currentEntryPath: string }[] }
      }
      expect(adjacent.book.displayName).toBe("Book 3")
      expect(adjacent.activationIdentity).toMatchObject({
        activatedEntryPath: third,
        traversalFrames: [
          { directoryPath: root, currentEntryPath: series },
          { directoryPath: series, currentEntryPath: third },
        ],
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.hierarchical-book] preserves non-penetrable branches and restores progress through hierarchical traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-hierarchical-http-"))
    roots.push(root)
    const a = join(root, "A")
    const aChild = join(a, "4")
    const b1 = join(root, "B", "Book 1")
    const b2 = join(root, "B", "Book 2")
    const c = join(root, "C", "nested")
    await Promise.all([mkdir(aChild, { recursive: true }), mkdir(b1, { recursive: true }), mkdir(b2, { recursive: true }), mkdir(c, { recursive: true })])
    await Promise.all([
      writeFile(join(a, "1.jpg"), Uint8Array.of(1)),
      writeFile(join(aChild, "1.jpg"), Uint8Array.of(6)),
      writeFile(join(b1, "1.jpg"), Uint8Array.of(2)),
      writeFile(join(b2, "1.jpg"), Uint8Array.of(3)),
      writeFile(join(b2, "2.jpg"), Uint8Array.of(4)),
      writeFile(join(c, "1.jpg"), Uint8Array.of(5)),
    ])
    const controller = createController(memoryProgressStore())
    try {
      const opened = await request(controller, "/reader/sessions", "POST", {
        path: a,
        provenance: { browserOriginPath: root, browserOriginEntryPath: a, browserOriginSelfTerminal: true },
      })
      expect(opened.status).toBe(201)
      let current = await opened.json() as {
        sessionId: string
        activationIdentity: { readerSourcePath: string; activatedEntryPath: string; traversalRootPath: string }
        book: { displayName: string }
        frame: { anchorPageIndex: number }
      }
      expect(current.activationIdentity).toMatchObject({
        readerSourcePath: a,
        activatedEntryPath: a,
        traversalRootPath: root,
      })
      const names: string[] = []
      const activatedEntries: string[] = []
      for (let index = 0; index < 4; index += 1) {
        const switched = await request(controller, `/reader/s/${current.sessionId}/adjacent-book`, "POST", { direction: "next" })
        expect(switched.status).toBe(201)
        current = await switched.json() as typeof current
        names.push(current.book.displayName)
        activatedEntries.push(current.activationIdentity.activatedEntryPath)
      }
      expect(names).toEqual(["4", "Book 1", "Book 2", "nested"])
      expect(activatedEntries).toEqual([aChild, b1, b2, join(root, "C")])

      const previous = await request(controller, `/reader/s/${current.sessionId}/adjacent-book`, "POST", { direction: "previous" })
      expect(previous.status).toBe(201)
      const previousBook = await previous.json() as typeof current
      expect(previousBook.book.displayName).toBe("Book 2")
      expect(previousBook.frame.anchorPageIndex).toBe(0)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.adjacent-book-progress] restores the previous book's saved page instead of forcing its last page", async () => {
    const { first } = await fixture()
    await writeFile(join(first, "2.jpg"), Uint8Array.of(3))
    const controller = createController(memoryProgressStore())
    try {
      const opened = await open(controller, first)
      const nextResponse = await request(controller, `/reader/s/${opened.sessionId}/adjacent-book`, "POST", { direction: "next" })
      expect(nextResponse.status).toBe(201)
      const next = await nextResponse.json() as { sessionId: string; frame: { anchorPageIndex: number } }
      expect(next.frame.anchorPageIndex).toBe(0)

      const previousResponse = await request(controller, `/reader/s/${next.sessionId}/adjacent-book`, "POST", { direction: "previous" })
      expect(previousResponse.status).toBe(201)
      const previous = await previousResponse.json() as typeof next
      expect(previous.frame.anchorPageIndex).toBe(0)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.adjacent-book] atomically switches naturally ordered sibling books and reports boundaries", async () => {
    const { first } = await fixture()
    const controller = createController()
    try {
      const opened = await open(controller, first)
      const switched = await request(controller, `/reader/s/${opened.sessionId}/adjacent-book`, "POST", { direction: "next" })
      expect(switched.status).toBe(201)
      const next = await switched.json() as { sessionId: string; book: { displayName: string } }
      expect(next.book.displayName).toBe("Book 2")
      expect((await request(controller, `/reader/s/${opened.sessionId}`, "GET")).status).toBe(404)
      expect((await request(controller, `/reader/s/${next.sessionId}/adjacent-book`, "POST", { direction: "next" })).status).toBe(204)
      expect((await request(controller, `/reader/s/${next.sessionId}`, "GET")).status).toBe(200)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.adjacent-book-rollback] preserves the current session when replacement opening fails", async () => {
    const { first } = await fixture()
    const controller = createController()
    try {
      const opened = await open(controller, first)
      vi.spyOn(CoreReaderService.prototype, "openViewSource").mockRejectedValueOnce(new Error("replacement failed"))
      const failed = await request(controller, `/reader/s/${opened.sessionId}/adjacent-book`, "POST", {
        direction: "next",
        sort: { field: "name", order: "asc", directoriesFirst: true },
      })
      expect(failed.status).toBe(400)
      expect(await failed.json()).toEqual({ error: "replacement failed" })
      expect((await request(controller, `/reader/s/${opened.sessionId}`, "GET")).status).toBe(200)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("rejects malformed adjacent-book controls before scanning", async () => {
    const { first } = await fixture()
    const controller = createController()
    try {
      const opened = await open(controller, first)
      const invalid = await request(controller, `/reader/s/${opened.sessionId}/adjacent-book`, "POST", {
        direction: "sideways",
        sort: { field: "name", order: "asc", directoriesFirst: true },
      })
      expect(invalid.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function createController(progressStore: ReaderProgressStore | false = false): ReaderHttpController {
  return new ReaderHttpController({
    baseUrl: "http://127.0.0.1:43131",
    token: "adjacent-token",
    progressStore,
  })
}

function memoryProgressStore(): ReaderProgressStore {
  const records = new Map<string, ReaderProgressRecord>()
  return {
    get: async (bookId) => records.get(bookId),
    save: async (record) => { records.set(record.bookId, record) },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  }
}

async function open(controller: ReaderHttpController, path: string): Promise<{ sessionId: string }> {
  const response = await request(controller, "/reader/sessions", "POST", { path })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ sessionId: string }>
}

function request(
  controller: ReaderHttpController,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  return controller.handle(new Request(`http://127.0.0.1:43131${path}`, {
    method,
    headers: {
      "x-xiranite-token": "adjacent-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).then((response) => response!)
}

async function fixture(): Promise<{ root: string; first: string; second: string }> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-adjacent-http-"))
  roots.push(root)
  const first = join(root, "Book 1")
  const second = join(root, "Book 2")
  await Promise.all([mkdir(first), mkdir(second)])
  await Promise.all([
    writeFile(join(first, "1.jpg"), Uint8Array.of(1)),
    writeFile(join(second, "1.jpg"), Uint8Array.of(2)),
  ])
  return { root, first, second }
}
