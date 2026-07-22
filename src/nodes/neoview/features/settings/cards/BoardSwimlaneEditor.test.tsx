import { describe, expect, it } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { createBoardLanes, createBoardPatch } from "./BoardSwimlaneEditor"

describe("BoardSwimlaneEditor layout moves", () => {
  it("moves a panel from left to right without dropping its cards", () => {
    const shell = shellConfig()
    const lanes = createBoardLanes(shell)
    const folder = lanes.left.find((panel) => panel.id === "folder")
    expect(folder?.cards.some((card) => card.id === "folder-main")).toBe(true)

    // Simulate the live cross-lane membership change used during drag-over.
    const withoutFolder = {
      ...lanes,
      left: lanes.left.filter((panel) => panel.id !== "folder"),
      right: [...lanes.right, folder!],
    }
    expect(withoutFolder.right.some((panel) => panel.id === "folder")).toBe(true)
    expect(withoutFolder.left.some((panel) => panel.id === "folder")).toBe(false)

    const patch = createBoardPatch(shell, withoutFolder)
    expect(patch.board.panels.find((panel) => panel.id === "folder")).toMatchObject({
      position: "right",
      visible: true,
    })
    expect(patch.board.cards.find((card) => card.cardId === "folder-main")).toMatchObject({
      panelId: "folder",
      visible: true,
    })
  })

  it("keeps exclusive folder-main alone on its host after a board patch", () => {
    const shell = shellConfig()
    const lanes = createBoardLanes(shell)
    const folder = lanes.left.find((panel) => panel.id === "folder")!
    const info = lanes.right.find((panel) => panel.id === "info") ?? lanes.left.find((panel) => panel.id === "info")
    // Place folder panel on the right; exclusive card stays on folder.
    const next = {
      left: lanes.left.filter((panel) => panel.id !== "folder"),
      right: info
        ? [folder, ...lanes.right.filter((panel) => panel.id !== "folder")]
        : [folder, ...lanes.right],
      hidden: lanes.hidden,
    }
    const patch = createBoardPatch(shell, next)
    const folderCards = patch.board.cards.filter((card) => card.panelId === "folder" && card.visible)
    expect(folderCards.map((card) => card.cardId)).toEqual(["folder-main"])
  })

  it("does not hide required cards when their host panel is in the hidden lane", () => {
    const shell = shellConfig()
    const lanes = createBoardLanes(shell)
    // playlist panel is defaultVisible:false → starts in the hidden lane with
    // playlist-main (canHide:false). Saving must not emit visible:false for it.
    const playlist = lanes.hidden.find((panel) => panel.id === "playlist")
      ?? lanes.left.find((panel) => panel.id === "playlist")
      ?? lanes.right.find((panel) => panel.id === "playlist")
    expect(playlist).toBeTruthy()
    expect(playlist!.cards.some((card) => card.id === "playlist-main" && card.canHide === false)).toBe(true)

    const patch = createBoardPatch(shell, lanes)
    expect(patch.board.panels.find((panel) => panel.id === "playlist")).toMatchObject({ visible: false })
    expect(patch.board.cards.find((card) => card.cardId === "playlist-main")).toMatchObject({
      panelId: "playlist",
      visible: true,
    })
  })
})

function shellConfig(): ReaderShellConfigDto {
  return {
    revision: 3,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {
      folder: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
      settings: { visible: true, order: 1, position: "left" },
    },
    cardLayout: {
      "folder-main": { panelId: "folder", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
