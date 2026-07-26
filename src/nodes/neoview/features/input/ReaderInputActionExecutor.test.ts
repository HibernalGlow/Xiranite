import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"
import { describe, expect, it, vi } from "vitest"

import { executeReaderInputAction, type ReaderInputActionControls } from "./ReaderInputActionExecutor"

describe("ReaderInputActionExecutor", () => {
  it("[neoview.bindings.action-executor] routes navigation, view, shell and slideshow actions", async () => {
    const controls = fixture()
    await expect(executeReaderInputAction("reader.page-left", controls)).resolves.toEqual({ status: "succeeded" })
    expect(controls.navigate).toHaveBeenCalledWith("next")
    executeReaderInputAction("reader.last-page", controls)
    expect(controls.goTo).toHaveBeenCalledWith(99)
    executeReaderInputAction("reader.next-book", controls)
    expect(controls.switchBook).toHaveBeenCalledWith("next")
    executeReaderInputAction("reader.rotate-180", controls)
    expect(controls.setPresentation).toHaveBeenCalledWith(expect.objectContaining({ rotation: 180 }))
    executeReaderInputAction("shell.toggle-left-sidebar", controls)
    expect(controls.toggleShellEdge).toHaveBeenCalledWith("left")
    executeReaderInputAction("slideshow.skip", controls)
    expect(controls.slideshow.skip).toHaveBeenCalledOnce()
    await expect(executeReaderInputAction("viewer.toggle-progress-bar", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-progress-bar-glow", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-page-info", controls)).resolves.toEqual({ status: "succeeded" })
    expect(controls.viewerToggles?.toggleProgressBar).toHaveBeenCalledOnce()
    expect(controls.viewerToggles?.toggleProgressBarGlow).toHaveBeenCalledOnce()
    expect(controls.viewerToggles?.togglePageInfo).toHaveBeenCalledOnce()
  })

  it("[neoview.bindings.video-actions] routes all video actions and remaps page actions in seek mode", async () => {
    const controls = fixture()
    vi.mocked(controls.video!.isSeekMode).mockReturnValue(true)
    await expect(executeReaderInputAction("video.play-pause", controls)).resolves.toEqual({ status: "succeeded" })
    executeReaderInputAction("video.seek-forward", controls)
    executeReaderInputAction("video.seek-backward", controls)
    executeReaderInputAction("video.toggle-mute", controls)
    executeReaderInputAction("video.cycle-loop-mode", controls)
    executeReaderInputAction("video.volume-up", controls)
    executeReaderInputAction("video.volume-down", controls)
    executeReaderInputAction("video.speed-up", controls)
    executeReaderInputAction("video.speed-down", controls)
    executeReaderInputAction("video.toggle-speed", controls)
    executeReaderInputAction("video.toggle-seek-mode", controls)
    expect(controls.video?.seek).toHaveBeenNthCalledWith(1, 1)
    expect(controls.video?.seek).toHaveBeenNthCalledWith(2, -1)
    executeReaderInputAction("reader.next-page", controls)
    executeReaderInputAction("reader.page-left", controls)
    expect(controls.video?.seek).toHaveBeenNthCalledWith(3, 1)
    expect(controls.video?.seek).toHaveBeenNthCalledWith(4, -1)
  })

  it("[neoview.bindings.action-capability] reports unsupported actions without their provider", async () => {
    const controls = fixture()
    controls.video = undefined
    await expect(executeReaderInputAction("video.play-pause", controls)).resolves.toEqual({ status: "unavailable" })
    await expect(executeReaderInputAction("upscale.toggle-auto", controls)).resolves.toEqual({ status: "unavailable" })
  })

  it("routes swimlane workspace actions through the shared binding executor", async () => {
    const controls = fixture()
    const workspace = {
      toggleLayoutMode: vi.fn(),
      focusReader: vi.fn(),
      focusAdjacent: vi.fn(),
      toggleActiveLaneFullscreen: vi.fn(),
      fitLanes: vi.fn(),
    }
    controls.workspace = workspace

    await expect(executeReaderInputAction("workspace.toggle-layout-mode", controls)).resolves.toEqual({ status: "succeeded" })
    executeReaderInputAction("workspace.focus-reader", controls)
    executeReaderInputAction("workspace.focus-previous-lane", controls)
    executeReaderInputAction("workspace.focus-next-lane", controls)
    executeReaderInputAction("workspace.toggle-active-lane-fullscreen", controls)
    executeReaderInputAction("workspace.fit-lanes", controls)
    expect(workspace.toggleLayoutMode).toHaveBeenCalledOnce()
    expect(workspace.focusReader).toHaveBeenCalledOnce()
    expect(workspace.focusAdjacent).toHaveBeenNthCalledWith(1, "previous")
    expect(workspace.focusAdjacent).toHaveBeenNthCalledWith(2, "next")
    expect(workspace.toggleActiveLaneFullscreen).toHaveBeenCalledOnce()
    expect(workspace.fitLanes).toHaveBeenCalledOnce()
  })

  it("[neoview.bindings.file-delete] routes current-file deletion through its destructive action port", async () => {
    const controls = fixture()
    controls.deleteCurrentFile = vi.fn(async () => ({ status: "succeeded" as const }))
    await expect(executeReaderInputAction("file.delete-current", controls)).resolves.toEqual({ status: "succeeded" })
    expect(controls.deleteCurrentFile).toHaveBeenCalledWith(undefined)
    controls.session = () => undefined
    await expect(executeReaderInputAction("file.delete-current", controls)).resolves.toEqual({ status: "unavailable" })
  })

  it("[neoview.bindings.file-delete-next] consumes a prepared adjacent-book action exactly once", async () => {
    const controls = fixture()
    controls.deleteCurrentFile = vi.fn(async () => ({ status: "succeeded" as const, consumedAction: "reader.next-book" as const }))
    const deleted = await executeReaderInputAction("file.delete-current", controls, {
      bindingId: "delete-next",
      index: 0,
      nextAction: "reader.next-book",
    })
    expect(controls.deleteCurrentFile).toHaveBeenCalledWith("next")
    await expect(executeReaderInputAction("reader.next-book", controls, {
      bindingId: "delete-next",
      index: 1,
      previousOutcome: deleted,
    })).resolves.toEqual({ status: "succeeded" })
    expect(controls.switchBook).not.toHaveBeenCalled()
  })

  it("[neoview.bindings.viewer-toggle-provider] routes persistent toast and info overlay toggles", async () => {
    const switchToast = {
      getSnapshot: vi.fn(() => ({ enableBook: false, enablePage: true, enableBoundaryToast: true })),
      update: vi.fn(async (_patch: { enableBook?: boolean; enablePage?: boolean; enableBoundaryToast?: boolean }) => undefined),
    }
    const infoOverlay = {
      getSnapshot: vi.fn(() => ({ enabled: true })),
      update: vi.fn(async (_patch: { enabled?: boolean }) => undefined),
    }
    const hoverScroll = {
      getSnapshot: vi.fn(() => ({ enabled: true })),
      update: vi.fn(async (_patch: { enabled: boolean }) => undefined),
    }
    const controls = fixture({ switchToast, infoOverlay, hoverScroll })

    await expect(executeReaderInputAction("viewer.toggle-page-switch-toast", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-book-switch-toast", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-boundary-toast", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-info-overlay", controls)).resolves.toEqual({ status: "succeeded" })
    await expect(executeReaderInputAction("viewer.toggle-hover-scroll", controls)).resolves.toEqual({ status: "succeeded" })
    expect(switchToast.update).toHaveBeenNthCalledWith(1, { enablePage: false })
    expect(switchToast.update).toHaveBeenNthCalledWith(2, { enableBook: true })
    expect(switchToast.update).toHaveBeenNthCalledWith(3, { enableBoundaryToast: false })
    expect(infoOverlay.update).toHaveBeenCalledWith({ enabled: false })
    expect(hoverScroll.update).toHaveBeenCalledWith({ enabled: false })
  })
})

function fixture(overrides: Partial<Pick<ReaderInputActionControls, "switchToast" | "infoOverlay" | "hoverScroll">> = {}): ReaderInputActionControls & Record<"navigate" | "goTo" | "switchBook" | "setPresentation" | "toggleShellEdge", ReturnType<typeof vi.fn>> {
  const presentation = { ...DEFAULT_READER_PRESENTATION }
  return {
    session: () => ({ pageCount: 100, pageIndex: 10, direction: "right-to-left", pageMode: "single" }),
    presentation: () => presentation,
    setPresentation: vi.fn(),
    navigate: vi.fn(),
    goTo: vi.fn(),
    switchBook: vi.fn(),
    updatePageMode: vi.fn(),
    updateReadingDirection: vi.fn(),
    toggleTemporaryFit: vi.fn(),
    toggleSinglePanorama: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleShellEdge: vi.fn(),
    toggleShellPin: vi.fn(),
    toggleSidebarControl: vi.fn(),
    openFile: vi.fn(),
    closeFile: vi.fn(),
    openSettings: vi.fn(),
    openRadialMenu: vi.fn(),
    video: {
      hasActiveVideo: vi.fn(() => true),
      isSeekMode: vi.fn(() => false),
      playPause: vi.fn(() => true),
      seek: vi.fn(() => true),
      toggleMute: vi.fn(() => true),
      cycleLoopMode: vi.fn(() => true),
      adjustVolume: vi.fn(() => true),
      adjustSpeed: vi.fn(() => true),
      toggleSpeed: vi.fn(() => true),
      toggleSeekMode: vi.fn(() => true),
    },
    viewerToggles: {
      subscribe: vi.fn(() => () => undefined),
      getSnapshot: vi.fn(() => ({ progressBarVisible: true, progressBarGlow: true, pageInfoVisible: true })),
      toggleProgressBar: vi.fn(),
      toggleProgressBarGlow: vi.fn(),
      togglePageInfo: vi.fn(),
    },
    slideshow: { toggle: vi.fn(), stop: vi.fn(), skip: vi.fn() },
    ...overrides,
  }
}
