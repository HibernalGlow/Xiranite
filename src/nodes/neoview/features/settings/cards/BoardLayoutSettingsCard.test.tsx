import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { BoardLayoutSettingsCard } from "./BoardLayoutSettingsCard"

afterEach(cleanup)

describe("BoardLayoutSettingsCard", () => {
  it("maps shared swimlane interaction fields to Reader workspace fields", () => {
    const onWorkspace = vi.fn()
    render(<BoardLayoutSettingsCard shell={shell()} onSave={vi.fn(async () => undefined)} onWorkspace={onWorkspace} />)

    const interaction = screen.getByRole("tab", { name: "交互" })
    fireEvent.mouseDown(interaction, { button: 0 })
    fireEvent.click(interaction)
    fireEvent.click(screen.getByRole("switch", { name: "Reader 聚焦时自动全屏" }))
    expect(onWorkspace).toHaveBeenLastCalledWith({ readerSoloOnFocus: false })
    fireEvent.click(screen.getByRole("switch", { name: "Reader 独占时显示泳道底栏" }))
    expect(onWorkspace).toHaveBeenLastCalledWith({ showLaneNavigatorInReaderSolo: true })

    const revealDelay = screen.getByRole("spinbutton", { name: "左右泳道展开延迟" })
    fireEvent.change(revealDelay, { target: { value: "430" } })
    fireEvent.blur(revealDelay)
    expect(onWorkspace).toHaveBeenLastCalledWith({ edgeRevealDelayMs: 430 })

    const focusDelay = screen.getByRole("spinbutton", { name: "Reader 重新聚焦延迟" })
    fireEvent.change(focusDelay, { target: { value: "900" } })
    fireEvent.blur(focusDelay)
    expect(onWorkspace).toHaveBeenLastCalledWith({ readerFocusHoverDelayMs: 900 })
  })

  it("[neoview.swimlane.vertical-reveal-zones] mirrors top and bottom zones only while vertical linking is enabled", () => {
    const onWorkspace = vi.fn()
    render(<BoardLayoutSettingsCard shell={shell()} onSave={vi.fn(async () => undefined)} onWorkspace={onWorkspace} />)

    const interaction = screen.getByRole("tab", { name: "交互" })
    fireEvent.mouseDown(interaction, { button: 0 })
    fireEvent.click(interaction)
    expect(document.querySelectorAll("[data-reader-reveal-zone]")).toHaveLength(4)

    fireEvent.click(screen.getByRole("button", { name: "上栏" }))
    const topY = screen.getByRole("spinbutton", { name: "上栏唤出区y" })
    fireEvent.change(topY, { target: { value: "8" } })
    fireEvent.blur(topY)
    expect(onWorkspace).toHaveBeenLastCalledWith({
      edgeRevealZones: {
        left: { x: 0, y: 10, width: 1, height: 80 },
        right: { x: 99, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 8, width: 80, height: 1 },
        bottom: { x: 10, y: 91, width: 80, height: 1 },
      },
    })

    fireEvent.click(screen.getByRole("checkbox", { name: "上下联动" }))
    fireEvent.change(topY, { target: { value: "9" } })
    fireEvent.blur(topY)
    expect(onWorkspace).toHaveBeenLastCalledWith({
      edgeRevealZones: {
        left: { x: 0, y: 10, width: 1, height: 80 },
        right: { x: 99, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 9, width: 80, height: 1 },
        bottom: { x: 10, y: 91, width: 80, height: 1 },
      },
    })
  })
})

function shell(): ReaderShellConfigDto {
  return {
    revision: 1,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    workspace: {
      mode: "swimlane",
      swimlane: {
        laneOrder: ["left", "reader", "right"],
        activeLane: "reader",
        readerSolo: true,
        readerSoloOnFocus: true,
        readerWidthRatio: 0.5,
        edgeRevealDelayMs: 180,
        edgeRevealZones: {
          left: { x: 0, y: 10, width: 1, height: 80 },
          right: { x: 99, y: 10, width: 1, height: 80 },
          top: { x: 10, y: 0, width: 80, height: 1 },
          bottom: { x: 10, y: 99, width: 80, height: 1 },
        },
        readerFocusOnHover: true,
        readerFocusHoverDelayMs: 650,
        showLaneNavigatorInReaderSolo: false,
        barHandleStyle: "grip",
        barHandlePosition: "left",
        laneNavigatorPositionX: 92,
        laneNavigatorPositionY: 96,
        laneNavigatorDock: "floating",
        lanes: {
          left: { width: 320, collapsed: false },
          reader: { width: 960, collapsed: false },
          right: { width: 280, collapsed: false },
        },
      },
    },
    panelLayout: {},
    cardLayout: {},
  }
}
