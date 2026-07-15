import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { PlatformDirectoryListingProvider } from "./PlatformDirectoryListingProvider.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformDirectoryListingProvider", () => {
  it("[neoview.file-tree.opendir] streams one native level without applying application sorting or leaking nested entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-tree-"))
    temporaryPaths.push(root)
    await mkdir(join(root, "chapter-2", "nested"), { recursive: true })
    await writeFile(join(root, "chapter-10.cbz"), "archive")
    await writeFile(join(root, "chapter-2", "nested", "page.png"), "image")

    const listing = await new PlatformDirectoryListingProvider().read(root)

    expect(listing.entries.map((entry) => entry.name).toSorted()).toEqual(["chapter-10.cbz", "chapter-2"])
    expect(listing.entries.find((entry) => entry.name === "chapter-2")).toMatchObject({ kind: "directory", readerSupported: true })
    expect(listing.entries.find((entry) => entry.name === "chapter-10.cbz")).toMatchObject({ kind: "file", readerSupported: true })
    expect(listing.entries.some((entry) => entry.name === "page.png")).toBe(false)
  })

  it("[neoview.file-tree.cancel] rejects an already-cancelled stream before publishing entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-tree-"))
    temporaryPaths.push(root)
    const controller = new AbortController()
    controller.abort(new DOMException("superseded", "AbortError"))
    await expect(new PlatformDirectoryListingProvider().read(root, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})
