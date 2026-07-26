import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { WorkspaceAppearance } from "./WorkspaceAppearance"
import { TopBar } from "./TopBar"
import { THEME_PRESET_OPTIONS } from "@/lib/appearance"
import { useWorkspaceStore } from "@/store/workspaceStore"
import type { AppCustomTheme, AppThemeScheme } from "@/types/workspace"

vi.mock("@/components/workspace/WorkspaceMelodeck", () => ({
  WorkspaceMelodeckTopBarSlot: () => <div data-melodeck="topbar-slot-test" />,
}))

afterEach(cleanup)

test.each(["light", "dark"] as const)("tints the Melo deck titlebar from the %s preset palette's fourth color", async (scheme) => {
  const state = useWorkspaceStore.getState()
  const previousSelection = state.themeSelections[scheme]
  const vitePalette = THEME_PRESET_OPTIONS.find((preset) => preset.key === "vite")!.palette

  try {
    state.setThemeSelection(scheme, { kind: "preset", name: "vite" })
    await render(<TopBarThemeHarness scheme={scheme} />)

    const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
    const backgroundProbe = document.querySelector<HTMLElement>("[data-theme-background-probe]")!
    await expect.poll(() => titlebar.style.getPropertyValue("--xiranite-titlebar-palette-color")).toBe(vitePalette[3])
    expect(titlebar.querySelector('[data-melodeck="topbar-slot-test"]')).not.toBeNull()
    expect(titlebar.dataset.titlebarPaletteSlot).toBe("4")
    expect(titlebar.style.backgroundColor).toContain("color-mix")
    expect(getComputedStyle(titlebar).backgroundColor).not.toBe(getComputedStyle(backgroundProbe).backgroundColor)
  } finally {
    state.setThemeSelection(scheme, previousSelection)
  }
})

test("uses an imported custom theme accent for the Melo deck titlebar", async () => {
  const state = useWorkspaceStore.getState()
  const previousSelection = state.themeSelections.light
  const previousCustomThemes = state.customThemes
  const customTheme: AppCustomTheme = {
    name: "Melo Rose",
    cssVars: {
      light: {
        background: "rgb(248, 247, 244)",
        foreground: "rgb(28, 30, 34)",
        primary: "rgb(32, 104, 92)",
        accent: "rgb(204, 72, 132)",
      },
    },
  }

  try {
    state.setCustomThemes([...previousCustomThemes, customTheme])
    state.setThemeSelection("light", { kind: "custom", name: customTheme.name })
    await render(<TopBarThemeHarness scheme="light" />)

    const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
    await expect.poll(() => document.documentElement.style.getPropertyValue("--accent")).toBe(customTheme.cssVars.light.accent)
    expect(titlebar.style.getPropertyValue("--xiranite-titlebar-palette-color")).toBe(customTheme.cssVars.light.accent)
    expect(getComputedStyle(titlebar).backgroundColor).not.toBe("rgb(255, 255, 255)")
  } finally {
    state.setCustomThemes(previousCustomThemes)
    state.setThemeSelection("light", previousSelection)
  }
})

function TopBarThemeHarness({ scheme }: { scheme: AppThemeScheme }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }))

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={scheme}
      enableSystem={false}
      storageKey={`xiranite-topbar-browser-${scheme}`}
    >
      <QueryClientProvider client={queryClient}>
        <WorkspaceAppearance />
        <main className="min-h-screen bg-background text-foreground">
          <TopBar />
          <div data-theme-background-probe className="h-8 bg-background" />
        </main>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
