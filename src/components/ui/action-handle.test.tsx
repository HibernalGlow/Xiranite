import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionHandle } from "./action-handle"

afterEach(cleanup)

function items(count: number, selected?: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: `操作 ${index}`,
    preview: index === selected ? "显示对应操作预览" : undefined,
    icon: <span>{index}</span>,
    onSelect: index === selected ? vi.fn() : vi.fn(),
  }))
}

describe("ActionHandle", () => {
  it("opens a compact accessible palette anchored to the trigger center", () => {
    const selected = vi.fn()
    render(<ActionHandle items={items(8, 4).map((item, index) => ({ ...item, onSelect: index === 4 ? selected : vi.fn() }))} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 900, right: 928, top: 10, bottom: 38, width: 28, height: 28 }) })

    fireEvent.click(handle)
    expect(screen.getAllByRole("menuitem")).toHaveLength(8)
    const menu = screen.getByRole("menu")
    expect(menu.getAttribute("data-action-placement")).toBe("left")
    expect(menu.getAttribute("data-action-palette-size")).toBe("114")
    expect(Number.parseFloat(menu.getAttribute("style")?.match(/left:\s*([\d.]+)px/)?.[1] ?? "0") + 57).toBeCloseTo(914)
    const action = screen.getByRole("menuitem", { name: "操作 4" })
    fireEvent.pointerEnter(action)
    expect(screen.getByRole("status").textContent).toContain("显示对应操作预览")
    fireEvent.click(action)
    expect(selected).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("accepts custom layout geometry without changing the trigger anchor", () => {
    render(<ActionHandle items={items(9)} layout={{ itemSize: 40, radius: 50, ringStep: 40, palettePadding: 10, maxRings: 2 }} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, top: 100, width: 28, height: 28 }) })
    fireEvent.click(handle)
    const menu = screen.getByRole("menu")
    expect(menu.getAttribute("data-action-rings")).toBe("2")
    expect(menu.getAttribute("data-action-palette-size")).toBe("240")
  })

  it("supports custom compass slots for a wheel preset", () => {
    const selected = vi.fn()
    render(
      <ActionHandle
        items={items(2).map((item, index) => ({ ...item, onSelect: index === 1 ? selected : vi.fn() }))}
        layout={{ positions: { "1": { x: 1, y: 0, ring: 0 }, "0": { x: 0, y: -1, ring: 1 } } }}
      />,
    )
    const handle = screen.getByRole("button", { name: /手柄/ })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, top: 100, width: 28, height: 28 }) })
    fireEvent.click(handle)
    const menu = screen.getByRole("menu")
    expect(menu.getAttribute("data-action-rings")).toBe("2")
    const customOuter = screen.getByRole("menuitem", { name: /操作 0/ })
    expect(customOuter.getAttribute("style")).toContain("top: 6px")

    fireEvent.pointerDown(handle, { button: 0, pointerId: 11, clientX: 114, clientY: 114 })
    fireEvent.pointerMove(handle, { pointerId: 11, clientX: 180, clientY: 114 })
    fireEvent.pointerUp(handle, { pointerId: 11, clientX: 180, clientY: 114 })
    expect(selected).toHaveBeenCalledOnce()
  })

  it("selects a direction without invoking actions during pointer moves", () => {
    const selected = vi.fn()
    render(<ActionHandle items={items(8).map((item, index) => ({ ...item, onSelect: index === 4 ? selected : vi.fn() }))} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, top: 100, width: 28, height: 28 }) })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 114, clientY: 114 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 180, clientY: 114 })
    expect(selected).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 180, clientY: 114 })
    expect(selected).toHaveBeenCalledOnce()
  })

  it("uses drag distance to select the same direction on a second ring", () => {
    const selected = vi.fn()
    render(<ActionHandle items={items(16).map((item, index) => ({ ...item, onSelect: index === 12 ? selected : vi.fn() }))} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, right: 128, top: 100, bottom: 128, width: 28, height: 28 }) })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 10, clientX: 114, clientY: 114 })
    expect(screen.getByRole("menu").getAttribute("data-action-rings")).toBe("2")
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 184, clientY: 114 })
    fireEvent.pointerUp(handle, { pointerId: 10, clientX: 184, clientY: 114 })
    expect(selected).toHaveBeenCalledOnce()
  })
})
