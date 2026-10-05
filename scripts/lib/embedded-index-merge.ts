/**
 * The index of embedded node bundles, and the one operation on it that needs a test of its own.
 *
 * `scripts/embed-node-bundles.ts` runs `main()` at import, so nothing can unit-test a rule that lives inside it
 * without performing a real embed. `mergeEmbeddedIndex` is the rule that decides whether a partial refresh
 * speaks only for the nodes it copied, so it lives here where a test can reach it.
 */

/** One row of `crates/xiranite-quickjs-executor/bundles/index.json`. */
export interface EmbeddedIndexEntry {
  id: string
  file: string
  run: string
  createRuntime: string | null
  bytes: number
  sha256: string
  /** Where the artifact came from, so a stale file is traceable to its producer. */
  source: string
}

/**
 * The index after a partial refresh.
 *
 * A refreshed id takes the fresh entry. Every other id keeps the entry that describes the bytes still sitting
 * in `bundles/` — replacing those with the artifact's current hash would claim a copy that did not happen, and
 * that claim is exactly what lets one lane's run speak for another lane's uncommitted node code.
 *
 * An id in `fresh` that `existing` does not carry is a node whose bundle was built for the first time, so it
 * joins the list. Sorted by id afterwards, so a refresh cannot reorder the file and turn the next diff into
 * noise.
 */
export function mergeEmbeddedIndex(
  existing: EmbeddedIndexEntry[],
  fresh: EmbeddedIndexEntry[],
  refresh: ReadonlySet<string>,
): EmbeddedIndexEntry[] {
  const freshById = new Map(fresh.map((entry) => [entry.id, entry]))
  // Only a refreshed id takes the fresh row. The caller refuses a refreshed id with no artifact today, so the
  // fallback keeps the old row rather than inventing a rule for a state that cannot arrive.
  const merged = existing.map((entry) => (refresh.has(entry.id) ? (freshById.get(entry.id) ?? entry) : entry))
  const known = new Set(merged.map((entry) => entry.id))
  for (const entry of fresh) {
    if (!known.has(entry.id)) merged.push(entry)
  }
  return merged.sort((left, right) => left.id.localeCompare(right.id))
}
