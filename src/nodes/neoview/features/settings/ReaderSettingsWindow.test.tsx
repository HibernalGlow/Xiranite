import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"

vi.mock("./cards/PanelLayoutEditor", () => ({ default: () => <div data-testid="panel-layout-editor">editor</div> }))

import { ReaderSettingsWindow } from "./ReaderSettingsWindow"

afterEach(cleanup)

describe("ReaderSettingsWindow", () => {
  it("[neoview.settings.window] follows the standalone categorized settings fixture and defers Kanban", async () => {
    render(<ReaderSettingsWindow shell={shell()} onClose={vi.fn()} onBoardLayout={vi.fn(async () => undefined)} />)
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "NeoView 设置分类" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "边栏布局" })).toBeTruthy()
    expect(screen.queryByTestId("panel-layout-editor")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "卡片管理" }))
    expect(await screen.findByTestId("panel-layout-editor")).toBeTruthy()
  })
})

function shell(): ReaderShellConfigDto {
  return {
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
    panelLayout: {
      pageList: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
