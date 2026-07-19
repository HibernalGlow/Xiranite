import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, parse, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ResourceTaskRequest } from "../../ports/ResourceScheduler.js"
import { WritableLegacyThumbnailStore } from "./WritableLegacyThumbnailStore.js"

describe("WritableLegacyThumbnailStore", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.persist.batch] [neoview.thumbnail.persist-metadata] batches WebP upserts without clearing metadata", async () => {
    const path = await createFixture(roots)
    const seed = await openFixtureDatabase(path)
    seed.exec(`INSERT INTO thumbs (key, category, value, emm_json, rating_data, ai_translation, manual_tags)
      VALUES ('D:/book/page-1.jpg', 'file', X'00', 'emm', 'rating', 'translation', 'tags')`)
    seed.close()
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 60_000, maxBatchSize: 2 })
    const webp = fixtureWebp(7)
    const failure = store.recordFailure({
      key: "D:/book/page-1.jpg",
      reason: "decode-error",
      lastAttempt: "2026-07-15 10:00:00",
      errorMessage: "bad source",
    })
    const first = store.put({ key: "D:/book/page-1.jpg", category: "file", bytes: webp, sourceSize: 123, generationHash: 44 })
    await Promise.all([failure, first])
    expect(await store.getFailure("D:/book/page-1.jpg")).toBeUndefined()
    expect(await store.get("D:/book/page-1.jpg", "file")).toMatchObject({
      sourceSize: 123,
      generationHash: 44,
      contentType: "image/webp",
      compressed: false,
    })
    const pending = store.put({ key: "D:/book/page-2.jpg", category: "file", bytes: fixtureWebp(8), sourceSize: 456 })
    const batch = await store.getMany(["D:/book/page-1.jpg", "D:/book/page-2.jpg", "missing", "D:/book/page-1.jpg"], "file")
    expect([...batch.keys()].sort()).toEqual(["D:/book/page-1.jpg", "D:/book/page-2.jpg"])
    expect(batch.get("D:/book/page-2.jpg")).toMatchObject({ sourceSize: 456, contentType: "image/webp" })
    await store.flush()
    await pending
    await store.close()
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT emm_json, rating_data, ai_translation, manual_tags FROM thumbs WHERE key = 'D:/book/page-1.jpg'"))
      .toEqual({ emm_json: "emm", rating_data: "rating", ai_translation: "translation", manual_tags: "tags" })
    verified.close()
  })

  it("[neoview.thumbnail.failure.retry] increments bounded failure metadata and flushes pending work on close", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 60_000 })
    const firstFailure = store.recordFailure({ key: "D:/bad.cbz", reason: "archive-error", lastAttempt: "2026-07-15 10:00:00", errorMessage: "first" })
    await store.flush()
    await firstFailure
    const secondFailure = store.recordFailure({ key: "D:/bad.cbz", reason: "password-required", lastAttempt: "2026-07-15 10:01:00", errorMessage: "failed D:\\private\\book.cbz" })
    await store.flush()
    await secondFailure
    expect(await store.getFailure("D:/bad.cbz")).toEqual({
      key: "D:/bad.cbz",
      reason: "password-required",
      retryCount: 2,
      lastAttempt: "2026-07-15 10:01:00",
      errorMessage: "failed <path>",
    })
    const pending = store.put({ key: "D:/pending.jpg", category: "file", bytes: fixtureWebp(9) })
    await store.close()
    await expect(pending).resolves.toBeUndefined()

    const reopened = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    expect(await reopened.get("D:/pending.jpg", "file")).toMatchObject({ contentType: "image/webp" })
    await reopened.close()
  })

  it("rejects non-WebP writes before they enter the database queue", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path)
    expect(() => store.put({ key: "bad", category: "file", bytes: Uint8Array.of(1, 2, 3) })).toThrow("WebP")
    await store.close()
  })

  it("[neoview.thumbnail.writer-scheduler] commits queued thumbnail writes through the host background I/O pool", async () => {
    const path = await createFixture(roots)
    const requests: ResourceTaskRequest[] = []
    let releases = 0
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      resourceScheduler: {
        acquire: async (request) => {
          requests.push({ ...request })
          return { release: () => { releases += 1 } }
        },
      },
    })
    await store.put({ key: "D:/scheduled.webp", category: "file", bytes: fixtureWebp(1) })
    expect(requests).toEqual([{
      resource: "io",
      kind: "neoview.thumbnail.database-write",
      priority: "background",
    }])
    expect(releases).toBe(1)
    await store.close()
  })

  it("[neoview.thumbnail.writer.journal-compat] preserves the legacy database journal mode", async () => {
    const path = await createFixture(roots)
    const setup = await openFixtureDatabase(path)
    setup.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
    expect(setup.get("PRAGMA journal_mode")).toEqual({ journal_mode: "delete" })
    setup.close()

    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    await store.put({ key: "D:/journal.jpg", category: "file", bytes: fixtureWebp(1) })
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("PRAGMA journal_mode")).toEqual({ journal_mode: "delete" })
    verified.close()
  })

  it("[neoview.thumbnail.writer-access-lock] allows only one Xiranite writer and releases the lock on close", async () => {
    const path = await createFixture(roots)
    const first = await WritableLegacyThumbnailStore.open(path)
    expect((await stat(`${path}.xr-write.lock`)).isDirectory()).toBe(true)
    await expect(WritableLegacyThumbnailStore.open(path)).rejects.toThrow("already in use")
    await first.close()
    await expect(stat(`${path}.xr-write.lock`)).rejects.toMatchObject({ code: "ENOENT" })

    const reopened = await WritableLegacyThumbnailStore.open(path)
    await reopened.close()
  })

  it("[neoview.thumbnail.writer.external-epoch] increments only when another SQLite connection commits", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      dataVersionPollIntervalMs: 0,
    })
    expect(store.revision()).toBe(0)

    const external = await openFixtureDatabase(path)
    external.exec("INSERT INTO thumbs (key, category, value) VALUES ('D:/external.jpg', 'file', X'52494646040000005745425001')")
    external.close()
    expect(store.revision()).toBe(1)
    expect(store.revision()).toBe(1)

    await store.put({ key: "D:/local.jpg", category: "file", bytes: fixtureWebp(2) })
    expect(store.revision()).toBe(1)
    await store.close()
  })

  it("[neoview.thumbnail.writer.busy-retry] retries the complete transaction after a competing writer releases its lock", async () => {
    const path = await createFixture(roots)
    const blocker = await openFixtureDatabase(path)
    blocker.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE")
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 60_000,
      busyTimeoutMs: 0,
      writeBusyRetries: 4,
      writeBusyBaseDelayMs: 5,
    })
    const pending = store.put({ key: "D:/busy.jpg", category: "file", bytes: fixtureWebp(3) })
    const release = setTimeout(() => blocker.exec("COMMIT"), 12)
    try {
      await store.flush()
      await expect(pending).resolves.toBeUndefined()
      expect(store.snapshot()).toMatchObject({
        pendingWrites: 0,
        committedBatches: 1,
        committedWrites: 1,
        failedBatches: 0,
      })
      expect(store.snapshot().busyRetries).toBeGreaterThan(0)
    } finally {
      clearTimeout(release)
      try { blocker.exec("ROLLBACK") } catch { /* committed by timer */ }
      blocker.close()
      await store.close()
    }
  })

  it("[neoview.thumbnail.writer.busy-exhausted] rejects callers and records a sanitized terminal write failure", async () => {
    const path = await createFixture(roots)
    const blocker = await openFixtureDatabase(path)
    blocker.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE")
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 60_000,
      busyTimeoutMs: 0,
      writeBusyRetries: 1,
      writeBusyBaseDelayMs: 1,
    })
    const pending = store.put({ key: "D:/locked.jpg", category: "file", bytes: fixtureWebp(4) })
    try {
      await store.flush()
      await expect(pending).rejects.toBeTruthy()
      expect(store.snapshot()).toMatchObject({
        committedBatches: 0,
        busyRetries: 1,
        failedBatches: 1,
        lastError: expect.any(String),
      })
    } finally {
      blocker.exec("ROLLBACK")
      blocker.close()
      await store.close()
    }
  })

  it("[neoview.thumbnail.writer-replacement-rollback] preserves the previous blob when an atomic replacement cannot commit", async () => {
    const path = await createFixture(roots)
    const original = fixtureWebp(2)
    const replacement = fixtureWebp(8)
    const initial = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    await initial.put({ key: "D:/replace.jpg", category: "file", bytes: original })
    await initial.close()

    const blocker = await openFixtureDatabase(path)
    blocker.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE")
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 60_000,
      busyTimeoutMs: 0,
      writeBusyRetries: 1,
      writeBusyBaseDelayMs: 1,
    })
    const pending = store.put({ key: "D:/replace.jpg", category: "file", bytes: replacement })
    try {
      await store.flush()
      await expect(pending).rejects.toBeTruthy()
      blocker.exec("ROLLBACK")
      await expect(store.get("D:/replace.jpg", "file")).resolves.toMatchObject({ bytes: original })
    } finally {
      try { blocker.exec("ROLLBACK") } catch { /* released before verification */ }
      blocker.close()
      await store.close()
    }
  })

  it("[neoview.thumbnail.maintenance.online] reports aggregates and performs only bounded online cleanup", async () => {
    const path = await createFixture(roots)
    const seed = await openFixtureDatabase(path)
    seed.exec("INSERT INTO thumbs (key, category, date, value) VALUES ('empty', 'file', '2020-01-01 00:00:00', X'')")
    seed.close()
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    await Promise.all([
      store.put({ key: "D:/expired.jpg", category: "file", bytes: fixtureWebp(1), date: "2020-01-01 00:00:00" }),
      store.put({ key: "D:/folder", category: "folder", bytes: fixtureWebp(2), date: "2020-01-01 00:00:00" }),
      store.put({ key: "D:/current.jpg", category: "file", bytes: fixtureWebp(3), date: "2026-07-15 00:00:00" }),
      store.recordFailure({ key: "D:/bad-1", reason: "decode-error", lastAttempt: "2026-07-15 00:00:00" }),
      store.recordFailure({ key: "D:/bad-2", reason: "archive-error", lastAttempt: "2026-07-15 00:00:00" }),
    ])
    const before = await store.maintenanceSnapshot()
    expect(before).toMatchObject({
      totalRows: 4,
      fileRows: 3,
      folderRows: 1,
      emptyBlobs: 1,
      failedRows: 2,
      failuresByReason: { "archive-error": 1, "decode-error": 1 },
      databaseBytes: expect.any(Number),
      writer: { pendingWrites: 0, committedWrites: 5 },
    })
    expect(await store.cleanup({ kind: "empty", limit: 1 })).toBe(1)
    expect(await store.cleanup({ kind: "expired", cutoff: "2025-01-01 00:00:00", limit: 1, preserveFolders: true })).toBe(1)
    expect(await store.get("D:/folder", "folder")).toBeDefined()
    expect(await store.get("D:/expired.jpg", "file")).toBeUndefined()
    expect(await store.clearFailures({ reason: "decode-error", limit: 1 })).toBe(1)
    const after = await store.maintenanceSnapshot()
    expect(after).toMatchObject({ totalRows: 2, fileRows: 1, folderRows: 1, emptyBlobs: 0, failedRows: 1 })
    await store.close()
  })

  it("[neoview.thumbnail.maintenance.path-prefix] deletes only the selected path region and keeps sibling prefixes", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    await Promise.all([
      store.put({ key: "D:/library", category: "folder", bytes: fixtureWebp(1) }),
      store.put({ key: "D:/library/page-1.jpg", category: "file", bytes: fixtureWebp(2) }),
      store.put({ key: "D:/library\\nested/page-2.jpg", category: "file", bytes: fixtureWebp(3) }),
      store.put({ key: "D:/library::inner/page-3.jpg", category: "file", bytes: fixtureWebp(4) }),
      store.put({ key: "D:/library2/page-4.jpg", category: "file", bytes: fixtureWebp(5) }),
    ])

    expect(await store.cleanup({ kind: "path-prefix", prefix: "D:/library/", limit: 2 })).toBe(2)
    expect(await store.get("D:/library2/page-4.jpg", "file")).toBeDefined()
    expect(await store.cleanup({ kind: "path-prefix", prefix: "D:/library", limit: 10 })).toBe(2)
    expect(await store.get("D:/library", "folder")).toBeUndefined()
    expect(await store.get("D:/library2/page-4.jpg", "file")).toBeDefined()
    await store.close()
  })

  it("[neoview.thumbnail.maintenance.path-prefix-windows] matches legacy Windows separators and casing without crossing sibling paths", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    await Promise.all([
      store.put({ key: "D:\\Library", category: "folder", bytes: fixtureWebp(1) }),
      store.put({ key: "d:/LIBRARY/one.jpg", category: "file", bytes: fixtureWebp(2) }),
      store.put({ key: "D:\\library\\nested/two.jpg", category: "file", bytes: fixtureWebp(3) }),
      store.put({ key: "D:\\Library::entry/three.jpg", category: "file", bytes: fixtureWebp(4) }),
      store.put({ key: "D:\\Library2/four.jpg", category: "file", bytes: fixtureWebp(5) }),
      store.put({ key: "D:\\Libraries/five.jpg", category: "file", bytes: fixtureWebp(6) }),
    ])

    expect(await store.cleanup({ kind: "path-prefix", prefix: " d:/library/ ", limit: 10 })).toBe(4)
    expect(await store.get("D:\\Library2/four.jpg", "file")).toBeDefined()
    expect(await store.get("D:\\Libraries/five.jpg", "file")).toBeDefined()
    await store.close()
  })

  it("[neoview.thumbnail.maintenance-cooperative-stats] scans exact Blob totals in bounded host I/O chunks", async () => {
    const path = await createFixture(roots)
    const requests: ResourceTaskRequest[] = []
    let releases = 0
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      statisticsChunkSize: 2,
      resourceScheduler: {
        acquire: async (request) => {
          requests.push({ ...request })
          return { release: () => { releases += 1 } }
        },
      },
    })
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.put({
      key: `D:/page-${index}.jpg`,
      category: index === 4 ? "folder" : "file",
      bytes: fixtureWebp(index),
    })))
    requests.length = 0
    releases = 0
    const snapshot = await store.maintenanceSnapshot()
    expect(snapshot).toMatchObject({
      totalRows: 5,
      fileRows: 4,
      folderRows: 1,
      blobBytes: fixtureWebp(0).byteLength * 5,
      emptyBlobs: 0,
    })
    expect(requests).toEqual([
      { resource: "io", kind: "neoview.thumbnail.database-statistics-index", priority: "view" },
      { resource: "io", kind: "neoview.thumbnail.database-statistics-scan", priority: "view" },
      { resource: "io", kind: "neoview.thumbnail.database-statistics-scan", priority: "view" },
      { resource: "io", kind: "neoview.thumbnail.database-statistics-scan", priority: "view" },
    ])
    expect(releases).toBe(4)
    await store.close()
  })

  it("[neoview.thumbnail.maintenance-statistics-cancellation] rolls back a cancelled cooperative scan", async () => {
    const path = await createFixture(roots)
    const controller = new AbortController()
    let scanRequests = 0
    let cancelled = false
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      statisticsChunkSize: 1,
      resourceScheduler: {
        acquire: async (request) => {
          if (!cancelled && request.kind === "neoview.thumbnail.database-statistics-scan" && ++scanRequests === 2) {
            cancelled = true
            controller.abort(new DOMException("statistics superseded", "AbortError"))
          }
          return { release() {} }
        },
      },
    })
    await Promise.all([
      store.put({ key: "D:/one.jpg", category: "file", bytes: fixtureWebp(1) }),
      store.put({ key: "D:/two.jpg", category: "file", bytes: fixtureWebp(2) }),
    ])
    await expect(store.maintenanceSnapshot(controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    await expect(store.maintenanceSnapshot()).resolves.toMatchObject({ totalRows: 2, blobBytes: fixtureWebp(0).byteLength * 2 })
    await store.close()
  })

  it("[neoview.thumbnail.maintenance.invalid-paths] deletes only confirmed missing sources and preserves unavailable volumes", async () => {
    const path = await createFixture(roots)
    const root = parse(resolve(path)).root
    const valid = resolve(join(root, "xiranite-valid.jpg"))
    const missing = resolve(join(root, "xiranite-missing.jpg"))
    const unavailable = resolve(join(root, "xiranite-offline.jpg"))
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      pathState: async (candidate) => {
        if (candidate === root || candidate === valid) return "exists"
        if (candidate === unavailable) return "unavailable"
        return "missing"
      },
    })
    await Promise.all([
      store.put({ key: valid, category: "file", bytes: fixtureWebp(1) }),
      store.put({ key: missing, category: "file", bytes: fixtureWebp(2) }),
      store.put({ key: unavailable, category: "file", bytes: fixtureWebp(3) }),
      store.put({ key: "relative-invalid", category: "file", bytes: fixtureWebp(4) }),
    ])
    expect(await store.cleanupInvalid({ scanLimit: 10, deleteLimit: 10 })).toEqual({
      scanned: 4,
      deleted: 2,
      unavailableVolumeRowsPreserved: 1,
      wrapped: false,
    })
    expect(await store.get(valid, "file")).toBeDefined()
    expect(await store.get(unavailable, "file")).toBeDefined()
    expect(await store.get(missing, "file")).toBeUndefined()
    expect(await store.get("relative-invalid", "file")).toBeUndefined()
    await store.close()
  })

  it("[neoview.thumbnail.maintenance-scheduler] schedules invalid-path reads, probes and deletion separately", async () => {
    const path = await createFixture(roots)
    const root = parse(resolve(path)).root
    const missing = resolve(join(root, "xiranite-scheduled-missing.jpg"))
    const requests: ResourceTaskRequest[] = []
    let releases = 0
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      pathState: async (candidate) => candidate === root ? "exists" : "missing",
      resourceScheduler: {
        acquire: async (request) => {
          requests.push({ ...request })
          return { release: () => { releases += 1 } }
        },
      },
    })
    await store.put({ key: missing, category: "file", bytes: fixtureWebp(1) })
    requests.length = 0
    releases = 0
    await expect(store.cleanupInvalid({ scanLimit: 10, deleteLimit: 10 })).resolves.toMatchObject({ scanned: 1, deleted: 1 })
    expect(requests).toEqual([
      { resource: "io", kind: "neoview.thumbnail.database-maintenance-scan", priority: "background" },
      { resource: "io", kind: "neoview.thumbnail.path-state", priority: "background" },
      { resource: "io", kind: "neoview.thumbnail.path-state", priority: "background" },
      { resource: "io", kind: "neoview.thumbnail.database-maintenance-write", priority: "background" },
    ])
    expect(releases).toBe(4)
    await store.close()
  })

  it("[neoview.thumbnail.maintenance-cancel-store] stops invalid-path cleanup before deleting scanned rows", async () => {
    const path = await createFixture(roots)
    const root = parse(resolve(path)).root
    const missing = resolve(join(root, "xiranite-cancelled-missing.jpg"))
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const store = await WritableLegacyThumbnailStore.open(path, {
      flushIntervalMs: 0,
      pathState: async (candidate) => {
        if (candidate === root) return "exists"
        started.resolve()
        await gate.promise
        return "missing"
      },
    })
    await store.put({ key: missing, category: "file", bytes: fixtureWebp(1) })
    const cancellation = new AbortController()
    const operation = store.cleanupInvalid({ scanLimit: 10, deleteLimit: 10 }, cancellation.signal)
    await started.promise
    cancellation.abort(new DOMException("cancelled", "AbortError"))
    gate.resolve()
    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(await store.get(missing, "file")).toBeDefined()
    await expect(store.cleanupInvalid({ scanLimit: 10, deleteLimit: 10 })).resolves.toMatchObject({ scanned: 1, deleted: 1 })
    expect(await store.get(missing, "file")).toBeUndefined()
    await store.close()
  })
})

async function createFixture(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-writer-"))
  roots.push(root)
  const path = join(root, "thumbnails.db")
  const database = await openFixtureDatabase(path)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
    CREATE INDEX idx_thumbs_key ON thumbs(key);
    CREATE INDEX idx_thumbs_category ON thumbs(category);
    CREATE INDEX idx_thumbs_date ON thumbs(date);
    CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
    CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
    CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO metadata VALUES ('version','2.4');
  `)
  database.close()
  return path
}

function fixtureWebp(fill: number): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, fill])
}

interface FixtureDatabase {
  exec(sql: string): void
  get(sql: string): Record<string, unknown> | undefined
  close(): void
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        exec(sql: string): void
        query(sql: string): { get(): Record<string, unknown> | null }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create: true, strict: true })
    return {
      exec: (sql) => database.exec(sql),
      get: (sql) => database.query(sql).get() ?? undefined,
      close: () => database.close(),
    }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return {
    exec: (sql) => database.exec(sql),
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    close: () => database.close(),
  }
}
