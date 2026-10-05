/**
 * The assertable core of a route A flavour verification.
 *
 * `xiranite-dev-host` prints one audit line at start-up (`staging_summary` in
 * `crates/xiranite-loopback-host/src/launcher.rs`) naming the node ids the *running* host will dispatch.
 * That line is the only product-level evidence that a subset table survived compilation into the host, so
 * comparing against it is the difference between "cargo said Finished" and "the shipped host serves what
 * was asked for". Split out of `build-node-flavor.ts` because that file runs on import; a predicate has to
 * be testable without launching a host.
 */

/** Ids named in the host's audit line; empty when the line is absent (a host that never staged). */
export function servedIdsFromLog(log: string): string[] {
  const clause = /nodes \[([^\]]*)\]/.exec(log)?.[1] ?? ""
  return clause
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
}

/**
 * `dissolvef` and `kisaki` are the two nodes `xiranite-builtin-host` still hand-links in its own
 * `build.rs` staging list, so they appear in every flavour regardless of `--node`. Naming them here is a
 * deliberate coupling: when that hand-written pair finally retires, the helper that builds the expected
 * set has to lose them and this constant is where the change shows up.
 */
export const HAND_LINKED_NODE_IDS: readonly string[] = ["dissolvef", "kisaki"]

/** The ids a flavour is expected to serve: what `--node` asked for, plus what the host always links. */
export function expectedServedIds(requested: readonly string[]): string[] {
  return [...new Set([...requested, ...HAND_LINKED_NODE_IDS])].sort()
}

/**
 * Returns the two lists when they disagree, `null` when they match. Kept symmetric: a one-directional
 * "is every requested id present" check would pass a host that also serves nodes the flavour excluded,
 * which is exactly the leak a per-node distribution is meant to close.
 */
export function flavourMismatch(
  requested: readonly string[],
  served: readonly string[],
): { expected: string[]; served: string[] } | null {
  const expected = expectedServedIds(requested)
  const actual = [...served].sort()
  return expected.join("|") === actual.join("|") ? null : { expected, served: actual }
}
