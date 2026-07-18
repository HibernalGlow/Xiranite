import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import DockedSidebarControlCard, { SidebarControlCard, type SidebarControlCardProps } from "./SidebarControlCard"

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

  it("[neoview.card.sidebar-control.inactive-zero-subscription] keeps an empty shell while hidden and subscribes after activation", async () => {
    const { context, subscribe } = createDockedContext()
    const view = render(<DockedSidebarControlCard {...context} panelActive={false} />)

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(view.container.querySelector('[data-neoview-card="sidebar-control"]')).toBeNull()
    expect(subscribe).not.toHaveBeenCalled()

    view.rerender(<DockedSidebarControlCard {...context} panelActive />)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    expect(view.container.querySelector('[data-neoview-card="sidebar-control"]')).toBeTruthy()
  })
})

function createDockedContext() {
  const snapshot = {
    edges: {
      top: { pinned: true, open: true, lockMode: "auto" },
      right: { pinned: false, open: false, lockMode: "auto" },
      bottom: { pinned: false, open: false, lockMode: "auto" },
      left: { pinned: false, open: true, lockMode: "auto" },
    },
    floating: { enabled: true, position: { x: 40, y: 60 } },
  }
  const subscribe = vi.fn(() => () => undefined)
  const control = {
    store: {
      getSnapshot: vi.fn(() => snapshot),
      getTouchedSnapshot: vi.fn(() => ({ edges: { top: false, right: false, bottom: false, left: false }, floating: false })),
      subscribe,
      hydrate: vi.fn(),
      replace: vi.fn(),
      requestOpen: vi.fn(),
      setPinned: vi.fn(),
      cycleLock: vi.fn(),
      setLock: vi.fn(),
      setFloating: vi.fn(),
      setPosition: vi.fn(),
    },
    requestOpen: vi.fn(),
    setPinned: vi.fn(),
    cycleLock: vi.fn(),
    setLock: vi.fn(),
    setFloating: vi.fn(),
    setTriggerSize: vi.fn(),
    reset: vi.fn(),
  }
  const shell = {
    edges: {
      top: { enabled: true, triggerSize: 32 },
      right: { enabled: true, triggerSize: 32 },
      bottom: { enabled: true, triggerSize: 32 },
      left: { enabled: true, triggerSize: 32 },
    },
  }
  const context = {
    client: {},
    disabled: false,
    onGoTo: () => undefined,
    shell,
    shellControl: control,
  } as Parameters<typeof DockedSidebarControlCard>[0]
  return { context, subscribe }
}

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
