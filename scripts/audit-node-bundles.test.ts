#!/usr/bin/env bun
/**
 * Falsification tests for `scripts/audit-node-bundles.ts`.
 *
 * The gate is only trustworthy if every failure arm has a *positive control*: a fixture that turns it red, and
 * one that proves the gate can pass. `audit-node-registry.ts` earns that discipline by comparing three on-disk
 * sets instead of scanning one directory, so this file does the same against synthetic fixtures — each arm gets
 * a bundle that must make the gate red, and one green fixture bundle must keep it green.
 *
 * Run with: bun test scripts/audit-node-bundles.test.ts
 */
import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  auditNodeBundles,
  bundleExportNames,
  forbiddenGlobalsInSource,
  parseGeneratedNodeIds,
  unmappedBuiltinSpecifiers,
} from "./audit-node-bundles.ts"

interface FixtureNode {
  id: string
  run?: string | null
  createRuntime?: string | null
  coreOk?: boolean
  coreSource?: string
  coreExternals?: string[]
  platformOk?: boolean
  platformSource?: string
  platformExternals?: string[]
}

interface Fixture {
  dir: string
  paths: { bundlesDir: string; manifestPath: string; generatedTablePath: string; nodesDir: string; targetManifestPath: string }
}

/** A clean core bundle: exports the run name, no forbidden globals, no unmapped builtins. */
function cleanCore(run: string): string {
  return `// This bundle documents Buffer.from(x) and process.exit() in a comment; they must not count as evidence.\nfunction ${run}(input, runtime, onEvent) { return Promise.resolve({ success: true }) }\nexport {\n  ${run}\n};\n`
}

function cleanPlatform(createRuntime: string): string {
  return `function ${createRuntime}(context) { return Object.assign({}, context) }\nexport {\n  ${createRuntime}\n};\n`
}

/**
 * Writes a fixture tree and returns the paths the audit needs. The generated table and target manifest carry the
 * registered/retained ids; the bundle manifest is what `build-node-bundles.ts` would emit; the `.js` files are
 * the artefacts the arms scan.
 */
async function makeFixture(nodes: FixtureNode[], opts: { allowlist?: unknown[] } = {}): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "node-bundles-audit-"))
  const bundlesDir = join(dir, "bundles")
  const nodesRoot = join(dir, "nodes")
  await mkdir(bundlesDir, { recursive: true })
  await mkdir(nodesRoot, { recursive: true })

  const manifestNodes: Record<string, unknown> = {}
  const tableEntries: string[] = []
  const targetNodes: Array<{ id: string; disposition: string }> = []
  for (const node of nodes) {
    const id = node.id
    const corePath = `${id}.core.js`
    const platformPath = `${id}.platform.js`
    await mkdir(join(nodesRoot, id, "src"), { recursive: true })
    await writeFile(join(nodesRoot, id, "src", "core.ts"), `export function ${node.run ?? "run"}() {}`)
    const coreOk = node.coreOk ?? true
    const platformOk = node.platformOk ?? true
    if (coreOk && node.coreSource !== undefined) await writeFile(join(bundlesDir, corePath), node.coreSource)
    if (platformOk && node.platformSource !== undefined) await writeFile(join(bundlesDir, platformPath), node.platformSource)
    manifestNodes[id] = {
      id,
      disposition: "retain-rewrite",
      run: node.run ?? null,
      createRuntime: node.createRuntime ?? null,
      core: coreOk ? { path: `bundles/${corePath}`, bytes: 1, ok: true, error: null, unresolvedExternals: node.coreExternals ?? [] } : { path: `bundles/${corePath}`, bytes: 0, ok: false, error: "fixture: core bundle failed", unresolvedExternals: [] },
      platform: node.createRuntime && platformOk ? { path: `bundles/${platformPath}`, bytes: 1, ok: true, error: null, unresolvedExternals: node.platformExternals ?? [] } : null,
    }
    tableEntries.push(`  ${id}: {\n    packageName: "@xiranite/node-${id}",\n    run: ${JSON.stringify(node.run ?? "")},\n${node.createRuntime ? `    createRuntime: ${JSON.stringify(node.createRuntime)},\n` : ""}  },`)
    targetNodes.push({ id, disposition: "retain-rewrite" })
  }

  const manifestPath = join(bundlesDir, "manifest.json")
  await writeFile(manifestPath, JSON.stringify({ nodes: manifestNodes, counts: { nodes: nodes.length } }, null, 2))
  const generatedTablePath = join(dir, "node-runner.generated.ts")
  await writeFile(generatedTablePath, `// Generated.\nexport const generatedNodeSpecs: Record<string, unknown> = {\n${tableEntries.join("\n")}\n}\nexport const generatedNodeIds = Object.keys(generatedNodeSpecs)\n`)
  const targetManifestPath = join(dir, "target-node-manifest.json")
  await writeFile(targetManifestPath, JSON.stringify({ nodes: targetNodes }, null, 2))

  return {
    dir,
    paths: { bundlesDir, manifestPath, generatedTablePath, nodesDir: nodesRoot, targetManifestPath },
  }
}

