import { describe, expect, it } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { applyReaderWorkspacePatch, fitReaderSwimlanesToViewport, readerWorkspaceConfig, reorderedReaderLanes } from "./ReaderWorkspaceLayout"

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
      laneOrder: ["right", "reader", "left"],
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
        laneOrder: ["right", "reader", "left"],
        lanes: { right: { width: 720, activePanelId: "properties" } },
      },
    })
  })

  it("normalizes lane reordering without dropping the Reader", () => {
    expect(reorderedReaderLanes(["left", "reader", "right"], "right", "left")).toEqual(["right", "left", "reader"])
    expect(reorderedReaderLanes(["reader", "reader"] as never, "reader", "reader")).toEqual(["reader", "left", "right"])
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
    expect(fitted.reduce((sum, width) => sum + width, 0)).toBe(1_000)
    expect(fitted).toEqual([213, 333, 267, 187])
    expect(patch.readerSolo).toBe(false)
    expect(patch.readerWidthRatio).toBeCloseTo(0.333)
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
