/**
 * The one decision that says whether a scripted node can be scheduled at all.
 *
 * Lives in its own module because `embed-node-bundles.ts` runs on import (`await main()` at the bottom of that
 * file), so a test cannot import the generator — and this is the rule worth testing on its own: the manifest's
 * `maxLiveBytes` column is the operator's only lever over the 18 embedded bundles that stay unregistered today.
 * A policy field nobody reads is a failure this repo has already been bitten by twice (`confirm_before_run`,
 * the manifest's `services` column), so the read path is pinned by `scripts/embed-node-bundles.test.ts`.
 */

/** The resolved ceiling in bytes, or the reason the node must not enter the registry. */
export type Ceiling = { bytes: number } | { refusal: string }

/**
 * A node with no byte ceiling is not a node without a limit: `max_live_bytes = 0` is measured (via the probe in
 * `crates/xiranite-scripted-nodes/tests/every_registered_bundle_evaluates.rs`) to make the QuickJS executor refuse
 * to schedule the run — "declares no live-byte budget (max_live_bytes = 0), so the QuickJS executor refuses to
 * schedule it". Registering such a node puts the id in the host's list and then fails on the first operation.
 *
 * Two sources qualify, in this order: the manifest column `maxLiveBytes` (the single written source AGENTS.md
 * names, and a human decision) and the wasm-era `plugins/<id>/manifest.toml`'s `memory_max_pages × 64 KiB`.
 * A declared-but-malformed value is refused rather than fallen through: silently ignoring a typo in a policy
 * field is how a ceiling meant to bound a run ends up deciding it by accident.
 */
export function resolveCeiling(declared: number | null | undefined, memoryMaxPages: number): Ceiling {
  if (declared !== null && declared !== undefined && !(Number.isInteger(declared) && declared > 0)) {
    return { refusal: `manifest maxLiveBytes ${JSON.stringify(declared)} is not a positive whole byte count — falling back or guessing here either kills the run or widens it` }
  }
  if (declared !== null && declared !== undefined) return { bytes: declared }
  if (Number.isFinite(memoryMaxPages) && memoryMaxPages > 0) return { bytes: memoryMaxPages * 65536 }
  return {
    refusal: "no byte ceiling in any source: the executor refuses max_live_bytes = 0, and this file does not " +
      "invent one — set maxLiveBytes in docs/xiranite-target-node-manifest.json, or add memory_max_pages " +
      "to plugins/<id>/manifest.toml",
  }
}
