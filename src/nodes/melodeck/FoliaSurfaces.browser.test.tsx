import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  buildFoliaDualTheme,
  FoliaBarSurface,
  FoliaPlayerProvider,
  FoliaRemoteSurface,
  FoliaUnifiedPanel,
  useFoliaPlayer,
  type FoliaLoopMode,
  type FoliaPlayerHostAdapter,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import { MelodeckFoliaNodeSurface } from "./Component"
import { foliaMelodeckHost } from "./foliaHost"
import { resolveFoliaCssColor } from "./foliaTheme"
import { useWorkspaceStore } from "@/store/workspaceStore"
import {
  WorkspaceMelodeckPanel,
  WorkspaceMelodeckProvider,
  WorkspaceMelodeckTopBarSlot,
  useWorkspaceMelodeck,
} from "@/components/workspace/WorkspaceMelodeck"
import hostI18n from "@/i18n"
import "@hibernalglow/folia-player/styles.css"

afterEach(() => {
  useWorkspaceStore.getState().setChromePosition("right")
})

test("keeps Xiranite translations intact after loading Folia surfaces", () => {
  expect(hostI18n.t("common:appName")).toBe("XIRANITE")
  expect(hostI18n.t("view:cards.openRegistry")).not.toBe("view:cards.openRegistry")
})

