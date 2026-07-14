import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { deterministicBytes } from "../../../../test/fixture-builders/create-zip-fixture.js"
import type { ResourceClass, ResourceScheduler, ResourceTaskRequest } from "../../../ports/ResourceScheduler.js"
import { SevenZipArchiveProvider } from "./SevenZipArchiveProvider.js"
import { resolveSevenZipExecutable } from "./SevenZipExecutable.js"

const execFileAsync = promisify(execFile)
const executable = await resolveSevenZipExecutable().catch(() => undefined)
let directory = ""
let nonSolidPath = ""
let solidPath = ""
let largePath = ""

beforeAll(async () => {
  if (!executable) return
  directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-provider-"))
  await mkdir(join(directory, "pages"))
  await mkdir(join(directory, "empty"))
  await writeFile(join(directory, "pages", "001.jpg"), Uint8Array.of(1, 2, 3, 4, 5))
  await writeFile(join(directory, "pages", "002.jpg"), Uint8Array.of(6, 7, 8))
  await writeFile(join(directory, "large.jpg"), deterministicBytes(8 * 1024 * 1024))
  nonSolidPath = join(directory, "fixture.7z")
  solidPath = join(directory, "solid.7z")
  largePath = join(directory, "large.7z")
  await createArchive(nonSolidPath, false, ["pages/001.jpg", "pages/002.jpg", "empty"])
  await createArchive(solidPath, true, ["pages/001.jpg", "pages/002.jpg"])
  await createArchive(largePath, false, ["large.jpg"])
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe.skipIf(!executable)("SevenZipArchiveProvider system integration", () => {
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

  it("[neoview.sevenzip.solid-boundary] identifies solid archives and requires sequential pre-extraction", async () => {
    const provider = createProvider(solidPath)
    try {
      const entries = await provider.list()
      expect(provider.capabilities).toMatchObject({ solid: true, randomAccess: false, materialization: "required" })
      const first = entries.find((entry) => entry.kind === "file")!
      await expect(provider.openEntry(first.id)).rejects.toThrow("sequential pre-extraction")
    } finally {
      await provider.close()
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
})

function createProvider(path: string, resourceScheduler?: ResourceScheduler): SevenZipArchiveProvider {
  return new SevenZipArchiveProvider(path, { executable: executable!, resourceScheduler })
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

async function createArchive(path: string, solid: boolean, entries: string[]): Promise<void> {
  await execFileAsync(executable!.path, [
    "a", "-t7z", "-mx=1", solid ? "-ms=on" : "-ms=off", "-bd", "-bb0", "--", path, ...entries,
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
