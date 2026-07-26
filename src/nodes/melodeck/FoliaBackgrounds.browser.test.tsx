import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useState } from "react"
import {
  buildFoliaDualTheme,
  DEFAULT_FOLIA_PLAYER_PREFERENCES,
  FoliaFullscreenSurface,
  FoliaPlayerProvider,
  FoliaUnifiedPanel,
  useFoliaPlayer,
  type FoliaPlayerPreferences,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import "@hibernalglow/folia-player/styles.css"
import { ThemeProvider } from "@/components/theme-provider"
import { useMelodeckThemeMode } from "@/nodes/melodeck/useMelodeckThemeMode"
import "@/i18n"

// Drives the upstream ControlsTab through the Xiranite-controlled Folia provider.
afterEach(() => {
  document.documentElement.classList.remove("dark")
  localStorage.removeItem("folia-background-test-theme")
})

test("projects background controls and theme actions into the active fullscreen renderer", async () => {
  await render(
    <ThemeProvider defaultTheme="light" enableSystem={false} storageKey="folia-background-test-theme">
      <FoliaBackgroundHarness />
    </ThemeProvider>,
  )

  const fullscreen = document.querySelector<HTMLElement>('[data-folia-surface="fullscreen"]')!
  const probe = document.querySelector<HTMLElement>("[data-folia-background-preferences]")!
  await openVisualizerSettings(fullscreen)

  await selectSettingsBackgroundMode("common")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("common")
  const commonSwitches = [...document.querySelectorAll<HTMLElement>('[data-folia-background-settings] [aria-pressed]')]
  await page.elementLocator(commonSwitches[2]!).click()
  await expect.poll(() => probe.getAttribute("data-cover-color")).toBe("true")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-reset="common"]')!).click()
  await expect.poll(() => probe.getAttribute("data-cover-color")).toBe("false")

  await selectSettingsBackgroundMode("monet")
  expect(document.querySelector<HTMLButtonElement>("[data-folia-background-monet-upload]")?.disabled).toBe(true)

  await selectSettingsBackgroundMode("latent")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-latent-display="dithering"]')!).click()
  await expect.poll(() => probe.getAttribute("data-latent-display")).toBe("dithering")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-reset="latent"]')!).click()
  await expect.poll(() => probe.getAttribute("data-latent-display")).toBe("both")

  await selectSettingsBackgroundMode("url")
  await manageUrlBackgroundList(probe)

  await selectSettingsBackgroundMode("latent")
  await closeSettings()
  await enterLyricsPlayer(fullscreen)

  expectRendererMode(fullscreen, "latent")
  await selectBackgroundMode("latent")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("latent")

  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-quick="latent-display"]')!).click()
  await expect.poll(() => probe.getAttribute("data-latent-display")).toBe("dithering")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-quick="latent-overlay"]')!).click()
  await expect.poll(() => probe.getAttribute("data-latent-overlay")).toBe("false")

  await selectBackgroundMode("url")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("url")
  expectRendererMode(fullscreen, "url")

  await selectBackgroundMode("monet")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("monet")
  expectRendererMode(fullscreen, "monet")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-quick="monet-layout"]')!).click()
  await expect.poll(() => probe.getAttribute("data-monet-layout")).toBe("half-pane-gradient")

  await selectBackgroundMode("nomand")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("nomand")
  expectRendererMode(fullscreen, "nomand")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-quick="nomand-overlay"]')!).click()
  await expect.poll(() => probe.getAttribute("data-nomand-overlay")).toBe("false")

  await selectBackgroundMode("common")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("common")
  expectRendererMode(fullscreen, "common")
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-background-quick="common-cover-color"]')!).click()
  await expect.poll(() => probe.getAttribute("data-cover-color")).toBe("true")

  await selectBackgroundMode("sora")
  await expect.poll(() => probe.getAttribute("data-background-mode")).toBe("sora")
  expectRendererMode(fullscreen, "sora")

  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-theme-action="animation-intensity"]')!).click()
  await expect.poll(() => probe.getAttribute("data-animation-intensity")).toBe("chaotic")

  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-theme-action="toggle-daylight"]')!).click()
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true)
  await expect.poll(() => probe.getAttribute("data-daylight")).toBe("false")
})

function FoliaBackgroundHarness() {
  const [preferences, setPreferences] = useState<FoliaPlayerPreferences>(DEFAULT_FOLIA_PLAYER_PREFERENCES)
  const { isDaylight, setDaylight } = useMelodeckThemeMode()

  return (
    <FoliaPlayerProvider
      tracks={tracks}
      onTracksChange={() => undefined}
      preferences={preferences}
      onPreferencesChange={setPreferences}
      theme={theme}
      isDaylight={isDaylight}
      onDaylightChange={setDaylight}
    >
      <main className="grid h-[720px] w-[1200px] grid-cols-2 gap-4 bg-background p-4 text-foreground">
        <FoliaUnifiedPanel initialTab="settings" />
        <FoliaFullscreenSurface brandLabel="Melodeck" />
        <FoliaBackgroundPreferencesProbe />
      </main>
    </FoliaPlayerProvider>
  )
}