test("resolves Xiranite CSS variables to shader-compatible colors", () => {
  const root = document.documentElement
  const previous = root.style.getPropertyValue("--melodeck-test-color")
  root.style.setProperty("--melodeck-test-color", "oklch(0.6 0.12 210)")
  try {
    expect(resolveFoliaCssColor("var(--melodeck-test-color)", "#000000")).toMatch(/^rgba\(/)
  } finally {
    if (previous) root.style.setProperty("--melodeck-test-color", previous)
    else root.style.removeProperty("--melodeck-test-color")
  }
})

test("loads the browser metadata host through Vite's CommonJS compatibility graph", () => {
  expect(foliaMelodeckHost.hydrateTrack).toBeTypeOf("function")
})

test("keeps Folia actions stable when a workspace bridge writes playback state", async () => {
  await render(<FoliaActionBridgeHarness />)

  expect(document.querySelector("[data-folia-bridge]")?.textContent).toBe("track-1")
})

test("expands the original topbar island around Folia Remote and a floating more menu", async () => {
  await render(<WorkspaceMelodeckTopBarHarness />)

  const island = document.querySelector<HTMLElement>('[data-melodeck-island-state="collapsed"]')
  expect(island).not.toBeNull()
  expect(island?.getAttribute("data-melodeck-island-variant")).toBe("full")
  const collapsedShell = island!.querySelector<HTMLElement>("[data-melodeck-island-collapsed-shell]")
  expect(collapsedShell).not.toBeNull()
  expect(island?.hasAttribute("data-melodeck-artwork-tint")).toBe(false)
  expect(getComputedStyle(collapsedShell!).backgroundColor).toBe("rgba(250, 249, 246, 0.95)")
  document.documentElement.classList.add("dark")
  await expect.poll(() => getComputedStyle(collapsedShell!).backgroundColor).toBe("rgba(9, 9, 11, 0.95)")
  document.documentElement.classList.remove("dark")
  await expect.poll(() => getComputedStyle(collapsedShell!).backgroundColor).toBe("rgba(250, 249, 246, 0.95)")
  expect(getComputedStyle(document.querySelector<HTMLElement>("#melodeck-topbar-island-full")!).borderTopWidth).toBe("0px")
  expect(getComputedStyle(document.querySelector<HTMLElement>("#melodeck-topbar-island-full")!).boxShadow).not.toMatch(/(?:8|24)px/)
  const collapsedWidth = island!.getBoundingClientRect().width

  await page.getByRole("button", { name: "展开音乐灵动岛" }).click()

  await expect.poll(() => island?.getAttribute("data-melodeck-island-state")).toBe("expanded")
  const expandedContent = island!.querySelector<HTMLElement>("[data-melodeck-island-expanded-content]")
  const morphShell = island!.querySelector<HTMLElement>("[data-melodeck-island-morph-shell]")
  const morphSummary = island!.querySelector<HTMLElement>("[data-melodeck-island-morph-summary]")
  expect(expandedContent).not.toBeNull()
  expect(morphShell).not.toBeNull()
  expect(morphSummary).not.toBeNull()
  expect(island!.querySelector("[data-melodeck-island-collapsed-shell]")).toBeNull()
  expect(Number.parseFloat(getComputedStyle(morphShell!).opacity)).toBeGreaterThan(0)
  expect(getComputedStyle(morphShell!).borderTopWidth).toBe("0px")
  expect(getComputedStyle(morphShell!).boxShadow).toBe("none")
  expect(Number.parseFloat(getComputedStyle(morphSummary!).opacity)).toBeGreaterThan(0)
  expect(Number.parseFloat(getComputedStyle(expandedContent!).opacity)).toBeLessThan(1)
  await expect.poll(() => getComputedStyle(morphSummary!).opacity).toBe("0")
  await expect.poll(() => getComputedStyle(morphShell!).opacity).toBe("0")
  await expect.poll(() => getComputedStyle(expandedContent!).opacity).toBe("1")
  await expect.poll(() => island!.getBoundingClientRect().width).toBeGreaterThan(collapsedWidth + 150)
  expect(island!.querySelectorAll('[data-folia-surface="remote"]')).toHaveLength(1)
  expect(island!.querySelector("[data-melodeck-island-bottom-bar]")).toBeNull()
  expect(getComputedStyle(island!.parentElement!).borderBottomWidth).toBe("0px")
  const remotePlay = island!.querySelector<HTMLButtonElement>('[data-folia-remote-control="play-pause"]')
  const remotePrevious = island!.querySelector<HTMLButtonElement>('[data-folia-remote-control="previous"]')
  expect(remotePlay?.style.backgroundColor).toBe("var(--primary)")
  expect(remotePlay?.style.color).toBe("var(--primary-foreground)")
  expect(remotePrevious?.style.backgroundColor).toBe("var(--accent)")
  expect(remotePrevious?.style.color).toBe("var(--accent-foreground)")

  const moreButton = page.getByRole("button", { name: "更多播放选项" })
  await expect.element(moreButton).toBeVisible()
  expect(document.querySelectorAll("[data-melodeck-visualizer-preview]")).toHaveLength(0)
  await moreButton.click()
  const waveformMenu = page.getByRole("menuitem", { name: "调整波形" })
  await expect.element(waveformMenu).toBeVisible()
  await waveformMenu.hover()
  const gridVisualizer = page.getByRole("menuitemradio", { name: "Grid", exact: true })
  await expect.element(gridVisualizer).toBeVisible()
  await expect.element(page.getByRole("menuitemradio", { name: "无波形", exact: true })).toBeVisible()
  expect(document.querySelectorAll("[data-melodeck-visualizer-preview]").length).toBeGreaterThan(10)
  await gridVisualizer.click()
  await expect.poll(() => island!.querySelector("[data-melodeck-visualizer-style]")?.getAttribute("data-melodeck-visualizer-style")).toBe("Grid")
  await expect.poll(() => document.querySelectorAll("[data-melodeck-visualizer-preview]").length).toBe(0)

  await moreButton.click()
  await page.getByRole("menuitem", { name: "调整波形" }).hover()
  await page.getByRole("menuitemradio", { name: "无波形", exact: true }).click()
  await expect.poll(() => island!.querySelector("[data-melodeck-visualizer-style]")?.getAttribute("data-melodeck-visualizer-style")).toBe("None")
  expect(island!.querySelector("[data-melodeck-island-spectrum]")).toBeNull()

  const inlineActions = island!.querySelector<HTMLElement>("[data-melodeck-island-actions]")!
  expect(inlineActions.querySelectorAll(":scope > button, :scope > [data-slot=dropdown-menu-trigger]")).toHaveLength(5)
  for (const button of inlineActions.querySelectorAll<HTMLElement>("button")) {
    expect(button.getBoundingClientRect().width).toBe(20)
    expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  }

  await moreButton.click()
  const moreMenu = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"][data-melodeck-island-menu]')
  expect(moreMenu).not.toBeNull()
  expect(getComputedStyle(moreMenu!).zIndex).toBe("10000")
  const firstMenuItem = moreMenu!.querySelector<HTMLElement>('[role="menuitem"]')!
  const firstMenuItemRect = firstMenuItem.getBoundingClientRect()
  expect(document.elementFromPoint(
    firstMenuItemRect.left + firstMenuItemRect.width / 2,
    firstMenuItemRect.top + firstMenuItemRect.height / 2,
  )?.closest('[data-melodeck-island-menu]')).toBe(moreMenu)
  expect(moreMenu!.querySelector('[role="menuitem"][aria-label="固定到底栏"]')).toBeNull()
  const followFullscreen = moreMenu!.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!
  const stateProbe = document.querySelector<HTMLElement>("[data-melodeck-state-probe]")!
  expect(followFullscreen.textContent).toContain("全屏时同步打开浮窗")
  expect(followFullscreen.getAttribute("aria-checked")).toBe("false")
  expect(stateProbe.getAttribute("data-follow-fullscreen-with-floating")).toBe("false")
  followFullscreen.click()
  await expect.poll(() => stateProbe.getAttribute("data-follow-fullscreen-with-floating")).toBe("true")

  if (!document.body.contains(followFullscreen)) {
    island!.querySelector<HTMLButtonElement>('button[data-melodeck-island-menu]')!.click()
  }
  document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!.click()
  await expect.poll(() => stateProbe.getAttribute("data-follow-fullscreen-with-floating")).toBe("false")

  island!.querySelector<HTMLButtonElement>('button[aria-label="进入标准全屏"]')!.click()
  await expect.poll(() => island?.getAttribute("data-melodeck-island-state")).toBe("collapsed")
  await expect.poll(() => stateProbe.getAttribute("data-collapsed")).toBe("true")
  expect(island!.querySelectorAll('[data-folia-surface="remote"]')).toHaveLength(0)
})

test("renders populated Folia projections around one shared audio element", async () => {
  await render(<FoliaSurfaceHarness />)

  expect(document.querySelectorAll("audio.folia-player-audio")).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-surface="remote"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-surface="bar"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-surface="unified"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-remote-mode="embedded"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-component="FloatingPlayerControls"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-component="UnifiedPanel"]')).toHaveLength(1)

  const remote = document.querySelector<HTMLElement>('[data-folia-remote-mode="embedded"]')!
  expect(remote.textContent).toContain("焚蝶")
  expect(remote.textContent).toContain("铁痕电台")
  expect(getComputedStyle(remote).fontFamily).toContain("Inter")

  const upstreamCover = [...remote.querySelectorAll<HTMLElement>("div")]
    .find((element) => element.classList.contains("h-[112px]") && element.classList.contains("w-[112px]"))
  expect(upstreamCover).toBeDefined()
  expect(upstreamCover!.getBoundingClientRect().width).toBe(112)
  expect(upstreamCover!.getBoundingClientRect().height).toBe(112)
  expect(upstreamCover!.querySelector<HTMLElement>('[style*="background-image"]')?.style.backgroundImage).toContain("data:image/png")

  const renderedText = document.body.textContent ?? ""
  expect(renderedText).not.toContain("localMusic.title")
  expect(renderedText).not.toContain("options.playback")
  expect(renderedText).not.toContain("remote.next")

  for (const surface of document.querySelectorAll<HTMLElement>("[data-folia-surface]")) {
    expect(surface.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(surface.getBoundingClientRect().height).toBeGreaterThan(0)
  }

  const remoteNext = remote.querySelector("svg.lucide-skip-forward")?.closest("button")
  expect(remoteNext).not.toBeNull()
  await page.elementLocator(remoteNext!).click()
  await expect.poll(() => remote.textContent).toContain("微光")
})

test("uses the Folia card and bar as direct draggable workspace projections", async () => {
  useWorkspaceStore.getState().setChromePosition("island")
  await render(<WorkspaceMelodeckProjectionHarness />)

  await expect.poll(() => document.querySelector('[data-melodeck="panel"]')?.getAttribute("data-melodeck-projection")).toBe("direct")
  const panel = document.querySelector<HTMLElement>('[data-melodeck="panel"]')!
  await expect.poll(() => panel.getAttribute("data-melodeck-mode")).toBe("floating")
  await expect.poll(() => panel.querySelectorAll(':scope > [data-folia-surface="unified"]').length).toBe(1)
  expect(panel.querySelector('[data-melodeck-part="ambient-layer"]')).toBeNull()
  expect(panel.querySelector(':scope > .xiranite-app-region-no-drag')).toBeNull()
  expect(panel.querySelector('[data-folia-component="UnifiedPanel"]')?.getAttribute("data-folia-embedded")).toBe("true")
  expect(panel.getAttribute("data-melodeck-direct-drag")).toBe("true")
  const unifiedSurface = panel.querySelector<HTMLElement>(':scope > [data-folia-surface="unified"]')!
  expect(getComputedStyle(unifiedSurface).overflow).toBe("visible")
  expect(getComputedStyle(unifiedSurface).backgroundColor).toBe("rgba(0, 0, 0, 0)")

  const dragRegion = panel.querySelector<HTMLElement>('[data-melodeck-part="toolbar-drag-region"]')!
  const dragHandle = panel.querySelector<HTMLElement>('[data-melodeck-part="drag-handle"]')!
  const panelRect = panel.getBoundingClientRect()
  expect(dragRegion.getBoundingClientRect().width).toBe(panelRect.width)
  expect(dragRegion.getBoundingClientRect().height).toBe(40)
  expect(getComputedStyle(dragRegion).cursor).toBe("grab")
  expect(getComputedStyle(dragHandle).cursor).toBe("grab")
  expect(panel.querySelector('[data-melodeck-part="surface-chrome"]')).not.toBeNull()
  expect(panel.querySelector('button[data-action-key="collapse"]')).not.toBeNull()
  expect(panel.querySelector('button[data-action-key="bottom"]')).not.toBeNull()
  expect(panel.querySelector('button[data-action-key="fullscreen"]')).not.toBeNull()
  expect(panel.querySelector('button[data-action-key="hide"]')).not.toBeNull()

  const sharedAudio = document.querySelector("audio.folia-player-audio")
  expect(sharedAudio).not.toBeNull()
  expect(document.querySelectorAll("audio.folia-player-audio")).toHaveLength(1)

  panel.querySelector<HTMLButtonElement>('button[data-action-key="collapse"]')!.click()
  await expect.poll(() => panel.getBoundingClientRect().width).toBeLessThanOrEqual(48)
  expect(panel.querySelector('[data-melodeck-part="surface-chrome"]')).toBeNull()
  const progressRing = panel.querySelector<SVGElement>("[data-folia-toggle-progress]")
  expect(progressRing).not.toBeNull()
  const reopenButton = progressRing!.parentElement!.querySelector<HTMLButtonElement>("button")
  expect(reopenButton).not.toBeNull()
  reopenButton!.click()
  await expect.poll(() => panel.getBoundingClientRect().width).toBeGreaterThanOrEqual(300)
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)

  panel.querySelector<HTMLButtonElement>('button[data-action-key="bottom"]')!.click()
  await expect.poll(() => panel.getAttribute("data-melodeck-mode")).toBe("bottom")
  expect(panel.hasAttribute("data-melodeck-direct-drag")).toBe(false)
  await expect.poll(() => panel.querySelectorAll(':scope > [data-folia-surface="bar"]').length).toBe(1)
  expect(panel.querySelector('[data-melodeck-part="ambient-layer"]')).toBeNull()
  expect(panel.querySelector(':scope > .xiranite-app-region-no-drag')).toBeNull()
  expect(panel.querySelector('[data-melodeck-part="toolbar-drag-region"]')).toBeNull()
  const bottomChrome = panel.querySelector<HTMLElement>('[data-melodeck-part="surface-chrome"]')
  expect(bottomChrome).not.toBeNull()
  expect(bottomChrome?.getAttribute("data-melodeck-bottom-chrome")).toBe("true")
  const idleIndicator = bottomChrome!.querySelector<HTMLElement>("[data-node-chrome-idle-indicator]")
  expect(idleIndicator).not.toBeNull()
  expect(getComputedStyle(idleIndicator!).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  expect(getComputedStyle(idleIndicator!).boxShadow).toBe("none")
  const bottomToolbar = bottomChrome!.querySelector<HTMLElement>('[role="toolbar"]')
  expect(bottomToolbar).not.toBeNull()
  bottomToolbar!.parentElement!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))
  await expect.poll(() => getComputedStyle(
    panel.querySelector<HTMLElement>('[role="toolbar"]')!,
  ).backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
  await expect.poll(() => panel.getBoundingClientRect().height).toBe(96)
  await expect.poll(() => panel.getBoundingClientRect().width).toBeLessThanOrEqual(576)
  expect(getComputedStyle(panel).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)
})