const fixtures: string[] = []
afterEach(async () => {
  for (const dir of fixtures.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fixture(nodes: FixtureNode[]): Promise<Fixture> {
  const made = await makeFixture(nodes)
  fixtures.push(made.dir)
  return made
}

describe("unit helpers", () => {
  it("strips comment lines so a doc example cannot count as a Node global", () => {
    expect(forbiddenGlobalsInSource("// Buffer.from('x') and process.exit()\nexport const a = 1")).toEqual([])
    expect(forbiddenGlobalsInSource("const b = Buffer.from('x')\nexport { b }")).toContain("Buffer")
  })

  it("reads the export bindings an ESM bundle declares", () => {
    const names = bundleExportNames("function runX(){}\nexport {\n  runX as default2\n};\nexport { helper }")
    expect(names.has("default2")).toBe(true)
    expect(names.has("helper")).toBe(true)
    expect(names.has("runX")).toBe(false)
  })

  it("classifies bare and prefixed builtins, mapped ones excluded", () => {
    const unmapped = unmappedBuiltinSpecifiers(["node:worker_threads", "node:fs/promises", "path", "stream", "node:url", "@xiranite/file-operations"])
    // node:fs/promises + node:url + path are mapped (no fire); stream is beyond the eight; worker_threads unmapped.
    expect(unmapped).toEqual(["node:worker_threads", "stream"])
  })

  it("parses the generated table for the registered ids", () => {
    const ids = parseGeneratedNodeIds("export const generatedNodeSpecs = {\n  linedup: {\n    run: \"filterLines\",\n  },\n  trename: {\n    run: \"runTrename\",\n  },\n}")
    expect(ids).toEqual(["linedup", "trename"])
  })
})

describe("failure arms have positive controls", () => {
  it("GREEN: a clean core + platform bundle passes the gate", async () => {
    const run = "runGood"
    const createRuntime = "createGoodRuntime"
    const f = await fixture([{ id: "goodnode", run, createRuntime, coreSource: cleanCore(run), platformSource: cleanPlatform(createRuntime) }])
    const report = await auditNodeBundles({ ...f.paths, allowlist: [] })
    console.log("\n[green fixture] errors:", JSON.stringify(report.errors))
    console.log("[green fixture] warnings:", JSON.stringify(report.warnings))
    expect(report.errors).toEqual([])
    expect(report.scannedCoreBundles).toBe(1)
  })

  it("RED: a core bundle importing node:worker_threads turns the gate red", async () => {
    const run = "runBad"
    const f = await fixture([{ id: "workerthreads", run, coreSource: cleanCore(run), coreExternals: ["node:worker_threads"] }])
    const report = await auditNodeBundles({ ...f.paths, allowlist: [] })
    console.log("[worker_threads fixture] errors:", JSON.stringify(report.errors))
    expect(report.errors.some((line) => line.includes("node:worker_threads") && line.includes("no shim mapping"))).toBe(true)
  })

  it("RED: a missing run export turns the gate red", async () => {
    const f = await fixture([{ id: "noexport", run: "runAbsent", coreSource: "export { somethingElse };" }])
    const report = await auditNodeBundles({ ...f.paths, allowlist: [] })
    console.log("[missing run fixture] errors:", JSON.stringify(report.errors))
    expect(report.errors.some((line) => line.includes("run export \"runAbsent\" is absent"))).toBe(true)
  })

  it("RED: a core closure reaching a Node global turns the gate red", async () => {
    const run = "runGlobal"
    const f = await fixture([{ id: "reachesglobal", run, coreSource: `function ${run}(){ return process.env.X }\nexport { ${run} };` }])
    const report = await auditNodeBundles({ ...f.paths, allowlist: [] })
    console.log("[core global fixture] errors:", JSON.stringify(report.errors))
    expect(report.errors.some((line) => line.includes("reaches a Node global"))).toBe(true)
  })

  it("RED: an empty bundle directory (no readable core) turns the gate red", async () => {
    const run = "runGhost"
    // The node is retained but its core failed to build, so zero core bundles are scanned — an empty scan.
    const f = await fixture([{ id: "ghost", run, coreOk: false }])
    const report = await auditNodeBundles({ ...f.paths, allowlist: [] })
    console.log("[empty scan fixture] errors:", JSON.stringify(report.errors))
    expect(report.errors.some((line) => line.includes("empty scan"))).toBe(true)
    expect(report.errors.some((line) => line.includes("no core bundle"))).toBe(true)
  })
})
