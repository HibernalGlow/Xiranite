import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import PanelLayoutEditor, { createPanelBoardPatch, createPanelLayoutColumns, movePanelLayoutCard } from "./PanelLayoutEditor"

afterEach(cleanup)

describe("PanelLayoutEditor", () => {
  it("[neoview.panel-editor.batch] keeps a local draft and saves the complete board once", async () => {
    const save = vi.fn(async () => undefined)
    render(<PanelLayoutEditor shell={shell()} onSave={save} />)
    expect(screen.getByRole("button", { name: "拖动页面导航" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "拖动书籍信息" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "保存面板布局" }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      board: {
        cards: expect.arrayContaining([
          { cardId: "page-navigation", panelId: "pageList", visible: true, order: 0 },
          { cardId: "book-information", panelId: "info", visible: true, order: 0 },
          { cardId: "panel-layout-settings", panelId: "settings", visible: false, order: 0 },
        ]),
      },
    })
  })

  it("[neoview.settings.card-docking] exposes every registered panel and enables the destination when a hidden card is docked", () => {
    const current = shell()
    const columns = createPanelLayoutColumns(current)
    expect(Object.keys(columns)).toEqual(expect.arrayContaining(["__hidden__", "folder", "pageList", "settings", "info"]))

    const moved = movePanelLayoutCard(columns, "panel-layout-settings", "settings")
    const patch = createPanelBoardPatch(current, moved)
    expect(patch.board.cards).toContainEqual({ cardId: "panel-layout-settings", panelId: "settings", visible: true, order: 0 })
    expect(patch.board.panels).toContainEqual({ id: "settings", visible: true, order: 99, position: "left" })
  })
})

function shell(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {} as ReaderShellConfigDto["edges"],
    sidebars: {} as ReaderShellConfigDto["sidebars"],
    panelLayout: {
      pageList: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
