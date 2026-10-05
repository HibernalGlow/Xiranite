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

  it("keeps every row, in id order, whatever order the two lists came in", () => {
    const existing = [entry("charlie", "c-old"), entry("alpha", "a-old")]
    const fresh = [entry("bravo", "b-new"), entry("alpha", "a-new"), entry("charlie", "c-old")]

    const ids = mergeEmbeddedIndex(existing, fresh, new Set(["alpha"])).map((row) => row.id)

    expect(ids).toEqual(["alpha", "bravo", "charlie"])
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
