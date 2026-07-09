import type { AppCustomTheme, AppFontPreset, AppTheme } from "@/types/workspace"

export type ThemePresetMode = "light" | "dark"

export type ThemeStyleFamily =
  | "spatial-product"
  | "tactical-console"
  | "jade-industrial"
  | "onlook-gradient"
  | "tori-terminal"
  | "conductor-agent-workbench"
  | "hilden-poster"
  | "aperture-cinematic-archive"
  | "noomo-3d-agency"
  | "excalidraw-sketch"
  | "astro-cosmic"
  | "svelte-editorial"
  | "bun-runtime"
  | "storybook-workshop"
  | "supabase-postgres"
  | "penpot-design-canvas"
  | "vite-dev-server"

export type ThemeDensity = "compact" | "balanced" | "comfortable"
export type ThemeRadiusProfile = "soft" | "technical" | "hard"
export type ThemeBorderTreatment = "subtle" | "outlined" | "brutalist"
export type ThemeMotionStyle = "soft" | "mechanical" | "cinematic"
export type ThemeSurfaceTreatment = "flat" | "tonal" | "glass" | "media-led"
export type ThemeDepthModel = "none" | "shadow" | "glow" | "layered"
export type ThemeNodeInteriorMode = "inherit" | "dense-controls" | "ledger-panels" | "agent-workbench" | "gallery-archive"

export interface ThemeStyleProfile {
  family: ThemeStyleFamily
  density: ThemeDensity
  radius: ThemeRadiusProfile
  border: ThemeBorderTreatment
  motion: ThemeMotionStyle
  surface: ThemeSurfaceTreatment
  depth: ThemeDepthModel
  nodeInterior: ThemeNodeInteriorMode
  referenceAxis: string[]
}

export interface ThemeDesignRecipe {
  /**
   * Store-applicable appearance settings only.
   * Higher-level website imitation axes live in THEME_STYLE_PROFILES.
   */
  fontPreset: AppFontPreset
  bgMode: "grid" | "dot-grid" | "image" | "none"
  bgOpacity?: number
  bgBlur?: number
  bgCoverTopBar?: boolean
  grainEnabled?: boolean
  vignetteDepth?: number
  grainIntensity?: number
  actionGlow?: boolean
  cardElevation?: boolean
  chromePosition?: "left" | "right" | "island"
  chromeStyle?: "default" | "traffic-light"
}

export type ThemeMode = "system" | "light" | "dark"

export interface FontPresetOption {
  key: AppFontPreset
  label: string
  description: string
  sans: string
  mono: string
}

export type ThemeSourceKind = "internal" | "one-page-love" | "awwwards" | "public-site" | "open-source"

export interface ThemePresetSource {
  kind: ThemeSourceKind
  title: string
  url?: string
  originalUrl?: string
  repositoryUrl?: string
  evidence: string[]
  note?: string
}

export interface ThemePresetOption {
  key: AppTheme
  labelKey: string
  subtitleKey: string
  descriptionKey: string
  swatch: string
  palette: string[]
  paletteLabelKeys: string[]
  source: ThemePresetSource
}

export const AESTIVUS_THEME_NAME_BY_PRESET: Record<AppTheme, string> = {
  spatial: "Default",
  endfield: "Endfield",
  wuling: "Wuling",
  onlook: "Onlook",
  tori: "Tori",
  conductor: "Conductor",
  hilden: "Hilden & Kaira",
  aperture: "Project Aperture",
  noomo: "Noomo",
  excalidraw: "Excalidraw",
  astro: "Astro",
  svelte: "Svelte",
  bun: "Bun",
  storybook: "Storybook",
  supabase: "Supabase",
  penpot: "Penpot",
  vite: "Vite",
}

export const THEME_PRESET_DEFAULT_MODE: Record<AppTheme, ThemePresetMode> = {
  spatial: "light",
  endfield: "dark",
  wuling: "light",
  onlook: "dark",
  tori: "light",
  conductor: "dark",
  hilden: "light",
  aperture: "dark",
  noomo: "light",
  excalidraw: "light",
  astro: "dark",
  svelte: "light",
  bun: "dark",
  storybook: "light",
  supabase: "light",
  penpot: "dark",
  vite: "dark",
}

export const THEME_DESIGN_RECIPES: Record<AppTheme, ThemeDesignRecipe> = {
  spatial: {
    fontPreset: "xiranite",
    bgMode: "dot-grid",
    grainEnabled: true,
    vignetteDepth: 40,
    grainIntensity: 15,
    actionGlow: true,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "default",
  },
  endfield: {
    fontPreset: "mono",
    bgMode: "grid",
    grainEnabled: true,
    vignetteDepth: 48,
    grainIntensity: 12,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "left",
    chromeStyle: "traffic-light",
  },
  wuling: {
    fontPreset: "industrial",
    bgMode: "grid",
    bgCoverTopBar: false,
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "default",
  },
  onlook: {
    fontPreset: "display",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 64,
    grainIntensity: 10,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "island",
    chromeStyle: "default",
  },
  tori: {
    fontPreset: "terminal",
    bgMode: "grid",
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "left",
    chromeStyle: "default",
  },
  conductor: {
    fontPreset: "terminal",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 46,
    grainIntensity: 9,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "left",
    chromeStyle: "traffic-light",
  },
  hilden: {
    fontPreset: "poster",
    bgMode: "grid",
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "traffic-light",
  },
  aperture: {
    fontPreset: "display",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 70,
    grainIntensity: 12,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "island",
    chromeStyle: "traffic-light",
  },
  noomo: {
    fontPreset: "machina",
    bgMode: "none",
    grainEnabled: false,
    vignetteDepth: 12,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: true,
    chromePosition: "right",
    chromeStyle: "default",
  },
  excalidraw: {
    fontPreset: "sketch",
    bgMode: "none",
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "right",
    chromeStyle: "default",
  },
  astro: {
    fontPreset: "display",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 72,
    grainIntensity: 8,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "island",
    chromeStyle: "default",
  },
  svelte: {
    fontPreset: "editorial",
    bgMode: "none",
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: false,
    cardElevation: false,
    chromePosition: "left",
    chromeStyle: "default",
  },
  bun: {
    fontPreset: "terminal",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 54,
    grainIntensity: 8,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "left",
    chromeStyle: "traffic-light",
  },
  storybook: {
    fontPreset: "workshop",
    bgMode: "dot-grid",
    bgOpacity: 12,
    grainEnabled: false,
    vignetteDepth: 0,
    grainIntensity: 0,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "right",
    chromeStyle: "default",
  },
  supabase: {
    fontPreset: "xiranite",
    bgMode: "grid",
    bgOpacity: 10,
    grainEnabled: false,
    vignetteDepth: 8,
    grainIntensity: 0,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "left",
    chromeStyle: "default",
  },
  penpot: {
    fontPreset: "canvas",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 48,
    grainIntensity: 7,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "island",
    chromeStyle: "traffic-light",
  },
  vite: {
    fontPreset: "display",
    bgMode: "none",
    grainEnabled: true,
    vignetteDepth: 58,
    grainIntensity: 6,
    actionGlow: true,
    cardElevation: true,
    chromePosition: "island",
    chromeStyle: "default",
  },
}

