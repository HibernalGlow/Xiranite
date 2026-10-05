#!/usr/bin/env bun
/**
 * Falsification tests for the tier → feature derivation in `scripts/lib/node-feature-set.ts`.
 *
 * Two directions are pinned, because a one-sided check would pass on a broken table either way: every
 * feature the core declares has to be reachable from some tier (so the build vocabulary cannot drift away
 * from the analyzer vocabulary), and a node that asks for nothing must get an empty feature set (so a
 * flavour is not quietly handed the whole host). The unknown-tier arm is the anti-vacuity control — without
 * it, a table that mapped nothing would also "pass".
 *
 * Run with: bun test scripts/node-feature-set.test.ts
 */
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { expect, it } from "bun:test"
import { declaredCoreFeatures, droppedEngineFeatures, featuresForNodes, keptEngineFeatures, uncoveredFeatures } from "./lib/node-feature-set.ts"

const repoRoot = resolve(import.meta.dirname, "..")
const manifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")

interface ManifestNode {
  id: string
  disposition: string
  hostRequirements: string[] | null
}

async function retained(): Promise<ManifestNode[]> {
  const document = JSON.parse(await readFile(manifestPath, "utf8")) as { nodes: ManifestNode[] }
  return document.nodes.filter((node) => node.disposition === "retain-rewrite")
}

it("every feature xiranite-core declares is reachable from some tier", async () => {
  const nodes = await retained()
  const decision = featuresForNodes(nodes)
  const declared = await declaredCoreFeatures(join(repoRoot, "crates", "xiranite-core", "Cargo.toml"))
  expect(declared.length).toBeGreaterThanOrEqual(5)
  expect(uncoveredFeatures(declared, decision.features)).toEqual([])
})

it("the single pure-logic node asks for no feature at all", async () => {
  const nodes = await retained()
  const pure = nodes.filter((node) => (node.hostRequirements ?? []).join("|") === "pure-logic")
  expect(pure.length).toBe(1)
  expect(featuresForNodes(pure).features).toEqual([])
  // Positive control for the line above: a node one tier richer must get a non-empty answer.
  const osNative = nodes.filter((node) => (node.hostRequirements ?? []).includes("os-native"))
  expect(featuresForNodes(osNative).features).toContain("clipboard")
})

it("os-native asks for exactly the four gated modules it actually reaches", async () => {
  const nodes = await retained()
  const osNative = nodes.filter((node) => (node.hostRequirements ?? []).includes("os-native"))
  const decision = featuresForNodes(osNative)
  expect(decision.features).toEqual(["clipboard", "known-folders", "power", "system-info", "trash"])
  const basis = decision.basis.find((row) => row.tier === "os-native")
  expect(basis?.features).toEqual(["clipboard", "system-info", "power", "known-folders"])
})

it("external-process is reported as unmappable, not silently dropped", async () => {
  const nodes = await retained()
  const decision = featuresForNodes(nodes)
  const row = decision.unmappedTiers.find((entry) => entry.tier === "external-process")
  expect(row).toBeDefined()
  expect(row?.nodes.length).toBeGreaterThan(0)
  expect(row?.why).toContain("xiranite-quickjs-executor")
  // The same nodes must not contribute a feature: an unanswerable tier cannot widen a build by accident.
  expect(decision.features).not.toContain("external-process")
})

it("a tier the table has never heard of lands in unmappedTiers, not in features", () => {
  const decision = featuresForNodes([{ id: "probe", hostRequirements: ["never-heard-of"] }])
  expect(decision.features).toEqual([])
  expect(decision.unmappedTiers.map((entry) => entry.tier)).toEqual(["never-heard-of"])
  expect(decision.unmappedTiers[0]?.why).toContain("no entry in TIER_TO_FEATURES")
})

it("a retained node with no measured verdict contributes nothing", async () => {
  const nodes = await retained()
  const unaudited = nodes.filter((node) => node.hostRequirements === null)
  expect(featuresForNodes(unaudited).features).toEqual([])
  expect(featuresForNodes(unaudited).basis).toEqual([])
})

it("an engine is kept only for the service that needs it, and the two sets are exact complements", () => {
  expect(keptEngineFeatures(["czkawka"])).toEqual(["xiranite-builtin-host/czkawka"])
  expect(keptEngineFeatures(["findz", "config"])).toEqual(["xiranite-builtin-host/findz"])
  expect(keptEngineFeatures([])).toEqual([])
  // Complementarity is the assertion that matters: a flavour may drop every engine nobody declared, but
  // never one somebody did. §9.12 measures the prize as 314 of 441 crates, so a wrong guess here is loud.
  for (const services of [[], ["config"], ["czkawka"], ["findz"], ["czkawka", "findz"]]) {
    const kept = keptEngineFeatures(services)
    const dropped = droppedEngineFeatures(services)
    expect(kept.filter((spec) => dropped.includes(spec))).toEqual([])
    // The whole engine set must be accounted for: `kept.length` alone would pass if `dropped` were also empty.
    expect(kept.length + dropped.length).toBe(2)
    expect(kept.length).toBe(services.filter((name) => name === "czkawka" || name === "findz").length)
  }
})
