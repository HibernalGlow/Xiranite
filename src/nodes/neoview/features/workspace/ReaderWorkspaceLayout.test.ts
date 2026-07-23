import { describe, expect, it } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { applyReaderWorkspacePatch, fitReaderSwimlanesToViewport, isSwimlaneFitNoOp, readerSwimlaneWidthField, readerWorkspaceConfig, reorderedReaderLanes } from "./ReaderWorkspaceLayout"

describe("ReaderWorkspaceLayout", () => {
  it("keeps the legacy edge shell as default and derives only initial lane widths", () => {
    const shell = shellConfig()
    shell.sidebars.left.width = 444
    shell.sidebars.right.width = 388

    expect(readerWorkspaceConfig(shell)).toMatchObject({
      mode: "edges",
      swimlane: {
        laneOrder: ["left", "reader", "right"],
        activeLane: "reader",
        readerSolo: true,
        readerWidthRatio: 0.5,
        edgeRevealDelayMs: 180,
        readerFocusOnHover: true,
        readerFocusHoverDelayMs: 650,
        manualScrollEnabled: false,
        windowControlsPlacement: "lane",
        windowControlsOwnerLaneId: "right",
        windowControlsExpanded: false,
        lanes: {
          left: { width: 444, activePanelId: "folder" },
          reader: { width: 960 },
          right: { width: 388, activePanelId: "info" },
        },
      },
    })
  })

  it("applies swimlane patches without rewriting edge geometry", () => {
    const shell = shellConfig()
    const updated = applyReaderWorkspacePatch(shell, {
      mode: "swimlane",
      activeLane: "right",
      readerSolo: true,
      readerWidthRatio: 0.7,
      edgeRevealDelayMs: 320,
      readerFocusOnHover: false,
      readerFocusHoverDelayMs: 900,
      manualScrollEnabled: true,
      laneOrder: ["right", "reader", "left"],
      laneNavigatorDock: "window-title",
      windowControlsPlacement: "titlebar",
      windowControlsOwnerLaneId: "left",
      windowControlsExpanded: true,
      lanes: { right: { width: 720, activePanelId: "properties" } },
    })

    expect(updated.sidebars).toEqual(shell.sidebars)
    expect(updated.edges).toEqual(shell.edges)
    expect(updated.workspace).toMatchObject({
      mode: "swimlane",
      swimlane: {
        activeLane: "right",
        readerSolo: true,
        readerWidthRatio: 0.7,
        edgeRevealDelayMs: 320,
        readerFocusOnHover: false,
        readerFocusHoverDelayMs: 900,
        manualScrollEnabled: true,
        laneOrder: ["right", "reader", "left"],
        laneNavigatorDock: "window-title",
        windowControlsPlacement: "titlebar",
        windowControlsOwnerLaneId: "left",
        windowControlsExpanded: true,
        lanes: { right: { width: 720, activePanelId: "properties" } },
      },
    })
  })

  it("normalizes lane reordering without dropping the Reader", () => {
    expect(reorderedReaderLanes(["left", "reader", "right"], "right", "left")).toEqual(["right", "left", "reader"])
    expect(reorderedReaderLanes(["reader", "reader"] as never, "reader", "reader")).toEqual(["reader", "left", "right"])
  })

  it("keeps independent width slots for orientation and Reader solo state", () => {
    const updated = applyReaderWorkspacePatch(shellConfig(), {
      lanes: {
        left: {
          landscapeWidth: 360,
          portraitWidth: 280,
          landscapeReaderSoloWidth: 440,
          portraitReaderSoloWidth: 320,
        },
      },
    })

    expect(readerWorkspaceConfig(updated).swimlane.lanes.left).toMatchObject({
      width: 320,
      landscapeWidth: 360,
      portraitWidth: 280,
      landscapeReaderSoloWidth: 440,
      portraitReaderSoloWidth: 320,
    })
    expect(readerSwimlaneWidthField("landscape", false)).toBe("landscapeWidth")
    expect(readerSwimlaneWidthField("portrait", false)).toBe("portraitWidth")
    expect(readerSwimlaneWidthField("landscape", true)).toBe("landscapeReaderSoloWidth")
    expect(readerSwimlaneWidthField("portrait", true)).toBe("portraitReaderSoloWidth")
  })

  it("keeps dynamic lanes and fits every expanded lane to the viewport without changing proportions", () => {
    const shell = applyReaderWorkspacePatch(shellConfig(), {
      laneOrder: ["left", "reader", "research", "right"],
      activeLane: "research",
      lanes: { research: { width: 400, collapsed: false, title: "资料" } },
    })
    const workspace = readerWorkspaceConfig(shell)
    expect(workspace.swimlane.laneOrder).toEqual(["left", "reader", "research", "right"])
    expect(workspace.swimlane.lanes.research).toMatchObject({ width: 400, title: "资料" })

    const patch = fitReaderSwimlanesToViewport(1_000, workspace.swimlane)
    const fitted = workspace.swimlane.laneOrder.map((laneId) => patch.lanes?.[laneId]?.width ?? 0)
    // Panel lanes stay within the shell-control contract (240..8192); reader keeps ratio floor.
    expect(fitted).toEqual([240, 280, 240, 240])
    expect(fitted.reduce((sum, width) => sum + width, 0)).toBe(1_000)
    expect(fitted.every((width, index) => {
      const laneId = workspace.swimlane.laneOrder[index]
      return laneId === "reader" ? width >= 120 : width >= 240
    })).toBe(true)
    expect(patch.readerSolo).toBeUndefined()
    expect(patch.readerWidthRatio).toBeCloseTo(0.28)

    const portraitPatch = fitReaderSwimlanesToViewport(600, workspace.swimlane)
    const portraitWidths = workspace.swimlane.laneOrder.map((laneId) => portraitPatch.lanes?.[laneId]?.width ?? 0)
    // Viewport is smaller than the sum of minima, so total may exceed the viewport.
    expect(portraitWidths).toEqual([240, 150, 240, 240])
    expect(portraitWidths.reduce((sum, width) => sum + width, 0)).toBe(870)
    expect(portraitPatch.readerWidthRatio).toBe(0.25)
  })

  it("treats a second fit of the same geometry as a no-op", () => {
    const shell = applyReaderWorkspacePatch(shellConfig(), {
      mode: "swimlane",
      readerSolo: false,
      autoFitToViewport: true,
      lanes: {
        left: { width: 320, collapsed: false },
        reader: { width: 480, collapsed: false },
        right: { width: 280, collapsed: false },
      },
    })
    const first = fitReaderSwimlanesToViewport(1_080, readerWorkspaceConfig(shell).swimlane)
    const fitted = applyReaderWorkspacePatch(shell, first)
    const second = fitReaderSwimlanesToViewport(1_080, readerWorkspaceConfig(fitted).swimlane)
    expect(isSwimlaneFitNoOp(readerWorkspaceConfig(fitted).swimlane, second)).toBe(true)
  })
})

function shellConfig(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {},
    cardLayout: {},
  }
}
