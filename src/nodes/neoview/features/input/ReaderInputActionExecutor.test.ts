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

  it("[neoview.bindings.action-capability] reports unsupported migrated actions for a later provider", () => {
    const controls = fixture()
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
    slideshow: { toggle: vi.fn(), stop: vi.fn(), skip: vi.fn() },
  }
}
