import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarControlCard, type SidebarControlCardProps } from "./SidebarControlCard"

afterEach(cleanup)

describe("SidebarControlCard", () => {
  it("[neoview.card.sidebar-control.floating] keeps the floating controller switch and reset contract", () => {
    const onFloatingControlChange = vi.fn()
    renderCard({ onFloatingControlChange })

    fireEvent.click(screen.getByRole("switch", { name: "启用浮动控制器" }))
    expect(onFloatingControlChange).toHaveBeenCalledWith({ enabled: false })

    fireEvent.click(screen.getByRole("button", { name: "重置控制器位置" }))
    expect(onFloatingControlChange).toHaveBeenLastCalledWith({ position: { x: 100, y: 100 } })
  })

  it("[neoview.card.sidebar-control.edges] pins top and bottom while side clicks change transient visibility", () => {
    const onPinnedChange = vi.fn()
    const onOpenChange = vi.fn()
    renderCard({ onPinnedChange, onOpenChange })

    fireEvent.click(screen.getByRole("button", { name: "上边栏" }))
    fireEvent.click(screen.getByRole("button", { name: "下边栏" }))
    fireEvent.click(screen.getByRole("button", { name: "左边栏" }))
    fireEvent.click(screen.getByRole("button", { name: "右边栏" }))

    expect(onPinnedChange).toHaveBeenNthCalledWith(1, "top", false)
    expect(onPinnedChange).toHaveBeenNthCalledWith(2, "bottom", true)
    expect(onOpenChange).toHaveBeenNthCalledWith(1, "left", false)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, "right", true)
  })

  it("[neoview.card.sidebar-control.context-pin] preserves right-click pinning without toggling open", () => {
    const onPinnedChange = vi.fn()
    const onOpenChange = vi.fn()
    renderCard({ onPinnedChange, onOpenChange })

    fireEvent.contextMenu(screen.getByRole("button", { name: "左边栏" }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "右边栏" }))

    expect(onPinnedChange).toHaveBeenNthCalledWith(1, "left", true)
    expect(onPinnedChange).toHaveBeenNthCalledWith(2, "right", false)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("[neoview.card.sidebar-control.accessibility] exposes lock, trigger and reset actions without a context menu", () => {
    const onLockModeChange = vi.fn()
    const onTriggerSizeChange = vi.fn()
    const onReset = vi.fn()
    renderCard({ onLockModeChange, onTriggerSizeChange, onReset })

    fireEvent.change(screen.getByRole("combobox", { name: "左边锁定模式" }), { target: { value: "locked-hidden" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "右边触发区大小" }), { target: { value: "48" } })
    fireEvent.click(screen.getByRole("button", { name: "恢复边栏默认布局" }))

    expect(onLockModeChange).toHaveBeenCalledWith("left", "locked-hidden")
    expect(onTriggerSizeChange).toHaveBeenCalledWith("right", 48)
    expect(onReset).toHaveBeenCalledOnce()
  })
})

function renderCard(overrides: Partial<SidebarControlCardProps> = {}) {
  const edge = (pinned: boolean, open: boolean): SidebarControlCardProps["edges"]["left"] => ({
    pinned,
    open,
    enabled: true,
    triggerSize: 32,
    lockMode: "auto",
  })
  const props: SidebarControlCardProps = {
    floatingControl: { enabled: true, position: { x: 40, y: 60 } },
    edges: {
      top: edge(true, true),
      bottom: edge(false, false),
      left: edge(false, true),
      right: edge(true, false),
    },
    onFloatingControlChange: vi.fn(),
    onPinnedChange: vi.fn(),
    onOpenChange: vi.fn(),
    onLockModeChange: vi.fn(),
    onTriggerSizeChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  }
  return render(<SidebarControlCard {...props} />)
}
