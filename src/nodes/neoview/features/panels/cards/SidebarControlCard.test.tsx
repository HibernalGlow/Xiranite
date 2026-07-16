import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarControlCard, type SidebarControlCardProps } from "./SidebarControlCard"

afterEach(cleanup)

describe("SidebarControlCard", () => {
  it("[neoview.card.sidebar-control.floating] keeps the legacy floating controller switch and reset contract", () => {
    const onFloatingControlChange = vi.fn()
    renderCard({ onFloatingControlChange })

    fireEvent.click(screen.getByRole("switch", { name: "启用浮动控制器" }))
    expect(onFloatingControlChange).toHaveBeenCalledWith({ enabled: false })

    fireEvent.click(screen.getByRole("button", { name: "重置控制器位置" }))
    expect(onFloatingControlChange).toHaveBeenLastCalledWith({ position: { x: 100, y: 100 } })
  })

  it("[neoview.card.sidebar-control.edges] pins top and bottom while left-clicking sidebars changes transient visibility", () => {
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

  it("[neoview.card.sidebar-control.context-pin] preserves side-button right-click pinning without toggling open", () => {
    const onPinnedChange = vi.fn()
    const onOpenChange = vi.fn()
    renderCard({ onPinnedChange, onOpenChange })

    fireEvent.contextMenu(screen.getByRole("button", { name: "左边栏" }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "右边栏" }))

    expect(onPinnedChange).toHaveBeenNthCalledWith(1, "left", true)
    expect(onPinnedChange).toHaveBeenNthCalledWith(2, "right", false)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

function renderCard(overrides: Partial<SidebarControlCardProps> = {}) {
  const props: SidebarControlCardProps = {
    floatingControl: { enabled: true, position: { x: 40, y: 60 } },
    edges: {
      top: { pinned: true, open: true },
      bottom: { pinned: false, open: false },
      left: { pinned: false, open: true },
      right: { pinned: true, open: false },
    },
    onFloatingControlChange: vi.fn(),
    onPinnedChange: vi.fn(),
    onOpenChange: vi.fn(),
    ...overrides,
  }
  return render(<SidebarControlCard {...props} />)
}
