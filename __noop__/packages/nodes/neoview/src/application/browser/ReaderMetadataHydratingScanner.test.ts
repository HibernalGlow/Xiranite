import { describe, expect, it, vi } from "vitest"

import type { ReaderFileTreeScanner } from "../../ports/ReaderFileTreeScanner.js"
import { ReaderMetadataHydratingScanner } from "./ReaderMetadataHydratingScanner.js"

describe("ReaderMetadataHydratingScanner", () => {
  it("[neoview.folder.emm-search-batch] hydrates bounded batches while preserving scanner order", async () => {
    const source: ReaderFileTreeScanner = {
      async *scan() {
        for (let index = 0; index < 5; index += 1) yield entry(index)
      },
    }
    const hydrate = vi.fn(async (entries: readonly ReturnType<typeof directoryEntry>[]) => entries.map((value) => ({
      ...value,
      tags: [`artist:${value.name}`],
    })))
    const scanner = new ReaderMetadataHydratingScanner(source, { supportedFields: new Set(["tags"]), hydrate }, 2)

    const output = []
    for await (const value of scanner.scan("/library")) output.push(value)

    expect(hydrate.mock.calls.map(([values]) => values.length)).toEqual([2, 2, 1])
    expect(output.map((value) => value.name)).toEqual(["0.cbz", "1.cbz", "2.cbz", "3.cbz", "4.cbz"])
    expect(output[3]?.tags).toEqual(["artist:3.cbz"])
  })
})

function entry(index: number) {
  return { name: `${index}.cbz`, path: `/library/${index}.cbz`, relativePath: `${index}.cbz`, depth: 0, kind: "file" as const }
}

function directoryEntry(index: number) {
  return { name: `${index}.cbz`, path: `/library/${index}.cbz`, kind: "file" as const, readerSupported: false }
}
