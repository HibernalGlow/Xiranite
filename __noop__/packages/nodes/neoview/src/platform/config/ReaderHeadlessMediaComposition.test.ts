import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderFileTreeController, createReaderHeadlessController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader headless media composition", () => {
  it("[neoview.headless.media-registry] [neoview.headless.adjacent-book] shares TOML formats and sibling resolution with GUI composition", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-headless-media-"))
    roots.push(root)
    const book = join(root, "Book 1")
    const video = join(root, "Movie.comicvideo")
    await mkdir(book)
    await writeFile(join(book, "1.jpg"), Uint8Array.of(1, 2, 3))
    await writeFile(video, Uint8Array.of(4, 5, 6))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.image]",
      'supported_formats = ["jpg"]',
      'video_formats = ["comicvideo"]',
      'media_mime_types = { comicvideo = "video/mp4" }',
      "",
    ].join("\n"), "utf8")

    const controller = await createReaderHeadlessController({
      configPath,
      progressStore: false,
      legacyThumbnailDatabasePath: false,
    })
    try {
      const opened = await controller.open({ path: video })
      expect(opened.visiblePages[0]).toMatchObject({ name: "Movie.comicvideo", mediaKind: "video", mimeType: "video/mp4" })
      const previous = await controller.openAdjacent("previous")
      expect(previous?.book.displayName).toBe("Book 1")
      expect(previous?.visiblePages[0]).toMatchObject({ name: "1.jpg", mimeType: "image/jpeg" })
      await expect(controller.openAdjacent("previous")).resolves.toBeUndefined()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.filter-headless] shares configured video classification with the headless file tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-headless-filter-"))
    roots.push(root)
    await Promise.all([
      writeFile(join(root, "Movie.comicvideo"), Uint8Array.of(1)),
      writeFile(join(root, "Cover.jpg"), Uint8Array.of(2)),
    ])
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.image]",
      'supported_formats = ["jpg"]',
      'video_formats = ["comicvideo"]',
      'media_mime_types = { comicvideo = "video/mp4" }',
      "",
    ].join("\n"), "utf8")

    const controller = await createReaderFileTreeController({ configPath, legacyThumbnailDatabasePath: false })
    try {
      await controller.open({ path: root })
      await expect(controller.setFilter("video")).resolves.toMatchObject({
        filter: "video",
        total: 1,
        entries: [{ name: "Movie.comicvideo" }],
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})
