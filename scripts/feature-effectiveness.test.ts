#!/usr/bin/env bun
/**
 * Tests for `scripts/lib/feature-effectiveness.ts`, the guard that refuses to build a flavour on an inert
 * cargo gate.
 *
 * Both directions are required: a predicate that only ever says "inert" would fail every build, while one
 * that only ever says "fine" would have approved the exact case that motivated it (measured on 2026-10-06:
 * `--features=xiranite-core/clipboard` left `arboard` present and the count at 127 crates, yet cargo, the
 * build and the host audit all reported success).
 *
 * Run with: bun test scripts/feature-effectiveness.test.ts
 */
import { expect, it } from "bun:test"
import { crateNames, gateLooksInert, inertGateHint, setDifference } from "./lib/feature-effectiveness.ts"

// The two leading columns are what `cargo tree --prefix none` actually emits per line shape: `name version`,
// sometimes followed by the source. Indent-free because --prefix none was asked for.
const TREE = "xiranite-builtin-host 0.1.0\nxiranite-core 0.1.0 (path+file:///x/crates/xiranite-core)\narboard 3.6.1\nserde 1.0.22x\n"

it("reads crate names out of a tree dump and ignores the noise", () => {
  expect([...crateNames(TREE)]).toEqual([
    "xiranite-builtin-host",
    "xiranite-core",
    "arboard",
    "serde",
  ])
})

it("a gate that adds one package is not called inert", () => {
  const baseline = crateNames("xiranite-builtin-host 0.1.0\nserde 1.0.22x\n")
  const withGate = crateNames(TREE)
  expect(gateLooksInert(baseline, withGate)).toBe(false)
  expect(setDifference(baseline, withGate).onlyAfter).toEqual(["arboard", "xiranite-core"])
})

it("identical graphs are inert, and inertness is reported both ways round", () => {
  const a = crateNames(TREE)
  const b = crateNames(TREE)
  expect(gateLooksInert(a, b)).toBe(true)
  const diff = setDifference(a, b)
  expect(diff.onlyBefore).toEqual([])
  expect(diff.onlyAfter).toEqual([])
})

it("a failed tree read is inert, never a silent pass", () => {
  // cargo writing nothing (bad flag, locked target dir) must not become evidence that a gate works.
  expect(gateLooksInert(crateNames(""), crateNames(TREE))).toBe(true)
  expect(gateLooksInert(crateNames(TREE), crateNames(""))).toBe(true)
})

it("the explanation names the fix and the command that re-measures it", () => {
  const hint = inertGateHint("xiranite-core/clipboard", "xiranite-builtin-host")
  expect(hint).toContain("default-features = false")
  expect(hint).toContain("cargo tree -p xiranite-builtin-host")
  expect(hint).toContain("xiranite-core/clipboard")
})