export const THEME_STYLE_PROFILES: Record<AppTheme, ThemeStyleProfile> = {
  spatial: {
    family: "spatial-product",
    density: "comfortable",
    radius: "soft",
    border: "subtle",
    motion: "soft",
    surface: "tonal",
    depth: "layered",
    nodeInterior: "inherit",
    referenceAxis: ["quiet SaaS workspace", "soft data surfaces", "balanced scanning"],
  },
  endfield: {
    family: "tactical-console",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "flat",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["operational console", "futuristic dashboard", "dark luminous UI"],
  },
  wuling: {
    family: "jade-industrial",
    density: "balanced",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "tonal",
    depth: "none",
    nodeInterior: "ledger-panels",
    referenceAxis: ["jade industrial", "ledger tables", "hard outlined utility panels"],
  },
  onlook: {
    family: "onlook-gradient",
    density: "comfortable",
    radius: "soft",
    border: "subtle",
    motion: "cinematic",
    surface: "glass",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["One Page Love: Onlook", "dark macOS product demo", "multi-color gradient ribbons"],
  },
  tori: {
    family: "tori-terminal",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "flat",
    depth: "none",
    nodeInterior: "dense-controls",
    referenceAxis: ["One Page Love: Tori by TalkJS", "blue-white terminal modules", "React/shadcn/Tailwind landing page"],
  },
  conductor: {
    family: "conductor-agent-workbench",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "tonal",
    depth: "glow",
    nodeInterior: "agent-workbench",
    referenceAxis: ["One Page Love shadcn/ui: Conductor", "parallel coding agent workbench", "dark mono workspace review UI"],
  },
  hilden: {
    family: "hilden-poster",
    density: "compact",
    radius: "hard",
    border: "brutalist",
    motion: "mechanical",
    surface: "flat",
    depth: "shadow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Awwwards SOTD: Hilden & Kaira", "oversized black-white portfolio type", "poster frame"],
  },
  aperture: {
    family: "aperture-cinematic-archive",
    density: "comfortable",
    radius: "technical",
    border: "outlined",
    motion: "cinematic",
    surface: "media-led",
    depth: "layered",
    nodeInterior: "gallery-archive",
    referenceAxis: ["Awwwards Honorable Mention: Project Aperture", "cinematic travel photography grid", "dark gallery archive with viewfinder framing"],
  },
  noomo: {
    family: "noomo-3d-agency",
    density: "comfortable",
    radius: "technical",
    border: "subtle",
    motion: "cinematic",
    surface: "media-led",
    depth: "layered",
    nodeInterior: "dense-controls",
    referenceAxis: ["Noomo Agency", "pale blue 3D storytelling stage", "oversized uppercase NeueMachina type"],
  },
  excalidraw: {
    family: "excalidraw-sketch",
    density: "comfortable",
    radius: "soft",
    border: "outlined",
    motion: "soft",
    surface: "flat",
    depth: "shadow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: excalidraw/excalidraw", "hand-drawn whiteboard", "rough diagram controls"],
  },
  astro: {
    family: "astro-cosmic",
    density: "balanced",
    radius: "soft",
    border: "outlined",
    motion: "cinematic",
    surface: "media-led",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: withastro/astro", "cosmic gradient framework site", "glowing docs and code surfaces"],
  },
  svelte: {
    family: "svelte-editorial",
    density: "comfortable",
    radius: "hard",
    border: "outlined",
    motion: "soft",
    surface: "flat",
    depth: "shadow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: sveltejs/svelte", "warm editorial framework site", "serif lead type and orange action surfaces"],
  },
  bun: {
    family: "bun-runtime",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "mechanical",
    surface: "tonal",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: oven-sh/bun", "dark JavaScript runtime launch site", "release-feed and terminal toolkit surfaces"],
  },
  storybook: {
    family: "storybook-workshop",
    density: "balanced",
    radius: "soft",
    border: "outlined",
    motion: "soft",
    surface: "tonal",
    depth: "shadow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: storybookjs/storybook", "component workshop and docs canvas", "blue-pink addon controls"],
  },
  supabase: {
    family: "supabase-postgres",
    density: "balanced",
    radius: "technical",
    border: "outlined",
    motion: "soft",
    surface: "tonal",
    depth: "glow",
    nodeInterior: "ledger-panels",
    referenceAxis: ["Open source: supabase/supabase", "Postgres development platform", "mint CTA and SQL table editor surfaces"],
  },
  penpot: {
    family: "penpot-design-canvas",
    density: "compact",
    radius: "technical",
    border: "outlined",
    motion: "cinematic",
    surface: "glass",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: penpot/penpot", "design canvas and inspector panels", "teal actions with purple vector controls"],
  },
  vite: {
    family: "vite-dev-server",
    density: "balanced",
    radius: "soft",
    border: "outlined",
    motion: "cinematic",
    surface: "glass",
    depth: "glow",
    nodeInterior: "dense-controls",
    referenceAxis: ["Open source: vitejs/vite", "dark build-tool hero glow", "purple-blue-yellow docs and code surfaces"],
  },
}

