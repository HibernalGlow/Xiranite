import { describe, expect, it } from "vitest"
import { LegacyRadialMenuCodec } from "./LegacyRadialMenuCodec.js"

describe("LegacyRadialMenuCodec", () => {
  it("[neoview.bindings.legacy-radial] converts menus, layers, actions and cross-menu jumps", () => {
    const result = new LegacyRadialMenuCodec().decode({
      id: "default",
      name: "旧轮盘",
      enabled: true,
      layerCount: 3,
      activeMenuId: "second",
      menus: [
        { id: "default", name: "主菜单", items: [{ id: "next", label: "下一页", action: "nextPage", children: [{ id: "zoom", label: "放大", action: "zoomIn" }] }] },
        { id: "second", name: "第二菜单", layers: [[{ id: "back", label: "返回", action: null, moveToMenuId: "default" }], [], []] },
      ],
      radius: 140,
      innerRadius: 36,
      variant: "bubble",
      startAngle: -45,
      sweepAngle: 270,
    })

    expect(result.config).toMatchObject({ activeMenuId: "second", radius: 140, innerRadius: 36, variant: "bubble" })
    expect(result.config?.menus[0]?.layers[0]?.[0]).toMatchObject({ id: "next", action: "reader.next-page" })
    expect(result.config?.menus[0]?.layers[1]?.[0]).toMatchObject({ id: "zoom", action: "reader.zoom-in" })
    expect(result.config?.menus[1]?.layers[0]?.[0]).toMatchObject({ id: "back", moveToMenuId: "default" })
  })

  it("[neoview.bindings.legacy-radial-report] keeps valid slots while reporting unknown actions and invalid geometry", () => {
    const result = new LegacyRadialMenuCodec().decode({
      id: "bad id",
      name: "",
      items: [{ id: "item", label: "Future", action: "futureAction" }],
      radius: 999,
      innerRadius: 999,
    }, "appSettings.radialMenus")

    expect(result.config).toMatchObject({ activeMenuId: "default", radius: 300, innerRadius: 100 })
    expect(result.config?.menus[0]?.layers[0]?.[0]?.action).toBeNull()
    expect(result.report).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "appSettings.radialMenus.menus[0].id", status: "converted" }),
      expect.objectContaining({ sourcePath: "appSettings.radialMenus.menus[0].items[0].action", status: "skipped" }),
      expect.objectContaining({ sourcePath: "appSettings.radialMenus.radius", status: "converted" }),
    ]))
  })
})
