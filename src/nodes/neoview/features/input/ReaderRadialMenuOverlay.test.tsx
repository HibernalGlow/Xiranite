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
    expect(element.layers[0]?.[0]).toMatchObject({ id: "next", action: "reader.next-page" })
    element.dispatchEvent(new CustomEvent("ray-select", { detail: { id: "next", label: "下一页", action: "reader.next-page" } }))
    expect(onSelect).toHaveBeenCalledWith("reader.next-page")
    open.mockRestore()
  })
})
