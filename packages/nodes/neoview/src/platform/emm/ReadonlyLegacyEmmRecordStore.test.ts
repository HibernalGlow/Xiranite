import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { openReadonlyLegacyEmmRecordStore } from "./ReadonlyLegacyEmmRecordStore.js"

describe("ReadonlyLegacyEmmRecordStore", () => {
  it("projects legacy Mangas ratings and object tags by normalized filepath", async () => {
    const root = join(tmpdir(), `xiranite-emm-${randomUUID()}`)
    await mkdir(root, { recursive: true })
    const path = join(root, "database.sqlite")
    const database = new DatabaseSync(path)
    database.exec("CREATE TABLE Mangas (filepath TEXT, rating REAL, tags JSON, pageCount INTEGER)")
    database.prepare("INSERT INTO Mangas VALUES (?1, ?2, ?3, ?4)").run("D:\\Library\\Book.cbz", 4.75, JSON.stringify({ artist: ["Alice"], female: ["glasses"] }), 42)
    database.close()
    const store = await openReadonlyLegacyEmmRecordStore([path])
    expect(store?.directoryEmmAvailable).toBe(true)
    const records = await store!.readDirectoryEmmRecords(["d:/library/book.cbz::001.png"])
    expect(JSON.parse(records.get("d:/library/book.cbz::001.png")!.ratingData!)).toMatchObject({ value: 4.75 })
    expect(JSON.parse(records.get("d:/library/book.cbz::001.png")!.emmJson!).tags).toEqual([
      { namespace: "artist", tag: "Alice" },
      { namespace: "female", tag: "glasses" },
    ])
    await store!.close()
    await rm(root, { recursive: true, force: true })
  })
})
