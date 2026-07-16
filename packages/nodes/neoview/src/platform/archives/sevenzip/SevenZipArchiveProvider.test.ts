import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { deterministicBytes } from "../../../../test/fixture-builders/create-zip-fixture.js"
import type { ResourceClass, ResourceScheduler, ResourceTaskRequest } from "../../../ports/ResourceScheduler.js"
import { SolidArchiveMaterializer } from "./SolidArchiveMaterializer.js"
import { SolidArchiveCache } from "./SolidArchiveCache.js"
import { SevenZipArchiveProvider, type SevenZipArchiveProviderOptions } from "./SevenZipArchiveProvider.js"
import { resolveSevenZipExecutable } from "./SevenZipExecutable.js"

const execFileAsync = promisify(execFile)
const executable = await resolveSevenZipExecutable().catch(() => undefined)
let directory = ""
let nonSolidPath = ""
let solidPath = ""
let largePath = ""
let solidLargePath = ""
let encryptedPath = ""
let encryptedSolidPath = ""
let encryptedHeaderPath = ""

beforeAll(async () => {
  if (!executable) return
  directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-provider-"))
  await mkdir(join(directory, "pages"))
  await mkdir(join(directory, "empty"))
  await writeFile(join(directory, "pages", "001.jpg"), Uint8Array.of(1, 2, 3, 4, 5))
  await writeFile(join(directory, "pages", "002.jpg"), Uint8Array.of(6, 7, 8))
  await writeFile(join(directory, "pages", "003.jpg"), new Uint8Array())
  await writeFile(join(directory, "large.jpg"), deterministicBytes(8 * 1024 * 1024))
  nonSolidPath = join(directory, "fixture.7z")
  solidPath = join(directory, "solid.7z")
  largePath = join(directory, "large.7z")
  solidLargePath = join(directory, "solid-large.7z")
  encryptedPath = join(directory, "encrypted.7z")
  encryptedSolidPath = join(directory, "encrypted-solid.7z")
  encryptedHeaderPath = join(directory, "encrypted-header.7z")
  await createArchive(nonSolidPath, false, ["pages/001.jpg", "pages/002.jpg", "empty"])
  await createArchive(solidPath, true, ["pages/001.jpg", "pages/002.jpg", "pages/003.jpg"])
  await createArchive(largePath, false, ["large.jpg"])
  await createArchive(solidLargePath, true, ["large.jpg", "pages/001.jpg"])
  await createArchive(encryptedPath, false, ["pages/001.jpg"], "fixture-secret")
  await createArchive(encryptedSolidPath, true, ["pages/001.jpg", "pages/002.jpg"], "fixture-secret")
  await createArchive(encryptedHeaderPath, false, ["pages/001.jpg"], "fixture-secret", true)
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe.skipIf(!executable)("SevenZipArchiveProvider system integration", () => {
  it("[neoview.archive.sevenzip-index-snapshot] reports index payload and releases it on close", async () => {
    const provider = createProvider(nonSolidPath, new RecordingScheduler())
    expect(provider.snapshot()).toEqual({ initialized: false, indexEntries: 0, indexPayloadBytes: 0, activeExtractions: 0 })
    const entries = await provider.list()
    expect(provider.snapshot()).toMatchObject({ initialized: true, indexEntries: entries.length, activeExtractions: 0 })
    expect(provider.snapshot().indexPayloadBytes).toBeGreaterThan(0)
    await provider.close()
    expect(provider.snapshot()).toEqual({ initialized: false, indexEntries: 0, indexPayloadBytes: 0, activeExtractions: 0 })
  })

  it("[neoview.sevenzip.provider] [neoview.sevenzip.scheduler] indexes and stdout-streams exact non-solid entries", async () => {
    const scheduler = new RecordingScheduler()
    const provider = createProvider(nonSolidPath, scheduler)
    try {
      const entries = await provider.list()
      expect(scheduler.requests).toContainEqual({
        resource: "io",
        kind: "neoview.archive-index",
        priority: "interactive",
      })
      expect(scheduler.active.io).toBe(0)
      expect(provider.capabilities).toMatchObject({ solid: false, randomAccess: true, entryRange: false })
      expect(entries.map((entry) => [entry.path, entry.kind, entry.uncompressedSize])).toEqual([
        ["empty", "directory", 0],
        ["pages/001.jpg", "file", 5],
        ["pages/002.jpg", "file", 3],
      ])
      const first = entries.find((entry) => entry.path === "pages/001.jpg")!
      const stream = await provider.openEntry(first.id)
      expect(scheduler.requests).toContainEqual({
        resource: "cpu",
        kind: "neoview.archive-extract",
        priority: "interactive",
      })
      expect(scheduler.active.cpu).toBe(1)
      expect(await collect(stream)).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      await expect.poll(() => scheduler.active.cpu).toBe(0)
      await expect(provider.openEntry(first.id, { range: { start: 0, endExclusive: 1 } })).rejects.toThrow("ranges")
      await expect(provider.openEntry(entries[0]!.id)).rejects.toThrow("not a file")
      await expect(provider.openEntry("missing")).rejects.toThrow("not found")
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.cancellation] kills an active stdout extraction and closes idempotently", async () => {
    const scheduler = new RecordingScheduler()
    const provider = createProvider(largePath, scheduler)
    const [entry] = await provider.list()
    const abort = new AbortController()
    const reader = (await provider.openEntry(entry!.id, { signal: abort.signal })).getReader()
    expect((await reader.read()).value?.byteLength).toBeGreaterThan(0)
    abort.abort(new Error("reader navigated away"))
    await expect(reader.read()).rejects.toThrow("reader navigated away")
    await expect.poll(() => scheduler.active.cpu).toBe(0)
    await provider.close()
    await provider.close()
    await expect(provider.list()).rejects.toThrow("closed")
  })

  it("[neoview.sevenzip.shared-lease] reuses but never releases an externally owned CPU lease", async () => {
    const scheduler = new RecordingScheduler()
    const provider = createProvider(nonSolidPath, scheduler)
    try {
      const entry = (await provider.list()).find((candidate) => candidate.path === "pages/001.jpg")!
      expect(provider.entryStreamResource).toBe("cpu")
      const release = vi.fn()
      const cpuRequests = scheduler.requests.filter((request) => request.resource === "cpu").length
      expect(await collect(await provider.openEntry(entry.id, { resourceLease: { release } })))
        .toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(scheduler.requests.filter((request) => request.resource === "cpu")).toHaveLength(cpuRequests)
      expect(release).not.toHaveBeenCalled()
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.solid-streaming] materializes a solid archive once and publishes exact entries", async () => {
    const scheduler = new RecordingScheduler()
    const tempDirectory = join(directory, "solid-materialized")
    await mkdir(tempDirectory)
    const provider = createProvider(solidPath, scheduler, { solidTempDirectory: tempDirectory })
    try {
      const entries = await provider.list()
      expect(provider.capabilities).toMatchObject({ solid: true, randomAccess: false, materialization: "required" })
      const first = entries.find((entry) => entry.path === "pages/001.jpg")!
      const second = entries.find((entry) => entry.path === "pages/002.jpg")!
      const empty = entries.find((entry) => entry.path === "pages/003.jpg")!
      expect(await collect(await provider.openEntry(first.id))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(await collect(await provider.openEntry(second.id))).toEqual(Uint8Array.of(6, 7, 8))
      expect(await collect(await provider.openEntry(empty.id))).toEqual(new Uint8Array())
      expect(scheduler.requests.filter((request) => request.kind === "neoview.archive-solid-extract")).toHaveLength(1)
      await expect.poll(() => scheduler.active.cpu).toBe(0)
    } finally {
      await provider.close()
    }
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it("[neoview.sevenzip.solid-budget] rejects oversized solid materialization before spawning extraction", async () => {
    const scheduler = new RecordingScheduler()
    const provider = createProvider(solidPath, scheduler, { maxSolidMaterializedBytes: 4 })
    try {
      const first = (await provider.list()).find((entry) => entry.path === "pages/001.jpg")!
      await expect(provider.openEntry(first.id)).rejects.toThrow("exceeding the 4 byte budget")
      expect(scheduler.requests.some((request) => request.kind === "neoview.archive-solid-extract")).toBe(false)
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.solid-crc-errors] rejects a corrupt materialized entry before publishing it", async () => {
    const provider = createProvider(solidPath)
    const scheduler = new RecordingScheduler()
    try {
      const entries = await provider.list()
      const first = entries.find((entry) => entry.path === "pages/001.jpg")!
      expect(first.crc32).toEqual(expect.any(Number))
      const corrupted = entries.map((entry) => entry.id === first.id
        ? { ...entry, crc32: entry.crc32! ^ 0xffffffff }
        : entry)
      const materializer = new SolidArchiveMaterializer({
        sourcePath: solidPath,
        executable: executable!,
        entries: corrupted,
        resourceScheduler: scheduler,
      })
      try {
        await expect(materializer.pathFor(first.id)).rejects.toThrow("CRC mismatch")
        await expect.poll(() => scheduler.active.cpu).toBe(0)
      } finally {
        await materializer.close()
      }
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.solid-cancellation] rejects waiters and releases resources when closed during startup", async () => {
    const provider = createProvider(solidPath)
    const scheduler = new RecordingScheduler()
    try {
      const entries = await provider.list()
      const first = entries.find((entry) => entry.path === "pages/001.jpg")!
      const materializer = new SolidArchiveMaterializer({
        sourcePath: solidPath,
        executable: executable!,
        entries,
        resourceScheduler: scheduler,
      })
      const opening = materializer.pathFor(first.id)
      const rejected = expect(opening).rejects.toThrow("closed")
      await materializer.close()
      await rejected
      expect(scheduler.active.cpu).toBe(0)
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.solid-reader-cancellation] closes active file readers before deleting materialized data", async () => {
    const scheduler = new RecordingScheduler()
    const tempDirectory = join(directory, "solid-reader-cancelled")
    await mkdir(tempDirectory)
    const provider = createProvider(solidLargePath, scheduler, { solidTempDirectory: tempDirectory })
    const large = (await provider.list()).find((entry) => entry.path === "large.jpg")!
    const reader = (await provider.openEntry(large.id)).getReader()
    expect((await reader.read()).value?.byteLength).toBeGreaterThan(0)
    await provider.close()
    await expect((async () => {
      for (;;) {
        const result = await reader.read()
        if (result.done) throw new Error("materialized reader ended without the provider abort")
      }
    })()).rejects.not.toThrow("materialized reader ended without the provider abort")
    expect(scheduler.active.cpu).toBe(0)
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it("[neoview.sevenzip.encrypted-stream] streams and materializes encrypted entries through stdin without retaining request passwords", async () => {
    const scheduler = new RecordingScheduler()
    const provider = createProvider(encryptedPath, scheduler)
    try {
      const first = (await provider.list()).find((entry) => entry.kind === "file")!
      expect(first.encrypted).toBe(true)
      await expect(provider.openEntry(first.id)).rejects.toThrow("requires a password")
      const wrongPassword = new TextEncoder().encode("wrong-password")
      await expect(provider.openEntry(first.id, { rawPassword: wrongPassword }).then(collect)).rejects.toThrow(/password|data error/i)
      expect(wrongPassword.every((byte) => byte === 0)).toBe(true)
      const streamPassword = new TextEncoder().encode("fixture-secret")
      expect(await collect(await provider.openEntry(first.id, { rawPassword: streamPassword }))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(streamPassword.every((byte) => byte === 0)).toBe(true)
      const materializePassword = new TextEncoder().encode("fixture-secret")
      const lease = await provider.materializeEntry(first.id, { rawPassword: materializePassword })
      expect(new Uint8Array(await readFile(lease.path))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      await lease.release()
      expect(materializePassword.every((byte) => byte === 0)).toBe(true)
      const invalidPassword = new TextEncoder().encode("unsafe\npassword")
      await expect(provider.openEntry(first.id, { rawPassword: invalidPassword })).rejects.toThrow("NUL, CR, or LF")
      expect(invalidPassword.every((byte) => byte === 0)).toBe(true)
      expect(scheduler.requests.some((request) => request.kind === "neoview.archive-extract")).toBe(true)
      expect(scheduler.requests.some((request) => request.kind === "neoview.archive-materialize")).toBe(true)
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.encrypted-solid] retries encrypted solid extraction and never publishes decrypted data to the shared cache", async () => {
    const scheduler = new RecordingScheduler()
    const cache = new SolidArchiveCache({ maxBytes: 1024 })
    const tempDirectory = join(directory, "encrypted-solid-materialized")
    await mkdir(tempDirectory)
    const provider = createProvider(encryptedSolidPath, scheduler, { solidArchiveCache: cache, solidTempDirectory: tempDirectory })
    try {
      const first = (await provider.list()).find((entry) => entry.path === "pages/001.jpg")!
      const wrong = new TextEncoder().encode("wrong-password")
      await expect(provider.openEntry(first.id, { rawPassword: wrong }).then(collect)).rejects.toThrow(/password|data error/i)
      expect(wrong.every((byte) => byte === 0)).toBe(true)
      const correct = new TextEncoder().encode("fixture-secret")
      expect(await collect(await provider.openEntry(first.id, { rawPassword: correct }))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(correct.every((byte) => byte === 0)).toBe(true)
      expect(cache.entryCount).toBe(0)
    } finally {
      await provider.close()
      await cache.close()
    }
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it("[neoview.sevenzip.encrypted-header] uses a session-scoped constructor password for indexing and extraction", async () => {
    const unavailable = createProvider(encryptedHeaderPath)
    await expect(unavailable.list()).rejects.toThrow(/password|encrypted/i)
    await unavailable.close()

    const password = new TextEncoder().encode("fixture-secret")
    const provider = createProvider(encryptedHeaderPath, undefined, { rawPassword: password })
    try {
      const first = (await provider.list()).find((entry) => entry.kind === "file")!
      expect(first.encrypted).toBe(true)
      expect(await collect(await provider.openEntry(first.id))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(password).toEqual(new TextEncoder().encode("fixture-secret"))
    } finally {
      await provider.close()
      password.fill(0)
    }
  })

  it("[neoview.sevenzip.cancellation] rejects pre-cancelled extraction without spawning stdout", async () => {
    const provider = createProvider(nonSolidPath)
    try {
      const first = (await provider.list()).find((entry) => entry.kind === "file")!
      const abort = new AbortController()
      abort.abort(new Error("already cancelled"))
      await expect(provider.openEntry(first.id, { signal: abort.signal })).rejects.toThrow("already cancelled")
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.materialize-lease] materializes non-solid entries and releases their temporary root", async () => {
    const scheduler = new RecordingScheduler()
    const tempDirectory = join(directory, "non-solid-materialized")
    await mkdir(tempDirectory)
    const provider = new SevenZipArchiveProvider(nonSolidPath, {
      executable: executable!,
      resourceScheduler: scheduler,
      tempDirectory,
    })
    try {
      const first = (await provider.list()).find((entry) => entry.path === "pages/001.jpg")!
      const lease = await provider.materializeEntry(first.id)
      expect(new Uint8Array(await readFile(lease.path))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      expect(scheduler.requests.some((request) => request.kind === "neoview.archive-materialize")).toBe(true)
      await lease.release()
      expect(await readdir(tempDirectory)).toEqual([])
    } finally {
      await provider.close()
    }
  })

  it("[neoview.sevenzip.solid-materialize-lease] borrows the solid cache without a second materialization copy", async () => {
    const scheduler = new RecordingScheduler()
    const tempDirectory = join(directory, "solid-borrowed")
    await mkdir(tempDirectory)
    const provider = new SevenZipArchiveProvider(solidPath, {
      executable: executable!,
      resourceScheduler: scheduler,
      tempDirectory,
    })
    const first = (await provider.list()).find((entry) => entry.path === "pages/001.jpg")!
    const lease = await provider.materializeEntry(first.id)
    expect(new Uint8Array(await readFile(lease.path))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
    expect(scheduler.requests.filter((request) => request.kind === "neoview.archive-solid-extract")).toHaveLength(1)
    expect(scheduler.requests.some((request) => request.kind === "neoview.archive-materialize")).toBe(false)
    await lease.release()
    expect(await access(lease.path).then(() => true, () => false)).toBe(true)
    await provider.close()
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it("[neoview.sevenzip.solid-cache-reuse] reuses a verified extraction across providers and invalidates changed sources", async () => {
    const scheduler = new RecordingScheduler()
    const tempDirectory = join(directory, "solid-shared-cache")
    await mkdir(tempDirectory)
    const cache = new SolidArchiveCache({ maxBytes: 1024 })
    const options = {
      executable: executable!,
      resourceScheduler: scheduler,
      tempDirectory,
      solidArchiveCache: cache,
    }
    try {
      const firstProvider = new SevenZipArchiveProvider(solidPath, options)
      const firstEntry = (await firstProvider.list()).find((entry) => entry.path === "pages/001.jpg")!
      expect(await collect(await firstProvider.openEntry(firstEntry.id))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      await expect.poll(() => scheduler.active.cpu).toBe(0)
      await firstProvider.close()
      expect(cache.entryCount).toBe(1)

      const secondProvider = new SevenZipArchiveProvider(solidPath, options)
      const secondEntry = (await secondProvider.list()).find((entry) => entry.path === "pages/002.jpg")!
      expect(await collect(await secondProvider.openEntry(secondEntry.id))).toEqual(Uint8Array.of(6, 7, 8))
      await secondProvider.close()
      expect(scheduler.requests.filter((request) => request.kind === "neoview.archive-solid-extract")).toHaveLength(1)

      const changedTime = new Date(Date.now() + 5_000)
      await utimes(solidPath, changedTime, changedTime)
      const changedProvider = new SevenZipArchiveProvider(solidPath, options)
      const changedEntry = (await changedProvider.list()).find((entry) => entry.path === "pages/001.jpg")!
      expect(await collect(await changedProvider.openEntry(changedEntry.id))).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
      await expect.poll(() => scheduler.active.cpu).toBe(0)
      await changedProvider.close()
      expect(scheduler.requests.filter((request) => request.kind === "neoview.archive-solid-extract")).toHaveLength(2)
    } finally {
      await cache.close()
    }
    expect(await readdir(tempDirectory)).toEqual([])
  })
})

function createProvider(
  path: string,
  resourceScheduler?: ResourceScheduler,
  options: Pick<SevenZipArchiveProviderOptions, "solidTempDirectory" | "maxSolidMaterializedBytes" | "solidArchiveCache" | "rawPassword"> = {},
): SevenZipArchiveProvider {
  return new SevenZipArchiveProvider(path, { executable: executable!, resourceScheduler, ...options })
}

class RecordingScheduler implements ResourceScheduler {
  readonly requests: ResourceTaskRequest[] = []
  readonly active: Record<ResourceClass, number> = { cpu: 0, io: 0, gpu: 0 }

  async acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<{ release(): void }> {
    signal?.throwIfAborted()
    this.requests.push({ ...request })
    this.active[request.resource] += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.active[request.resource] -= 1
      },
    }
  }
}

async function createArchive(path: string, solid: boolean, entries: string[], password?: string, encryptHeaders = false): Promise<void> {
  await execFileAsync(executable!.path, [
    "a", "-t7z", "-mx=1", solid ? "-ms=on" : "-ms=off", ...(password ? [`-p${password}`, encryptHeaders ? "-mhe=on" : "-mhe=off"] : []), "-bd", "-bb0", "--", path, ...entries,
  ], { cwd: directory, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(result.value)
    bytes += result.value.byteLength
  }
  const output = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
