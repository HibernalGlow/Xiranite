import { describe, expect, it } from "vitest"

import { mergeEmbeddedIndex, type EmbeddedIndexEntry } from "./embedded-index-merge"

/** A row of the embedded index, with the fields this rule actually reads. */
function entry(id: string, sha: string): EmbeddedIndexEntry {
  return {
    id,
    file: `${id}.js`,
    run: `run${id[0]?.toUpperCase()}${id.slice(1)}`,
    createRuntime: null,
    bytes: 1000 + sha.length,
    sha256: sha,
    source: `artifacts/node-bundles/${id}.js`,
  }
}

describe("a partial refresh of the embedded bundle index", () => {
  it("speaks only for the nodes it copied", () => {
    // The claim under test is the one that matters when several lanes share one working tree: the rows nobody
    // refreshed must keep the hash of the bytes still in bundles/. Taking the artifact hash for them instead
    // would report a copy that never happened — which is how one lane's run ships another lane's uncommitted
    // node code under the first lane's message.
    const existing = [entry("alpha", "a-old"), entry("bravo", "b-old"), entry("charlie", "c-old")]
    const fresh = [entry("alpha", "a-new"), entry("bravo", "b-new"), entry("charlie", "c-new")]

    const merged = mergeEmbeddedIndex(existing, fresh, new Set(["bravo"]))

    expect(merged.find((row) => row.id === "bravo")?.sha256).toBe("b-new")
    expect(merged.find((row) => row.id === "alpha")?.sha256).toBe("a-old")
    expect(merged.find((row) => row.id === "charlie")?.sha256).toBe("c-old")
  })

  it("keeps the list in id order whatever order the two lists came in", () => {
    // Bravo joins here only because this run copied it: a row may be added for a bundle that is now on disk,
    // never for one that is merely in the artifacts (see the two cases below).
    const existing = [entry("charlie", "c-old"), entry("alpha", "a-old")]
    const fresh = [entry("bravo", "b-new"), entry("alpha", "a-new"), entry("charlie", "c-old")]

    const ids = mergeEmbeddedIndex(existing, fresh, new Set(["alpha", "bravo"])).map((row) => row.id)

    expect(ids).toEqual(["alpha", "bravo", "charlie"])
  })

  it("keeps a node the artifacts gained but this run did not copy out of the index", () => {
    // `bun run build:node-bundles` may produce more artifacts than `bundles/` holds; a partial refresh must
    // not write rows for the difference, or the embedded set size grows by four phantom entries and the
    // scripted-nodes invariant (registered + refused == index rows) reads them as real bundles.
    const existing = [entry("alpha", "a-old")]
    const fresh = [entry("alpha", "a-new"), entry("newcomer", "n-new")]

    const merged = mergeEmbeddedIndex(existing, fresh, new Set(["alpha"]))

    expect(merged.map((row) => row.id)).toEqual(["alpha"])
    expect(merged[0]?.sha256).toBe("a-new")
  })

  it("lets a refreshed id that has never been embedded join the index", () => {
    const existing = [entry("alpha", "a-old")]
    const fresh = [entry("alpha", "a-old"), entry("newcomer", "n-new")]

    expect(mergeEmbeddedIndex(existing, fresh, new Set(["newcomer"])).map((row) => row.id)).toEqual([
      "alpha",
      "newcomer",
    ])
  })

  it("is not a rename of the fresh list: an unrefreshed row that the artifacts no longer carry survives", () => {
    // A node whose bundle is present but whose artifact failed to build today must keep its row, or the index
    // would describe a file that is still embedded as if it were gone and the next --check would look for it.
    const existing = [entry("alpha", "a-old"), entry("bravo", "b-old")]
    const fresh = [entry("alpha", "a-new")]

    const merged = mergeEmbeddedIndex(existing, fresh, new Set(["alpha"]))

    expect(merged.map((row) => row.id)).toEqual(["alpha", "bravo"])
    expect(merged.find((row) => row.id === "bravo")?.sha256).toBe("b-old")
    expect(merged.find((row) => row.id === "alpha")?.sha256).toBe("a-new")
  })
})
