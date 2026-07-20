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
    expect(availablePanels("left").map((panel) => panel.id)).toEqual(["folder", "history", "bookmark", "pageList", "settings"])
    expect(availablePanels("right").map((panel) => panel.id)).toEqual(["info", "properties", "upscale", "insights", "control"])
    for (const loader of loaders) expect(loader).not.toHaveBeenCalled()
    for (const loader of loaders) loader.mockRestore()
  })

  it("[neoview.history.shell] preserves the non-hideable legacy History Card contract", () => {
    expect(CARD_DEFINITIONS.find((card) => card.id === "history-list")?.canHide).toBe(false)
  })

  it("[neoview.card.exclusive-panel] declares all full-size cards explicitly", () => {
    expect(CARD_DEFINITIONS.filter((card) => card.exclusivePanel).map((card) => card.id)).toEqual([
      "folder-main",
      "history-list",
      "bookmark-list",
      "page-navigation",
    ])
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
    } as never).map((panel) => panel.id)).toEqual(["folder", "history", "bookmark", "settings"])
    expect(availablePanels("right", {
      panelLayout: {
        info: { visible: true, order: 10, position: "right" },
        properties: { visible: true, order: 1, position: "right" },
      },
    } as never).map((panel) => panel.id)).toEqual(["properties", "upscale", "insights", "control", "info"])
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: false, order: 20, position: "left" },
        info: { visible: true, order: 0, position: "left" },
      },
    } as never).map((panel) => panel.id)).toEqual(["folder", "info", "history", "bookmark", "settings"])
  })

  it("[neoview.settings.registry] maps settings cards to settings sections and the settings panel", () => {
    expect(CARD_DEFINITIONS.filter((card) => card.settingsSectionId).map((card) => card.id)).toEqual(expect.arrayContaining([
      "slideshow-settings",
      "media-settings",
      "view-defaults-settings",
      "reader-material-settings",
      "board-layout-settings",
      "input-bindings-settings",
      "data-migration-settings",
      "about-settings",
    ]))
    expect(cardsForPanel("settings").map((card) => card.id)).toEqual([
      "slideshow-settings",
      "media-settings",
      "view-defaults-settings",
      "reader-material-settings",
      "board-layout-settings",
      "input-bindings-settings",
      "data-migration-settings",
      "about-settings",
    ])
  })

  it("[neoview.card.parallel-core] exposes preload and current-book settings without eager loading", () => {
    expect(cardsForPanel("info").map((card) => card.id)).toContain("preload-status")
    expect(CARD_DEFINITIONS.find((card) => card.id === "preload-status")?.icon).toBeTruthy()
    expect(cardsForPanel("properties").map((card) => card.id)).toEqual(["book-settings"])
    expect(cardsForPanel("properties", undefined, false).map((card) => card.id)).toEqual(["book-settings"])
  })

  it("[neoview.thumbnail-maintenance.registry] keeps maintenance session-independent and undocked by default", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "thumbnail-maintenance")
    expect(definition).toMatchObject({
      defaultPanel: "control",
      defaultSidebarVisible: false,
      requiresSession: false,
      canHide: true,
    })
    expect(cardsForPanel("control").map((card) => card.id)).toEqual(["switch-toast", "sidebar-control", "color-filter", "page-transition", "sidebar-height", "image-trim", "animated-video-mode"])
    expect(cardsForPanel("control", {
      cardLayout: { "thumbnail-maintenance": { panelId: "control", visible: true, expanded: true, order: 1 } },
    } as never, false).map((card) => card.id)).toEqual(["switch-toast", "sidebar-control", "color-filter", "page-transition", "sidebar-height", "image-trim", "animated-video-mode", "thumbnail-maintenance"])
  })

  it("[neoview.switch-toast.registry] exposes the legacy Card first, resident and lazy", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "switch-toast")
    expect(definition).toMatchObject({
      title: "切换提示",
      defaultPanel: "control",
      defaultSidebarVisible: true,
      requiresSession: false,
      canHide: true,
    })
    expect(definition?.icon).toBeTruthy()
    expect(cardsForPanel("control", undefined, false)[0]?.id).toBe("switch-toast")
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

  it("[neoview.progressive-upscale.registry] keeps the upscale settings Card resident without a book", () => {
    const definition = CARD_DEFINITIONS.find((card) => card.id === "progressive-upscale")
    expect(definition).toMatchObject({
      title: "递进超分",
      defaultPanel: "upscale",
      defaultSidebarVisible: true,
      requiresSession: false,
      canHide: true,
    })
    expect(definition?.icon).toBeTruthy()
    expect(cardsForPanel("upscale", undefined, false).map((card) => card.id)).toEqual([
      "progressive-upscale", "upscale-model", "upscale-status", "upscale-cache", "upscale-conditions",
    ])
    expect(CARD_DEFINITIONS.filter((card) => card.id.startsWith("upscale-")).map((card) => ({ id: card.id, requiresSession: card.requiresSession }))).toEqual([
      { id: "upscale-model", requiresSession: false },
      { id: "upscale-status", requiresSession: true },
      { id: "upscale-cache", requiresSession: true },
      { id: "upscale-conditions", requiresSession: false },
    ])
  })

  it("[neoview.settings.card-docking] docks settings cards into the settings panel by default", () => {
    expect(availablePanels("left").map((panel) => panel.id)).toContain("settings")
    expect(cardsForPanel("settings").map((card) => card.id)).toEqual([
      "slideshow-settings",
      "media-settings",
      "view-defaults-settings",
      "reader-material-settings",
      "board-layout-settings",
      "input-bindings-settings",
      "data-migration-settings",
      "about-settings",
    ])
    expect(availablePanels("left", {
      panelLayout: {
        pageList: { visible: true, order: 0, position: "left" },
        settings: { visible: true, order: 99, position: "left" },
      },
      cardLayout: {
        "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      },
    } as never, false).map((panel) => panel.id)).toEqual(["folder", "pageList", "history", "bookmark", "settings"])
  })

  it("[neoview.shell.resident-cards] keeps configured panels and session-dependent Card shells resident before opening a book", () => {
    expect(availablePanels("left", undefined, false).map((panel) => panel.id)).toEqual(["folder", "history", "bookmark", "pageList", "settings"])
    expect(availablePanels("right", undefined, false).map((panel) => panel.id)).toEqual(["info", "properties", "upscale", "insights", "control"])
    expect(cardsForPanel("info", undefined, false).map((card) => card.id)).toEqual([
      "book-information", "image-information", "storage-information", "time-information", "preload-status", "info-overlay",
    ])
  })
})
