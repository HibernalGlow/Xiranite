#!/usr/bin/env bun
/**
 * Falsification tests for the route A host-audit predicate in `scripts/lib/node-flavor-assert.ts`.
 *
 * The fixture is the line a real flavour run produced on 2026-10-06 (`nodes [classq, dissolvef, kisaki]
 * granting 1 root(s)`), not a shape invented here. Both directions of disagreement are asserted: a host
 * missing a requested node, and a host serving a node the flavour excluded. The second one is the reason
 * the check is symmetric — a subset build that quietly kept every node would pass any "is it present" test.
 *
 * Run with: bun test scripts/node-flavor-assert.test.ts
 */
import { expect, it } from "bun:test"
import { expectedServedIds, flavourMismatch, servedIdsFromLog } from "./lib/node-flavor-assert.ts"

const REAL_AUDIT_LINE = "2026-10-05T17:39:22Z xiranite-dev-host: nodes [classq, dissolvef, kisaki] granting 1 root(s)"

it("reads the ids out of the line the host actually prints", () => {
  expect(servedIdsFromLog(REAL_AUDIT_LINE)).toEqual(["classq", "dissolvef", "kisaki"])
})

it("a flavour whose requested node is served matches, hand-linked nodes included", () => {
  expect(flavourMismatch(["classq"], servedIdsFromLog(REAL_AUDIT_LINE))).toBeNull()
})

it("a host missing the requested node is a mismatch", () => {
  const bad = flavourMismatch(["logx"], ["classq", "dissolvef", "kisaki"])
  expect(bad).not.toBeNull()
  expect(bad?.served).toEqual(["classq", "dissolvef", "kisaki"])
  expect(bad?.expected).toEqual(["dissolvef", "kisaki", "logx"])
})

it("a host that kept an excluded node is also a mismatch — the leak a subset build exists to close", () => {
  const bad = flavourMismatch(["classq"], ["classq", "dissolvef", "kisaki", "logx", "nameu"])
  expect(bad).not.toBeNull()
  expect(bad?.served).toEqual(["classq", "dissolvef", "kisaki", "logx", "nameu"])
  expect(bad?.expected).toEqual(["classq", "dissolvef", "kisaki"])
})

it("an absent audit line is a mismatch, never an empty pass", () => {
  expect(servedIdsFromLog("no summary here")).toEqual([])
  expect(flavourMismatch(["classq"], servedIdsFromLog("no summary here"))).not.toBeNull()
})

it("asking for a hand-linked node does not list it twice", () => {
  expect(expectedServedIds(["dissolvef"])).toEqual(["dissolvef", "kisaki"])
})
