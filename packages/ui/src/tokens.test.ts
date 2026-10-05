import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, test } from "vitest"

import {
  PLUGIN_COLOR_TOKENS,
  PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT,
  pluginColor,
  pluginColorVar,
} from "./tokens.js"

/**
 * The claim in `@xiranite/ui` is "every palette theme defines these names". That is a claim about CSS
 * this package does not own, so it is recomputed from the CSS on every run rather than trusted from a
 * design document — and the audit function is shown, by control, to actually fire.
 */

const themesDir = resolve(import.meta.dirname, "../../../src/styles/themes")

function themeFiles(): string[] {
  return readdirSync(themesDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => [name, readFileSync(resolve(themesDir, name), "utf8")] as const)
}

function declaredNames(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!))
}

/**
 * A palette theme is one that declares `--background`. That filter is what excludes the axis file, the
 * custom-theme override and the index import list — none of which is a full palette, and intersecting
 * across them would empty the result and make every audit pass vacuously.
 */
function paletteTokenIntersection(): { names: Set<string>; files: number } {
  const palettes = themeFiles().filter(([, css]) => declaredNames(css).has("--background"))
  let names: Set<string> | undefined
  for (const [, css] of palettes) {
    const declared = declaredNames(css)
    names = names === undefined ? new Set(declared) : new Set([...names].filter((name) => declared.has(name)))
  }
  return { names: names ?? new Set<string>(), files: palettes.length }
}

function audit(names: readonly string[], intersection: Set<string>): string[] {
  return names.map((name) => `--${name}`).filter((varName) => !intersection.has(varName))
}

describe("the token vocabulary is measured from the host's CSS", () => {
  const { names, files } = paletteTokenIntersection()

  test("there is a real sample to compare against", () => {
    // Without this, an empty intersection or a wrong directory would make every assertion below vacuous.
    expect(files).toBeGreaterThanOrEqual(15)
    expect(names.size).toBeGreaterThan(30)
    expect(names.has("--background")).toBe(true)
  })

  test("every exported color token is declared by every palette theme", () => {
    expect(audit(PLUGIN_COLOR_TOKENS, names)).toEqual([])
  })

  test("the excluded names are excluded because they really are missing somewhere", () => {
    const missingFromSomewhere = PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT.filter((name) => !names.has(`--${name}`))
    expect(missingFromSomewhere).toEqual([...PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT])
  })

  test("the audit fires when a token is not universal", () => {
    // Positive control: `radius` is defined by 16 of 17 palettes and absent in `endfield.css`, so a
    // list containing it must be reported. If this ever passes with an empty result, the gauge is blind.
    expect(audit([...PLUGIN_COLOR_TOKENS, "radius"], names)).toEqual(["--radius"])
  })
})

describe("token helpers", () => {
  test("a token resolves to a var reference, never to a literal value", () => {
    expect(pluginColorVar("card")).toBe("--card")
    expect(pluginColor("card")).toBe("var(--card)")
    expect(pluginColor("muted-foreground")).toBe("var(--muted-foreground)")
  })
})
