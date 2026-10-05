import { afterAll, describe, expect, test } from "vitest"

import { PLUGIN_COLOR_TOKENS } from "../../../packages/ui/src/tokens"
import "./index.css"

/**
 * The app-wide token **fallback** layer (`base.css`) is what keeps the UI painted when no `.theme-*`
 * class is on the root — the HTML before React applies a preset, and every imported custom theme,
 * because `applyCustomTheme` takes all preset classes off.
 *
 * It exists because that layer went missing once. On 2026-10-05 the 16 built-in presets were deleted,
 * and with them `spatial.css`, whose bare `:root` block *was* the fallback (76 declarations, plus
 * `:root.dark`). Nothing failed to build; `--radius` simply had no declaration, so `rounded-*`
 * resolved to the property's initial value and the interface went square. The only thing that noticed
 * was another suite's positive control going red. This file is the version of that check that does not
 * depend on somebody else's control.
 *
 * Real chromium (`bun run test:browser -- <this file>`), because the question is "what does the cascade
 * hand the root element", which a DOM shim cannot answer.
 */
const FALLBACK_ONLY = [
  "--radius",
  "--font-app-sans",
  "--font-app-mono",
  "--badge-blue",
  "--badge-teal-subtle-foreground",
  "--ws-grid-color",
  "--chart-3",
  "--sidebar-accent-foreground",
] as const

const root = document.documentElement
const probes = [...PLUGIN_COLOR_TOKENS.map((token) => `--${token}`), ...FALLBACK_ONLY]

afterAll(() => {
  root.classList.remove("dark")
})

function read(varName: string): string {
  return getComputedStyle(root).getPropertyValue(varName).trim()
}

describe("the token fallback layer holds up with no preset class", () => {
  test("the root carries no preset class in this page (the case under test)", () => {
    expect([...root.classList].filter((name) => /^theme-(?!bg-)/.test(name)), "有预设 class 就不是在测兜底层了")
      .toEqual([])
  })

  test("every probe resolves in light and in dark, and the gauge can see a miss", () => {
    expect(probes.length, "探针太少的话这条断言没有信息量").toBeGreaterThanOrEqual(20)

    const lightEmpty = probes.filter((name) => read(name).length === 0)
    root.classList.add("dark")
    const darkEmpty = probes.filter((name) => read(name).length === 0)
    root.classList.remove("dark")

    expect(lightEmpty, `亮色下无声明：${lightEmpty.join(", ")}`).toEqual([])
    expect(darkEmpty, `暗色下无声明：${darkEmpty.join(", ")}`).toEqual([])

    // The gauge is not blind: a name nothing declares really does come back empty in the same page,
    // so the two green lines above are a measurement rather than an artifact of reading nothing.
    expect(read("--no-such-xiranite-token")).toBe("")
  })

  test("--radius reaching a real corner is what the deletion broke", () => {
    // The shape of the failure was not an empty string but a silently-initial value, so the probe is
    // the same construct the components use: `border-radius: var(--radius)` on an element under :root.
    const withRadius = document.createElement("div")
    withRadius.style.borderRadius = "var(--radius)"
    const withBogus = document.createElement("div")
    withBogus.style.borderRadius = "var(--no-such-xiranite-token)"
    root.append(withRadius, withBogus)
    try {
      expect(getComputedStyle(withRadius).borderTopLeftRadius).not.toBe("0px")
      // Control: an undefined var makes the property fall back to its initial value — exactly the 0px
      // the app produced for every corner when base.css was missing.
      expect(getComputedStyle(withBogus).borderTopLeftRadius).toBe("0px")
    } finally {
      withRadius.remove()
      withBogus.remove()
    }
  })
})
