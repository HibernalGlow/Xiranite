#!/usr/bin/env bun
/**
 * Falsification tests for the route A host-audit predicate in `scripts/lib/node-flavor-assert.ts`.
 *
 * The audit-line fixture is a line a real run produced on 2026-10-06 03:30 (`xiranite-dev-host: nodes
 * [classq, kisaki] granting 1 root(s)`), read from the binary that `--node classq --verify-host` had just
 * built — not a shape invented here. Both directions of disagreement are asserted: a host missing a
 * requested node, and a host serving a node the flavour excluded. The second one is the reason the check is
 * symmetric — a subset build that quietly kept every node would pass any "is it present" test.
 *
 * That same fixture line is now the *negative* case. `kisaki` left the hand-staged list on 2026-10-06, so a
 * `--node classq` host that still serves it is a build that did not pick up the retirement, and the predicate
 * has to say so. Keeping the line as a passing fixture would have frozen the pre-retirement behaviour into
 * the gauge.
 *
 * The last test is the one that exists because of a real failure: `dissolvef` was registered twice
 * (hand-staged in `build.rs` *and* present in the generated table), so the product host refused to start at
 * all, while this gauge kept calling that a passing flavour.
 *
 * Run with: bun test scripts/node-flavor-assert.test.ts
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "bun:test"
import { expectedServedIds, flavourMismatch, servedIdsFromLog } from "./lib/node-flavor-assert.ts"

const HAND_STAGED_LINE = "2026-10-06T03:30:23Z xiranite-dev-host: nodes [classq, kisaki] granting 1 root(s)"

it("reads the ids out of the line the host actually prints", () => {
  expect(servedIdsFromLog(HAND_STAGED_LINE)).toEqual(["classq", "kisaki"])
})

it("a subset host that serves only the requested node matches", () => {
  expect(flavourMismatch(["classq"], ["classq"])).toBeNull()
})

it("a host that kept serving the formerly hand-linked node is now a mismatch", () => {
  // The same line that used to pass: nothing is linked outside the generated table any more, so `kisaki`
  // alongside `--node classq` means the build kept a node the flavour excluded.
  const bad = flavourMismatch(["classq"], servedIdsFromLog(HAND_STAGED_LINE))
  expect(bad).not.toBeNull()
  expect(bad?.expected).toEqual(["classq"])
  expect(bad?.served).toEqual(["classq", "kisaki"])
})

it("a host missing the requested node is a mismatch", () => {
  const bad = flavourMismatch(["logx"], ["classq", "kisaki"])
  expect(bad).not.toBeNull()
  expect(bad?.served).toEqual(["classq", "kisaki"])
  expect(bad?.expected).toEqual(["logx"])
})

it("an absent audit line is a mismatch, never an empty pass", () => {
  expect(servedIdsFromLog("no summary here")).toEqual([])
  expect(flavourMismatch(["classq"], servedIdsFromLog("no summary here"))).not.toBeNull()
})

it("asking for a node does not widen the request, and does not list it twice", () => {
  expect(expectedServedIds(["classq", "classq", "logx"])).toEqual(["classq", "logx"])
  expect(expectedServedIds(["kisaki"])).toEqual(["kisaki"])
})

/**
 * The retirement, pinned on its source. `crates/xiranite-builtin-host/build.rs` spells the hand-staged list
 * in Rust; a non-empty entry there means a node with a second spelling, which is how the host came up
 * refusing to start once already. The parser is proven against a fixture that does name an id, so an empty
 * result on the real file is a reading, not a blind spot.
 */
it("build.rs stages no bundle by hand any more", () => {
  const pattern = /const NODE_BUNDLES: &\[&str\] = &\[([^\]]*)\]/
  const staged = (source: string): string[] =>
    [...(pattern.exec(source)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((found) => found[1] as string).sort()

  const real = readFileSync(resolve(import.meta.dirname, "../crates/xiranite-builtin-host/build.rs"), "utf8")
  expect(staged(real)).toEqual([])
  expect(staged('const NODE_BUNDLES: &[&str] = &["dissolvef", "kisaki"];')).toEqual(["dissolvef", "kisaki"])
})
