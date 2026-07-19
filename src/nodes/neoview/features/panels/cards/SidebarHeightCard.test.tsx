import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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

  it("keeps the resident shell while inactive and restores the ready editor after activation", () => {
    const context = {
      client: {},
      disabled: false,
      onGoTo: () => undefined,
      shell: shell(),
      shellControl: { setTriggerSize: vi.fn(), persist: vi.fn() },
      onSidebarLayout: vi.fn(),
    } as unknown as Parameters<typeof SidebarHeightCard>[0]
    const view = render(<SidebarHeightCard {...context} panelActive={false} />)

    expect(view.container.querySelector('[data-sidebar-height-state="loading"]')).toBeTruthy()
    expect(view.container.querySelector('[data-sidebar-height-state="ready"]')).toBeNull()
    expect(view.container.querySelectorAll('input[type="range"]')).toHaveLength(0)

    view.rerender(<SidebarHeightCard {...context} panelActive />)

    expect(view.container.querySelector('[data-sidebar-height-state="ready"]')).toBeTruthy()
    expect(view.container.querySelectorAll('input[type="range"]')).toHaveLength(10)
  })

  it("propagates the host disabled state to every interactive control", () => {
    const context = {
      client: {},
      disabled: true,
      onGoTo: () => undefined,
      shell: shell(),
      shellControl: { setTriggerSize: vi.fn(), persist: vi.fn() },
      onSidebarLayout: vi.fn(),
    } as unknown as Parameters<typeof SidebarHeightCard>[0]

    render(<SidebarHeightCard {...context} />)

    expect(screen.getAllByRole("slider").every((control) => (control as HTMLInputElement).disabled)).toBe(true)
    expect(screen.getAllByRole("switch").every((control) => (control as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") !== null).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
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

  it("[neoview.sidebar-height.saving] disables geometry controls until the layout save settles", async () => {
    let resolveSave!: () => void
    const onSidebarLayout = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    render(<SidebarHeightEditor shell={shell()} onSidebarLayout={onSidebarLayout} onTriggerSize={() => undefined} onInteraction={() => undefined} />)

    const leftHeight = screen.getAllByRole("slider")[0]!
    fireEvent.change(leftHeight, { target: { value: "72" } })
    fireEvent.pointerUp(leftHeight, { pointerId: 1 })

    await waitFor(() => expect((leftHeight as HTMLInputElement).disabled).toBe(true))
    expect((screen.getByRole("switch", { name: "显示拖拽手柄" }) as HTMLButtonElement).disabled).toBe(true)
    resolveSave()
    await waitFor(() => expect((leftHeight as HTMLInputElement).disabled).toBe(false))
  })

  it("[neoview.sidebar-height.save-retry] exposes a failed layout save and retries the same patch", async () => {
    const onSidebarLayout = vi.fn()
      .mockRejectedValueOnce(new Error("layout unavailable"))
      .mockResolvedValueOnce(undefined)
    render(<SidebarHeightEditor shell={shell()} onSidebarLayout={onSidebarLayout} onTriggerSize={() => undefined} onInteraction={() => undefined} />)

    const leftHeight = screen.getAllByRole("slider")[0]!
    fireEvent.change(leftHeight, { target: { value: "72" } })
    fireEvent.pointerUp(leftHeight, { pointerId: 1 })

    expect((await screen.findByRole("alert")).textContent).toContain("layout unavailable")
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))

    await waitFor(() => {
      expect(onSidebarLayout).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole("alert")).toBeNull()
    })
    expect(onSidebarLayout).toHaveBeenNthCalledWith(1, { side: "left", height: "custom", customHeight: 72 })
    expect(onSidebarLayout).toHaveBeenNthCalledWith(2, { side: "left", height: "custom", customHeight: 72 })
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
  it("[neoview.sidebar-height.lifecycle] re-enables Y-axis positioning as soon as a full-height sidebar leaves 100%", async () => {
    render(
      <SidebarHeightEditor
        shell={shell()}
        onSidebarLayout={() => undefined}
        onTriggerSize={() => undefined}
        onInteraction={() => undefined}
      />,
    )

    const sliders = screen.getAllByRole("slider")
    const leftHeight = sliders[0]!
    fireEvent.change(leftHeight, { target: { value: "99" } })

    await waitFor(() => expect((screen.getAllByRole("slider")[1] as HTMLInputElement).disabled).toBe(false))
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
