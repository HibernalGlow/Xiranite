import { describe, expect, it, vi } from "vitest"

import { CARD_DEFINITIONS, PANEL_DEFINITIONS, availablePanels, cardsForPanel, resolveLegacyPanels } from "./registry"

describe("NeoView panel and card registries", () => {
  it("[neoview.shell.registry] preserves the complete legacy panel identity surface", () => {
    expect(PANEL_DEFINITIONS.map((panel) => panel.id)).toEqual([
      "folder", "history", "bookmark", "pageList", "playlist", "settings",
      "info", "properties", "upscale", "insights", "control", "ai", "benchmark", "cardwindow",
    ])
  })

  it("[neoview.shell.registry-lazy] reads metadata without invoking any card loader", () => {
    const loaders = CARD_DEFINITIONS.map((card) => vi.spyOn(card, "load"))
    expect(availablePanels("left").map((panel) => panel.id)).toEqual(["folder", "history", "bookmark", "pageList"])
    expect(availablePanels("right").map((panel) => panel.id)).toEqual(["info"])
    for (const loader of loaders) expect(loader).not.toHaveBeenCalled()
    for (const loader of loaders) loader.mockRestore()
  })

  it("[neoview.shell.registry-compat] preserves unknown old panel configuration", () => {
    expect(resolveLegacyPanels([
      { id: "info", position: "left", order: 4 },
      { id: "future-plugin-panel", position: "right", visible: false },
    ])).toEqual([
      expect.objectContaining({ id: "info", unknown: false, definition: expect.objectContaining({ id: "info" }) }),
      { id: "future-plugin-panel", position: "right", visible: false, definition: undefined, unknown: true },
    ])
  })

  it("[neoview.shell.registry-config] applies visible/order config without touching lazy loaders", () => {
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: false, order: 20, position: "left" },
        folder: { visible: true, order: 0, position: "left" },
      },
    } as never).map((panel) => panel.id)).toEqual(["folder", "history", "bookmark"])
    expect(availablePanels("right", {
      panelLayout: {
        info: { visible: true, order: 10, position: "right" },
        properties: { visible: true, order: 1, position: "right" },
      },
    } as never).map((panel) => panel.id)).toEqual(["info"])
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: false, order: 20, position: "left" },
        info: { visible: true, order: 0, position: "left" },
      },
    } as never).map((panel) => panel.id)).toEqual(["folder", "info", "history", "bookmark"])
  })

  it("[neoview.settings.card-docking] keeps setting cards undocked by default and allows explicit sidebar placement", () => {
    expect(availablePanels("left").map((panel) => panel.id)).not.toContain("settings")
    expect(availablePanels("left", {
      panelLayout: { settings: { visible: true, order: 99, position: "left" } },
      cardLayout: { "panel-layout-settings": { panelId: "settings", visible: true, expanded: true, order: 0 } },
    } as never).map((panel) => panel.id)).toContain("settings")
    expect(cardsForPanel("settings")).toEqual([])
    expect(cardsForPanel("settings", {
      cardLayout: { "sidebar-management-settings": { panelId: "settings", visible: true, expanded: true, order: 1 } },
    } as never).map((card) => card.id)).toContain("sidebar-management-settings")
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: true, order: 0, position: "left" },
        settings: { visible: true, order: 99, position: "left" },
      },
      cardLayout: {
        "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
        "panel-layout-settings": { panelId: "settings", visible: true, expanded: true, order: 0 },
      },
    } as never, false).map((panel) => panel.id)).toEqual(["folder", "history", "bookmark", "settings"])
  })
})
