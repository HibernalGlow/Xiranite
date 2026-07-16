import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderFileOperationService } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader file-operation persistence", () => {
  it("[neoview.file-operations.undo-cross-process] reopens the primary Reader database and safely undoes the latest receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-file-undo-persistence-"))
    roots.push(root)
    const databasePath = join(root, "thumbnails.db")
    const sourcePath = join(root, "source.txt")
    const destinationPath = join(root, "destination.txt")
    await writeFile(sourcePath, "reader")

    const writer = await createReaderFileOperationService({ databasePath })
    const operation = await writer.execute({ operations: [{ kind: "copy", sourcePath, destinationPath }] })
    expect(operation).toMatchObject({ succeeded: 1, undoable: 1, undoPersisted: true })
    await writer.close()

    const reader = await createReaderFileOperationService({ databasePath })
    await reader.prepare()
    expect(reader.undoState()).toMatchObject({ available: true, count: 1, persistent: true })
    await expect(reader.undoLatest()).resolves.toMatchObject({ succeeded: 1, failed: 0, remaining: 0, journalPersisted: true })
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(sourcePath, "utf8")).toBe("reader")
    await reader.close()
  })
})
