import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readEfuDirectoryListing } from "./PlatformEfuDirectoryListingProvider.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformEfuDirectoryListingProvider", () => {
  it("maps EFU records to reader entries with metadata, directories, and path deduplication", async () => {
    const root = await temporaryRoot()
    const path = join(root, "results.efu")
    await writeFile(path, [
      "Filename,Size,Date Modified,Attributes",
      '"C:\\Books\\A, one.cbz",123,133801632000000000,32',
      '"C:\\Books\\Folder",0,2024-01-02T03:04:05Z,D',
      '"c:\\books\\a, one.cbz",999,0,32',
    ].join("\r\n"))

    const listing = await readEfuDirectoryListing(path)

    expect(listing).toMatchObject({ path, sourceKind: "efu" })
    expect(listing.parentPath).toBeUndefined()
    expect(listing.entries).toEqual([
      expect.objectContaining({ name: "A, one.cbz", path: "C:\\Books\\A, one.cbz", kind: "file", size: 123, readerSupported: true }),
      expect.objectContaining({ name: "Folder", path: "C:\\Books\\Folder", kind: "directory", readerSupported: true }),
    ])
    expect(listing.entries[0]?.modifiedAt).toBeGreaterThan(0)
    expect(listing.entries[1]?.modifiedAt).toBe(Date.parse("2024-01-02T03:04:05Z"))
  })

  it("reads UTF-16LE Everything exports through the shared streaming parser", async () => {
    const root = await temporaryRoot()
    const path = join(root, "utf16.efu")
    await writeFile(path, Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Filename,Size\r\nD:/images/a.png,42\r\n", "utf16le"),
    ]))

    await expect(readEfuDirectoryListing(path)).resolves.toMatchObject({
      sourceKind: "efu",
      entries: [{ name: "a.png", path: "D:/images/a.png", kind: "file", size: 42, readerSupported: true }],
    })
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "neoview-efu-"))
  roots.push(root)
  return root
}
