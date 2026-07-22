import { describe, expect, it } from "vitest"

import { parseNeoviewRuntimeConfig, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("NeoView ambient background configuration", () => {
  it("[neoview.ambient-background.runtime-config] parses the legacy view background shape", () => {
    expect(parseNeoviewRuntimeConfig({
      view: {
        background_color: "#101820",
        background_mode: "ambient",
        ambient: { style: "gentle", speed: 12, blur: 60, opacity: 0.65 },
        aurora: { show_radial_gradient: false },
        spotlight: { color: "#22c55e" },
      },
    }).viewDefaults.background).toEqual({
      color: "#101820",
      mode: "ambient",
      ambient: { style: "gentle", speed: 12, blur: 60, opacity: 0.65 },
      aurora: { showRadialGradient: false },
      spotlight: { color: "#22c55e" },
    })
  })

  it("[neoview.ambient-background.patch] bounds and persists background changes through the view patch", () => {
    const parsed = parseNeoviewViewDefaultsPatch({ viewDefaults: {
      background: {
        mode: "aurora",
        ambient: { speed: 20, blur: 150, opacity: 1, style: "dynamic" },
        aurora: { showRadialGradient: true },
      },
    } })
    expect(parsed.patch.viewDefaults.background).toEqual({
      mode: "aurora",
      ambient: { speed: 20, blur: 150, opacity: 1, style: "dynamic" },
      aurora: { showRadialGradient: true },
    })
    expect(parsed.tomlPatch).toEqual({ view: {
      background_mode: "aurora",
      ambient: { speed: 20, blur: 150, opacity: 1, style: "dynamic" },
      aurora: { show_radial_gradient: true },
    } })
    expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { background: { ambient: { speed: 99 } } } })).toThrow("background.ambient.speed")
  })

  it("[neoview.ambient-background.edge-mode] parses and patches the edge match background mode", () => {
    expect(parseNeoviewRuntimeConfig({
      view: { background_mode: "edge" },
    }).viewDefaults.background.mode).toBe("edge")

    const parsed = parseNeoviewViewDefaultsPatch({ viewDefaults: { background: { mode: "edge" } } })
    expect(parsed.patch.viewDefaults.background).toEqual({ mode: "edge" })
    expect(parsed.tomlPatch).toEqual({ view: { background_mode: "edge" } })
  })
})
