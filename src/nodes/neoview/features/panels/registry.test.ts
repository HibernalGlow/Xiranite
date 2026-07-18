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
    expect(availablePanels("right").map((panel) => panel.id)).toEqual(["info", "properties", "control"])
    for (const loader of loaders) expect(loader).not.toHaveBeenCalled()
    for (const loader of loaders) loader.mockRestore()
  })

  it("[neoview.history.shell] preserves the non-hideable legacy History Card contract", () => {
    expect(CARD_DEFINITIONS.find((card) => card.id === "history-list")?.canHide).toBe(false)
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
    } as never).map((panel) => panel.id)).toEqual(["properties", "control", "info"])
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: false, order: 20, position: "left" },
        info: { visible: true, order: 0, position: "left" },
      },
    } as never).map((panel) => panel.id)).toEqual(["folder", "info", "history", "bookmark"])
  })

  it("[neoview.card.parallel-core] exposes preload and current-book settings without eager loading", () => {
    expect(cardsForPanel("info").map((card) => card.id)).toContain("preload-status")
    expect(CARD_DEFINITIONS.find((card) => card.id === "preload-status")?.icon).toBeTruthy()
    expect(cardsForPanel("properties").map((card) => card.id)).toEqual(["book-settings"])
    expect(cardsForPanel("properties", undefined, false)).toEqual([])
  })

  it("[neoview.thumbnail-maintenance.registry] keeps maintenance session-independent and undocked by default", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "thumbnail-maintenance")
    expect(definition).toMatchObject({
      defaultPanel: "control",
      defaultSidebarVisible: false,
      requiresSession: false,
      canHide: true,
    })
    expect(cardsForPanel("control").map((card) => card.id)).toEqual(["sidebar-control", "color-filter", "page-transition"])
    expect(cardsForPanel("control", {
      cardLayout: { "thumbnail-maintenance": { panelId: "control", visible: true, expanded: true, order: 1 } },
    } as never, false).map((card) => card.id)).toEqual(["sidebar-control", "color-filter", "page-transition", "thumbnail-maintenance"])
  })

  it("[neoview.color-filter.registry] exposes the session-independent legacy control Card lazily", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "color-filter")
    expect(definition).toMatchObject({
      title: "颜色滤镜",
      defaultPanel: "control",
      defaultSidebarVisible: true,
      requiresSession: false,
      canHide: true,
    })
    expect(definition?.icon).toBeTruthy()
    expect(cardsForPanel("control", undefined, false).map((card) => card.id)).toContain("color-filter")
  })

  it("[neoview.page-transition.registry] exposes the session-independent legacy control Card lazily", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "page-transition")
    expect(definition).toMatchObject({
      title: "翻页动画",
      defaultPanel: "control",
      defaultSidebarVisible: true,
      requiresSession: false,
      canHide: true,
    })
    expect(definition?.icon).toBeTruthy()
    expect(cardsForPanel("control", undefined, false).map((card) => card.id)).toContain("page-transition")
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