const THEME_ROOT_CLASSES: Record<AppTheme, string> = {
  spatial: "theme-spatial",
  endfield: "theme-endfield",
  wuling: "theme-wuling",
  onlook: "theme-onlook",
  tori: "theme-tori",
  conductor: "theme-conductor",
  hilden: "theme-hilden",
  aperture: "theme-aperture",
  noomo: "theme-noomo",
  excalidraw: "theme-excalidraw",
  astro: "theme-astro",
  svelte: "theme-svelte",
  bun: "theme-bun",
  storybook: "theme-storybook",
  supabase: "theme-supabase",
  penpot: "theme-penpot",
  vite: "theme-vite",
}

export const THEME_PRESET_OPTIONS: ThemePresetOption[] = [
  {
    key: "spatial",
    labelKey: "settings:themes.spatial.label",
    subtitleKey: "settings:themes.spatial.subtitle",
    descriptionKey: "settings:themes.spatial.description",
    swatch: "oklch(0.40 0.12 148)",
    palette: ["oklch(0.97 0.005 148)", "oklch(0.40 0.12 148)", "oklch(0.88 0.02 148)", "oklch(0.12 0.01 148)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.bg", "settings:texture.paletteLabels.primary", "settings:texture.paletteLabels.border", "settings:texture.paletteLabels.text"],
    source: {
      kind: "internal",
      title: "Xiranite default workspace",
      evidence: [],
    },
  },
  {
    key: "endfield",
    labelKey: "settings:themes.endfield.label",
    subtitleKey: "settings:themes.endfield.subtitle",
    descriptionKey: "settings:themes.endfield.description",
    swatch: "oklch(0.62 0.18 152)",
    palette: ["oklch(0.13 0.025 216)", "oklch(0.17 0.025 216)", "oklch(0.62 0.18 152)", "oklch(0.90 0.04 148)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.card", "settings:texture.paletteLabels.green", "settings:texture.paletteLabels.text"],
    source: {
      kind: "internal",
      title: "Endfield tactical UI direction",
      evidence: [],
      note: "Internal preset tuned for a dark operational console.",
    },
  },
  {
    key: "wuling",
    labelKey: "settings:themes.wuling.label",
    subtitleKey: "settings:themes.wuling.subtitle",
    descriptionKey: "settings:themes.wuling.description",
    swatch: "oklch(0.72 0.13 173)",
    palette: ["oklch(0.98 0.006 180)", "oklch(1 0 0)", "oklch(0.72 0.13 173)", "oklch(0.24 0.025 166)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.bg", "settings:texture.paletteLabels.surface", "settings:texture.paletteLabels.jade", "settings:texture.paletteLabels.text"],
    source: {
      kind: "internal",
      title: "Wuling jade industrial direction",
      evidence: [],
      note: "Internal preset for hard-edged pale industrial surfaces.",
    },
  },
  {
    key: "onlook",
    labelKey: "settings:themes.onlook.label",
    subtitleKey: "settings:themes.onlook.subtitle",
    descriptionKey: "settings:themes.onlook.description",
    swatch: "oklch(0.76 0.17 210)",
    palette: ["oklch(0.12 0.025 252)", "oklch(0.76 0.17 210)", "oklch(0.72 0.19 25)", "oklch(0.94 0.02 92)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.cyan", "settings:texture.paletteLabels.signal", "settings:texture.paletteLabels.text"],
    source: {
      kind: "one-page-love",
      title: "Onlook",
      url: "https://onepagelove.com/onlook-cam",
      originalUrl: "https://onlook.cam/",
      evidence: [
        "output/playwright/onepagelove-onlook-live-20260709.png",
        "output/playwright/xiranite-theme-onlook-nodes-live-20260709.png",
      ],
      note: "Original site was not consistently reachable during browsing; One Page Love entry screenshot is the stable visual source.",
    },
  },
  {
    key: "tori",
    labelKey: "settings:themes.tori.label",
    subtitleKey: "settings:themes.tori.subtitle",
    descriptionKey: "settings:themes.tori.description",
    swatch: "oklch(0.58 0.22 262)",
    palette: ["oklch(0.985 0.005 250)", "oklch(0.58 0.22 262)", "oklch(0.72 0.13 245)", "oklch(0.18 0.035 252)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.paper", "settings:texture.paletteLabels.blue", "settings:texture.paletteLabels.cyan", "settings:texture.paletteLabels.ink"],
    source: {
      kind: "one-page-love",
      title: "Tori by TalkJS",
      url: "https://onepagelove.com/tori",
      originalUrl: "https://asktori.ai/",
      evidence: [
        "output/playwright/onepagelove-tori-live-20260709.png",
        "output/playwright/tori-original-fresh-20260709.png",
        "output/playwright/xiranite-theme-tori-live-20260709.png",
      ],
    },
  },
  {
    key: "conductor",
    labelKey: "settings:themes.conductor.label",
    subtitleKey: "settings:themes.conductor.subtitle",
    descriptionKey: "settings:themes.conductor.description",
    swatch: "oklch(0.72 0.13 148)",
    palette: ["oklch(0.12 0.012 40)", "oklch(0.91 0.008 60)", "oklch(0.68 0.15 148)", "oklch(0.29 0.018 40)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.text", "settings:texture.paletteLabels.green", "settings:texture.paletteLabels.panel"],
    source: {
      kind: "one-page-love",
      title: "Conductor",
      url: "https://onepagelove.com/tech/shadcn-ui",
      originalUrl: "https://www.conductor.build/",
      evidence: [
        "output/playwright/conductor.png",
      ],
      note: "Browsed from One Page Love's shadcn/ui collection; selected because it is a real developer-tool workspace UI rather than a pure marketing treatment.",
    },
  },
  {
    key: "hilden",
    labelKey: "settings:themes.hilden.label",
    subtitleKey: "settings:themes.hilden.subtitle",
    descriptionKey: "settings:themes.hilden.description",
    swatch: "oklch(0.84 0.18 92)",
    palette: ["oklch(0.985 0.01 105)", "oklch(0.08 0 0)", "oklch(0.84 0.18 92)", "oklch(0.62 0.22 27)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.paper", "settings:texture.paletteLabels.ink", "settings:texture.paletteLabels.yellow", "settings:texture.paletteLabels.signal"],
    source: {
      kind: "awwwards",
      title: "Hilden & Kaira",
      url: "https://www.awwwards.com/sites/hilden-kaira",
      originalUrl: "https://www.hildenkaira.fi/",
      evidence: [
        "output/playwright/awwwards-hilden-live-20260709.png",
        "output/playwright/hilden-original-fresh-20260709.png",
        "output/playwright/xiranite-theme-hilden-live-20260709.png",
      ],
    },
  },
  {
    key: "aperture",
    labelKey: "settings:themes.aperture.label",
    subtitleKey: "settings:themes.aperture.subtitle",
    descriptionKey: "settings:themes.aperture.description",
    swatch: "oklch(0.78 0.055 145)",
    palette: ["oklch(0.16 0.016 330)", "oklch(0.93 0.015 145)", "oklch(0.78 0.055 145)", "oklch(0.70 0.13 60)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.photo", "settings:texture.paletteLabels.sage", "settings:texture.paletteLabels.amber"],
    source: {
      kind: "awwwards",
      title: "Project Aperture",
      url: "https://www.awwwards.com/sites/project-aperture",
      originalUrl: "https://www.project-aperture.com/",
      evidence: [
        "output/playwright/candidate-awwwards-project-aperture-detail.png",
        "output/playwright/candidate-project-aperture-original.png",
      ],
      note: "Browsed as an Awwwards Honorable Mention; selected for its cinematic travel-photography grid, viewfinder framing, and dark archive atmosphere.",
    },
  },
  {
    key: "noomo",
    labelKey: "settings:themes.noomo.label",
    subtitleKey: "settings:themes.noomo.subtitle",
    descriptionKey: "settings:themes.noomo.description",
    swatch: "oklch(0.83 0.045 250)",
    palette: ["oklch(0.83 0.045 250)", "oklch(0.06 0.012 272)", "oklch(0.97 0.012 255)", "oklch(0.72 0.045 300)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.sky", "settings:texture.paletteLabels.ink", "settings:texture.paletteLabels.chrome", "settings:texture.paletteLabels.mist"],
    source: {
      kind: "public-site",
      title: "Noomo Agency",
      url: "https://noomoagency.com/",
      originalUrl: "https://noomoagency.com/",
      evidence: [
        "output/playwright/noomo-agency-fresh-20260709.png",
        "output/playwright/xiranite-theme-noomo-nodes-live-20260709.png",
      ],
    },
  },
  {
    key: "excalidraw",
    labelKey: "settings:themes.excalidraw.label",
    subtitleKey: "settings:themes.excalidraw.subtitle",
    descriptionKey: "settings:themes.excalidraw.description",
    swatch: "oklch(0.58 0.18 292)",
    palette: ["oklch(0.99 0 0)", "oklch(0.58 0.18 292)", "oklch(0.93 0.022 292)", "oklch(0.22 0.015 270)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.canvas", "settings:texture.paletteLabels.violet", "settings:texture.paletteLabels.tool", "settings:texture.paletteLabels.ink"],
    source: {
      kind: "open-source",
      title: "Excalidraw",
      url: "https://excalidraw.com/",
      repositoryUrl: "https://github.com/excalidraw/excalidraw",
      evidence: [
        "output/playwright/excalidraw-app-fresh-20260709.png",
        "output/playwright/excalidraw-github-live-20260709.png",
        "output/playwright/xiranite-theme-excalidraw-nodes-live-20260709.png",
      ],
      note: "GitHub page showed about 127k stars when browsed.",
    },
  },
  {
    key: "astro",
    labelKey: "settings:themes.astro.label",
    subtitleKey: "settings:themes.astro.subtitle",
    descriptionKey: "settings:themes.astro.description",
    swatch: "oklch(0.70 0.21 32)",
    palette: ["oklch(0.15 0.04 259)", "oklch(0.70 0.21 32)", "oklch(0.64 0.22 310)", "oklch(0.91 0.035 244)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.orange", "settings:texture.paletteLabels.nebula", "settings:texture.paletteLabels.star"],
    source: {
      kind: "open-source",
      title: "Astro",
      url: "https://astro.build/",
      repositoryUrl: "https://github.com/withastro/astro",
      evidence: [
        "output/playwright/astro-build-fresh-20260709.png",
        "output/playwright/astro-github-fresh-20260709.png",
        "output/playwright/xiranite-theme-astro-nodes-live-20260709.png",
      ],
      note: "Official site links to the withastro/astro GitHub repository; GitHub API showed about 60.8k stars when reviewed.",
    },
  },
  {
    key: "svelte",
    labelKey: "settings:themes.svelte.label",
    subtitleKey: "settings:themes.svelte.subtitle",
    descriptionKey: "settings:themes.svelte.description",
    swatch: "oklch(0.62 0.22 32)",
    palette: ["oklch(0.985 0.018 75)", "oklch(0.62 0.22 32)", "oklch(0.16 0.035 48)", "oklch(0.92 0.035 58)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.paper", "settings:texture.paletteLabels.orange", "settings:texture.paletteLabels.ink", "settings:texture.paletteLabels.surface"],
    source: {
      kind: "open-source",
      title: "Svelte",
      url: "https://svelte.dev/",
      repositoryUrl: "https://github.com/sveltejs/svelte",
      evidence: [
        "output/playwright/svelte-dev-fresh-20260709.png",
        "output/playwright/svelte-github-fresh-20260709.png",
        "output/playwright/xiranite-theme-svelte-nodes-live-20260709.png",
      ],
      note: "GitHub API showed about 87.4k stars when reviewed.",
    },
  },
  {
    key: "bun",
    labelKey: "settings:themes.bun.label",
    subtitleKey: "settings:themes.bun.subtitle",
    descriptionKey: "settings:themes.bun.description",
    swatch: "oklch(0.78 0.12 80)",
    palette: ["oklch(0.14 0.018 260)", "oklch(0.78 0.12 80)", "oklch(0.24 0.035 62)", "oklch(0.96 0.02 84)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.gold", "settings:texture.paletteLabels.deep", "settings:texture.paletteLabels.text"],
    source: {
      kind: "open-source",
      title: "Bun",
      url: "https://bun.com/",
      repositoryUrl: "https://github.com/oven-sh/bun",
      evidence: [
        "output/playwright/bun-site-fresh-20260709.png",
        "output/playwright/bun-docs-fresh-20260709.png",
        "output/playwright/bun-github-fresh-20260709.png",
        "output/playwright/xiranite-theme-bun-nodes-live-20260709.png",
      ],
      note: "GitHub API showed about 93.7k stars when reviewed.",
    },
  },
  {
    key: "storybook",
    labelKey: "settings:themes.storybook.label",
    subtitleKey: "settings:themes.storybook.subtitle",
    descriptionKey: "settings:themes.storybook.description",
    swatch: "oklch(0.67 0.20 343)",
    palette: ["oklch(0.99 0.004 250)", "oklch(0.66 0.20 245)", "oklch(0.67 0.20 343)", "oklch(0.23 0.025 260)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.canvas", "settings:texture.paletteLabels.blue", "settings:texture.paletteLabels.signal", "settings:texture.paletteLabels.ink"],
    source: {
      kind: "open-source",
      title: "Storybook",
      url: "https://storybook.js.org/",
      repositoryUrl: "https://github.com/storybookjs/storybook",
      evidence: [
        "output/playwright/storybook-site-live-20260709.png",
        "output/playwright/storybook-docs-live-20260709.png",
        "output/playwright/storybook-github-live-20260709.png",
      ],
      note: "Official site showed 90,478 stars, 72.58m monthly installs, and 2282 contributors; GitHub page showed about 90.5k stars when browsed.",
    },
  },
  {
    key: "supabase",
    labelKey: "settings:themes.supabase.label",
    subtitleKey: "settings:themes.supabase.subtitle",
    descriptionKey: "settings:themes.supabase.description",
    swatch: "oklch(0.76 0.16 160)",
    palette: ["oklch(0.985 0.004 34)", "oklch(0.76 0.16 160)", "oklch(0.22 0.018 170)", "oklch(0.14 0.012 34)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.canvas", "settings:texture.paletteLabels.green", "settings:texture.paletteLabels.deep", "settings:texture.paletteLabels.ink"],
    source: {
      kind: "open-source",
      title: "Supabase",
      url: "https://supabase.com/",
      repositoryUrl: "https://github.com/supabase/supabase",
      evidence: [
        "output/playwright/supabase-site-live-20260709.png",
        "output/playwright/supabase-docs-live-20260709.png",
        "output/playwright/supabase-github-live-20260709.png",
      ],
      note: "Official site showed 105.9K stars in its nav; GitHub page showed about 106k stars when browsed.",
    },
  },
  {
    key: "penpot",
    labelKey: "settings:themes.penpot.label",
    subtitleKey: "settings:themes.penpot.subtitle",
    descriptionKey: "settings:themes.penpot.description",
    swatch: "oklch(0.74 0.16 185)",
    palette: ["oklch(0.16 0.06 275)", "oklch(0.74 0.16 185)", "oklch(0.79 0.17 150)", "oklch(0.70 0.20 315)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.ink", "settings:texture.paletteLabels.cyan", "settings:texture.paletteLabels.green", "settings:texture.paletteLabels.signal"],
    source: {
      kind: "open-source",
      title: "Penpot",
      url: "https://penpot.app/",
      repositoryUrl: "https://github.com/penpot/penpot",
      evidence: [
        "output/playwright/penpot-site-live-20260709.png",
        "output/playwright/penpot-self-host-live-20260709.png",
        "output/playwright/penpot-github-live-20260709.png",
      ],
      note: "Official site describes Penpot as the open-source design platform for teams; GitHub page showed about 55.3k stars when browsed.",
    },
  },
  {
    key: "vite",
    labelKey: "settings:themes.vite.label",
    subtitleKey: "settings:themes.vite.subtitle",
    descriptionKey: "settings:themes.vite.description",
    swatch: "oklch(0.72 0.22 292)",
    palette: ["oklch(0.13 0.050 275)", "oklch(0.72 0.22 292)", "oklch(0.77 0.17 235)", "oklch(0.88 0.18 96)"],
    paletteLabelKeys: ["settings:texture.paletteLabels.void", "settings:texture.paletteLabels.violet", "settings:texture.paletteLabels.blue", "settings:texture.paletteLabels.yellow"],
    source: {
      kind: "open-source",
      title: "Vite",
      url: "https://vite.dev/",
      repositoryUrl: "https://github.com/vitejs/vite",
      evidence: [
        "output/playwright/vite-site-live-20260709.png",
        "output/playwright/vite-guide-live-20260709.png",
        "output/playwright/vite-github-live-20260709.png",
      ],
      note: "Official site showed 80k+ GitHub stars and 80m+ weekly NPM downloads; GitHub page showed about 81.9k stars when browsed.",
    },
  },
]

