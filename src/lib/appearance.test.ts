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
  THEME_PRESET_OPTIONS,
  THEME_PRESET_DEFAULT_MODE,
  THEME_STYLE_PROFILES,
} from "./appearance"

afterEach(() => {
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-app-theme")
  document.documentElement.removeAttribute("data-theme-family")
  document.documentElement.removeAttribute("data-theme-density")
  document.documentElement.removeAttribute("data-theme-radius")
  document.documentElement.removeAttribute("data-theme-border")
  document.documentElement.removeAttribute("data-theme-motion")
  document.documentElement.removeAttribute("data-theme-surface")
  document.documentElement.removeAttribute("data-theme-depth")
  document.documentElement.removeAttribute("data-theme-node-interior")
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
    expect(document.documentElement.dataset.themeFamily).toBe("tactical-console")
    expect(document.documentElement.dataset.themeDensity).toBe("compact")
    expect(document.documentElement.dataset.themeNodeInterior).toBe("dense-controls")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(true)

    applyThemePreset("spatial")

    expect(document.documentElement.dataset.appTheme).toBe("spatial")
    expect(document.documentElement.dataset.themeFamily).toBe("spatial-product")
    expect(document.documentElement.dataset.themeDensity).toBe("comfortable")
    expect(document.documentElement.dataset.themeNodeInterior).toBe("inherit")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(false)
    expect(document.documentElement.classList.contains("theme-spatial")).toBe(true)
  })

  test("registers site-inspired presets through the shared preset list", () => {
    expect(THEME_PRESET_OPTIONS.map((preset) => preset.key)).toEqual([
      "spatial",
      "endfield",
      "wuling",
      "onlook",
      "tori",
      "conductor",
      "hilden",
      "aperture",
      "noomo",
      "excalidraw",
      "astro",
      "svelte",
      "bun",
      "storybook",
      "supabase",
      "penpot",
      "vite",
    ])
    expect(THEME_DESIGN_RECIPES.tori.fontPreset).toBe("terminal")
    expect(THEME_STYLE_PROFILES.onlook.referenceAxis).toContain("One Page Love: Onlook")
    expect(THEME_STYLE_PROFILES.tori).toMatchObject({
      family: "tori-terminal",
      density: "compact",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.conductor).toMatchObject({
      fontPreset: "terminal",
      bgMode: "none",
      chromeStyle: "traffic-light",
    })
    expect(THEME_STYLE_PROFILES.conductor).toMatchObject({
      family: "conductor-agent-workbench",
      density: "compact",
      nodeInterior: "agent-workbench",
    })
    expect(THEME_STYLE_PROFILES.hilden).toMatchObject({
      family: "hilden-poster",
      border: "brutalist",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.aperture).toMatchObject({
      fontPreset: "display",
      bgMode: "none",
      chromePosition: "island",
    })
    expect(THEME_STYLE_PROFILES.aperture).toMatchObject({
      family: "aperture-cinematic-archive",
      surface: "media-led",
      nodeInterior: "gallery-archive",
    })
    expect(THEME_DESIGN_RECIPES.noomo.fontPreset).toBe("machina")
    expect(THEME_STYLE_PROFILES.noomo).toMatchObject({
      family: "noomo-3d-agency",
      surface: "media-led",
      depth: "layered",
    })
    expect(THEME_DESIGN_RECIPES.excalidraw.fontPreset).toBe("sketch")
    expect(THEME_STYLE_PROFILES.excalidraw).toMatchObject({
      family: "excalidraw-sketch",
      surface: "flat",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.astro).toMatchObject({
      fontPreset: "display",
      bgMode: "none",
      cardElevation: true,
    })
    expect(THEME_STYLE_PROFILES.astro).toMatchObject({
      family: "astro-cosmic",
      surface: "media-led",
      depth: "glow",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.svelte.fontPreset).toBe("editorial")
    expect(THEME_STYLE_PROFILES.svelte).toMatchObject({
      family: "svelte-editorial",
      surface: "flat",
      border: "outlined",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.bun).toMatchObject({
      fontPreset: "terminal",
      bgMode: "none",
      chromeStyle: "traffic-light",
    })
    expect(THEME_STYLE_PROFILES.bun).toMatchObject({
      family: "bun-runtime",
      density: "compact",
      depth: "glow",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.storybook).toMatchObject({
      fontPreset: "workshop",
      bgMode: "dot-grid",
      cardElevation: true,
    })
    expect(THEME_STYLE_PROFILES.storybook).toMatchObject({
      family: "storybook-workshop",
      surface: "tonal",
      depth: "shadow",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.supabase).toMatchObject({
      fontPreset: "xiranite",
      bgMode: "grid",
      chromePosition: "left",
    })
    expect(THEME_STYLE_PROFILES.supabase).toMatchObject({
      family: "supabase-postgres",
      surface: "tonal",
      depth: "glow",
      nodeInterior: "ledger-panels",
    })
    expect(THEME_DESIGN_RECIPES.penpot).toMatchObject({
      fontPreset: "canvas",
      bgMode: "none",
      chromePosition: "island",
    })
    expect(THEME_STYLE_PROFILES.penpot).toMatchObject({
      family: "penpot-design-canvas",
      surface: "glass",
      depth: "glow",
      nodeInterior: "dense-controls",
    })
    expect(THEME_DESIGN_RECIPES.vite).toMatchObject({
      fontPreset: "display",
      bgMode: "none",
      chromePosition: "island",
    })
    expect(THEME_STYLE_PROFILES.vite).toMatchObject({
      family: "vite-dev-server",
      surface: "glass",
      depth: "glow",
      nodeInterior: "dense-controls",
    })
  })

  test("keeps browsed source evidence on site-inspired presets", () => {
    for (const preset of THEME_PRESET_OPTIONS) {
      expect(preset.source.title).toBeTruthy()

      if (preset.source.kind === "internal") {
        continue
      }

      expect(preset.source.url ?? preset.source.originalUrl ?? preset.source.repositoryUrl).toBeTruthy()
      expect(preset.source.evidence.length).toBeGreaterThan(0)
    }

    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "tori")?.source).toMatchObject({
      kind: "one-page-love",
      originalUrl: "https://asktori.ai/",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "conductor")?.source).toMatchObject({
      kind: "one-page-love",
      originalUrl: "https://www.conductor.build/",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "hilden")?.source).toMatchObject({
      kind: "awwwards",
      originalUrl: "https://www.hildenkaira.fi/",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "aperture")?.source).toMatchObject({
      kind: "awwwards",
      url: "https://www.awwwards.com/sites/project-aperture",
      originalUrl: "https://www.project-aperture.com/",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "excalidraw")?.source).toMatchObject({
      kind: "open-source",
      repositoryUrl: "https://github.com/excalidraw/excalidraw",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "astro")?.source).toMatchObject({
      kind: "open-source",
      url: "https://astro.build/",
      repositoryUrl: "https://github.com/withastro/astro",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "svelte")?.source).toMatchObject({
      kind: "open-source",
      url: "https://svelte.dev/",
      repositoryUrl: "https://github.com/sveltejs/svelte",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "bun")?.source).toMatchObject({
      kind: "open-source",
      url: "https://bun.com/",
      repositoryUrl: "https://github.com/oven-sh/bun",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "storybook")?.source).toMatchObject({
      kind: "open-source",
      url: "https://storybook.js.org/",
      repositoryUrl: "https://github.com/storybookjs/storybook",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "supabase")?.source).toMatchObject({
      kind: "open-source",
      url: "https://supabase.com/",
      repositoryUrl: "https://github.com/supabase/supabase",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "penpot")?.source).toMatchObject({
      kind: "open-source",
      url: "https://penpot.app/",
      repositoryUrl: "https://github.com/penpot/penpot",
    })
    expect(THEME_PRESET_OPTIONS.find((preset) => preset.key === "vite")?.source).toMatchObject({
      kind: "open-source",
      url: "https://vite.dev/",
      repositoryUrl: "https://github.com/vitejs/vite",
    })
  })

  test("applies every built-in theme root class", () => {
    for (const preset of THEME_PRESET_OPTIONS) {
      applyThemePreset(preset.key)
      const profile = THEME_STYLE_PROFILES[preset.key]

      expect(document.documentElement.dataset.appTheme).toBe(preset.key)
      expect(document.documentElement.dataset.themeFamily).toBe(profile.family)
      expect(document.documentElement.dataset.themeDensity).toBe(profile.density)
      expect(document.documentElement.dataset.themeRadius).toBe(profile.radius)
      expect(document.documentElement.dataset.themeBorder).toBe(profile.border)
      expect(document.documentElement.dataset.themeMotion).toBe(profile.motion)
      expect(document.documentElement.dataset.themeSurface).toBe(profile.surface)
      expect(document.documentElement.dataset.themeDepth).toBe(profile.depth)
      expect(document.documentElement.dataset.themeNodeInterior).toBe(profile.nodeInterior)
      expect(document.documentElement.classList.contains(`theme-${preset.key}`)).toBe(true)
    }
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

  test("parses registry-wrapped and keyed theme libraries", () => {
    const registryThemes = parseImportedThemeJson(JSON.stringify({
      items: [
        {
          name: "tweakcn-slate",
          type: "registry:theme",
          cssVars: {
            light: { background: "oklch(0.98 0 0)", primary: "oklch(0.52 0.15 250)" },
            dark: { background: "oklch(0.18 0 0)", primary: "oklch(0.74 0.13 250)" },
          },
        },
      ],
    }))

    expect(registryThemes.map((theme) => theme.name)).toEqual(["tweakcn-slate"])
    expect(registryThemes[0].cssVars.light.primary).toBe("oklch(0.52 0.15 250)")

    const keyedThemes = parseImportedThemeJson(JSON.stringify({
      perpetuity: {
        cssVars: {
          light: { background: "oklch(0.9491 0.0085 197.0126)" },
          dark: { background: "oklch(0.2068 0.0247 224.4533)" },
        },
      },
    }))

    expect(keyedThemes.map((theme) => theme.name)).toEqual(["perpetuity"])
    expect(keyedThemes[0].cssVars.dark?.background).toBe("oklch(0.2068 0.0247 224.4533)")
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
    expect(document.documentElement.style.getPropertyValue("--popover")).toContain("oklch(0.99 0 0)")
    expect(document.documentElement.style.getPropertyValue("--ws-canvas")).toBe("oklch(0.99 0 0)")
    expect(document.documentElement.style.getPropertyValue("--ws-accent-glow")).toContain("oklch(0.55 0.16 240)")
    expect(document.documentElement.style.getPropertyValue("--node-surface-bg")).toBe("oklch(0.99 0 0)")
    expect(document.documentElement.style.getPropertyValue("--node-chrome-accent")).toBe("oklch(0.55 0.16 240)")
    expect(document.documentElement.style.getPropertyValue("--node-chrome-bg")).toContain("oklch(0.55 0.16 240)")

    applyCustomTheme(theme, "dark")

    expect(document.documentElement.style.getPropertyValue("--background")).toBe("oklch(0.2 0 0)")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("oklch(0.75 0.13 240)")
    expect(document.documentElement.style.getPropertyValue("--ws-canvas")).toBe("oklch(0.2 0 0)")
    expect(document.documentElement.style.getPropertyValue("--node-chrome-accent")).toBe("oklch(0.75 0.13 240)")

    applyCustomTheme(null, "light")

    expect(document.documentElement.getAttribute("data-custom-theme")).toBeNull()
    expect(document.documentElement.getAttribute("data-custom-theme-name")).toBeNull()
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--ws-canvas")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--node-surface-bg")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--node-chrome-accent")).toBe("")
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
