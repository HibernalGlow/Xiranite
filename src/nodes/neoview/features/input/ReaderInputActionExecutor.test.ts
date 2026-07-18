import { DEFAULT_READER_PRESENTATION, type ReaderInputAction } from "@xiranite/node-neoview/ui-core"
import { describe, expect, it, vi } from "vitest"

import { executeReaderInputAction, type ReaderInputActionControls } from "./ReaderInputActionExecutor"

describe("ReaderInputActionExecutor", () => {
  it("[neoview.bindings.action-executor] routes navigation, view, shell and slideshow actions", () => {
    const controls = fixture()
    expect(executeReaderInputAction("reader.page-left", controls)).toBe(true)
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
  })

  it("[neoview.bindings.video-actions] routes all video actions and remaps page actions in seek mode", () => {
    const controls = fixture()
    vi.mocked(controls.video!.isSeekMode).mockReturnValue(true)
    expect(executeReaderInputAction("video.play-pause", controls)).toBe(true)
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

  it("[neoview.bindings.action-capability] reports unsupported actions without their provider", () => {
    const controls = fixture()
    controls.video = undefined
    expect(executeReaderInputAction("video.play-pause", controls)).toBe(false)
    expect(executeReaderInputAction("upscale.toggle-auto", controls)).toBe(false)
  })
})

function fixture(): ReaderInputActionControls & Record<"navigate" | "goTo" | "switchBook" | "setPresentation" | "toggleShellEdge", ReturnType<typeof vi.fn>> {
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
    slideshow: { toggle: vi.fn(), stop: vi.fn(), skip: vi.fn() },
  }
}
