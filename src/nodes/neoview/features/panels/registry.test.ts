import { describe, expect, it, vi } from "vitest"

import { CARD_DEFINITIONS, PANEL_DEFINITIONS, availablePanels, resolveLegacyPanels } from "./registry"

describe("NeoView panel and card registries", () => {
  it("[neoview.shell.registry] preserves the complete legacy panel identity surface", () => {
    expect(PANEL_DEFINITIONS.map((panel) => panel.id)).toEqual([
      "folder", "history", "bookmark", "pageList", "playlist", "settings",
      "info", "properties", "upscale", "insights", "control", "ai", "benchmark", "cardwindow",
    ])
  })

  it("[neoview.shell.registry-lazy] reads metadata without invoking any card loader", () => {
    const loaders = CARD_DEFINITIONS.map((card) => vi.spyOn(card, "load"))
    expect(availablePanels("left").map((panel) => panel.id)).toEqual(["pageList"])
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
})
