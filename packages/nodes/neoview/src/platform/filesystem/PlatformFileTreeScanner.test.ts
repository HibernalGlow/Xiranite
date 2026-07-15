import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { PlatformFileTreeScanner } from "./PlatformFileTreeScanner.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformFileTreeScanner", () => {
  it("[neoview.file-tree.readdirp] streams recursive entries without stat hydration", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-scan-"))
    temporaryPaths.push(root)
    await mkdir(join(root, "series", "volume"), { recursive: true })
    await writeFile(join(root, "series", "volume", "book.cbz"), "archive")
    const entries = []
    for await (const entry of new PlatformFileTreeScanner().scan(root)) entries.push(entry)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "series", depth: 0, kind: "directory" }),
      expect.objectContaining({ relativePath: join("series", "volume"), depth: 1, kind: "directory" }),
      expect.objectContaining({ relativePath: join("series", "volume", "book.cbz"), depth: 2, kind: "file" }),
    ]))
  })

  it("[neoview.file-tree.scan-limit] stops an unbounded recursive result before publishing excess entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-scan-"))
    temporaryPaths.push(root)
    await Promise.all([0, 1, 2].map((index) => writeFile(join(root, `${index}.txt`), "file")))
    const consume = async () => {
      for await (const _entry of new PlatformFileTreeScanner().scan(root, { maximumEntries: 2 })) {
        // Consume until the scanner enforces its bounded contract.
      }
    }
    await expect(consume()).rejects.toThrow("2 entry limit")
  })
})