let customThemeKeys = new Set<string>()

export const FONT_PRESETS: FontPresetOption[] = [
  {
    key: "xiranite",
    label: "Xiranite",
    description: "Inter UI with JetBrains Mono code surfaces.",
    sans: "\"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "system",
    label: "System",
    description: "Native platform UI fonts with stable monospace fallback.",
    sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    mono: "ui-monospace, \"Cascadia Mono\", \"Segoe UI Mono\", monospace",
  },
  {
    key: "aestivus",
    label: "Aestivus",
    description: "LXGW WenKai style text with JetBrains Mono for technical fields.",
    sans: "\"LXGW WenKai Screen\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "industrial",
    label: "Industrial",
    description: "Hanken Grotesk UI with JetBrains Mono labels for jade industrial workspaces.",
    sans: "\"Hanken Grotesk\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "display",
    label: "Display",
    description: "Wide editorial display treatment for cinematic, image-led interfaces.",
    sans: "\"Space Grotesk\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "editorial",
    label: "Editorial",
    description: "Serif-led rhythm for gallery and long-form workspace surfaces.",
    sans: "\"Fraunces\", Georgia, Cambria, \"Times New Roman\", serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "poster",
    label: "Poster",
    description: "Narrow grotesk UI with high-contrast editorial headings supplied by the theme.",
    sans: "\"Inter Tight\", \"Arial Narrow\", \"Helvetica Neue\", Arial, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "Inter UI with Menlo-style technical labels for modular terminal layouts.",
    sans: "\"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "Menlo, Monaco, Consolas, \"Courier New\", ui-monospace, monospace",
  },
  {
    key: "machina",
    label: "Machina",
    description: "Squared agency display typography with a restrained grotesk utility face.",
    sans: "\"NeueMachina\", \"Space Grotesk\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"Source Code Pro\", \"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "sketch",
    label: "Sketch",
    description: "Hand-drawn Excalidraw-style text with a clean technical fallback.",
    sans: "\"Excalifont\", \"Xiaolai\", \"Comic Sans MS\", \"Assistant\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "workshop",
    label: "Workshop",
    description: "Rounded component-workshop typography inspired by Storybook docs and addon panels.",
    sans: "\"Nunito Sans\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"SFMono-Regular\", \"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "canvas",
    label: "Canvas",
    description: "Work Sans-led interface typography for design-canvas and inspector surfaces.",
    sans: "\"Work Sans\", \"Inter\", ui-sans-serif, system-ui, sans-serif",
    mono: "\"JetBrains Mono\", \"SFMono-Regular\", ui-monospace, monospace",
  },
  {
    key: "serif",
    label: "Serif",
    description: "Reading-friendly serif text while keeping code monospace.",
    sans: "ui-serif, Georgia, Cambria, \"Times New Roman\", serif",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
  {
    key: "mono",
    label: "Mono UI",
    description: "Monospace everywhere for dense operational workspaces.",
    sans: "\"JetBrains Mono\", ui-monospace, monospace",
    mono: "\"JetBrains Mono\", ui-monospace, monospace",
  },
]

export function getFontPresetOption(fontPreset: AppFontPreset): FontPresetOption {
  return FONT_PRESETS.find((preset) => preset.key === fontPreset) ?? FONT_PRESETS[0]
}

export function applyFontPreset(fontPreset: AppFontPreset): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  const preset = getFontPresetOption(fontPreset)
  root.dataset.fontPreset = preset.key
  root.style.setProperty("--font-app-sans", preset.sans)
  root.style.setProperty("--font-app-mono", preset.mono)

  if (preset.key === "xiranite") {
    root.removeAttribute("data-custom-font")
    root.style.removeProperty("--font-custom-sans")
    root.style.removeProperty("--font-custom-mono")
    return
  }

  root.setAttribute("data-custom-font", "enabled")
  root.style.setProperty("--font-custom-sans", preset.sans)
  root.style.setProperty("--font-custom-mono", preset.mono)
}

