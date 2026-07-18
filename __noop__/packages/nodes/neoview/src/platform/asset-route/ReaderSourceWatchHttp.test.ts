import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader source watch HTTP", () => {
  it("[neoview.control.source-watch-http] lazily exposes pathless changes and releases on session close", async () => {
    let publish: Parameters<ReaderSourceWatcher["subscribe"]>[1] | undefined
    const close = vi.fn(async () => undefined)
    const sourceWatcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async (_source, onChanges) => {
        publish = onChanges
        return { close, [Symbol.asyncDispose]: close }
      }),
    }
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      sourceWatcher,
    })
    try {
      const directory = await fixtureDirectory()
      const opened = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      expect(sourceWatcher.subscribe).not.toHaveBeenCalled()

      const pending = controller.handle(authorized(`/reader/s/${opened.sessionId}/source-changes?after=0`))
      await vi.waitFor(() => expect(publish).toBeTypeOf("function"))
      publish!([{ kind: "create" }])
      const response = (await pending)!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ revision: 1, state: "changed", kinds: ["create"], count: 1 })

      expect((await controller.handle(authorized(`/reader/s/${opened.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.source-watch-validation] rejects missing revisions and unknown sessions", async () => {
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token", progressStore: false })
    try {
      expect((await controller.handle(authorized("/reader/s/missing/source-changes?after=0")))?.status).toBe(404)
      const directory = await fixtureDirectory()
      const opened = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      expect((await controller.handle(authorized(`/reader/s/${opened.sessionId}/source-changes`)))?.status).toBe(400)
      expect((await controller.handle(authorized(`/reader/s/${opened.sessionId}/source-changes?after=-1`)))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.source-watch-privacy] does not expose native subscription errors or source paths", async () => {
    const sourceWatcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async () => {
        throw new Error("cannot watch D:/private/library")
      }),
    }
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      sourceWatcher,
    })
    try {
      const directory = await fixtureDirectory()
      const opened = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const response = (await controller.handle(authorized(`/reader/s/${opened.sessionId}/source-changes?after=0`)))!
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({ error: "Reader source watch unavailable" })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-source-watch-"))
  roots.push(directory)
  await writeFile(join(directory, "1.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))
  return directory
}

function jsonRequest(path: string, body: unknown): Request {
  return authorized(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

function authorized(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("x-xiranite-token", "reader-token")
  return new Request(`http://127.0.0.1:41000${path}`, { ...init, headers })
}