test("does not mount the Folia audio element while the legacy engine is active", async () => {
  await render(
    <FoliaPlayerProvider tracks={tracks} onTracksChange={vi.fn()} enabled={false}>
      <div data-legacy-engine />
    </FoliaPlayerProvider>,
  )
  expect(document.querySelectorAll("audio.folia-player-audio")).toHaveLength(0)
})

test("restores the last track paused and preloads the remaining album covers", async () => {
  const hydrateTrack = vi.fn(async (track: FoliaTrack) => ({
    coverUrl: `full-cover://${track.id}`,
    lyrics: { lines: [] },
  }))
  const hydrateTrackPreview = vi.fn(async (track: FoliaTrack) => ({
    coverUrl: `preview-cover://${track.id}`,
  }))
  const onActiveTrackChange = vi.fn()

  await render(
    <FoliaHydrationRestoreHarness
      host={{ hydrateTrack, hydrateTrackPreview }}
      onActiveTrackChange={onActiveTrackChange}
    />,
  )

  const probe = document.querySelector<HTMLElement>("[data-folia-hydration-restore]")!
  await expect.poll(() => probe.getAttribute("data-active-track-id")).toBe("track-2")
  await expect.poll(() => probe.getAttribute("data-cover-ready-ids"), { timeout: 3_000 }).toBe("track-1,track-2")
  expect(probe.getAttribute("data-is-playing")).toBe("false")
  expect(hydrateTrack).toHaveBeenCalledTimes(1)
  expect(hydrateTrack).toHaveBeenCalledWith(
    expect.objectContaining({ id: "track-2" }),
    expect.any(AbortSignal),
  )
  expect(hydrateTrackPreview).toHaveBeenCalledTimes(1)
  expect(hydrateTrackPreview).toHaveBeenCalledWith(
    expect.objectContaining({ id: "track-1" }),
    expect.any(AbortSignal),
  )
  expect(onActiveTrackChange).not.toHaveBeenCalled()
  expect(document.querySelectorAll("audio.folia-player-audio")).toHaveLength(1)
})

