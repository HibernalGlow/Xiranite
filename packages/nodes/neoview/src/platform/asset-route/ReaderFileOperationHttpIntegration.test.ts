import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderHttpController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader file operation HTTP composition", () => {
  it("[neoview.file-operations.http-composition] persists a guarded receipt and undoes it through the real controller", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-file-http-"))
    roots.push(root)
    const sourcePath = join(root, "source.txt")
    const destinationPath = join(root, "destination.txt")
    const databasePath = join(root, "thumbnails.db")
    await writeFile(sourcePath, "reader")

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: databasePath,
    })
    try {
      const executed = await controller.handle(jsonRequest("/reader/files/operations", {
        operations: [{ kind: "copy", sourcePath, destinationPath }],
      }))
      expect(executed?.status).toBe(200)
      await expect(executed!.json()).resolves.toMatchObject({
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        undoable: 1,
        undoPersisted: true,
      })
      expect(await readFile(sourcePath, "utf8")).toBe("reader")
      expect(await readFile(destinationPath, "utf8")).toBe("reader")

      const state = await controller.handle(authorized("/reader/files/operations"))
      expect(state?.status).toBe(200)
      await expect(state!.json()).resolves.toMatchObject({
        available: true,
        count: 1,
        persistent: true,
        supportedKinds: expect.arrayContaining(["copy", "trash"]),
      })

      const undone = await controller.handle(jsonRequest("/reader/files/undo", { confirmed: true }))
      expect(undone?.status).toBe(200)
      await expect(undone!.json()).resolves.toMatchObject({
        succeeded: 1,
        failed: 0,
        remaining: 0,
        journalPersisted: true,
      })
      await expect(stat(destinationPath)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(sourcePath, "utf8")).toBe("reader")

      const finalState = await controller.handle(authorized("/reader/files/operations"))
      await expect(finalState!.json()).resolves.toMatchObject({ available: false, count: 0, persistent: true })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function authorized(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:43127${path}`, {
    ...init,
    headers: { ...init.headers, "x-xiranite-token": "runtime-token" },
  })
}

function jsonRequest(path: string, body: unknown): Request {
  return authorized(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
