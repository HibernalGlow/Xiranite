import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformDirectoryListingProvider } from "./PlatformDirectoryListingProvider.js"
import { canonicalizePlatformDirectoryPath, normalizePlatformDirectoryPath } from "./PlatformDirectoryPath.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformDirectoryListingProvider", () => {
  it("[neoview.folder.windows-drive-root] converts drive-relative volume labels into absolute drive roots", () => {
    expect(normalizePlatformDirectoryPath("E:", "win32")).toBe("E:\\")
    expect(normalizePlatformDirectoryPath("E:/", "win32")).toBe("E:\\")
    expect(normalizePlatformDirectoryPath("E:\\library", "win32")).toBe("E:\\library")
    expect(normalizePlatformDirectoryPath("E:", "linux")).toBe("E:")
  })

  it("[neoview.folder.windows-drive-root] restores the root separator stripped by Windows realpath", async () => {
    const canonicalize = vi.fn(async () => "E:")

    await expect(canonicalizePlatformDirectoryPath("E:", "win32", canonicalize)).resolves.toBe("E:\\")
    expect(canonicalize).toHaveBeenCalledWith("E:\\")
  })

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
