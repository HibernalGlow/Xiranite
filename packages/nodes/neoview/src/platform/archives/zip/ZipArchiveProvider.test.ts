import { stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { defineArchiveProviderConformance } from "../../../testing/conformance/archive-provider.conformance.js"
import { createZipFixture, deterministicBytes, type ZipFixture } from "../../../../test/fixture-builders/create-zip-fixture.js"
import { ZipArchiveProvider } from "./ZipArchiveProvider.js"

let fixture: ZipFixture

beforeAll(async () => {
  fixture = await createZipFixture()
})

afterAll(async () => {
  await fixture?.cleanup()
})

defineArchiveProviderConformance("ZIP", () => new ZipArchiveProvider(fixture.path))

describe("ZipArchiveProvider", () => {
  it("[neoview.archive.zip-metadata] reports Store/Deflate metadata without reading entry bodies", async () => {
    const reads: Array<{ length: number; bytesRead: number }> = []
    const provider = new ZipArchiveProvider(fixture.path, {
      onRead: (_offset, length, bytesRead) => reads.push({ length, bytesRead }),
    })
    try {
      const entries = await provider.list()
      expect(entries.map((entry) => entry.compressionMethod)).toEqual(["deflate", "store", "store"])
      expect(entries[0]).toMatchObject({ crc32: expect.any(Number), encrypted: false, zip64: false })
      expect(entries[0]!.modifiedAt).toMatch(/^2024-01-02T03:04:0[46]\.000Z$/)
      expect(reads.every((read) => read.length <= 64 * 1024)).toBe(true)
    } finally {
      await provider.close()
    }
  })

  it("[neoview.archive.zip64] reads a forced ZIP64 central directory", async () => {
    const zip64 = await createZipFixture({ zip64: true, name: "zip64.cbz" })
    const provider = new ZipArchiveProvider(zip64.path)
    try {
      const entries = await provider.list()
      expect(entries[0]?.zip64).toBe(true)
      expect([...await collect(await provider.openEntry(entries[0]!.id))]).toEqual([1, 2, 3, 4, 5])
    } finally {
      await provider.close()
      await zip64.cleanup()
    }
  })

  it("[neoview.archive.streaming] indexes and starts a large stored entry without loading the archive into memory", async () => {
    const payload = deterministicBytes(4 * 1024 * 1024)
    const large = await createZipFixture({ entries: [{ path: "pages/large.bin", bytes: payload, level: 0 }] })
    let bytesRead = 0
    let maxRead = 0
    const provider = new ZipArchiveProvider(large.path, {
      onRead: (_offset, length, actual) => {
        bytesRead += actual
        maxRead = Math.max(maxRead, length)
      },
    })
    try {
      const archiveSize = (await stat(large.path)).size
      const [entry] = await provider.list()
      expect(bytesRead).toBeLessThan(archiveSize / 4)
      bytesRead = 0
      const reader = (await provider.openEntry(entry!.id)).getReader()
      const first = await reader.read()
      expect(first.done).toBe(false)
      expect(first.value!.byteLength).toBeLessThanOrEqual(64 * 1024)
      expect(bytesRead).toBeLessThan(archiveSize / 4)
      expect(maxRead).toBeLessThanOrEqual(64 * 1024)
      await reader.cancel()
    } finally {
      await provider.close()
      await large.cleanup()
    }
  })

  it("[neoview.archive.cancellation] aborts active decompression and releases it during close", async () => {
    const large = await createZipFixture({ entries: [{ path: "pages/large.bin", bytes: deterministicBytes(2 * 1024 * 1024), level: 6 }] })
    const provider = new ZipArchiveProvider(large.path)
    try {
      const [entry] = await provider.list()
      const controller = new AbortController()
      const reader = (await provider.openEntry(entry!.id, { signal: controller.signal })).getReader()
      expect((await reader.read()).done).toBe(false)
      controller.abort(new Error("cancelled-active-zip"))
      await expect(readUntilTerminal(reader)).rejects.toThrow(/cancelled-active-zip|abort/i)

      const secondReader = (await provider.openEntry(entry!.id)).getReader()
      expect((await secondReader.read()).done).toBe(false)
      await provider.close()
      await expect(readUntilTerminal(secondReader)).rejects.toThrow(/closed|abort/i)
    } finally {
      await provider.close()
      await large.cleanup()
    }
  })

  it("[neoview.archive.crc] rejects corrupted entry bytes when CRC verification is enabled", async () => {
    const corrupted = new Uint8Array(fixture.bytes)
    const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    corrupted[dataOffset] ^= 0xff
    const path = join(fixture.directory, "corrupted.cbz")
    await writeFile(path, corrupted)
    const provider = new ZipArchiveProvider(path)
    try {
      const [entry] = await provider.list()
      await expect(collect(await provider.openEntry(entry!.id))).rejects.toThrow(/signature|crc|invalid/i)
    } finally {
      await provider.close()
    }
  })

  it("[neoview.archive.security] rejects traversal paths during central-directory indexing", async () => {
    const unsafe = await createZipFixture({ entries: [{ path: "../escape.jpg", bytes: Uint8Array.of(1), level: 0 }] })
    const provider = new ZipArchiveProvider(unsafe.path)
    try {
      await expect(provider.list()).rejects.toThrow("Unsafe archive entry path")
    } finally {
      await provider.close()
      await unsafe.cleanup()
    }
  })

  it("[neoview.archive.duplicates] preserves duplicate filenames with distinct stable entry IDs", async () => {
    const duplicated = replaceAscii(new Uint8Array(fixture.bytes), "pages/002.jpg", "pages/001.jpg")
    const path = join(fixture.directory, "duplicates.cbz")
    await writeFile(path, duplicated)
    const provider = new ZipArchiveProvider(path)
    try {
      const entries = await provider.list()
      expect(entries.slice(0, 2).map((entry) => entry.path)).toEqual(["pages/001.jpg", "pages/001.jpg"])
      expect(entries[0]!.id).not.toBe(entries[1]!.id)
      expect([...await collect(await provider.openEntry(entries[0]!.id))]).toEqual([1, 2, 3, 4, 5])
      expect([...await collect(await provider.openEntry(entries[1]!.id))]).toEqual([6, 7, 8])
    } finally {
      await provider.close()
    }
  })

  it("[neoview.archive.unicode] preserves Unicode entry names", async () => {
    const unicode = await createZipFixture({ entries: [{ path: "章节/第001页.jpg", bytes: Uint8Array.of(9, 8, 7), level: 0 }] })
    const provider = new ZipArchiveProvider(unicode.path)
    try {
      const [entry] = await provider.list()
      expect(entry?.path).toBe("章节/第001页.jpg")
      expect([...await collect(await provider.openEntry(entry!.id))]).toEqual([9, 8, 7])
    } finally {
      await provider.close()
      await unicode.cleanup()
    }
  })

  it("[neoview.archive.encrypted] lists AES entries and decrypts them only with the supplied password", async () => {
    const encrypted = await createZipFixture({ entries: [{ path: "pages/secret.jpg", bytes: Uint8Array.of(4, 3, 2, 1), level: 6, password: "secret" }] })
    const provider = new ZipArchiveProvider(encrypted.path)
    try {
      const [entry] = await provider.list()
      expect(entry?.encrypted).toBe(true)
      await expect(collect(await provider.openEntry(entry!.id))).rejects.toThrow(/encrypted|password/i)
      expect([...await collect(await provider.openEntry(entry!.id, { password: "secret" }))]).toEqual([4, 3, 2, 1])
    } finally {
      await provider.close()
      await encrypted.cleanup()
    }
  })

  it("[neoview.archive.empty-corrupt] handles empty archives and rejects truncated central directories", async () => {
    const empty = await createZipFixture({ entries: [], name: "empty.cbz" })
    const emptyProvider = new ZipArchiveProvider(empty.path)
    try {
      expect(await emptyProvider.list()).toEqual([])
    } finally {
      await emptyProvider.close()
      await empty.cleanup()
    }

    const truncatedPath = join(fixture.directory, "truncated.cbz")
    await writeFile(truncatedPath, fixture.bytes.subarray(0, Math.max(1, fixture.bytes.byteLength - 32)))
    const truncated = new ZipArchiveProvider(truncatedPath)
    try {
      await expect(truncated.list()).rejects.toThrow()
    } finally {
      await truncated.close()
    }
  })

  it("[neoview.archive.large-index] indexes hundreds of entries without reading their payloads", async () => {
    const many = await createZipFixture({
      entries: Array.from({ length: 512 }, (_, index) => ({
        path: `pages/${String(index).padStart(4, "0")}.jpg`,
        bytes: Uint8Array.of(index & 0xff),
        level: 0,
      })),
    })
    let bytesRead = 0
    const provider = new ZipArchiveProvider(many.path, { onRead: (_offset, _length, actual) => { bytesRead += actual } })
    try {
      const entries = await provider.list()
      expect(entries).toHaveLength(512)
      expect(bytesRead).toBeLessThan(many.bytes.byteLength)
    } finally {
      await provider.close()
      await many.cleanup()
    }
  })
})

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(result.value)
    length += result.value.byteLength
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function readUntilTerminal(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  for (;;) {
    const result = await reader.read()
    if (result.done) return
  }
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error("ZIP filename replacements must preserve byte length.")
  const fromBytes = new TextEncoder().encode(from)
  const toBytes = new TextEncoder().encode(to)
  let replacements = 0
  for (let offset = 0; offset <= bytes.length - fromBytes.length; offset += 1) {
    if (!fromBytes.every((value, index) => bytes[offset + index] === value)) continue
    bytes.set(toBytes, offset)
    replacements += 1
    offset += fromBytes.length - 1
  }
  if (replacements < 2) throw new Error(`Expected local and central ZIP filename records, found ${replacements}.`)
  return bytes
}
