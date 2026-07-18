import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js/index-native.js"

export interface ZipFixtureEntry {
  path: string
  bytes?: Uint8Array
  directory?: boolean
  level?: number
  password?: string
}

export interface ZipFixtureOptions {
  entries?: ZipFixtureEntry[]
  zip64?: boolean
  name?: string
}

export interface ZipFixture {
  directory: string
  path: string
  bytes: Uint8Array
  cleanup(): Promise<void>
}

export async function createZipFixture(options: ZipFixtureOptions = {}): Promise<ZipFixture> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-zip-"))
  const path = join(directory, options.name ?? "fixture.cbz")
  const output = new Uint8ArrayWriter()
  const writer = new ZipWriter(output, {
    keepOrder: true,
    useCompressionStream: true,
    useWebWorkers: false,
    zip64: options.zip64,
  })
  const entries = options.entries ?? [
    { path: "pages/001.jpg", bytes: Uint8Array.of(1, 2, 3, 4, 5), level: 6 },
    { path: "pages/002.jpg", bytes: Uint8Array.of(6, 7, 8), level: 0 },
    { path: "empty/", directory: true },
  ]
  try {
    for (const entry of entries) {
      await writer.add(
        entry.path,
        entry.directory ? undefined : new Uint8ArrayReader(entry.bytes ?? new Uint8Array()),
        {
          directory: entry.directory,
          level: entry.level,
          password: entry.password,
          lastModDate: new Date("2024-01-02T03:04:06.000Z"),
          useWebWorkers: false,
          useCompressionStream: true,
        },
      )
    }
    const bytes = await writer.close()
    await writeFile(path, bytes)
    return {
      directory,
      path,
      bytes,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await writer.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

export function deterministicBytes(length: number): Uint8Array {
  const output = new Uint8Array(length)
  let state = 0x9e3779b9
  for (let index = 0; index < output.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    output[index] = state & 0xff
  }
  return output
}
