import { describe, expect, it } from "vitest"
import { DEFAULT_READER_RADIAL_MENU_CONFIG, parseReaderRadialMenuConfig, parseReaderRadialMenuPatch } from "./ReaderRadialMenuConfig.js"

describe("ReaderRadialMenuConfig", () => {
  it("[neoview.bindings.radial-config] parses multiple menus, layers, actions and menu jumps", () => {
    const parsed = parseReaderRadialMenuConfig({
      enabled: true,
      layerCount: 2,
      activeMenuId: "reader",
      menus: [
        { id: "reader", name: "阅读", layers: [[
          { id: "next", label: "下一页", slotIndex: 0, action: "reader.next-page" },
          { id: "more", label: "更多", slotIndex: 1, action: null, moveToMenuId: "more" },
        ], []] },
        { id: "more", name: "更多", layers: [[{ id: "settings", label: "设置", slotIndex: 0, action: "reader.open-settings" }]] },
      ],
      radius: 140,
      innerRadius: 36,
      variant: "bubble",
      startAngle: -90,
      sweepAngle: 270,
    })
    expect(parsed.menus).toHaveLength(2)
    expect(parsed.menus[0]?.layers).toHaveLength(3)
    expect(parsed.menus[0]?.layers[0]?.map((item) => item.action)).toEqual(["reader.next-page", null])
  })

  it("[neoview.bindings.radial-validation] rejects executable actions, duplicate items, invalid jumps and unbounded geometry", () => {
    expect(() => parseReaderRadialMenuConfig({ menus: [{ id: "one", name: "One", items: [{ id: "x", label: "X", action: "system.exec" }] }] })).toThrow("action")
    expect(() => parseReaderRadialMenuConfig({ menus: [{ id: "one", name: "One", items: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] }] })).toThrow("duplicate item")
    expect(() => parseReaderRadialMenuConfig({ menus: [{ id: "one", name: "One", items: [{ id: "x", label: "X", moveToMenuId: "missing" }] }] })).toThrow("another existing menu")
    expect(() => parseReaderRadialMenuConfig({ ...DEFAULT_READER_RADIAL_MENU_CONFIG, radius: 20 })).toThrow("radius")
  })

  it("[neoview.bindings.radial-legacy-shape] normalizes the legacy single-menu items shape without another runtime store", () => {
    const parsed = parseReaderRadialMenuConfig({ id: "default", name: "默认轮盘", items: [{ id: "next", label: "下一页", action: "reader.next-page", slotIndex: 3 }] })
    expect(parsed.activeMenuId).toBe("default")
    expect(parsed.menus[0]?.layers[0]?.[0]).toMatchObject({ id: "next", slotIndex: 3, action: "reader.next-page" })
  })

  it("[neoview.bindings.radial-persistence] emits the canonical [nodes.neoview.bindings].radial_menus patch", () => {
    const parsed = parseReaderRadialMenuPatch({ radialMenu: { config: DEFAULT_READER_RADIAL_MENU_CONFIG } })
    expect(parsed.patch.radialMenu.config?.activeMenuId).toBe("default")
    expect(parsed.tomlPatch).toEqual({ bindings: { radial_menus: DEFAULT_READER_RADIAL_MENU_CONFIG } })
    expect(parseReaderRadialMenuPatch({ radialMenu: { reset: "defaults" } }).patch).toEqual({ radialMenu: { reset: "defaults" } })
  })
})
