import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionHandle } from "./action-handle"

afterEach(cleanup)

describe("ActionHandle", () => {
  it("opens an accessible eight-slot palette and invokes a clicked action", () => {
    const selected = vi.fn()
    render(<ActionHandle items={Array.from({ length: 8 }, (_, index) => ({
      id: String(index), label: `操作 ${index}`, preview: index === 4 ? "显示对应操作栏" : undefined, icon: <span>{index}</span>, onSelect: index === 4 ? selected : vi.fn(),
    }))} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 900, right: 928, top: 10, bottom: 38, width: 28, height: 28 }) })

    fireEvent.click(handle)
    expect(screen.getAllByRole("menuitem")).toHaveLength(8)
    expect(screen.getByRole("menu").getAttribute("data-action-placement")).toBe("left")
    const action = screen.getByRole("menuitem", { name: "操作 4" })
    fireEvent.pointerEnter(action)
    expect(screen.getByRole("status").textContent).toContain("显示对应操作栏")
    fireEvent.click(action)
    expect(selected).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("selects a direction without invoking actions during pointer moves", () => {
    const selected = vi.fn()
    render(<ActionHandle items={Array.from({ length: 8 }, (_, index) => ({
      id: String(index), label: `操作 ${index}`, icon: <span>{index}</span>, onSelect: index === 4 ? selected : vi.fn(),
    }))} />)
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
    render(<ActionHandle items={Array.from({ length: 16 }, (_, index) => ({
      id: String(index), label: `操作 ${index}`, icon: <span>{index}</span>, onSelect: index === 12 ? selected : vi.fn(),
    }))} />)
    const handle = screen.getByRole("button", { name: "操作手柄" })
    Object.defineProperty(handle, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, right: 128, top: 100, bottom: 128, width: 28, height: 28 }) })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 10, clientX: 114, clientY: 114 })
    expect(screen.getByRole("menu").getAttribute("data-action-rings")).toBe("2")
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 214, clientY: 114 })
    fireEvent.pointerUp(handle, { pointerId: 10, clientX: 214, clientY: 114 })
    expect(selected).toHaveBeenCalledOnce()
  })
})
