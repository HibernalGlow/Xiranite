import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { openReadonlyLegacyEmmRecordStore, probeReadonlyLegacyEmmDatabases } from "./ReadonlyLegacyEmmRecordStore.js"

describe("ReadonlyLegacyEmmRecordStore", () => {
  it("[neoview.emm.external-readonly] projects legacy Mangas ratings and object tags by normalized filepath", async () => {
    const root = join(tmpdir(), `xiranite-emm-${randomUUID()}`)
    await mkdir(root, { recursive: true })
    const path = join(root, "database.sqlite")
    const database = new DatabaseSync(path)
    database.exec("CREATE TABLE Mangas (filepath TEXT, rating REAL, tags JSON, pageCount INTEGER, title TEXT, url TEXT, filesize INTEGER, hiddenBook INTEGER, posted INTEGER)")
    database.prepare("INSERT INTO Mangas VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").run(
      "D:\\Library\\Book.cbz",
      4.75,
      JSON.stringify({ artist: ["Alice"], female: ["glasses"] }),
      42,
      "Demo",
      "https://example.test/g/1",
      1_048_576,
      1,
      1_700_000_000,
    )
    database.close()
    const store = await openReadonlyLegacyEmmRecordStore([path])
    expect(store?.directoryEmmAvailable).toBe(true)
    const records = await store!.readDirectoryEmmRecords(["d:/library/book.cbz::001.png"])
    expect(JSON.parse(records.get("d:/library/book.cbz::001.png")!.ratingData!)).toMatchObject({ value: 4.75 })
    expect(JSON.parse(records.get("d:/library/book.cbz::001.png")!.emmJson!).tags).toEqual([
      { namespace: "artist", tag: "Alice" },
      { namespace: "female", tag: "glasses" },
    ])
    expect(records.get("d:/library/book.cbz::001.png")).not.toHaveProperty("rawFields")
    const raw = await store!.readDirectoryEmmRecords(["d:/library/book.cbz::001.png"], undefined, { includeRaw: true })
    expect(raw.get("d:/library/book.cbz::001.png")?.rawFields).toEqual(expect.arrayContaining([
      { key: "filepath", type: "path", value: "D:\\Library\\Book.cbz" },
      { key: "filesize", type: "bytes", value: 1_048_576 },
      { key: "hiddenBook", type: "boolean", value: true },
      { key: "posted", type: "timestamp", value: 1_700_000_000 },
      { key: "rating", type: "number", value: 4.75 },
      { key: "url", type: "url", value: "https://example.test/g/1" },
    ]))
    expect(raw.get("d:/library/book.cbz::001.png")?.rawFields?.map((field) => field.key)).toEqual(
      [...raw.get("d:/library/book.cbz::001.png")!.rawFields!].map((field) => field.key).sort((left, right) => left.localeCompare(right, "en-US")),
    )
    await store!.close()
    await rm(root, { recursive: true, force: true })
  })

  it("[neoview.emm-config.connection] bounds schema probes and accepts a minimal Mangas.filepath schema", async () => {
    const root = join(tmpdir(), `xiranite-emm-probe-${randomUUID()}`)
    await mkdir(root, { recursive: true })
    const compatiblePath = join(root, "compatible.sqlite")
    const incompatiblePath = join(root, "incompatible.sqlite")
    const compatible = new DatabaseSync(compatiblePath)
    compatible.exec("CREATE TABLE Mangas (FilePath TEXT)")
    compatible.prepare("INSERT INTO Mangas VALUES (?1)").run("D:\\Library\\Minimal.cbz")
    compatible.close()
    const incompatible = new DatabaseSync(incompatiblePath)
    incompatible.exec("CREATE TABLE Other (value TEXT)")
    incompatible.close()

    try {
      await expect(probeReadonlyLegacyEmmDatabases([compatiblePath, incompatiblePath, join(root, "missing.sqlite")])).resolves.toEqual([
        { path: compatiblePath, status: "compatible", readOnly: true },
        { path: incompatiblePath, status: "incompatible", readOnly: true, error: "Mangas.filepath is required." },
        expect.objectContaining({ path: join(root, "missing.sqlite"), status: "missing", readOnly: true }),
      ])
      const store = await openReadonlyLegacyEmmRecordStore([compatiblePath])
      await expect(store?.readDirectoryEmmRecords(["D:/Library/Minimal.cbz"])).resolves.toEqual(new Map([
        ["D:/Library/Minimal.cbz", { emmJson: "{}" }],
      ]))
      store?.close()
      await expect(probeReadonlyLegacyEmmDatabases(Array.from({ length: 9 }, (_, index) => join(root, `${index}.sqlite`))))
        .rejects.toThrow("at most 8")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
