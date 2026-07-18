import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import SidebarHeightCard, { SidebarHeightEditor } from "./SidebarHeightCard"

afterEach(cleanup)

describe("SidebarHeightCard", () => {
  it("keeps a resident loading shell while the Reader Shell config hydrates", () => {
    const view = render(<SidebarHeightCard client={{} as never} disabled={false} onGoTo={() => undefined} />)
    expect(view.container.querySelector('[data-neoview-card="sidebar-height"]')).toBeTruthy()
    expect(view.container.querySelector('[data-sidebar-height-state="loading"]')).toBeTruthy()
    expect(screen.getByText("侧边栏布局控制加载中...")).toBeTruthy()
  })

  it("[neoview.sidebar-height.ui] preserves the legacy hierarchy and responsive geometry controls", () => {
    render(<SidebarHeightEditor shell={shell()} onSidebarLayout={() => undefined} onTriggerSize={() => undefined} onInteraction={() => undefined} />)
    expect(screen.getByText("左侧边栏")).toBeTruthy()
    expect(screen.getByText("右侧边栏")).toBeTruthy()
    expect(screen.getByRole("switch", { name: "显示拖拽手柄" })).toBeTruthy()
    expect(screen.getByRole("switch", { name: "空白区点击收回侧边栏" })).toBeTruthy()
    expect(screen.getAllByRole("slider")).toHaveLength(10)
    expect(screen.getByRole("button", { name: "单击" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("[neoview.sidebar-height.slider-commit] previews locally and writes once at interaction end", () => {
    const onSidebarLayout = vi.fn()
    const onTriggerSize = vi.fn()
    render(<SidebarHeightEditor shell={shell()} onSidebarLayout={onSidebarLayout} onTriggerSize={onTriggerSize} onInteraction={() => undefined} />)
    const heights = screen.getAllByRole("slider", { name: "高度" })
    fireEvent.change(heights[0]!, { target: { value: "72" } })
    expect(onSidebarLayout).not.toHaveBeenCalled()
    fireEvent.pointerUp(heights[0]!, { pointerId: 1 })
    expect(onSidebarLayout).toHaveBeenCalledOnce()
    expect(onSidebarLayout).toHaveBeenCalledWith({ side: "left", height: "custom", customHeight: 72 })

    const leftTrigger = screen.getByRole("slider", { name: "左边缘" })
    fireEvent.change(leftTrigger, { target: { value: "44" } })
    expect(onTriggerSize).not.toHaveBeenCalled()
    fireEvent.pointerUp(leftTrigger, { pointerId: 2 })
    expect(onTriggerSize).toHaveBeenCalledWith("left", 44)
  })

  it("marks the full geometry editor ready and keeps Y-axis semantics discoverable", () => {
    const view = render(
      <SidebarHeightEditor
        shell={shell()}
        onSidebarLayout={() => undefined}
        onTriggerSize={() => undefined}
        onInteraction={() => undefined}
      />,
    )
    expect(view.container.querySelector('[data-sidebar-height-state="ready"]')).toBeTruthy()
    expect((screen.getAllByRole("slider", { name: "Y轴" })[0] as HTMLInputElement).disabled).toBe(true)
  })
})

function shell(): ReaderShellConfigDto {
  return {
    revision: 0,
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
      right: { width: 280, height: "custom", customHeight: 65, verticalAlign: 25, horizontalPosition: 10 },
    },
    sidebarInteraction: { showDragHandle: false, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" },
    panelLayout: {},
    cardLayout: {},
  }
}