test("keeps the original Folia app across node container sizes without recreating audio", async () => {
  await render(<ResponsiveFoliaSurfaceHarness />)

  await expect.poll(() => document.querySelector('[data-melodeck-folia-view]')?.getAttribute("data-melodeck-folia-view")).toBe("app")
  await expect.poll(() => document.querySelectorAll('[data-folia-surface="fullscreen"]').length).toBe(1)
  expect(document.querySelectorAll('[data-folia-surface="unified"]')).toHaveLength(0)
  const fullscreen = document.querySelector<HTMLElement>('[data-folia-surface="fullscreen"]')!
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("home")
  await expect.poll(() => document.querySelectorAll('[data-folia-component="Grid3D"]').length).toBe(1)
  expect(fullscreen.querySelector('[data-folia-visualizer-layer]')?.getAttribute("data-folia-visualizer-text")).toBe("false")
  expect(getComputedStyle(fullscreen.querySelector<HTMLElement>('[data-folia-visualizer-layer]')!).visibility).toBe("visible")
  expect(fullscreen.querySelector("[data-folia-home-brand]")?.textContent?.trim()).toBe("Meloddeck")
  expect(document.querySelectorAll("[data-folia-home-tab]")).toHaveLength(0)

  const homeSettingsButton = fullscreen.querySelector("svg.lucide-settings")?.closest("button")
  expect(homeSettingsButton).not.toBeNull()
  await page.elementLocator(homeSettingsButton!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(1)
  const metadataSwitch = document.querySelector<HTMLElement>('[data-folia-settings] [role="switch"]')!
  expect(metadataSwitch.getAttribute("aria-checked")).toBe("false")
  await page.elementLocator(metadataSwitch).click()
  await expect.poll(() => metadataSwitch.getAttribute("aria-checked")).toBe("true")
  await expect.poll(() => document.querySelector("[data-folia-responsive-queue]")?.getAttribute("data-background-metadata")).toBe("true")
  const closeSettings = document.querySelector("[data-folia-settings] svg.lucide-x")?.closest("button")
  expect(closeSettings).not.toBeNull()
  await page.elementLocator(closeSettings!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-settings]").length).toBe(0)

  await expect.poll(() => document.querySelectorAll(".theme-polaroid-card").length).toBeGreaterThan(0)
  await expect.poll(() => {
    const searchRect = document.querySelector<HTMLElement>('[data-folia-component="Grid3D"] input[type="text"]')!.getBoundingClientRect()
    const controlsTop = Math.min(...[...document.querySelectorAll<HTMLElement>("[data-folia-grid-controls]")]
      .map((controls) => controls.getBoundingClientRect().top))
    return controlsTop - searchRect.bottom
  }).toBeGreaterThanOrEqual(12)
  expect(homeControlGroupsHaveGap()).toBe(true)

  const importFolder = fullscreen.querySelector<HTMLElement>('[data-folia-grid-action="import-folder"]')
  expect(importFolder).not.toBeNull()
  await page.elementLocator(importFolder!).click()
  const queueProbe = document.querySelector<HTMLElement>("[data-folia-responsive-queue]")!
  await expect.poll(() => queueProbe.getAttribute("data-library-roots")).toBe("D:/Music")
  await expect.poll(() => responsiveScanLibraryRoots).toHaveBeenCalledTimes(1)

  await page.elementLocator(importFolder!).click()
  await expect.poll(() => responsiveScanLibraryRoots).toHaveBeenCalledTimes(2)
  expect(responsiveScanLibraryRoots).toHaveBeenLastCalledWith(["D:/Music"], expect.any(AbortSignal))
  expect(queueProbe.getAttribute("data-track-order")).toBe("track-1,track-2")

  const sharedAudio = document.querySelector("audio.folia-player-audio")
  expect(sharedAudio).not.toBeNull()

  await page.getByRole("button", { name: "Use spacious player size" }).click()

  await expect.poll(() => document.querySelector('[data-melodeck-folia-view]')?.getAttribute("data-melodeck-folia-view")).toBe("app")
  await expect.poll(() => document.querySelectorAll('[data-folia-surface="fullscreen"]').length).toBe(1)
  expect(document.querySelectorAll('[data-folia-surface="unified"]')).toHaveLength(0)
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)
  expect(fullscreen.getAttribute("data-folia-view")).toBe("home")
  expect(document.querySelectorAll('[data-folia-component="FloatingPlayerControls"]')).toHaveLength(1)
  await expect.poll(() => {
    const searchRect = document.querySelector<HTMLElement>('[data-folia-component="Grid3D"] input[type="text"]')!.getBoundingClientRect()
    const controlsTop = Math.min(...[...document.querySelectorAll<HTMLElement>("[data-folia-grid-controls]")]
      .map((controls) => controls.getBoundingClientRect().top))
    return controlsTop - searchRect.bottom
  }).toBeGreaterThanOrEqual(12)
  expect(homeControlGroupsHaveGap()).toBe(true)

  const openMap = document.querySelector('[data-folia-component="Grid3D"] svg.lucide-map')?.closest("button")
  expect(openMap).not.toBeNull()
  const mapButtonRect = openMap!.getBoundingClientRect()
  const mapButtonHitTarget = document.elementFromPoint(
    mapButtonRect.left + mapButtonRect.width / 2,
    mapButtonRect.top + mapButtonRect.height / 2,
  )
  expect(mapButtonHitTarget?.closest("button")).toBe(openMap)
  await page.elementLocator(openMap!).click()
  await expect.poll(() => document.querySelectorAll('[data-folia-component="GridMap"]').length).toBe(1)

  const allSongsMapItem = document.querySelector<HTMLElement>('[data-folia-grid-map-item-id="folder-__all-songs__"]')
  expect(allSongsMapItem).not.toBeNull()
  await page.elementLocator(allSongsMapItem!).click()
  await expect.poll(() => document.querySelectorAll('[data-folia-component="GridMap"]').length).toBe(0)

  const allSongsCard = document.querySelector<HTMLElement>('[data-folia-grid3d-item-id="folder-__all-songs__"]')
  expect(allSongsCard).not.toBeNull()
  await page.elementLocator(allSongsCard!).click()
  await expect.poll(() => document.querySelectorAll("[data-folia-grid-item-id]").length).toBeGreaterThanOrEqual(2)

  const secondTrack = document.querySelectorAll<HTMLElement>("[data-folia-grid-item-id]")[1]
  expect(secondTrack).toBeDefined()
  await page.elementLocator(secondTrack!).click()
  const secondTrackPlay = secondTrack!.querySelector<HTMLButtonElement>("[data-folia-grid-play-track-id]")
  expect(secondTrackPlay).not.toBeNull()
  await expect.poll(() => getComputedStyle(secondTrackPlay!).pointerEvents).toBe("auto")
  await page.elementLocator(secondTrackPlay!).click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-active-track-id")).toBe("track-2")

  const originalPlayerBar = document.querySelector<HTMLElement>('[data-folia-component="FloatingPlayerControls"]')
  const playerEntry = originalPlayerBar?.querySelector<HTMLElement>("[data-folia-player-entry]")
  expect(playerEntry).not.toBeNull()
  playerEntry!.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("player")
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)

  const fullscreenPanel = fullscreen.querySelector<HTMLElement>('[data-folia-panel-presentation="overlay"]')
  expect(fullscreenPanel).not.toBeNull()
  const fullscreenPanelToggle = fullscreenPanel!.querySelector("svg.lucide-settings-2")?.closest("button")
  expect(fullscreenPanelToggle).not.toBeNull()
  await page.elementLocator(fullscreenPanelToggle!).click()
  await expect.poll(() => fullscreenPanel!.querySelectorAll("[data-folia-panel-card]").length).toBe(1)

  await page.elementLocator(fullscreenPanel!.querySelector<HTMLElement>('[data-folia-panel-tab="queue"]')!).click()
  await expect.poll(() => fullscreenPanel!.querySelectorAll("[data-folia-queue-shuffle]").length).toBe(1)
  expect(queueProbe.getAttribute("data-track-order")).toBe("track-1,track-2")
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0)
  try {
    await page.elementLocator(fullscreenPanel!.querySelector<HTMLElement>("[data-folia-queue-shuffle]")!).click()
  } finally {
    randomSpy.mockRestore()
  }
  await expect.poll(() => queueProbe.getAttribute("data-track-order")).toBe("track-2,track-1")
  expect(queueProbe.getAttribute("data-active-track-id")).toBe("track-2")
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)

  const panelHomeButton = fullscreenPanel!.querySelector("svg.lucide-house")?.closest("button")
  expect(panelHomeButton).not.toBeNull()
  panelHomeButton!.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("home")
  expect(fullscreen.querySelectorAll('[data-folia-panel-presentation="overlay"]')).toHaveLength(0)

  playerEntry!.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("player")

  const backToHome = fullscreen.querySelector("svg.lucide-chevron-left")?.closest("button")
  expect(backToHome).not.toBeNull()
  await page.elementLocator(backToHome!).click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("home")

  playerEntry!.click()
  await expect.poll(() => fullscreen.getAttribute("data-folia-view")).toBe("player")

  await page.getByRole("button", { name: "Use compact player size" }).click()

  await expect.poll(() => document.querySelector('[data-melodeck-folia-view]')?.getAttribute("data-melodeck-folia-view")).toBe("app")
  expect(document.querySelectorAll('[data-folia-panel-presentation="overlay"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-folia-surface="fullscreen"]')).toHaveLength(1)
  expect(fullscreen.getAttribute("data-folia-view")).toBe("player")
  expect(fullscreen.getAttribute("data-folia-active-track-id")).toBe("track-2")
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)

  await page.elementLocator(originalPlayerBar!).hover()
  await expect.poll(() => originalPlayerBar!.querySelectorAll("[data-folia-loop-mode]").length).toBe(1)
  const loopModeButton = originalPlayerBar!.querySelector<HTMLElement>("[data-folia-loop-mode]")!
  expect(loopModeButton.getAttribute("data-folia-loop-mode")).toBe("all")
  await page.elementLocator(loopModeButton).click()
  await expect.poll(() => loopModeButton.getAttribute("data-folia-loop-mode")).toBe("one")
  await page.elementLocator(loopModeButton).click()
  await expect.poll(() => loopModeButton.getAttribute("data-folia-loop-mode")).toBe("random")
  expect(loopModeButton.querySelector("svg.lucide-shuffle")).not.toBeNull()
  expect(queueProbe.getAttribute("data-loop-mode")).toBe("random")

  const randomPlaybackSpy = vi.spyOn(Math, "random").mockReturnValue(0)
  try {
    sharedAudio!.dispatchEvent(new Event("ended"))
    await expect.poll(() => fullscreen.getAttribute("data-folia-active-track-id")).toBe("track-1")
  } finally {
    randomPlaybackSpy.mockRestore()
  }
  expect(document.querySelector("audio.folia-player-audio")).toBe(sharedAudio)
})