function FoliaBackgroundPreferencesProbe() {
  const { isDaylight, preferences } = useFoliaPlayer()
  return (
    <output
      data-folia-background-preferences
      data-background-mode={preferences.background.mode}
      data-cover-color={String(preferences.background.common?.useCoverColorBg ?? false)}
      data-latent-display={preferences.background.latent?.tuning?.displayMode ?? "both"}
      data-latent-overlay={String(preferences.background.latent?.tuning?.overlayEnabled ?? true)}
      data-monet-layout={preferences.background.monet?.tuning?.backgroundLayout ?? "full-overlay"}
      data-nomand-overlay={String(preferences.background.nomand?.tuning?.overlayEnabled ?? true)}
      data-url-count={String(preferences.background.url?.items?.length ?? 0)}
      data-url-first-note={preferences.background.url?.items?.[0]?.note ?? ""}
      data-url-first-value={preferences.background.url?.items?.[0]?.url ?? ""}
      data-url-selected={preferences.background.url?.selectedId ?? ""}
      data-animation-intensity={preferences.themeAnimationIntensity ?? "normal"}
      data-daylight={String(isDaylight)}
    />
  )
}

async function selectBackgroundMode(mode: "common" | "monet" | "nomand" | "latent" | "url" | "sora") {
  const controls = document.querySelector<HTMLElement>("[data-folia-background-quick-controls]")!
  await page.elementLocator(controls.querySelector<HTMLElement>('[aria-haspopup="listbox"]')!).click()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')][backgroundModes.indexOf(mode)]!
  await page.elementLocator(option).click()
}

async function openVisualizerSettings(fullscreen: HTMLElement) {
  const settingsButton = fullscreen.querySelector<HTMLElement>('[data-folia-surface="home"] svg.lucide-settings')?.closest<HTMLElement>("button")
  expect(settingsButton).not.toBeNull()
  await page.elementLocator(settingsButton!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(1)
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-settings-nav="visualizer"]')!).click()
  await expect.poll(() => document.querySelectorAll('[data-folia-settings-section="visualizer"]').length).toBe(1)
}

async function selectSettingsBackgroundMode(mode: "common" | "monet" | "nomand" | "latent" | "url" | "sora") {
  await page.elementLocator(document.querySelector<HTMLSelectElement>('[data-folia-background-mode-control="settings"]')!).selectOptions(mode)
}

async function manageUrlBackgroundList(probe: HTMLElement) {
  const settings = document.querySelector<HTMLElement>("[data-folia-background-url-settings]")!
  await page.elementLocator(settings.querySelector<HTMLElement>('[data-folia-background-url-action="add"]')!).click()
  await page.elementLocator(settings.querySelector<HTMLInputElement>('[data-folia-background-url-field="url"]')!).fill("https://example.com/background")
  await page.elementLocator(settings.querySelector<HTMLInputElement>('[data-folia-background-url-field="note"]')!).fill("First background")
  await page.elementLocator(settings.querySelector<HTMLElement>('[data-folia-background-url-action="save"]')!).click()
  await expect.poll(() => probe.getAttribute("data-url-count")).toBe("1")
  await expect.poll(() => probe.getAttribute("data-url-first-value")).toBe("https://example.com/background")
  await expect.poll(() => probe.getAttribute("data-url-selected")).not.toBe("")

  const item = settings.querySelector<HTMLElement>("[data-folia-background-url-item]")!
  await page.elementLocator(item.querySelector<HTMLElement>('[data-folia-background-url-action="select"]')!).click()
  await page.elementLocator(item.querySelector<HTMLElement>('[data-folia-background-url-action="edit"]')!).click()
  await page.elementLocator(item.querySelector<HTMLInputElement>('[data-folia-background-url-field="url"]')!).fill("https://example.com/updated")
  await page.elementLocator(item.querySelector<HTMLInputElement>('[data-folia-background-url-field="note"]')!).fill("Updated background")
  await page.elementLocator(item.querySelector<HTMLElement>('[data-folia-background-url-action="save"]')!).click()
  await expect.poll(() => probe.getAttribute("data-url-first-value")).toBe("https://example.com/updated")
  await expect.poll(() => probe.getAttribute("data-url-first-note")).toBe("Updated background")

  await page.elementLocator(item.querySelector<HTMLElement>('[data-folia-background-url-action="delete"]')!).click()
  await expect.poll(() => probe.getAttribute("data-url-count")).toBe("0")
  await expect.poll(() => probe.getAttribute("data-url-selected")).toBe("")
}

async function closeSettings() {
  const closeButton = document.querySelector<HTMLElement>('[data-folia-settings] > section > header svg.lucide-x')?.closest<HTMLElement>("button")
  expect(closeButton).not.toBeNull()
  await page.elementLocator(closeButton!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(0)
}

async function enterLyricsPlayer(fullscreen: HTMLElement) {
  const playerEntry = fullscreen.querySelector<HTMLElement>("[data-folia-player-entry]")!
  playerEntry.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("player")
}

function expectRendererMode(fullscreen: HTMLElement, mode: string) {
  expect(fullscreen.querySelector('[data-folia-background-mode]')?.getAttribute("data-folia-background-mode")).toBe(mode)
}

const backgroundModes = ["common", "monet", "nomand", "latent", "url", "sora"] as const

const theme = buildFoliaDualTheme(
  { background: "rgb(250, 250, 250)", foreground: "rgb(25, 25, 25)", accent: "rgb(0, 120, 110)", secondary: "rgb(90, 95, 100)", fontFamily: "Inter" },
  { background: "rgb(20, 20, 20)", foreground: "rgb(245, 245, 245)", accent: "rgb(80, 210, 190)", secondary: "rgb(160, 165, 170)", fontFamily: "Inter" },
)

const tracks: FoliaTrack[] = [{
  id: "background-track",
  src: "data:audio/wav;base64,UklGRgQAAABXQVZF",
  title: "Folia background test",
  artist: "Melodeck",
  coverUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%2300a896'/%3E%3C/svg%3E",
  lyrics: {
    lines: [{
      startTime: 0,
      endTime: 12,
      fullText: "A controlled background follows the player preference",
      words: [{ text: "A controlled background follows the player preference", startTime: 0, endTime: 12 }],
    }],
  },
}]
