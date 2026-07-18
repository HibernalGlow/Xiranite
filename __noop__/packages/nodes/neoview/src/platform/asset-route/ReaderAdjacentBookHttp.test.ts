import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader adjacent-book HTTP", () => {
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

function createController(): ReaderHttpController {
  return new ReaderHttpController({
    baseUrl: "http://127.0.0.1:43131",
    token: "adjacent-token",
    progressStore: false,
  })
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