function FoliaSurfaceHarness() {
  return (
    <FoliaPlayerProvider
      tracks={tracks}
      onTracksChange={vi.fn()}
      theme={theme}
      isDaylight
    >
      <main className="grid min-h-screen grid-rows-[180px_120px_420px] gap-4 bg-background p-6 text-foreground">
        <FoliaRemoteSurface idleLyricsDelayMs={60_000} />
        <FoliaBarSurface />
        <FoliaUnifiedPanel />
      </main>
    </FoliaPlayerProvider>
  )
}

function WorkspaceMelodeckTopBarHarness() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative flex h-64 w-full justify-end bg-background text-foreground">
        <WorkspaceMelodeckProvider>
          <WorkspaceMelodeckTopBarTintSetup />
          <WorkspaceMelodeckStateProbe />
          <WorkspaceMelodeckTopBarSlot />
        </WorkspaceMelodeckProvider>
      </div>
    </QueryClientProvider>
  )
}

function WorkspaceMelodeckStateProbe() {
  const dock = useWorkspaceMelodeck()
  return (
    <output
      data-melodeck-state-probe
      data-collapsed={String(dock.collapsed)}
      data-follow-fullscreen-with-floating={String(dock.followFullscreenWithFloating)}
    />
  )
}

function WorkspaceMelodeckTopBarTintSetup() {
  const { setPlaybackState } = useWorkspaceMelodeck()

  useEffect(() => {
    setPlaybackState({
      hasTrack: true,
      isPlaying: true,
      trackCount: 1,
      currentTime: 44,
      duration: 296,
      artworkUrl: coverUrl,
      trackName: "雪路",
      supportLine: "wukino",
    })
  }, [setPlaybackState])

  return null
}

