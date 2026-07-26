import { expect, test, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import type { ReaderWorkspaceConfig } from "./ReaderWorkspaceLayout"
import { ReaderSwimlaneWorkspace } from "./ReaderSwimlaneWorkspace"

test("keeps swimlane boundaries draggable in Reader view fullscreen", async () => {
  const onWorkspaceChange = vi.fn()
  const workspace = fullscreenWorkspace()

  await render(
    <div style={{ width: 1200, height: 700 }}>
      <ReaderSwimlaneWorkspace
        shell={shellConfig(workspace)}
        workspace={workspace}
        reader={<div data-testid="reader-resize-target" style={{ width: "100%", height: "100%" }}>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        readerViewFullscreen
        onWorkspaceChange={onWorkspaceChange}
      />
    </div>,
  )

  await expect.element(page.getByRole("separator", { name: "调整左侧面板与阅读器泳道宽度" })).toBeVisible()
  const separator = page.getByRole("separator", { name: "调整阅读器与右侧面板泳道宽度" })
  await expect.element(separator).toBeVisible()

  const readerLane = document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')!
  const rightLane = document.querySelector<HTMLElement>('[data-reader-swimlane="right"]')!
  const initialReaderWidth = readerLane.getBoundingClientRect().width
  const initialRightWidth = rightLane.getBoundingClientRect().width

  await userEvent.dragAndDrop(separator, page.getByTestId("reader-resize-target"))

  await expect.poll(() => readerLane.getBoundingClientRect().width).toBeLessThan(initialReaderWidth)
  await expect.poll(() => rightLane.getBoundingClientRect().width).toBeGreaterThan(initialRightWidth)
  await expect.poll(() => onWorkspaceChange).toHaveBeenCalled()
  expect(onWorkspaceChange.mock.lastCall?.[0].lanes?.right?.landscapeWidth).toBeGreaterThan(initialRightWidth)
})

function shellConfig(workspace: ReaderWorkspaceConfig): ReaderShellConfigDto {
  const edge = { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 }
  return {
    revision: 1,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: { top: edge, right: edge, bottom: edge, left: edge },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 300, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    workspace,
    panelLayout: {},
    cardLayout: {},
  }
}

function fullscreenWorkspace(): ReaderWorkspaceConfig {
  return {
    mode: "swimlane",
    swimlane: {
      laneOrder: ["left", "reader", "right"],
      activeLane: "reader",
      readerSolo: false,
      readerSoloOnFocus: true,
      readerWidthRatio: 0.5,
      edgeRevealDelayMs: 0,
      edgeRevealZones: {
        left: { x: 0, y: 10, width: 1, height: 80 },
        right: { x: 99, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 0, width: 80, height: 1 },
        bottom: { x: 10, y: 99, width: 80, height: 1 },
      },
      readerFocusOnHover: true,
      readerFocusHoverDelayMs: 0,
      manualScrollEnabled: false,
      showLaneNavigatorInReaderSolo: false,
      autoFitToViewport: false,
      barHandleStyle: "grip",
      barHandlePosition: "left",
      laneNavigatorPositionX: 92,
      laneNavigatorPositionY: 96,
      laneNavigatorDock: "floating",
      windowControlsPlacement: "lane",
      windowControlsOwnerLaneId: "right",
      windowControlsExpanded: false,
      lanes: {
        left: { width: 320, collapsed: false, activePanelId: "folder" },
        reader: { width: 600, collapsed: false },
        right: { width: 300, collapsed: false, activePanelId: "info" },
      },
    },
  }
}
