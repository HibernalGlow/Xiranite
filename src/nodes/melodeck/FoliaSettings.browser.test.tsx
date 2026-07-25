import { expect, test } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useState } from "react"
import {
  buildFoliaDualTheme,
  DEFAULT_FOLIA_PLAYER_PREFERENCES,
  FoliaFullscreenSurface,
  FoliaPlayerProvider,
  useFoliaPlayer,
  type FoliaPlayerPreferences,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import "@hibernalglow/folia-player/styles.css"
import "@/i18n"

// src/nodes/melodeck/FoliaSettings.browser.test.tsx

test("migrates Folia lab settings and scopes the FPS limit to the lyrics player", async () => {
  const nativeRequestAnimationFrame = window.requestAnimationFrame
  const nativeCancelAnimationFrame = window.cancelAnimationFrame

  await render(<FoliaSettingsHarness />)

  const fullscreen = document.querySelector<HTMLElement>('[data-folia-surface="fullscreen"]')!
  expect(fullscreen.getAttribute("data-folia-view")).toBe("home")
  expect(window.requestAnimationFrame).toBe(nativeRequestAnimationFrame)

  await openLabSettings(fullscreen)
  const switches = [...document.querySelectorAll<HTMLElement>('[data-folia-settings-section="lab"] [role="switch"]')]
  const visibilityOptions = [...document.querySelectorAll<HTMLElement>('[data-folia-settings-section="lab"] [role="checkbox"]')]
  expect(switches).toHaveLength(5)
  expect(visibilityOptions).toHaveLength(3)

  for (const control of switches) await page.elementLocator(control).click()
  for (const control of visibilityOptions) await page.elementLocator(control).click()
  await page.elementLocator(document.querySelector<HTMLInputElement>('[data-folia-settings-section="lab"] input[type="range"]')!).fill("0")

  const probe = document.querySelector<HTMLElement>("[data-folia-lab-preferences]")!
  await expect.poll(() => probe.getAttribute("data-static-mode")).toBe("true")
  expect(probe.getAttribute("data-home-background-disabled")).toBe("true")
  expect(probe.getAttribute("data-frame-rate")).toBe("60")
  expect(probe.getAttribute("data-hide-progress")).toBe("true")
  expect(probe.getAttribute("data-hide-translation")).toBe("true")
  expect(probe.getAttribute("data-hide-panel-button")).toBe("true")
  expect(probe.getAttribute("data-show-panel-close")).toBe("true")
  expect(probe.getAttribute("data-always-show-back")).toBe("true")
  expect(fullscreen.getAttribute("data-folia-static-mode")).toBe("true")
  expect(fullscreen.getAttribute("data-folia-home-background-static")).toBe("true")
  expect(fullscreen.getAttribute("data-folia-visualizer-frame-rate")).toBe("off")

  await closeSettings()
  await enterLyricsPlayer(fullscreen)

  expect(fullscreen.querySelectorAll('[data-folia-component="FloatingPlayerControls"]')).toHaveLength(0)
  expect(fullscreen.querySelector('[data-folia-panel-presentation="overlay"] svg.lucide-settings-2')).toBeNull()
  const backButton = fullscreen.querySelector<HTMLElement>('[data-folia-visualizer-layer] svg.lucide-chevron-left')?.closest<HTMLElement>("button")
  expect(backButton).not.toBeNull()
  await expect.poll(() => getComputedStyle(backButton!).pointerEvents).toBe("auto")
  expect(fullscreen.getAttribute("data-folia-visualizer-frame-rate")).toBe("60")
  expect(window.requestAnimationFrame).not.toBe(nativeRequestAnimationFrame)
  expect(window.cancelAnimationFrame).not.toBe(nativeCancelAnimationFrame)

  await page.elementLocator(backButton!).click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("home")
  await expect.poll(() => window.requestAnimationFrame).toBe(nativeRequestAnimationFrame)
  expect(window.cancelAnimationFrame).toBe(nativeCancelAnimationFrame)
  await expect.poll(() => fullscreen.querySelectorAll('[data-folia-component="FloatingPlayerControls"]').length).toBe(1)

  await openLabSettings(fullscreen)
  const panelVisibilityOption = document.querySelectorAll<HTMLElement>('[data-folia-settings-section="lab"] [role="checkbox"]')[2]!
  await page.elementLocator(panelVisibilityOption).click()
  await expect.poll(() => probe.getAttribute("data-hide-panel-button")).toBe("false")
  await closeSettings()
  await enterLyricsPlayer(fullscreen)

  const panelToggle = fullscreen.querySelector<HTMLElement>('[data-folia-panel-presentation="overlay"] svg.lucide-settings-2')?.closest<HTMLElement>("button")
  expect(panelToggle).not.toBeNull()
  await page.elementLocator(panelToggle!).click()
  await expect.poll(() => fullscreen.querySelectorAll("[data-folia-panel-card]").length).toBe(1)
  const panelClose = fullscreen.querySelector<HTMLElement>('[data-folia-panel-presentation="overlay"] svg.lucide-x')?.closest<HTMLElement>("button")
  expect(panelClose).not.toBeNull()
  await page.elementLocator(panelClose!).click()
  await expect.poll(() => fullscreen.querySelectorAll("[data-folia-panel-card]").length).toBe(0)

  const finalBackButton = fullscreen.querySelector<HTMLElement>('[data-folia-visualizer-layer] svg.lucide-chevron-left')?.closest<HTMLElement>("button")
  await page.elementLocator(finalBackButton!).click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("home")
  await expect.poll(() => window.requestAnimationFrame).toBe(nativeRequestAnimationFrame)
})

function FoliaSettingsHarness() {
  const [preferences, setPreferences] = useState<FoliaPlayerPreferences>(DEFAULT_FOLIA_PLAYER_PREFERENCES)

  return (
    <FoliaPlayerProvider
      tracks={tracks}
      onTracksChange={() => undefined}
      preferences={preferences}
      onPreferencesChange={setPreferences}
      theme={theme}
      isDaylight
    >
      <div className="h-[720px] w-[1200px] bg-background text-foreground">
        <FoliaFullscreenSurface brandLabel="Meloddeck" />
        <FoliaLabPreferencesProbe />
      </div>
    </FoliaPlayerProvider>
  )
}

function FoliaLabPreferencesProbe() {
  const { preferences } = useFoliaPlayer()
  return (
    <output
      data-folia-lab-preferences
      data-static-mode={String(preferences.staticMode)}
      data-home-background-disabled={String(preferences.disableHomeDynamicBackground)}
      data-frame-rate={String(preferences.visualizerFrameRate)}
      data-hide-progress={String(preferences.hidePlayerProgressBar)}
      data-hide-translation={String(preferences.hidePlayerTranslationSubtitle)}
      data-hide-panel-button={String(preferences.hidePlayerRightPanelButton)}
      data-show-panel-close={String(preferences.showOpenPanelCloseButton)}
      data-always-show-back={String(preferences.alwaysShowPlayerBackButton)}
    />
  )
}

async function openLabSettings(fullscreen: HTMLElement) {
  const settingsButton = fullscreen.querySelector<HTMLElement>('[data-folia-surface="home"] svg.lucide-settings')?.closest<HTMLElement>("button")
  expect(settingsButton).not.toBeNull()
  await page.elementLocator(settingsButton!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(1)
  await page.elementLocator(document.querySelector<HTMLElement>('[data-folia-settings-nav="lab"]')!).click()
  await expect.poll(() => document.querySelectorAll('[data-folia-settings-section="lab"]').length).toBe(1)
}

async function closeSettings() {
  const closeButton = document.querySelector<HTMLElement>('[data-folia-settings] > section > header svg.lucide-x')?.closest<HTMLElement>("button")
  expect(closeButton).not.toBeNull()
  await page.elementLocator(closeButton!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(0)
}

async function enterLyricsPlayer(fullscreen: HTMLElement) {
  const playerEntry = fullscreen.querySelector<HTMLElement>("[data-folia-player-entry]")
  expect(playerEntry).not.toBeNull()
  playerEntry!.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("player")
}

const theme = buildFoliaDualTheme(
  { background: "rgb(250, 250, 250)", foreground: "rgb(25, 25, 25)", accent: "rgb(0, 120, 110)", secondary: "rgb(90, 95, 100)", fontFamily: "Inter" },
  { background: "rgb(20, 20, 20)", foreground: "rgb(245, 245, 245)", accent: "rgb(80, 210, 190)", secondary: "rgb(160, 165, 170)", fontFamily: "Inter" },
)

const tracks: FoliaTrack[] = [{
  id: "track-1",
  src: "data:audio/wav;base64,UklGRgQAAABXQVZF",
  title: "Folia settings test",
  artist: "Meloddeck",
  lyrics: {
    lines: [{
      startTime: 0,
      endTime: 12,
      fullText: "The player remains responsive",
      translation: "播放器保持响应",
      words: [{ text: "The player remains responsive", startTime: 0, endTime: 12 }],
    }],
  },
}]
