import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

import { PLUGIN_CONTRIBUTION_KINDS, componentContribution } from "./index"

/**
 * `docs/plugin-architecture.md` §12 makes this package an ABI, and an ABI is only real if something
 * reads it back. Both tests below fail on the two ways an ABI actually decays: a name added without
 * a decision behind it, and a policy copied in "for convenience".
 */

/** Deterministic: case-insensitive first, then code units, so ties (`ComponentContribution` /
 * `componentContribution`) do not depend on the engine's sort stability. */
function compareNames(a: string, b: string): number {
  const lower = a.toLowerCase().localeCompare(b.toLowerCase())
  return lower !== 0 ? lower : a.localeCompare(b)
}

function sortNames(names: readonly string[]): string[] {
  return [...names].sort(compareNames)
}

describe("public surface", () => {
  test("the emitted declaration file exports exactly the listed names", () => {
    const text = readFileSync(fileURLToPath(new URL("../dist/index.d.ts", import.meta.url)), "utf8")
    const found = [...text.matchAll(/^export(?:\s+declare)?\s+(?:type|interface|const|function)\s+([A-Za-z0-9_]+)/gm)]
      .map((match) => match[1]!)

    // The list is the decision record: widening the public surface means editing it on purpose.
    const expected = [
      "ComponentContribution",
      "PLUGIN_CONTRIBUTION_KINDS",
      "PluginCapabilityId",
      "PluginContribution",
      "PluginContributionKind",
      "PluginHostSurface",
      "componentContribution",
    ]

    expect(sortNames(found)).toEqual(sortNames(expected))
    expect(found.length).toBe(expected.length)
  })

  test("the package exports no capability list of its own", () => {
    // Runtime exports only — a `GRANTABLE_*` array copied from `src/plugins/frontendHost.ts` would
    // show up here, and that copy is the second-reader bug this repository already documents twice.
    expect(sortNames(Object.keys({ PLUGIN_CONTRIBUTION_KINDS, componentContribution }))).toEqual(
      sortNames(["PLUGIN_CONTRIBUTION_KINDS", "componentContribution"]),
    )
    expect(PLUGIN_CONTRIBUTION_KINDS).toEqual(["component"])
  })
})

describe("componentContribution", () => {
  test("the tag is written by the SDK, whatever the caller passed", () => {
    expect(componentContribution("example.panel")).toEqual({ kind: "component", id: "example.panel" })
    expect(componentContribution({ id: "example.panel", name: "Panel" })).toEqual({
      kind: "component",
      id: "example.panel",
      name: "Panel",
    })
    // A hand-typed tag from JS must not survive into the record: the host refuses unknown kinds, so
    // passing one through would turn a working plugin into a note in the log.
    expect(componentContribution({ kind: "panel", id: "example.panel" } as never).kind).toBe("component")
  })
})

/**
 * §12's failure mode, made mechanical.
 *
 * An out-of-repo plugin compiles against the emitted declarations. If those declarations name a host
 * internal (`@/components/ui`, `../../src/plugins/…`) or a package this one does not declare, the
 * author gets one of two outcomes this document already refuses: the internal tree becomes public API
 * (one refactor breaks every plugin), or resolution works only inside this repository and fails
 * outside it. The undeclared-dependency shape is not hypothetical — the same class is what left
 * `@xiranite/node-kisaki` present on disk but missing from the root manifest.
 */
function auditAbiSpecifiers(text: string, declaredDependencies: readonly string[]): string[] {
  const problems: string[] = []
  for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
    const specifier = match[1]!
    if (specifier.startsWith(".")) {
      problems.push(`relative escape into the repository: ${specifier}`)
      continue
    }
    if (specifier.startsWith("@/")) {
      problems.push(`host-internal alias in a published ABI: ${specifier}`)
      continue
    }
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0]!
    if (!declaredDependencies.includes(packageName)) {
      problems.push(`undeclared dependency: ${specifier} (package ${packageName})`)
    }
  }
  return problems
}

describe("the published ABI is self-sufficient", () => {
  const declarations = readFileSync(fileURLToPath(new URL("../dist/index.d.ts", import.meta.url)), "utf8")
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { dependencies?: Record<string, string> }
  const declared = Object.keys(manifest.dependencies ?? {})

  test("every specifier the declarations mention is local-free and declared as a dependency", () => {
    expect(auditAbiSpecifiers(declarations, declared)).toEqual([])
    // The one external name the ABI is allowed to carry.
    expect(declared).toEqual(["@xiranite/contract"])
  })

  test("the audit fires on both shapes it is there to catch", () => {
    // Positive controls: without these, an empty violations list above could mean the audit is blind.
    const leaks = auditAbiSpecifiers(
      [
        'import type { Button } from "@/components/ui/button";',
        'import type { NodeHostApi } from "../../src/types/host";',
        'import { run } from "@xiranite/node-kisaki/help";',
      ].join("\n"),
      declared,
    )
    expect(leaks).toHaveLength(3)
    expect(leaks[0]).toContain("host-internal alias")
    expect(leaks[1]).toContain("relative escape")
    expect(leaks[2]).toContain("undeclared dependency")
  })
})
