import { describe, expect, it } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { moveReaderPanel, readerPanelIdsForSide } from "./reader-panel-layout"

describe("reader panel layout", () => {
  it("[neoview.sidebar.panel-dnd] reorders a panel and normalizes the source rail", () => {
    const result = moveReaderPanel(shell(), "pageList", "left", 0)

    expect(result).toBeTruthy()
    expect(readerPanelIdsForSide(result!.shell, "left").slice(0, 3)).toEqual(["pageList", "folder", "history"])
    expect(result!.patch.board.panels.find((panel) => panel.id === "pageList")).toMatchObject({ position: "left", order: 0 })
  })

  it("[neoview.sidebar.panel-dnd] moves panels between rails without changing cards or unknown panels", () => {
    const current = shell()
    const result = moveReaderPanel(current, "history", "right", 1)

    expect(result).toBeTruthy()
    expect(readerPanelIdsForSide(result!.shell, "left").slice(0, 2)).toEqual(["folder", "pageList"])
    expect(readerPanelIdsForSide(result!.shell, "right").slice(0, 2)).toEqual(["info", "history"])
    expect(result!.shell.cardLayout).toBe(current.cardLayout)
    expect(result!.shell.panelLayout.future).toEqual(current.panelLayout.future)
    expect(result!.patch.board.cards).toContainEqual({ cardId: "future-card", panelId: "future", visible: false, order: 7 })
  })

  it("[neoview.sidebar.panel-dnd] rejects fixed and unchanged moves", () => {
    expect(moveReaderPanel(shell(), "cardwindow", "left", 0)).toBeUndefined()
    expect(moveReaderPanel(shell(), "folder", "left", 0)).toBeUndefined()
  })
})

function shell(): ReaderShellConfigDto {
  return {
    revision: 7,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {} as ReaderShellConfigDto["edges"],
    sidebars: {} as ReaderShellConfigDto["sidebars"],
    panelLayout: {
      folder: { visible: true, order: 0, position: "left" },
      history: { visible: true, order: 1, position: "left" },
      pageList: { visible: true, order: 2, position: "left" },
      bookmark: { visible: false, order: 3, position: "left" },
      settings: { visible: false, order: 99, position: "left" },
      info: { visible: true, order: 0, position: "right" },
      properties: { visible: false, order: 1, position: "right" },
      upscale: { visible: false, order: 2, position: "right" },
      insights: { visible: false, order: 3, position: "right" },
      control: { visible: false, order: 4, position: "right" },
      ai: { visible: false, order: 5, position: "right" },
      future: { visible: false, order: 20, position: "floating" },
      cardwindow: { visible: false, order: 100, position: "floating" },
    },
    cardLayout: {
      "folder-main": { panelId: "folder", visible: true, expanded: true, order: 0 },
      "history-list": { panelId: "history", visible: true, expanded: true, order: 0 },
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
      "future-card": { panelId: "future", visible: false, expanded: true, order: 7 },
    },
  }
}
