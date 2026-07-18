import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { loadDirectoryBook } from "./DirectoryBookLoader.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("loadDirectoryBook", () => {
  it("[neoview.directory-book.p-map] loads naturally sorted media and subtitle assets from one bounded batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-directory-book-"))
    roots.push(root)
    await writeFile(join(root, "page10.jpg"), Uint8Array.of(1, 2, 3))
    await writeFile(join(root, "page2.png"), Uint8Array.of(4, 5))
    await writeFile(join(root, "page2.zh-CN.srt"), "1\n00:00:00,000 --> 00:00:01,000\ntext")
    await writeFile(join(root, "notes.txt"), "ignored")

    const book = await loadDirectoryBook(root)

    expect(book.pages.map((page) => page.name)).toEqual(["page2.png", "page10.jpg"])
    expect(book.pages.map((page) => page.byteLength)).toEqual([2, 3])
    expect(book.subtitleAssets).toEqual([
      expect.objectContaining({ name: "page2.zh-CN.srt", format: "srt" }),
    ])
    expect(book.pages.every((page) => page.thumbnailSource?.category === "file")).toBe(true)
    await book.close()
  })

  it("[neoview.directory-book.p-map] rejects a pre-cancelled load before scanning", async () => {
    const controller = new AbortController()
    controller.abort(new DOMException("Cancelled", "AbortError"))
    await expect(loadDirectoryBook("ignored", controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})
