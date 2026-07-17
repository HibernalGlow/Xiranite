import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore, ReaderEmmOverrides } from "../../ports/ReaderEmmOverrideStore.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader directory EMM edit HTTP", () => {
  it("[neoview.folder.emm-edit-http] edits current listing members and refreshes visible metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-emm-"))
    cleanup.push(directory)
    await Promise.all([
      writeFile(join(directory, "A.jpg"), Uint8Array.of(1)),
      writeFile(join(directory, "B.jpg"), Uint8Array.of(2)),
    ])
    const store = memoryEmmStore()
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "folder-emm-token",
      progressStore: false,
      directoryEmmRecordStore: store,
      emmOverrideStore: store,
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: directory }, 201) as BrowserPage
      const first = opened.entries[0]!
      const endpoint = `/reader/browser/s/${encodeURIComponent(opened.sessionId)}/emm-metadata`
      const updated = await json(controller, endpoint, "PATCH", {
        generation: opened.generation,
        updates: [{
          path: first.path,
          expectedRevision: 0,
          patch: { rating: 5, manualTags: [{ namespace: "artist", tag: "Alice" }] },
        }],
      }) as Record<string, unknown>
      expect(updated).toMatchObject({
        generation: opened.generation + 1,
        refreshRequired: false,
        succeeded: 1,
        conflicts: 0,
        failed: 0,
        results: [{ index: 0, status: "succeeded", metadata: { revision: 1 } }],
      })
      expect(JSON.stringify(updated)).not.toContain(directory)

      const refreshed = await json(
        controller,
        `/reader/browser/s/${encodeURIComponent(opened.sessionId)}/entries?cursor=0&limit=16&fields=tags`,
      ) as BrowserPage
      expect(refreshed.generation).toBe(opened.generation + 1)
      expect(refreshed.entries.find((entry) => entry.path === first.path)).toMatchObject({
        rating: 5,
        tags: ["artist:Alice"],
      })

      const stale = await json(controller, endpoint, "PATCH", {
        generation: opened.generation,
        updates: [{ path: first.path, expectedRevision: 1, patch: { rating: 4 } }],
      }, 409)
      expect(stale).toMatchObject({ error: expect.stringContaining("stale") })

      const conflict = await json(controller, endpoint, "PATCH", {
        generation: refreshed.generation,
        updates: [{ path: first.path, expectedRevision: 0, patch: { rating: 4 } }],
      })
      expect(conflict).toMatchObject({
        generation: refreshed.generation,
        succeeded: 0,
        conflicts: 1,
        results: [{ index: 0, status: "conflict", actualRevision: 1 }],
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.emm-edit-boundary] rejects non-members and unavailable persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-emm-boundary-"))
    cleanup.push(directory)
    await writeFile(join(directory, "A.jpg"), Uint8Array.of(1))
    const store = memoryEmmStore()
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "folder-emm-token",
      progressStore: false,
      directoryEmmRecordStore: store,
      emmOverrideStore: store,
    })
    const unavailable = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "folder-emm-token",
      progressStore: false,
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: directory }, 201) as BrowserPage
      await json(controller, `/reader/browser/s/${opened.sessionId}/emm-metadata`, "PATCH", {
        generation: opened.generation,
        updates: [{ path: join(directory, "outside.jpg"), expectedRevision: 0, patch: { rating: 5 } }],
      }, 400)
      expect(store.saveEmmOverride).not.toHaveBeenCalled()

      const unavailableSession = await json(unavailable, "/reader/browser/sessions", "POST", { path: directory }, 201) as BrowserPage
      const response = await json(unavailable, `/reader/browser/s/${unavailableSession.sessionId}/emm-metadata`, "PATCH", {
        generation: unavailableSession.generation,
        updates: [{ path: unavailableSession.entries[0]!.path, expectedRevision: 0, patch: { rating: 5 } }],
      }, 503)
      expect(response).toEqual({ error: "Reader EMM metadata editing is unavailable" })
    } finally {
      await controller[Symbol.asyncDispose]()
      await unavailable[Symbol.asyncDispose]()
    }
  })
})

interface BrowserPage {
  sessionId: string
  generation: number
  entries: Array<{ path: string; rating?: number; tags?: string[] }>
}

async function json(
  controller: ReaderHttpController,
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
): Promise<unknown> {
  const response = await controller.handle(new Request(`http://127.0.0.1:41000${path}`, {
    method,
    headers: {
      "x-xiranite-token": "folder-emm-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  expect(response?.status).toBe(status)
  return response ? response.json() : undefined
}

function memoryEmmStore(): ReaderEmmOverrideStore & ReaderDirectoryEmmRecordStore & {
  saveEmmOverride: ReturnType<typeof vi.fn>
} {
  const records = new Map<string, ReaderEmmOverrideRecord>()
  const get = (path: string) => records.get(normalize(path))
  const saveEmmOverride = vi.fn(async (path: string, overrides: ReaderEmmOverrides, expectedRevision: number, updatedAt: number) => {
    const key = normalize(path)
    const current = records.get(key)
    if ((current?.revision ?? 0) !== expectedRevision) return undefined
    const record = { path, overrides, revision: expectedRevision + 1, updatedAt }
    records.set(key, record)
    return record
  })
  return {
    directoryEmmAvailable: true,
    getEmmOverride: vi.fn(async (path) => get(path)),
    saveEmmOverride,
    readDirectoryEmmRecords: vi.fn(async (paths: readonly string[]) => new Map(paths.flatMap((path) => {
      const record = get(path)
      if (!record) return []
      return [[path, {
        ratingData: record.overrides.rating === undefined ? undefined : JSON.stringify({ value: record.overrides.rating }),
        manualTags: record.overrides.manualTags === undefined ? undefined : JSON.stringify(record.overrides.manualTags),
        emmJson: record.overrides.translatedTitle === undefined ? undefined : JSON.stringify({ translated_title: record.overrides.translatedTitle }),
      }]]
    }))),
  }
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}
