import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ReaderDirectoryEmmRecord,
  ReaderDirectoryEmmRecordStore,
} from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore, ReaderEmmOverrides } from "../../ports/ReaderEmmOverrideStore.js"
import { legacyEmmBookPathKey } from "../../application/metadata/LegacyEmmBookMetadataCodec.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader EMM metadata HTTP", () => {
  it("[neoview.emm-raw-data.http] exposes only bounded raw fields through authenticated cached metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-emm-raw-http-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1, 2, 3))
    const expectedLegacyPath = legacyEmmBookPathKey(directory)
    const record: ReaderDirectoryEmmRecord & { unallowedSentinel: string } = {
      rawFields: [
        { key: "filepath", type: "path", value: "D:/bounded/demo.cbz" },
        { key: "filesize", type: "bytes", value: 1_048_576 },
      ],
      unallowedSentinel: "must-not-cross-http-boundary",
    }
    const readDirectoryEmmRecords = vi.fn(async (
      paths: readonly string[],
      _signal?: AbortSignal,
      options?: { includeRaw?: boolean },
    ) => new Map(paths.map((path) => [path, options?.includeRaw ? record : {}])))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "emm-token",
      progressStore: false,
      directoryEmmRecordStore: { directoryEmmAvailable: true, readDirectoryEmmRecords },
    })
    try {
      const opened = await json(controller, "/reader/sessions", "POST", { path: directory }, 201)
      const sessionId = String((opened as { sessionId: unknown }).sessionId)
      const endpoint = `/reader/s/${encodeURIComponent(sessionId)}/metadata`

      const unauthorized = await controller.handle(new Request(`http://127.0.0.1:41000${endpoint}`))
      expect(unauthorized?.status).toBe(401)

      const metadata = await json(controller, endpoint) as {
        book?: { emmRaw?: { schemaVersion?: number; fields?: unknown[] } }
      }
      expect(metadata.book?.emmRaw).toEqual({
        schemaVersion: 1,
        fields: [
          { key: "filepath", type: "path", value: "D:/bounded/demo.cbz" },
          { key: "filesize", type: "bytes", value: 1_048_576 },
        ],
      })
      expect(JSON.stringify(metadata)).not.toContain("must-not-cross-http-boundary")
      expect(readDirectoryEmmRecords).toHaveBeenCalledWith(
        [expectedLegacyPath],
        expect.any(AbortSignal),
        { includeRaw: true },
      )

      await json(controller, endpoint)
      expect(readDirectoryEmmRecords).toHaveBeenCalledTimes(1)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm.gui-contract] updates and resets non-destructive overrides with CAS and metadata refresh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-emm-http-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1, 2, 3))
    const store = memoryEmmStore("旧译名")
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "emm-token",
      progressStore: false,
      directoryEmmRecordStore: store,
      emmOverrideStore: store,
    })
    try {
      const opened = await json(controller, "/reader/sessions", "POST", { path: directory }, 201)
      const sessionId = String((opened as { sessionId: unknown }).sessionId)
      const endpoint = `/reader/s/${encodeURIComponent(sessionId)}/emm-metadata`

      expect(await json(controller, endpoint)).toEqual({
        revision: 0,
        overrides: {},
        inherited: ["rating", "manualTags", "translatedTitle"],
      })
      expect(await translatedTitle(controller, sessionId)).toBe("旧译名")

      const updated = await json(controller, endpoint, "PATCH", {
        expectedRevision: 0,
        patch: {
          rating: 5,
          manualTags: [{ namespace: "artist", tag: "Alice" }],
          translatedTitle: "新译名",
        },
      })
      expect(updated).toMatchObject({
        revision: 1,
        overrides: {
          rating: 5,
          manualTags: [{ namespace: "artist", tag: "Alice" }],
          translatedTitle: "新译名",
        },
        inherited: [],
      })
      expect(JSON.stringify(updated)).not.toContain(directory)
      expect(await translatedTitle(controller, sessionId)).toBe("新译名")

      const conflict = await json(controller, endpoint, "PATCH", {
        expectedRevision: 0,
        patch: { rating: 4 },
      }, 409)
      expect(conflict).toMatchObject({ actualRevision: 1 })

      const reset = await json(controller, endpoint, "PATCH", {
        expectedRevision: 1,
        patch: { rating: null, manualTags: null, translatedTitle: null },
      })
      expect(reset).toMatchObject({ revision: 2, overrides: {}, inherited: ["rating", "manualTags", "translatedTitle"] })
      expect(await translatedTitle(controller, sessionId)).toBe("旧译名")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm.gui-unavailable] reports an unavailable optional store without exposing session data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-emm-http-unavailable-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "emm-token",
      progressStore: false,
    })
    try {
      const opened = await json(controller, "/reader/sessions", "POST", { path: directory }, 201)
      const sessionId = String((opened as { sessionId: unknown }).sessionId)
      const response = await json(controller, `/reader/s/${encodeURIComponent(sessionId)}/emm-metadata`, "GET", undefined, 503)
      expect(response).toEqual({ error: "Reader EMM metadata is unavailable" })
      expect(JSON.stringify(response)).not.toContain(directory)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function translatedTitle(controller: ReaderHttpController, sessionId: string): Promise<string | undefined> {
  const metadata = await json(controller, `/reader/s/${encodeURIComponent(sessionId)}/metadata`)
  return (metadata as { book?: { emm?: { translatedTitle?: string } } }).book?.emm?.translatedTitle
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
      "x-xiranite-token": "emm-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  expect(response?.status).toBe(status)
  return response ? response.json() : undefined
}

function memoryEmmStore(legacyTitle: string): ReaderEmmOverrideStore & ReaderDirectoryEmmRecordStore {
  const records = new Map<string, ReaderEmmOverrideRecord>()
  return {
    directoryEmmAvailable: true,
    getEmmOverride: vi.fn(async (path) => records.get(path)),
    saveEmmOverride: vi.fn(async (path, overrides: ReaderEmmOverrides, expectedRevision, updatedAt) => {
      const current = records.get(path)
      if ((current?.revision ?? 0) !== expectedRevision) return undefined
      const record = { path, overrides, revision: expectedRevision + 1, updatedAt }
      records.set(path, record)
      return record
    }),
    readDirectoryEmmRecords: vi.fn(async (paths: readonly string[]) => new Map(paths.map((path) => {
      const title = records.get(path)?.overrides.translatedTitle ?? legacyTitle
      return [path, { emmJson: JSON.stringify({ translated_title: title }) }]
    }))),
  }
}
