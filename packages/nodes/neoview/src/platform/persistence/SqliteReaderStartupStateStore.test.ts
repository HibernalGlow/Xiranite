import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import { SqliteReaderStartupStateStore } from "./SqliteReaderStartupStateStore.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SqliteReaderStartupStateStore", () => {
  it("[neoview.startup-state.sqlite] persists the last folder only in an xr_ table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-startup-state-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const legacy = await openWritableSqlite(path, { create: true })
    legacy.exec("PRAGMA user_version = 7; CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT); INSERT INTO metadata VALUES ('version', '2.4');")
    legacy.close()

    const store = await SqliteReaderStartupStateStore.open(path, { clock: () => 100 })
    await expect(store.getLastFolder()).resolves.toBeUndefined()
    await expect(store.saveLastFolder(" D:/Comics ")).resolves.toEqual({ path: "D:/Comics", updatedAt: 100 })
    await store.close()

    const database = await openWritableSqlite(path)
    expect(database.get("PRAGMA user_version")).toEqual({ user_version: 7 })
    expect(database.get("SELECT value FROM metadata WHERE key = 'version'")).toEqual({ value: "2.4" })
    expect(database.get("SELECT path, updated_at FROM xr_reader_startup_state WHERE state_key = 'last-folder'"))
      .toEqual({ path: "D:/Comics", updated_at: 100 })
    database.close()
  })
})
