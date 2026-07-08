// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import {
  applyCustomTheme,
  applyFontPreset,
  applyThemePreset,
  FONT_PRESETS,
  mirrorAestivusThemeStorage,
  parseImportedThemeJson,
  THEME_DESIGN_RECIPES,
  THEME_PRESET_DEFAULT_MODE,
  THEME_STYLE_PROFILES,
} from "./appearance"

afterEach(() => {
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-app-theme")
  document.documentElement.removeAttribute("data-font-preset")
  document.documentElement.removeAttribute("data-custom-font")
  document.documentElement.removeAttribute("style")
  localStorage.clear()
})

describe("appearance bridge", () => {
  test("defines Wuling as a light jade industrial preset", () => {
    expect(THEME_PRESET_DEFAULT_MODE.wuling).toBe("light")
    expect(THEME_DESIGN_RECIPES.wuling).toMatchObject({
      fontPreset: "industrial",
      bgMode: "grid",
      grainEnabled: false,
      grainIntensity: 0,
      actionGlow: false,
      cardElevation: false,
    })
    expect(FONT_PRESETS.some((preset) => preset.key === "industrial")).toBe(true)
    expect(THEME_STYLE_PROFILES.wuling).toMatchObject({
      family: "jade-industrial",
      border: "outlined",
      nodeInterior: "ledger-panels",
    })
  })

  test("applies theme preset to the document root for portals and floating surfaces", () => {
    applyThemePreset("endfield")

    expect(document.documentElement.dataset.appTheme).toBe("endfield")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(true)

    applyThemePreset("spatial")

    expect(document.documentElement.dataset.appTheme).toBe("spatial")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(false)
    expect(document.documentElement.classList.contains("theme-spatial")).toBe(true)
  })

  test("keeps aestivus-compatible storage and font variables in sync", () => {
    applyFontPreset("aestivus")
    mirrorAestivusThemeStorage("wuling", "dark")

    expect(document.documentElement.getAttribute("data-custom-font")).toBe("enabled")
    expect(document.documentElement.style.getPropertyValue("--font-custom-sans")).toContain("LXGW WenKai")
    expect(localStorage.getItem("theme-name")).toBe("Wuling")
    expect(localStorage.getItem("theme-mode")).toBe("dark")
  })

  test("parses tweakcn-style theme JSON and normalizes CSS variable keys", () => {
    const themes = parseImportedThemeJson(JSON.stringify({
      name: "Slate Import",
      description: "Imported from tweakcn",
      cssVars: {
        theme: { radius: "0.5rem" },
        light: {
          "--background": "oklch(1 0 0)",
          primary: "oklch(0.5 0.12 250)",
        },
        dark: {
          background: "oklch(0.15 0 0)",
        },
      },
    }))

    expect(themes).toEqual([{
      name: "Slate Import",
      description: "Imported from tweakcn",
      cssVars: {
        theme: { radius: "0.5rem" },
        light: {
          background: "oklch(1 0 0)",
          primary: "oklch(0.5 0.12 250)",
        },
        dark: {
          background: "oklch(0.15 0 0)",
        },
      },
    }])
  })

  test("parses theme.json arrays as a full imported theme library", () => {
    const themes = parseImportedThemeJson(JSON.stringify([
      {
        name: "perpetuity",
        cssVars: {
          light: { background: "oklch(0.9491 0.0085 197.0126)", primary: "oklch(0.5624 0.0947 203.2755)" },
          dark: { background: "oklch(0.2068 0.0247 224.4533)", primary: "oklch(0.8520 0.1269 195.0354)" },
        },
      },
      {
        name: "amethyst-haze",
        cssVars: {
          light: { background: "oklch(0.9777 0.0041 301.4256)", primary: "oklch(0.6104 0.0767 299.7335)" },
          dark: { background: "oklch(0.2166 0.0215 292.8474)", primary: "oklch(0.7058 0.0777 302.0489)" },
        },
      },
    ]))

    expect(themes).toHaveLength(2)
    expect(themes.map((theme) => theme.name)).toEqual(["perpetuity", "amethyst-haze"])
  })

  test("parses aestivus-style theme JSON", () => {
    const [theme] = parseImportedThemeJson(JSON.stringify({
      name: "Aestivus Import",
      colors: {
        light: { background: "oklch(0.98 0 0)" },
        dark: { background: "oklch(0.18 0 0)" },
      },
    }))

    expect(theme.cssVars.light.background).toBe("oklch(0.98 0 0)")
    expect(theme.cssVars.dark?.background).toBe("oklch(0.18 0 0)")
  })

  test("applies imported theme variables and clears them when disabled", () => {
    const [theme] = parseImportedThemeJson(JSON.stringify({
      name: "Imported",
      cssVars: {
        light: {
          "--background": "oklch(0.99 0 0)",
          primary: "oklch(0.55 0.16 240)",
        },
        dark: {
          background: "oklch(0.2 0 0)",
          primary: "oklch(0.75 0.13 240)",
        },
      },
    }))

    applyCustomTheme(theme, "light")

    expect(document.documentElement.getAttribute("data-custom-theme")).toBe("enabled")
    expect(document.documentElement.dataset.customThemeName).toBe("Imported")
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("oklch(0.99 0 0)")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("oklch(0.55 0.16 240)")

    applyCustomTheme(theme, "dark")

    expect(document.documentElement.style.getPropertyValue("--background")).toBe("oklch(0.2 0 0)")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("oklch(0.75 0.13 240)")

    applyCustomTheme(null, "light")

    expect(document.documentElement.getAttribute("data-custom-theme")).toBeNull()
    expect(document.documentElement.getAttribute("data-custom-theme-name")).toBeNull()
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("")
  })

  test("mirrors imported themes to aestivus-compatible custom theme storage", () => {
    const themes = parseImportedThemeJson(JSON.stringify([
      {
        name: "Imported",
        cssVars: {
          light: { background: "oklch(1 0 0)" },
          dark: { background: "oklch(0.2 0 0)" },
        },
      },
      {
        name: "Second",
        cssVars: {
          light: { background: "oklch(0.9 0 0)" },
          dark: { background: "oklch(0.1 0 0)" },
        },
      },
    ]))

    mirrorAestivusThemeStorage("spatial", "system", themes, themes[1])

    expect(localStorage.getItem("theme-name")).toBe("Second")
    expect(localStorage.getItem("theme-mode")).toBe("system")
    expect(JSON.parse(localStorage.getItem("custom-themes") ?? "[]")).toEqual([
      {
        name: "Imported",
        description: "Imported theme",
        colors: {
          light: { background: "oklch(1 0 0)" },
          dark: { background: "oklch(0.2 0 0)" },
        },
      },
      {
        name: "Second",
        description: "Imported theme",
        colors: {
          light: { background: "oklch(0.9 0 0)" },
          dark: { background: "oklch(0.1 0 0)" },
        },
      },
    ])

    mirrorAestivusThemeStorage("spatial", "light")

    expect(localStorage.getItem("theme-name")).toBe("Default")
    expect(localStorage.getItem("custom-themes")).toBeNull()
  })
})
