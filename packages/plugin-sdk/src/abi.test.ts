import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

import { PLUGIN_CONTRIBUTION_KINDS, componentContribution } from "./index"

/**
 * §12 makes this package an ABI, and an ABI is only real if something reads it back. Every test below
 * fails on a way an ABI actually decays: a name added without a decision behind it, a policy copied
 * in "for convenience", a declaration that resolves only inside this repository, or a vendored file
 * that no longer matches the package it came from.
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

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const distDir = join(packageRoot, "dist")
const declarations = readFileSync(join(distDir, "index.d.ts"), "utf8")
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const declared = Object.keys(manifest.dependencies ?? {})

function specifiersOf(text: string): string[] {
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!)
}

/** Every declaration file the published artifact ships: the entry plus everything vendored. */
function artifactFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...artifactFiles(path))
    else if (entry.name.endsWith(".d.ts")) found.push(path)
  }
  return found
}

/**
 * The rule the out-of-repo install experiment forced (§12): `workspace:*` resolves inside this
 * repository and fails on a consumer's machine, so a *workspace* specifier in the artifact is a bug,
 * while a *published* one (zod) is legitimate as long as it is declared.
 */
function auditArtifactSpecifiers(
  entries: Array<{ file: string; text: string }>,
  declaredDependencies: readonly string[],
): string[] {
  const problems: string[] = []
  for (const { file, text } of entries) {
    for (const specifier of specifiersOf(text)) {
      if (specifier.startsWith("@xiranite/")) {
        problems.push(`${file}: workspace specifier must be vendored, not referenced (${specifier})`)
      } else if (specifier.startsWith("@/")) {
        problems.push(`${file}: host-internal alias in a published ABI (${specifier})`)
      } else if (specifier.startsWith("../..")) {
        problems.push(`${file}: relative escape above the package (${specifier})`)
      } else if (!specifier.startsWith(".")) {
        const packageName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!
        if (!declaredDependencies.includes(packageName!)) {
          problems.push(`${file}: undeclared dependency (${specifier} → package ${packageName})`)
        }
      }
    }
  }
  return problems
}

describe("public surface", () => {
  test("the emitted declaration file exports exactly the listed names", () => {
    const found = [...declarations.matchAll(/^export(?:\s+declare)?\s+(?:type|interface|const|function)\s+([A-Za-z0-9_]+)/gm)]
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

describe("the published artifact resolves outside this repository", () => {
  test("no declaration in dist carries a workspace or internal specifier, and bare ones are declared", () => {
    const files = artifactFiles(distDir)
    expect(files.length).toBeGreaterThan(1)
    const entries = files.map((file) => ({ file: file.replace(distDir, "dist"), text: readFileSync(file, "utf8") }))
    expect(auditArtifactSpecifiers(entries, declared)).toEqual([])
  })

  test("the audit fires on all four shapes it is there to catch", () => {
    // Positive controls: without these, an empty violations list could just mean the audit is blind.
    const leaks = auditArtifactSpecifiers(
      [
        {
          file: "control.d.ts",
          text: [
            'import { z } from "zod";',
            'import type { NodeDef } from "@xiranite/contract";',
            'import type { Button } from "@/components/ui/button";',
            'import type { Host } from "../../src/types/host";',
            'import { run } from "left-pad";',
          ].join("\n"),
        },
      ],
      declared,
    )
    // `zod` is declared, so only the other four are problems.
    expect(leaks).toHaveLength(4)
    expect(leaks.join("\n")).toContain("workspace specifier")
    expect(leaks.join("\n")).toContain("host-internal alias")
    expect(leaks.join("\n")).toContain("relative escape")
    expect(leaks.join("\n")).toContain("undeclared dependency")
  })

  test("the vendored declarations still match the packages they were copied from", () => {
    // A stale vendor is the failure mode of any copy: contract changes, artifact does not. The
    // generator records a hash per file so this is a comparison, not a code review.
    const provenance = JSON.parse(
      readFileSync(join(distDir, "vendor/PROVENANCE.json"), "utf8"),
    ) as { files: Array<{ file: string; source: string; sha256_16: string }> }
    expect(provenance.files.length).toBeGreaterThan(0)

    const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)
    for (const entry of provenance.files) {
      const source = readFileSync(resolve(packageRoot, "..", "..", entry.source), "utf8")
      expect(digest(source), entry.source).toBe(entry.sha256_16)
    }
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
