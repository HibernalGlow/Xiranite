import { appendFile, readFile, stat } from "node:fs/promises"
import { afterEach, describe, expect, it } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../../test/fixture-builders/create-zip-fixture.js"
import { ZipArchiveProvider } from "./ZipArchiveProvider.js"
import { deleteZipArchiveEntry } from "./ZipArchiveEntryDeletion.js"

const fixtures: ZipFixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()))
})

describe("deleteZipArchiveEntry", () => {
  it("rewrites a CBZ beside its source and removes only the requested entry", async () => {
    const fixture = await createZipFixture({
      name: "editable.cbz",
      entries: [
        { path: "pages/001.jpg", bytes: Uint8Array.of(1, 2, 3), level: 6 },
        { path: "pages/002.jpg", bytes: Uint8Array.of(4, 5), level: 0 },
        { path: "metadata.txt", bytes: Uint8Array.of(6), level: 6 },
      ],
    })
    fixtures.push(fixture)
    const before = await stat(fixture.path)

    await expect(deleteZipArchiveEntry({ archivePath: fixture.path, entryIndex: 1 })).resolves.toEqual({
      archivePath: fixture.path,
      deletedEntryPath: "pages/002.jpg",
      remainingEntries: 2,
    })

    const provider = new ZipArchiveProvider(fixture.path)
    try {
      expect((await provider.list()).map((entry) => entry.path)).toEqual(["pages/001.jpg", "metadata.txt"])
      expect([...await collect(await provider.openEntry((await provider.list())[0]!.id))]).toEqual([1, 2, 3])
      expect((await stat(fixture.path)).size).toBeLessThan(before.size)
    } finally {
      await provider.close()
    }
  })

  it("refuses encrypted archives and leaves their source bytes intact", async () => {
    const fixture = await createZipFixture({
      name: "encrypted.cbz",
      entries: [{ path: "pages/secret.jpg", bytes: Uint8Array.of(9, 8, 7), password: "secret" }],
    })
    fixtures.push(fixture)
    const before = await readFile(fixture.path)

    await expect(deleteZipArchiveEntry({ archivePath: fixture.path, entryIndex: 0 })).rejects.toThrow("encrypted")

    await expect(readFile(fixture.path)).resolves.toEqual(before)
  })

  it("does not replace an archive that changed while the rewrite was pending", async () => {
    const fixture = await createZipFixture({ name: "changed.cbz" })
    fixtures.push(fixture)

    await expect(deleteZipArchiveEntry(
      { archivePath: fixture.path, entryIndex: 0 },
      { onBeforeReplace: async (path) => { await appendFile(path, Uint8Array.of(7)) } },
    )).rejects.toThrow("changed while")

    const provider = new ZipArchiveProvider(fixture.path)
    try {
      expect((await provider.list()).map((entry) => entry.path)).toEqual(["pages/001.jpg", "pages/002.jpg", "empty"])
    } finally {
      await provider.close()
    }
  })
})

async function collect(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const output: number[] = []
  for await (const chunk of stream) output.push(...chunk)
  return output
}