export function applyThemePreset(theme: AppTheme): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  const profile = THEME_STYLE_PROFILES[theme]
  root.dataset.appTheme = theme
  root.dataset.themeFamily = profile.family
  root.dataset.themeDensity = profile.density
  root.dataset.themeRadius = profile.radius
  root.dataset.themeBorder = profile.border
  root.dataset.themeMotion = profile.motion
  root.dataset.themeSurface = profile.surface
  root.dataset.themeDepth = profile.depth
  root.dataset.themeNodeInterior = profile.nodeInterior
  root.classList.remove(...Object.values(THEME_ROOT_CLASSES))
  root.classList.add(THEME_ROOT_CLASSES[theme])
}

export function applyCustomTheme(customTheme: AppCustomTheme | null, mode: ThemeMode): void {
  if (typeof document === "undefined") return

  const root = document.documentElement
  for (const key of customThemeKeys) {
    root.style.removeProperty(`--${key}`)
  }
  customThemeKeys = new Set()

  if (!customTheme) {
    root.removeAttribute("data-custom-theme")
    root.removeAttribute("data-custom-theme-name")
    root.removeAttribute("data-theme-visual-source")
    const appTheme = root.dataset.appTheme as AppTheme | undefined
    if (appTheme && THEME_ROOT_CLASSES[appTheme]) {
      root.classList.add(THEME_ROOT_CLASSES[appTheme])
    }
    return
  }

  const isDark = mode === "dark" || (mode === "system" && root.classList.contains("dark"))
  const selectedVars = isDark ? (customTheme.cssVars.dark ?? customTheme.cssVars.light) : customTheme.cssVars.light
  const cssVars = {
    ...(customTheme.cssVars.theme ?? {}),
    ...selectedVars,
  }
  const normalizedCssVars = Object.fromEntries(
    Object.entries(cssVars)
      .map(([key, value]) => [normalizeCssVarName(key), value] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0])),
  )
  const derivedCssVars = deriveCustomThemeVars(normalizedCssVars)

  root.setAttribute("data-custom-theme", "enabled")
  root.setAttribute("data-theme-visual-source", "custom")
  root.dataset.customThemeName = customTheme.name
  root.classList.remove(...Object.values(THEME_ROOT_CLASSES))
  for (const [cssVarName, value] of Object.entries({
    ...normalizedCssVars,
    ...derivedCssVars,
  })) {
    root.style.setProperty(`--${cssVarName}`, value)
    customThemeKeys.add(cssVarName)
  }
}

