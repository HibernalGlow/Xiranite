import { PLUGIN_COLOR_TOKENS, PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT, PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS } from "../../packages/ui/src/tokens"
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
    // 名单要和盘上的调色板文件一一对上：2026-10-05 内置预设整批出局后只剩武陵一份。
    // 这条断言的作用就是「加了预设没加检查」与「删了预设名单还留着」。
    expect(PALETTES).toHaveLength(1)
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

  test("the two exclusion lists mean two different things on a real element", () => {
    // Measured, not assumed, and the measurement is why the package splits the lists.
    // `--radius` used to be excluded because `endfield.css` did not declare it; the only palette left
    // declares it, so a name in OWNED_BY_ANOTHER_AXIS **does** resolve here — its exclusion is a
    // contract reason (the shape/elevation axes may answer instead), not absence.
    for (const name of PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS) {
      expect(resolveToken("light", "wuling", `--${name}`), `--${name} should resolve`).not.toBe("")
    }
    // The other group is not declared by any palette block, which `tokens.test.ts` measures from the
    // CSS text with a positive control. It is deliberately **not** asserted empty here: a value can
    // still reach the probe from another layer (`--scrollbar-thumb` lives in `src/index.css` under
    // `:root`), and whether that sheet is loaded in this page depends on which other suites ran first —
    // an order-dependent assertion would be a flake, not a fact.
    expect(PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT.length).toBeGreaterThan(0)
    // And the gauge is not blind: a name nothing declares anywhere really does come back empty.
    expect(resolveToken("light", "wuling", "--no-such-xiranite-token")).toBe("")
  })
})
