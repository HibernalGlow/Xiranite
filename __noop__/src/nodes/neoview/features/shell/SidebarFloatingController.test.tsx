import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarFloatingController, type SidebarFloatingControllerProps } from "./SidebarFloatingController"

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SidebarFloatingController", () => {
  it("[neoview.sidebar-control.floating-layer] renders the legacy layer identity and four edge controls", () => {
    renderController()

    expect(screen.getByRole("group", { name: "侧栏控制器" }).getAttribute("data-layer-id")).toBe("sidebar-control")
    expect(screen.getByRole("button", { name: /顶部边栏/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /底部边栏/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /左侧边栏/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /右侧边栏/ })).toBeTruthy()
  })

  it("[neoview.sidebar-control.lock-cycle] preserves right-click cycling and exposes explicit lock buttons", () => {
    const onLockCycle = vi.fn()
    renderController({ onLockCycle })

    fireEvent.contextMenu(screen.getByRole("button", { name: /左侧边栏/ }))

    expect(onLockCycle).toHaveBeenCalledWith("left")
    expect(screen.getByRole("button", { name: "左侧边锁定模式" })).toBeTruthy()
  })

  it("[neoview.sidebar-control.drag] changes only DOM during pointer moves and commits once on completion", () => {
    const onPositionCommit = vi.fn()
    renderController({ onPositionCommit })
    const handle = screen.getByRole("button", { name: "拖动侧栏控制器" })
    const root = screen.getByRole("group", { name: "侧栏控制器" })

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 100 })
    for (let index = 1; index <= 40; index += 1) {
      fireEvent.pointerMove(handle, { pointerId: 7, clientX: 100 + index, clientY: 100 + index })
    }
    expect(onPositionCommit).not.toHaveBeenCalled()
    expect(root.style.left).not.toBe("100px")

    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 140, clientY: 140 })
    expect(onPositionCommit).toHaveBeenCalledOnce()
  })

  it("[neoview.sidebar-control.accessibility] moves by keyboard with bounded single commits", () => {
    const onPositionCommit = vi.fn()
    renderController({ onPositionCommit })
    const handle = screen.getByRole("button", { name: "拖动侧栏控制器" })

    fireEvent.keyDown(handle, { key: "ArrowRight" })
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true })
    fireEvent.keyDown(handle, { key: "Home" })

    expect(onPositionCommit).toHaveBeenNthCalledWith(1, { x: 108, y: 100 })
    expect(onPositionCommit).toHaveBeenNthCalledWith(2, { x: 100, y: 132 })
    expect(onPositionCommit).toHaveBeenNthCalledWith(3, { x: 100, y: 100 })
  })
})

function renderController(overrides: Partial<SidebarFloatingControllerProps> = {}) {
  const props: SidebarFloatingControllerProps = {
    position: { x: 100, y: 100 },
    edges: {
      top: { open: true, lockMode: "auto" },
      right: { open: false, lockMode: "auto" },
      bottom: { open: false, lockMode: "locked-hidden" },
      left: { open: true, lockMode: "locked-open" },
    },
    onOpenChange: vi.fn(),
    onLockCycle: vi.fn(),
    onLockModeChange: vi.fn(),
    onPositionCommit: vi.fn(),
    ...overrides,
  }
  const view = render(<div className="relative h-[360px] w-[420px]"><SidebarFloatingController {...props} /></div>)
  const root = screen.getByRole("group", { name: "侧栏控制器" })
  if (root.parentElement) {
    Object.defineProperty(root.parentElement, "clientWidth", { configurable: true, value: 420 })
    Object.defineProperty(root.parentElement, "clientHeight", { configurable: true, value: 360 })
  }
  return view
}
