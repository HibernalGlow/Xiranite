import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, test } from "vitest"

import {
  PLUGIN_COLOR_TOKENS,
  PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT,
  PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS,
  pluginColor,
  pluginColorVar,
} from "./tokens.js"

/**
 * The claim in `@xiranite/ui` is "these names are what the host's colour layer guarantees". That is a
 * claim about CSS this package does not own, so it is recomputed from the CSS on every run rather than
 * trusted from a design document — and the audit function is shown, by control, to actually fire.
 *
 * **What the sample means changed on 2026-10-05.** This test used to intersect across 17 palette files,
 * and that breadth is what caught `--radius` (absent from `endfield.css`). The built-in colour presets
 * were then deleted in favour of the advanced-theme axis, so the file corpus is one palette plus the
 * user's imported themes — and an intersection over one file is that file's own declaration set, which
 * proves much less. The second dimension below (light *and* dark token blocks) is what keeps the gauge
 * from becoming a tautology; the preset-name↔file bijection lives in `src/lib/appearance.test.ts`,
 * which is the only place that can read both the table and the directory without scraping source text.
 */

const themesDir = resolve(import.meta.dirname, "../../../src/styles/themes")

/** Prose in a comment is not a declaration; both the identity test and the name sets read the body. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

function themeFiles(): [string, string][] {
  return readdirSync(themesDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => [name, withoutComments(readFileSync(resolve(themesDir, name), "utf8"))] as const)
}

function declaredNames(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!))
}

/**
 * A palette theme is a file that declares `--background` **inside a `.theme-<name>` block**. Both
 * halves matter: the `--background` test excludes the axis file and the import list (neither is a full
 * palette, and intersecting across them would empty the result and make every audit pass vacuously),
 * and the `.theme-<name>` test excludes `base.css` — the app-wide fallback layer recovered on
 * 2026-10-05 after the preset deletion. Counting that file as a palette would quietly weaken this gate,
 * because the fallback declares the whole vocabulary: a preset that forgot `--ring` would still pass by
 * intersecting with the layer that is supposed to be its safety net, not its sample.
 */
function paletteFiles(): [string, string][] {
  return themeFiles().filter(([, css]) => {
    const blocks = tokenBlocks(css)
    return blocks.length > 0 && blocks.some((block) => /\.theme-[a-z0-9-]+/.test(block.selector))
  })
}

/**
 * One innermost rule block that declares `--background` — in practice `.theme-wuling { … }` (light) and
 * `.theme-wuling.dark, .dark .theme-wuling { … }` (dark).
 *
 * The split on `[^{}]` deliberately keeps only innermost blocks: a `@media` wrapper would be reported
 * with an empty body and its inner blocks separately, which is the correct granularity here because a
 * mode that forgot a token is exactly the drift this catches.
 */
function tokenBlocks(css: string): { selector: string; names: Set<string> }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1]!.trim(), names: declaredNames(match[2]!) }))
    .filter((block) => block.names.has("--background"))
}

function paletteTokenIntersection(): { names: Set<string>; files: number } {
  let names: Set<string> | undefined
  for (const [, css] of paletteFiles()) {
    const declared = declaredNames(css)
    names = names === undefined ? new Set(declared) : new Set([...names].filter((name) => declared.has(name)))
  }
  return { names: names ?? new Set<string>(), files: paletteFiles().length }
}

function audit(names: readonly string[], intersection: Set<string>): string[] {
  return names.map((name) => `--${name}`).filter((varName) => !intersection.has(varName))
}

describe("the token vocabulary is measured from the host's CSS", () => {
  const { names, files } = paletteTokenIntersection()
  const blocks = paletteFiles().flatMap(([, css]) => tokenBlocks(css))

  test("there is a real sample to compare against", () => {
    // Without this, an empty intersection or a wrong directory would make every assertion below vacuous.
    // `files` is 1 since 2026-10-05, so the non-vacuity weight is carried by `blocks` (both modes) and
    // by `names.size` — a wrong directory gives 0/0, and a partial palette gives a small name set.
    expect(files).toBeGreaterThanOrEqual(1)
    expect(blocks.length, "至少要有亮/暗两个完整 token 块，否则下面的逐块断言是空转").toBeGreaterThanOrEqual(2)
    expect(names.size).toBeGreaterThan(30)
    expect(names.has("--background")).toBe(true)
  })

  test("every exported color token is declared by every palette theme", () => {
    expect(audit(PLUGIN_COLOR_TOKENS, names)).toEqual([])
  })

  test("every exported color token is declared in both light and dark", () => {
    // A palette can carry the whole vocabulary in light and drop one name in dark; the file-level
    // intersection above cannot see that, because the declaration exists somewhere in the file.
    const failures = blocks
      .map((block) => `${block.selector} → ${audit(PLUGIN_COLOR_TOKENS, block.names).join(", ")}`)
      .filter((line) => !line.endsWith("→ "))
    expect(failures).toEqual([])
  })

  test("the excluded names are excluded because nothing in the palette layer declares them", () => {
    const missingFromPalettes = PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT.filter((name) => !names.has(`--${name}`))
    expect(missingFromPalettes).toEqual([...PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT])
  })

  test("the axis-owned names do resolve, so their exclusion is a contract reason not an absence", () => {
    // The honest half of the 2026-10-05 rewrite: `radius` and `shadow` pass the old measurement, so
    // keeping them out of the colour contract has to rest on the other reason (shape/elevation axes own
    // them). If this ever goes red the reason was a missing declaration all along and the file test above
    // is the one that should change.
    for (const name of PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS) {
      expect(names.has(`--${name}`), `--${name} 不在调色板层里，那它该回到 EXCLUDED 名单`).toBe(true)
    }
  })

  test("the audit fires when a token is not universal", () => {
    // Positive control. It used to be `radius`, which 16 of 17 palettes declared; that name now exists
    // in the only remaining palette, so `scrollbar-thumb` (declared in `src/index.css`, never in a
    // `.theme-*` block) carries the control instead. A blind gauge would report [] for this.
    expect(audit([...PLUGIN_COLOR_TOKENS, "scrollbar-thumb"], names)).toEqual(["--scrollbar-thumb"])
    for (const block of blocks) {
      expect(audit([...PLUGIN_COLOR_TOKENS, "surface-1"], block.names)).toEqual(["--surface-1"])
    }
  })
})

describe("token helpers", () => {
  test("a token resolves to a var reference, never to a literal value", () => {
    expect(pluginColorVar("card")).toBe("--card")
    expect(pluginColor("card")).toBe("var(--card)")
    expect(pluginColor("muted-foreground")).toBe("var(--muted-foreground)")
  })
})