function deriveCustomThemeVars(cssVars: Record<string, string>): Record<string, string> {
  const background = cssVars.background ?? "var(--background)"
  const foreground = cssVars.foreground ?? "var(--foreground)"
  const card = cssVars.card ?? background
  const cardForeground = cssVars["card-foreground"] ?? foreground
  const primary = cssVars.primary ?? foreground
  const primaryForeground = cssVars["primary-foreground"] ?? background
  const secondary = cssVars.secondary ?? `color-mix(in oklch, ${primary} 10%, ${background})`
  const secondaryForeground = cssVars["secondary-foreground"] ?? foreground
  const muted = cssVars.muted ?? `color-mix(in oklch, ${card} 82%, ${background})`
  const mutedForeground = cssVars["muted-foreground"] ?? `color-mix(in oklch, ${foreground} 62%, ${background})`
  const accent = cssVars.accent ?? `color-mix(in oklch, ${primary} 18%, ${card})`
  const accentForeground = cssVars["accent-foreground"] ?? foreground
  const border = cssVars.border ?? `color-mix(in oklch, ${primary} 30%, ${background})`
  const input = cssVars.input ?? border
  const ring = cssVars.ring ?? primary
  const popover = cssVars.popover ?? `color-mix(in oklch, ${card} 94%, ${background})`
  const popoverForeground = cssVars["popover-foreground"] ?? cardForeground

  return {
    secondary,
    "secondary-foreground": secondaryForeground,
    muted,
    "muted-foreground": mutedForeground,
    accent,
    "accent-foreground": accentForeground,
    border,
    input,
    ring,
    popover,
    "popover-foreground": popoverForeground,
    sidebar: cssVars.sidebar ?? card,
    "sidebar-foreground": cssVars["sidebar-foreground"] ?? cardForeground,
    "sidebar-primary": cssVars["sidebar-primary"] ?? primary,
    "sidebar-primary-foreground": cssVars["sidebar-primary-foreground"] ?? primaryForeground,
    "sidebar-accent": cssVars["sidebar-accent"] ?? accent,
    "sidebar-accent-foreground": cssVars["sidebar-accent-foreground"] ?? accentForeground,
    "sidebar-border": cssVars["sidebar-border"] ?? border,
    "sidebar-ring": cssVars["sidebar-ring"] ?? ring,
    "ws-canvas": cssVars["ws-canvas"] ?? background,
    "ws-grid-color": cssVars["ws-grid-color"] ?? `color-mix(in oklch, ${primary} 24%, transparent)`,
    "ws-accent-glow": cssVars["ws-accent-glow"] ?? `color-mix(in oklch, ${primary} 24%, transparent)`,
    "ws-focused-overlay": cssVars["ws-focused-overlay"] ?? `color-mix(in oklch, ${background} 72%, transparent)`,
    "node-surface-bg": cssVars["node-surface-bg"] ?? card,
    "node-surface-fg": cssVars["node-surface-fg"] ?? cardForeground,
    "node-panel-bg": cssVars["node-panel-bg"] ?? `color-mix(in oklch, ${card} 88%, ${background})`,
    "node-panel-fg": cssVars["node-panel-fg"] ?? cardForeground,
    "node-panel-border": cssVars["node-panel-border"] ?? border,
    "node-panel-shadow": cssVars["node-panel-shadow"] ?? `0 18px 50px -36px color-mix(in oklch, ${foreground} 42%, transparent)`,
    "node-control-bg": cssVars["node-control-bg"] ?? `color-mix(in oklch, ${background} 76%, ${card})`,
    "node-control-bg-hover": cssVars["node-control-bg-hover"] ?? accent,
    "node-control-fg": cssVars["node-control-fg"] ?? foreground,
    "node-control-border": cssVars["node-control-border"] ?? input,
    "node-input-bg": cssVars["node-input-bg"] ?? `color-mix(in oklch, ${background} 84%, ${card})`,
    "node-code-bg": cssVars["node-code-bg"] ?? muted,
    "node-divider": cssVars["node-divider"] ?? `color-mix(in oklch, ${border} 76%, transparent)`,
    "node-media-frame-bg": cssVars["node-media-frame-bg"] ?? card,
    "node-media-frame-border": cssVars["node-media-frame-border"] ?? border,
    "node-media-caption-fg": cssVars["node-media-caption-fg"] ?? mutedForeground,
    "node-focus-ring": cssVars["node-focus-ring"] ?? ring,
    "node-chrome-bg": cssVars["node-chrome-bg"] ?? `color-mix(in oklch, ${primary} 16%, ${card})`,
    "node-chrome-fg": cssVars["node-chrome-fg"] ?? foreground,
    "node-chrome-border": cssVars["node-chrome-border"] ?? `color-mix(in oklch, ${primary} 44%, ${border})`,
    "node-chrome-accent": cssVars["node-chrome-accent"] ?? primary,
  }
}

