import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderBookSettingsMigrationFileController } from "./ReaderBookSettingsMigrationFileController.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ReaderBookSettingsMigrationFileController", () => {
  it("[neoview.book-settings.legacy-file-controller] inspects without a store and owns confirmed imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-book-settings-file-"))
    roots.push(root)
    const inputPath = join(root, "settings.json")
    const content = JSON.stringify({ "D:/book.cbz": { favorite: true } })
    await writeFile(inputPath, content, "utf8")
    const dispose = vi.fn(async () => undefined)
    const importSettings = vi.fn(async () => ({
      applied: { inserted: 1, updated: 0, unchanged: 0 }, unresolvedSources: 0, duplicateIdentities: 0,
    }))
    const createService = vi.fn(async () => ({ import: importSettings, [Symbol.asyncDispose]: dispose }))
    const controller = new ReaderBookSettingsMigrationFileController({ createService })

    await expect(controller.inspect(inputPath)).resolves.toMatchObject({ report: { validEntries: 1 } })
    expect(createService).not.toHaveBeenCalled()
    await expect(controller.import(inputPath, "D:/NeoView/thumbnails.db", "merge", false)).rejects.toThrow("confirmation")
    expect(createService).not.toHaveBeenCalled()

    await expect(controller.import(inputPath, "D:/NeoView/thumbnails.db", "overwrite", true)).resolves.toMatchObject({
      report: { validEntries: 1 }, result: { applied: { inserted: 1 } },
    })
    expect(createService).toHaveBeenCalledWith("D:/NeoView/thumbnails.db")
    expect(importSettings).toHaveBeenCalledWith(content, "overwrite", true, undefined)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("[neoview.book-settings.legacy-file-validation] rejects invalid or oversized input before opening SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-book-settings-file-invalid-"))
    roots.push(root)
    const invalidPath = join(root, "invalid.json")
    const oversizedPath = join(root, "oversized.json")
    await writeFile(invalidPath, "x", "utf8")
    await writeFile(oversizedPath, "12345", "utf8")
    const createService = vi.fn()
    const controller = new ReaderBookSettingsMigrationFileController({ createService, maxBytes: 4 })

    await expect(controller.import(invalidPath, undefined, "merge", true)).rejects.toThrow("valid JSON")
    await expect(controller.inspect(oversizedPath)).rejects.toThrow("exceeds 4 bytes")
    expect(createService).not.toHaveBeenCalled()
  })
})