function WorkspaceMelodeckProjectionHarness() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative h-screen w-full bg-background text-foreground">
        <WorkspaceMelodeckProvider>
          <WorkspaceMelodeckProjectionSetup />
          <WorkspaceMelodeckPanel />
        </WorkspaceMelodeckProvider>
      </div>
    </QueryClientProvider>
  )
}

function WorkspaceMelodeckProjectionSetup() {
  const {
    setCollapsed,
    setMode,
    setPlayerEngine,
    setSurfaceMounted,
  } = useWorkspaceMelodeck()

  useEffect(() => {
    setPlayerEngine("folia")
    setMode("floating")
    setSurfaceMounted(true)
    setCollapsed(false)
  }, [setCollapsed, setMode, setPlayerEngine, setSurfaceMounted])

  return null
}

function ResponsiveFoliaSurfaceHarness() {
  const [size, setSize] = useState({ width: 720, height: 420 })
  const [responsiveTracks, setResponsiveTracks] = useState(tracks)
  const [responsiveLibraryRoots, setResponsiveLibraryRoots] = useState<string[]>([])
  const [responsiveLoopMode, setResponsiveLoopMode] = useState<FoliaLoopMode>("all")
  const [responsiveBackgroundMetadata, setResponsiveBackgroundMetadata] = useState(false)

  return (
    <FoliaPlayerProvider
      tracks={responsiveTracks}
      onTracksChange={setResponsiveTracks}
      libraryRoots={responsiveLibraryRoots}
      onLibraryRootsChange={setResponsiveLibraryRoots}
      host={responsiveFoliaHost}
      preferences={{ loopMode: responsiveLoopMode, backgroundMetadataEnabled: responsiveBackgroundMetadata }}
      onPreferencesChange={(nextPreferences) => {
        setResponsiveLoopMode(nextPreferences.loopMode)
        setResponsiveBackgroundMetadata(nextPreferences.backgroundMetadataEnabled)
      }}
      theme={theme}
      isDaylight
    >
      <div className="min-h-screen bg-background p-4 text-foreground">
        <button type="button" onClick={() => setSize({ width: 1200, height: 720 })}>Use spacious player size</button>
        <button type="button" onClick={() => setSize({ width: 720, height: 420 })}>Use compact player size</button>
        <ResponsiveFoliaQueueProbe />
        <div style={size}>
          <MelodeckFoliaNodeSurface />
        </div>
      </div>
    </FoliaPlayerProvider>
  )
}