export function parseImportedThemeJson(jsonString: string): AppCustomTheme[] {
  const parsed = JSON.parse(jsonString) as unknown
  const themes = collectThemeRecords(parsed)

  if (themes.length > 0) return dedupeThemesByName(themes)

  throw new Error("Theme JSON must include cssVars.light or colors.light.")
}

function collectThemeRecords(value: unknown, fallbackName?: string): AppCustomTheme[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectThemeRecords(item))
  }

  const theme = parseThemeRecord(value, fallbackName)
  if (theme) return [theme]

  if (!isRecord(value)) return []

  for (const key of ["items", "themes", "presets"] as const) {
    if (Array.isArray(value[key])) {
      return collectThemeRecords(value[key])
    }
  }

  const themes: AppCustomTheme[] = []
  for (const [key, entryValue] of Object.entries(value)) {
    if (!isRecord(entryValue)) continue
    themes.push(...collectThemeRecords(entryValue, key))
  }
  return themes
}

function parseThemeRecord(value: unknown, fallbackName?: string): AppCustomTheme | null {
  if (!isRecord(value)) return null

  const explicitName = [value.name, value.label, value.title]
    .find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  const name = explicitName?.trim() ?? fallbackName ?? "Imported"
  const description = typeof value.description === "string" ? value.description : undefined

  if (isRecord(value.cssVars)) {
    const light = stringRecord(value.cssVars.light)
    if (!light) return null

    return {
      name,
      description,
      cssVars: {
        theme: stringRecord(value.cssVars.theme) ?? undefined,
        light,
        dark: stringRecord(value.cssVars.dark) ?? undefined,
      },
    }
  }

  if (isRecord(value.colors)) {
    const light = stringRecord(value.colors.light)
    if (!light) return null

    return {
      name,
      description,
      cssVars: {
        light,
        dark: stringRecord(value.colors.dark) ?? undefined,
      },
    }
  }

  return null
}

