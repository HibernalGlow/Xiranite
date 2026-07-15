import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { PlatformDirectoryMetadataProvider } from "./PlatformDirectoryMetadataProvider.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformDirectoryMetadataProvider", () => {
  it("[neoview.folder.metadata-batch] hydrates requested stat fields without recursively sizing folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-folder-metadata-"))
    directories.push(root)
    const file = join(root, "book.cbz")
    const folder = join(root, "nested")
    await writeFile(file, "12345")
    await mkdir(folder)
    const provider = new PlatformDirectoryMetadataProvider()
    const entries = await provider.hydrate([
      { name: "book.cbz", path: file, kind: "file", readerSupported: true },
      { name: "nested", path: folder, kind: "directory", readerSupported: true },
    ], new Set(["date", "size"]))
    expect(entries[0]).toMatchObject({ size: 5, modifiedAt: expect.any(Number) })
    expect(entries[1]).toMatchObject({ modifiedAt: expect.any(Number) })
    expect(entries[1]?.size).toBeUndefined()
  })
})
