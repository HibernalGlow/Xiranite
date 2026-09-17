import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { openWritableSqlite } from "./openWritableSqlite.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-sqlite-writable-open-"))
  roots.push(root)
  return root
}

describe("openWritableSqlite", () => {
  it("[neoview.sqlite.create-parent-directory] creates the containing directory when creation is requested", async () => {
    const root = await temporaryRoot()
    // Mirrors the macOS/Linux legacy location, whose application data directory is
    // absent until the reader data store has been opened once.
    const databasePath = join(root, "NeoView", "thumbnails.db")

    const database = await openWritableSqlite(databasePath, { create: true })
    try {
      database.exec("CREATE TABLE marker (value TEXT NOT NULL);")
      database.run("INSERT INTO marker (value) VALUES (?1)", "created")
      expect(database.get("SELECT value FROM marker LIMIT 1")).toEqual({ value: "created" })
    } finally {
      database.close()
    }
    expect((await stat(databasePath)).isFile()).toBe(true)
  })

  it("[neoview.sqlite.no-create-side-effect] leaves the filesystem untouched without a create request", async () => {
    const root = await temporaryRoot()
    const parentDirectory = join(root, "NeoView")

    await expect(openWritableSqlite(join(parentDirectory, "thumbnails.db"))).rejects.toThrow()
    await expect(stat(parentDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.sqlite.in-memory-create] opens an in-memory database without resolving a directory", async () => {
    const database = await openWritableSqlite(":memory:", { create: true })
    try {
      database.exec("CREATE TABLE marker (value TEXT NOT NULL);")
      database.run("INSERT INTO marker (value) VALUES (?1)", "memory")
      expect(database.get("SELECT value FROM marker LIMIT 1")).toEqual({ value: "memory" })
    } finally {
      database.close()
    }
  })
})