export function mirrorAestivusThemeStorage(theme: AppTheme, mode: ThemeMode, customThemes: AppCustomTheme[] = [], activeTheme?: AppCustomTheme | null): void {
  if (typeof localStorage === "undefined") return

  localStorage.setItem("theme-name", activeTheme?.name ?? AESTIVUS_THEME_NAME_BY_PRESET[theme])
  localStorage.setItem("theme-mode", mode)

  if (customThemes.length > 0) {
    const aestivusThemes = customThemes.map((customTheme) => ({
      name: customTheme.name,
      description: customTheme.description ?? "Imported theme",
      colors: {
        light: customTheme.cssVars.light,
        dark: customTheme.cssVars.dark ?? customTheme.cssVars.light,
      },
    }))
    localStorage.setItem("custom-themes", JSON.stringify(aestivusThemes))
  } else {
    localStorage.removeItem("custom-themes")
  }
}

export function getActiveCustomTheme(customThemes: AppCustomTheme[], activeThemeName: string | null): AppCustomTheme | null {
  if (!activeThemeName) return null
  return customThemes.find((theme) => theme.name === activeThemeName) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null

  const entries = Object.entries(value)
    .map(([key, entryValue]) => {
      const cssVarName = normalizeCssVarName(key)
      return [cssVarName, typeof entryValue === "string" ? normalizeCssVarValue(cssVarName, entryValue) : entryValue] as const
    })
    .filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function normalizeCssVarName(key: string): string {
  return key.trim().replace(/^--/, "")
}

function normalizeCssVarValue(key: string, value: string): string {
  const trimmed = value.trim()
  if (!isColorCssVar(key) || isCompleteCssColorValue(trimmed)) return trimmed

  if (/^-?\d*\.?\d+(?:deg|rad|turn)?\s+-?\d*\.?\d+%\s+-?\d*\.?\d+%(?:\s*\/\s*-?\d*\.?\d+%?)?$/i.test(trimmed)) {
    return `hsl(${trimmed})`
  }

  return trimmed
}

function isCompleteCssColorValue(value: string): boolean {
  return /^(?:transparent|currentColor|inherit|initial|unset|#[\da-f]{3,8}|(?:oklch|oklab|hsl|hsla|rgb|rgba|lab|lch|color|color-mix|light-dark|var)\()/i.test(value)
}

function isColorCssVar(key: string): boolean {
  return (
    key === "background" ||
    key === "foreground" ||
    key === "card" ||
    key === "card-foreground" ||
    key === "popover" ||
    key === "popover-foreground" ||
    key === "primary" ||
    key === "primary-foreground" ||
    key === "secondary" ||
    key === "secondary-foreground" ||
    key === "muted" ||
    key === "muted-foreground" ||
    key === "accent" ||
    key === "accent-foreground" ||
    key === "destructive" ||
    key === "destructive-foreground" ||
    key === "border" ||
    key === "input" ||
    key === "ring" ||
    key === "sidebar" ||
    key === "sidebar-foreground" ||
    key === "sidebar-primary" ||
    key === "sidebar-primary-foreground" ||
    key === "sidebar-accent" ||
    key === "sidebar-accent-foreground" ||
    key === "sidebar-border" ||
    key === "sidebar-ring" ||
    key.startsWith("chart-") ||
    key.startsWith("badge-") ||
    key.startsWith("ws-") ||
    key.startsWith("node-")
  )
}

function dedupeThemesByName(themes: AppCustomTheme[]): AppCustomTheme[] {
  const map = new Map<string, AppCustomTheme>()
  for (const theme of themes) {
    map.set(theme.name, theme)
  }
  return [...map.values()]
}
