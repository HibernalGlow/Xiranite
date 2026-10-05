/**
 * Test home: `vitest.scripts.config.ts`, because the root Vitest config collects test files under `src` only
 * and vitest has no include override on the command line — a script-side Vitest test is only collectable if a
 * config lists it. Run it with `bun run test:ci-build-targets`. Note that another lane has staged a deletion
 * of that config together with the `test:typecheck-baseline` key that currently consumes it; if that lands,
 * this file needs its config home re-declared rather than a new runner. CI wires the gate itself
 * (`audit:ci-build-targets`, which needs no config), not this test, so a re-home cannot turn the pipeline red.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "vitest"

import {
  cargoWorkspaceMembers,
  checkTargets,
  extractTargets,
  packageScriptNames,
  readWorkflows,
  repoRoot,
  type TargetUniverse,
  type WorkflowTargets,
} from "./audit-ci-build-targets"

const UNIVERSE: TargetUniverse = {
  cargoMembers: ["xiranite-core", "quickjs-realm"],
  packageScripts: ["lint", "build:node-bundles"],
  fileExists: (path) => path === "scripts/real.ts",
}

function empty(): WorkflowTargets {
  return { cargoPackages: [], bunScripts: [], scriptFiles: [] }
}

describe("extractTargets", () => {
  test("reads the -p values out of a run: line, including the -p=name form", () => {
    const targets = extractTargets(
      ".github/workflows/ci.yml",
      [
        "      - name: Core crate lints strictly",
        "        run: cargo clippy --locked -j 1 -p xiranite-core --all-targets --no-deps -- -D warnings",
        "        run: cargo test --locked -p=quickjs-realm -j 1",
      ].join("\n"),
    )
    expect(targets.cargoPackages.map((m) => m.target)).toEqual(["xiranite-core", "quickjs-realm"])
    expect(targets.cargoPackages[0].line).toBe(2)
    expect(targets.cargoPackages[0].command).toContain("--all-targets")
  })

  test("a comment naming a crate is prose, not a build argument", () => {
    const targets = extractTargets(
      ".github/workflows/ci.yml",
      ["  # Deliberately NOT covered here yet: `-p xiranite-desktop`.", "    run: cargo check --locked -p xiranite-core -j 1"].join("\n"),
    )
    expect(targets.cargoPackages.map((m) => m.target)).toEqual(["xiranite-core"])
  })

  test("`bun run --cwd <pkg> test` is not read as a script named --cwd", () => {
    const targets = extractTargets(".github/workflows/ci.yml", "        run: bun run --cwd packages/tauri-migrate test")
    expect(targets.bunScripts).toEqual([])
  })

  test("collects a directly invoked scripts/*.ts path", () => {
    const targets = extractTargets(".github/workflows/ci.yml", "        run: bun scripts/embed-node-bundles.ts --check")
    expect(targets.scriptFiles.map((m) => m.target)).toEqual(["scripts/embed-node-bundles.ts"])
  })
})

describe("checkTargets", () => {
  test("positive control: a bogus crate, a bogus script and a missing file each produce a named finding", () => {
    const targets = extractTargets(
      ".github/workflows/ci.yml",
      [
        "        run: cargo test --locked -p quickjs-realm -j 1",
        "        run: cargo test --locked -p crates_that_were_never_committed -j 1",
        "        run: bun run audit:script_that_does_not_exist",
        "        run: node scripts/missing_gate.ts",
      ].join("\n"),
    )
    const findings = checkTargets([targets], UNIVERSE)
    expect(findings).toHaveLength(3)
    expect(findings.join("\n")).toContain("crates_that_were_never_committed")
    expect(findings.join("\n")).toContain("bun run audit:script_that_does_not_exist")
    expect(findings.join("\n")).toContain("scripts/missing_gate.ts")
    // Every finding carries its location, so the reader can jump to the step instead of guessing.
    for (const finding of findings) expect(finding).toMatch(/\.github\/workflows\/ci\.yml:\d+/)
  })

  test("a workflow set that names nothing is reported as blindness, not as a clean scan", () => {
    expect(checkTargets([empty()], UNIVERSE)).toEqual([
      "no workflow names a cargo `-p` target, a `bun run` script or a `scripts/*.ts` path — the scan is blind, not clean",
    ])
  })

  test("a workspace that resolves to no members cannot grade anything", () => {
    const targets = extractTargets(".github/workflows/ci.yml", "        run: cargo test --locked -p xiranite-core -j 1")
    const noMembers: TargetUniverse = { ...UNIVERSE, cargoMembers: [] }
    expect(checkTargets([targets], noMembers)).toEqual(["cargo metadata reported no workspace members — the gate cannot grade anything"])
  })
})

describe("against the repository as it stands", () => {
  test("every target the workflows name resolves, and the scan is not blind", () => {
    const targets = readWorkflows()
    const universe: TargetUniverse = {
      cargoMembers: cargoWorkspaceMembers(),
      packageScripts: packageScriptNames(),
      fileExists: (path) => existsSync(join(repoRoot, path)),
    }
    const named = targets.flatMap((t) => [...t.cargoPackages, ...t.bunScripts, ...t.scriptFiles])
    // Non-blindness first: an empty difference over an empty scan would pass the assertion below for free.
    expect(named.length).toBeGreaterThan(10)
    expect(universe.cargoMembers).toContain("xiranite-core")
    expect(checkTargets(targets, universe)).toEqual([])
  })
})