function ResponsiveFoliaQueueProbe() {
  const { libraryRoots: currentLibraryRoots, preferences, snapshot, tracks: currentTracks } = useFoliaPlayer()
  return (
    <output
      data-folia-responsive-queue
      data-active-track-id={snapshot.activeTrack?.id ?? ""}
      data-library-roots={currentLibraryRoots.join(",")}
      data-loop-mode={preferences.loopMode}
      data-background-metadata={String(preferences.backgroundMetadataEnabled)}
      data-track-order={currentTracks.map((track) => track.id).join(",")}
    />
  )
}

function FoliaHydrationRestoreHarness({
  host,
  onActiveTrackChange,
}: {
  host: FoliaPlayerHostAdapter
  onActiveTrackChange: (trackId: string | null) => void
}) {
  return (
    <FoliaPlayerProvider
      tracks={tracksWithoutCovers}
      onTracksChange={vi.fn()}
      initialActiveTrackId="track-2"
      onActiveTrackChange={onActiveTrackChange}
      host={host}
      preferences={{ backgroundMetadataEnabled: true }}
    >
      <FoliaHydrationRestoreProbe />
    </FoliaPlayerProvider>
  )
}

function FoliaHydrationRestoreProbe() {
  const { snapshot, tracks: hydratedTracks } = useFoliaPlayer()
  return (
    <output
      data-folia-hydration-restore
      data-active-track-id={snapshot.activeTrack?.id ?? ""}
      data-cover-ready-ids={hydratedTracks.filter((track) => Boolean(track.coverUrl)).map((track) => track.id).join(",")}
      data-is-playing={String(snapshot.isPlaying)}
    />
  )
}

