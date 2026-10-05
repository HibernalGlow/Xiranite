/**
 * Does a cargo feature actually change anything in the build it is passed to?
 *
 * Born from a measured near-miss on 2026-10-06: `--features=xiranite-core/clipboard` was accepted by cargo,
 * the host built, and the headless host still served the expected nodes — yet the dependency set was
 * byte-for-byte identical with and without it (127 crates, `arboard` present both ways). The reason is that
 * `xiranite-builtin-host` depends on `xiranite-core` without `default-features = false`, so the core's own
 * defaults are merged in no matter what a caller asks for. Every signal a person normally trusts — no error,
 * a green build, a passing host audit — reads as success while the gate does nothing.
 *
 * So the check is the only one that means anything: compare the resolved dependency sets of two real
 * feature combinations. This mirrors AGENTS.md's rule that a gate must inspect actual build parameters and
 * the real registry rather than reading a document or scanning a directory.
 */

/** Normalized crate names from one `cargo tree --prefix none -e normal` dump. */
export function crateNames(treeDump: string): Set<string> {
  const names = new Set<string>()
  for (const line of treeDump.split("\n")) {
    const [name] = line.trim().split(/\s+/)
    if (name !== undefined && name !== "") names.add(name)
  }
  return names
}

/** Names present in one set and not the other, both directions, sorted. */
export function setDifference(before: Set<string>, after: Set<string>): { onlyBefore: string[]; onlyAfter: string[] } {
  return {
    onlyBefore: [...before].filter((name) => !after.has(name)).sort(),
    onlyAfter: [...after].filter((name) => !before.has(name)).sort(),
  }
}

/**
 * `true` when adding the feature changed nothing at all.
 *
 * An empty-everything result is treated as inert too: a tree that failed to resolve must not be reported as
 * a working gate, so callers should check that the baseline set is non-empty before trusting a verdict.
 */
export function gateLooksInert(baseline: Set<string>, withFeature: Set<string>): boolean {
  if (baseline.size === 0 || withFeature.size === 0) return true
  const { onlyBefore, onlyAfter } = setDifference(baseline, withFeature)
  return onlyBefore.length === 0 && onlyAfter.length === 0
}

/** Human explanation for the usual cause, kept next to the predicate that decides it. */
export function inertGateHint(feature: string, packageWithGate: string): string {
  return (
    `${feature} does not change the resolved graph of -p ${packageWithGate}: the dependency sets are ` +
    "identical with and without it. The usual cause is that this package depends on the feature's owner " +
    "without `default-features = false`, so cargo's feature unification keeps the owner's defaults on and " +
    "the flag is a no-op. Confirm with: cargo tree -p " +
    `${packageWithGate} -e normal --prefix none --no-default-features`
  )
}
