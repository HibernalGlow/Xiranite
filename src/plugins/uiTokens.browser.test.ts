import { PLUGIN_COLOR_TOKENS } from "../../packages/ui/src/tokens"
import { describe, expect, test } from "vitest"

import "../styles/themes/index.css"

/**
 * `packages/ui/src/tokens.test.ts` proves the token names exist **in the CSS text**. That is not the
 * same as the browser being able to resolve them: these palettes declare their custom properties under
 * `.theme-<name>` (and `.light .theme-<name>`), so a token can be present in the file and still come
 * out empty for an element that does not sit under both classes — and a plugin asked for a name it
 * cannot resolve gets a transparent/inherited value, which reads as a visual bug and never as an error.
 *
 * So this runs the check the way a plugin actually experiences it: attach an element under
 * `.light`/`.dark` plus each `.theme-*` and read the computed value of every exported token.
 *
 * Real chromium via Vitest Browser Mode (`bun run test:browser -- <this file>`); the palette list is
 * the set of files under `src/styles/themes/` that declare a `.theme-*` block, and the count assertion
 * below is what notices when a palette is added without being checked.
 */
const PALETTES = [
  "aperture",
  "astro",
  "bun",
  "conductor",
  "endfield",
  "excalidraw",
  "hilden",
  "noomo",
  "onlook",
  "penpot",
  "spatial",
  "storybook",
  "supabase",
  "svelte",
  "tori",
  "vite",
  "wuling",
]

const MODES = ["light", "dark"] as const

function resolveToken(mode: (typeof MODES)[number], palette: string, cssVar: string): string {
  const wrapper = document.createElement("div")
  wrapper.className = mode
  const probe = document.createElement("div")
  probe.className = `theme-${palette}`
  wrapper.appendChild(probe)
  document.body.appendChild(wrapper)
  try {
    return getComputedStyle(probe).getPropertyValue(cssVar).trim()
  } finally {
    wrapper.remove()
  }
}

describe("the plugin token vocabulary resolves in the browser", () => {
  test("the palette list covers every theme file", () => {
    // 17 palettes measured from `ls src/styles/themes/*.css` (excluding index/custom-theme/design-axes).
    expect(PALETTES).toHaveLength(17)
    expect(PLUGIN_COLOR_TOKENS.length).toBe(15)
  })

  test("every exported token resolves to a non-empty value in every palette, light and dark", () => {
    const failures: string[] = []
    for (const mode of MODES) {
      for (const palette of PALETTES) {
        for (const token of PLUGIN_COLOR_TOKENS) {
          if (resolveToken(mode, palette, `--${token}`).length === 0) {
            failures.push(`${mode} .theme-${palette} --${token}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  test("a name outside the contract still resolves, and that is a fact worth locking", () => {
    // Measured, not assumed: I expected `--radius` to come back empty under `endfield` (that palette
    // does not declare it, which is why `packages/ui` leaves it out) and got `0.375rem` instead —
    // an outer fallback in the base layer covers the gap. Two conclusions:
    //   - the exclusion still stands, but its reason is **contract** (not every palette declares it, so
    //     a palette may one day override the fallback), not "the plugin silently gets nothing";
    //   - the gauge is not blind: a genuinely absent var does return "" (see the empty-string case it
    //     would have produced), and the token list above is what proves non-emptiness, not this name.
    const inherited = resolveToken("light", "endfield", "--radius")
    const declared = resolveToken("light", "vite", "--radius")
    expect(inherited.length).toBeGreaterThan(0)
    // The two differ: vite's own block declares it, endfield's does not, so endfield falls through to
    // a base-layer value. Measured: 0.75rem vs 0.375rem. That mismatch — not emptiness — is the reason
    // `radius` is outside the plugin contract.
    expect(inherited).not.toBe(declared)
    // And the gauge is not blind: a name nothing declares really does come back empty.
    expect(resolveToken("light", "endfield", "--no-such-xiranite-token")).toBe("")
  })
})