function homeControlGroupsHaveGap(): boolean {
  const mapRect = document.querySelector<HTMLElement>('[data-folia-grid-controls="map"]')!.getBoundingClientRect()
  const actionRect = document.querySelector<HTMLElement>('[data-folia-grid-controls="actions"]')!.getBoundingClientRect()
  const horizontalGap = Math.max(actionRect.left - mapRect.right, mapRect.left - actionRect.right)
  const verticalGap = Math.max(actionRect.top - mapRect.bottom, mapRect.top - actionRect.bottom)
  return horizontalGap >= 8 || verticalGap >= 8
}

function FoliaActionBridgeHarness() {
  const [bridgeState, setBridgeState] = useState<{ trackId?: string } | null>(null)

  return (
    <FoliaPlayerProvider
      tracks={tracks}
      onTracksChange={onTracksChange}
      libraryRoots={libraryRoots}
      host={foliaHost}
      theme={theme}
      isDaylight
      enabled={false}
    >
      <FoliaActionBridge onBridgeStateChange={setBridgeState} />
      <output data-folia-bridge>{bridgeState?.trackId ?? "pending"}</output>
    </FoliaPlayerProvider>
  )
}

function FoliaActionBridge({ onBridgeStateChange }: { onBridgeStateChange: (state: { trackId?: string }) => void }) {
  const { actions, snapshot } = useFoliaPlayer()

  useEffect(() => {
    onBridgeStateChange({ trackId: snapshot.activeTrack?.id })
  }, [actions, onBridgeStateChange, snapshot.activeTrack])

  return null
}

const coverUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHRSURBVHhe7dDNTQMxGATQdMGREmiIGrghUS+NgIiUSHn2Zv2/RuvDu3yB9cxcXl7ffs7s4uFs1gAezmYN4KGVy9dHNr8xQtMBLFTDb/fSZADDt+RbrVUNYNiefLuV4gEMOIIZWigawGAjmaVW9gAGOoKZamQNYJAjma1U8gAGmIEZSyQN4MMzMWuu3QF8cEZmzrEG8PDwY+SxWZk91RrAw/2HyCOzs0OKNYCH+w+RB2ZnhxTRAfzwf2KXPWsAD9dj5MP/hV32TD3A9/tnstv/2GXPlANYLodd9kw1gGVq2GlLMIChRrFAC3aLCQY4YgSDt2Q3HT6AgXuw3zQDGLQnO64Bjh7AgCPYcw2wNUDvEQw2UtDTwxpgDdB/BEONFHT0sAbwDyIFahhotKCfB1mgBUONFPTzEGOBWoYaKejmYYslahhqpKCXh2csUspQIwWdPOyxTAlDjRT08ZDCQiUMNoI9rl08pLJQLsONYIdrDw85LJXLgD2Z/d7BQwmLpTJkT2a+Z/dQw4IpDNqDOR8ye2jFos8YuCVzqdsAuQzegm/ETDPAHwvU8NtbphrgxjI5/NaeKQe4sdwz/m+qqQcYYQ3g4WzWAB7OZg3g4WxOP8AvNEvrw6FcYncAAAAASUVORK5CYII="

const tracks: FoliaTrack[] = [{
  id: "track-1",
  src: "data:audio/wav;base64,UklGRgQAAABXQVZF",
  title: "焚蝶",
  artist: "铁痕电台",
  album: "MSR",
  coverUrl,
  lyrics: {
    lines: [{
      startTime: 0,
      endTime: 12,
      fullText: "落日穿过旧车站",
      translation: "Sunset crosses the old station",
      words: [{ text: "落日穿过旧车站", startTime: 0, endTime: 12 }],
    }],
  },
}, {
  id: "track-2",
  src: "data:audio/wav;base64,UklGRgQAAABXQVZF",
  title: "微光",
  artist: "铁痕电台",
  album: "MSR",
  coverUrl,
  lyrics: {
    lines: [{
      startTime: 0,
      endTime: 12,
      fullText: "微光沿着唱针醒来",
      words: [{ text: "微光沿着唱针醒来", startTime: 0, endTime: 12 }],
    }],
  },
}]

const tracksWithoutCovers = tracks.map(({ coverUrl: _coverUrl, lyrics: _lyrics, ...track }) => track)

const onTracksChange = vi.fn()
const libraryRoots: string[] = []
const foliaHost = {}
const responsiveScanLibraryRoots = vi.fn(async () => tracks)
const responsiveFoliaHost: FoliaPlayerHostAdapter = {
  pickLibraryRoot: async () => "D:/Music",
  scanLibraryRoots: responsiveScanLibraryRoots,
}

const theme = buildFoliaDualTheme(
  { background: "rgb(250, 250, 250)", foreground: "rgb(25, 25, 25)", accent: "rgb(0, 120, 110)", secondary: "rgb(90, 95, 100)", fontFamily: "Inter" },
  { background: "rgb(20, 20, 20)", foreground: "rgb(245, 245, 245)", accent: "rgb(80, 210, 190)", secondary: "rgb(160, 165, 170)", fontFamily: "Inter" },
)
