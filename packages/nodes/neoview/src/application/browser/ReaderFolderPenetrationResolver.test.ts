import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryListing, ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderFolderPenetrationResolver } from "./ReaderFolderPenetrationResolver.js"

const directory = (path: string) => ({ name: path.split("/").at(-1)!, path, kind: "directory" as const, readerSupported: true })
const file = (path: string, readerSupported = true) => ({ name: path.split("/").at(-1)!, path, kind: "file" as const, readerSupported })

function provider(listings: Record<string, ReaderDirectoryListing>, aliases: Record<string, string> = {}): ReaderDirectoryListingProvider {
  return {
    async canonicalize(path) { return aliases[path] ?? path },
    async read(path) {
      const listing = listings[path]
      if (!listing) throw new Error(`missing ${path}`)
      return listing
    },
  }
}

describe("ReaderFolderPenetrationResolver", () => {
  it("[neoview.folder.penetration-chain] resolves a unique directory chain with sidecars to one archive", async () => {
    const resolver = new ReaderFolderPenetrationResolver(provider({
      "/A": { path: "/A", entries: [directory("/A/B"), file("/A/cover.jpg"), file("/A/info.nfo", false)] },
      "/A/B": { path: "/A/B", entries: [directory("/A/B/C"), file("/A/B/cover.png")] },
      "/A/B/C": { path: "/A/B/C", entries: [file("/A/B/C/book.cbz"), file("/A/B/C/book.nfo", false)] },
    }))

    await expect(resolver.resolve("/A", { maxDepth: 3 })).resolves.toMatchObject({
      status: "resolved",
      terminal: { kind: "archive", path: "/A/B/C/book.cbz" },
      chain: [{ path: "/A" }, { path: "/A/B" }, { path: "/A/B/C" }],
    })
  })

  it("[neoview.folder.penetration-media] accepts real media folders but rejects text-only folders", async () => {
    const resolver = new ReaderFolderPenetrationResolver(provider({
      "/media": { path: "/media", entries: [file("/media/1.jpg"), file("/media/2.mp4"), file("/media/2.ass", false)] },
      "/text": { path: "/text", entries: [file("/text/a.json", false), file("/text/readme.txt", false)] },
    }))

    await expect(resolver.resolve("/media")).resolves.toMatchObject({ status: "resolved", terminal: { kind: "media-directory", path: "/media" } })
    await expect(resolver.resolve("/text")).resolves.toMatchObject({ status: "empty", reason: "empty" })
  })

  it("[neoview.folder.penetration-mixed-media] opens direct media before deferring child folders", async () => {
    const resolver = new ReaderFolderPenetrationResolver(provider({
      "/artist": {
        path: "/artist",
        entries: [
          directory("/artist/4"),
          file("/artist/001.avif"),
          file("/artist/001.json", false),
          file("/artist/002.avif"),
          file("/artist/002.json", false),
        ],
      },
    }))

    await expect(resolver.resolve("/artist")).resolves.toMatchObject({
      status: "resolved",
      terminal: { kind: "media-directory", path: "/artist" },
      reason: "mixed-media-directory",
      directMediaCount: 2,
      deferredDirectoryCount: 1,
    })
  })

  it("[neoview.folder.penetration-ambiguous] keeps multi-target and mixed directories as branches", async () => {
    const resolver = new ReaderFolderPenetrationResolver(provider({
      "/many": { path: "/many", entries: [file("/many/a.cbz"), file("/many/b.cbz")] },
      "/mixed": { path: "/mixed", entries: [directory("/mixed/nested"), file("/mixed/a.cbz")] },
    }))

    await expect(resolver.resolve("/many")).resolves.toMatchObject({ status: "branch", reason: "multiple-primary-items" })
    await expect(resolver.resolve("/mixed")).resolves.toMatchObject({ status: "branch", reason: "multiple-primary-items" })
  })

  it("[neoview.folder.penetration-safety] stops at exact depth and detects canonical cycles", async () => {
    const listings = {
      "/A": { path: "/A", entries: [directory("/A/B")] },
      "/A/B": { path: "/A/B", entries: [directory("/A/B/C")] },
      "/A/B/C": { path: "/A/B/C", entries: [file("/A/B/C/book.cbz")] },
      "/loop": { path: "/loop", entries: [directory("/loop/link")] },
      "/loop/link": { path: "/loop/link", entries: [directory("/loop")] },
    } satisfies Record<string, ReaderDirectoryListing>
    const resolver = new ReaderFolderPenetrationResolver(provider(listings, { "/loop/link": "/loop" }))

    await expect(resolver.resolve("/A", { maxDepth: 1 })).resolves.toMatchObject({ status: "blocked", reason: "depth-limit" })
    await expect(resolver.resolve("/A", { maxDepth: 2 })).resolves.toMatchObject({ status: "resolved", terminal: { path: "/A/B/C/book.cbz" } })
    await expect(resolver.resolve("/loop", { maxDepth: 10 })).resolves.toMatchObject({ status: "blocked", reason: "cycle" })
  })

  it("[neoview.folder.penetration-cache] singleflights identical requests, clones results and invalidates ancestors", async () => {
    const read = vi.fn(async (path: string) => ({ path, entries: [file(`${path}/book.cbz`)] }))
    const resolver = new ReaderFolderPenetrationResolver({ read })
    const [first, second] = await Promise.all([resolver.resolve("/A"), resolver.resolve("/A")])
    expect(read).toHaveBeenCalledOnce()
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    resolver.invalidate("/A/book.cbz")
    await resolver.resolve("/A")
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("[neoview.folder.penetration-cancel] lets one caller cancel without cancelling a shared flight", async () => {
    let release!: (listing: ReaderDirectoryListing) => void
    const listing = new Promise<ReaderDirectoryListing>((resolve) => { release = resolve })
    const resolver = new ReaderFolderPenetrationResolver({ read: () => listing })
    const controller = new AbortController()
    const cancelled = resolver.resolve("/A", {}, controller.signal)
    const retained = resolver.resolve("/A")
    controller.abort(new DOMException("cancelled", "AbortError"))
    release({ path: "/A", entries: [file("/A/book.cbz")] })
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    await expect(retained).resolves.toMatchObject({ status: "resolved" })
  })
})
