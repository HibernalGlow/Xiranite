import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => { vi.unstubAllGlobals() })

describe("Reader radial action bindings client", () => {
  it("[neoview.radial-bindings.client] sends the radial layout and action bindings as one config mutation", async () => {
    const inputBindings = { bindings: [{ id: "radial-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "radial", menuId: "default", itemId: "next" } }] } as const
    const radialMenu = { config: { enabled: true, layerCount: 1, activeMenuId: "default", menus: [{ id: "default", name: "默认轮盘", layers: [[{ id: "next", label: "下一页", slotIndex: 0 }], [], []] }], radius: 120, innerRadius: 40, variant: "slice", startAngle: -90, sweepAngle: 360 } } as const
    const fetchMock = vi.fn(async () => Response.json({ inputBindings, radialMenu: radialMenu.config }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updateInputBindingsAndRadialMenu!({ inputBindings: inputBindings as never, radialMenu: radialMenu as never })).resolves.toMatchObject({ inputBindings, radialMenu: radialMenu.config })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ inputBindings, radialMenu })
  })
})
