import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"
import { ReaderRadialMenuOverlay } from "./ReaderRadialMenuOverlay"
import { NeoViewRayMenu } from "../../vendor/ray-menu/wc/neoview-ray-menu"

afterEach(cleanup)

describe("ReaderRadialMenuOverlay", () => {
  it("[neoview.bindings.radial-runtime] delegates geometry and selection to the copied ray-menu component", async () => {
    const open = vi.spyOn(NeoViewRayMenu.prototype, "open")
    const onSelect = vi.fn()
    const config = structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)
    config.menus[0]!.layers[0] = [{ id: "next", label: "下一页", action: "reader.next-page", slotIndex: 0 }]
    render(<ReaderRadialMenuOverlay config={config} request={{ id: 1, x: 120, y: 180 }} onClose={vi.fn()} onSelect={onSelect} />)
    await waitFor(() => expect(open).toHaveBeenCalledWith(120, 180))
    const element = document.querySelector("neoview-ray-menu") as NeoViewRayMenu
    expect(element.style.position).toBe("absolute")
    expect(element.style.zIndex).toBe("70")
    expect(element.layers[0]?.[0]).toMatchObject({ id: "next", action: "reader.next-page" })
    const menu = element.shadowRoot?.querySelector<HTMLElement>('[role="menu"]')
    const label = menu?.querySelector<HTMLElement>('[role="menuitem"]')
    expect(menu?.style.width).toBe("400px")
    expect(menu?.style.height).toBe("400px")
    expect(label?.style.left).toContain("calc(50% +")
    expect(label?.style.top).toContain("calc(50% +")
    element.dispatchEvent(new CustomEvent("ray-select", { detail: { id: "next", label: "下一页", action: "reader.next-page" } }))
    expect(onSelect).toHaveBeenCalledWith("reader.next-page")
    open.mockRestore()
  })

  it("converts window coordinates into the Reader lane and clamps against its viewport", async () => {
    const open = vi.spyOn(NeoViewRayMenu.prototype, "open")
    const view = render(<div data-reader-boundary="true"><ReaderRadialMenuOverlay config={structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)} request={{ id: 3, x: 540, y: 320 }} onClose={vi.fn()} onSelect={vi.fn()} /></div>)
    const boundary = view.container.querySelector<HTMLElement>('[data-reader-boundary="true"]')!
    boundary.getBoundingClientRect = () => ({ left: 400, top: 80, width: 600, height: 500, right: 1000, bottom: 580, x: 400, y: 80, toJSON: () => ({}) })
    view.rerender(<div data-reader-boundary="true"><ReaderRadialMenuOverlay config={structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)} request={{ id: 4, x: 540, y: 320 }} onClose={vi.fn()} onSelect={vi.fn()} /></div>)
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(140, 240))
    expect((document.querySelector("neoview-ray-menu") as NeoViewRayMenu).viewport).toEqual({ width: 600, height: 500 })
    open.mockRestore()
  })

  it("[neoview.bindings.radial-empty] keeps an enabled empty menu visible with no executable action", async () => {
    const open = vi.spyOn(NeoViewRayMenu.prototype, "open")
    const config = structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)
    config.menus[0]!.layers[0] = []
    render(<ReaderRadialMenuOverlay config={config} request={{ id: 2, x: 40, y: 60 }} onClose={vi.fn()} onSelect={vi.fn()} />)
    await waitFor(() => expect(open).toHaveBeenCalledWith(40, 60))
    const element = document.querySelector("neoview-ray-menu") as NeoViewRayMenu
    expect(element.layers[0]).toMatchObject([{ id: "empty", disabled: true, action: null }])
    open.mockRestore()
  })
})
