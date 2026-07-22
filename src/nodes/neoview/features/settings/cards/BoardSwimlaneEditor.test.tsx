import { describe, expect, it } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { applyBoardDrop, createBoardLanes, createBoardPatch } from "./BoardSwimlaneEditor"

describe("BoardSwimlaneEditor layout moves", () => {
  it("moves a panel from left to right without dropping its cards", () => {
    const shell = shellConfig()
    const lanes = createBoardLanes(shell)
    const folder = lanes.left.find((panel) => panel.id === "folder")
    expect(folder?.cards.some((card) => card.id === "folder-main")).toBe(true)

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

  it("applies a cross-panel card move exactly once at drop", () => {
    const lanes = createBoardLanes(shellConfig())
    const moved = applyBoardDrop(lanes, "book-information", "slideshow-settings")

    expect(lanes.right.find((panel) => panel.id === "info")?.cards.some((card) => card.id === "book-information")).toBe(true)
    expect(moved.left.find((panel) => panel.id === "settings")?.cards.some((card) => card.id === "book-information")).toBe(true)
    expect(applyBoardDrop(moved, "book-information", "book-information")).toBe(moved)
  })

  it("places a card after the hovered card when the landing preview says after", () => {
    const lanes = createBoardLanes(shellConfig())
    const moved = applyBoardDrop(lanes, "book-information", "media-settings", true)
    const settings = moved.left.find((panel) => panel.id === "settings")

    expect(settings?.cards.slice(0, 3).map((card) => card.id)).toEqual([
      "slideshow-settings",
      "media-settings",
      "book-information",
    ])
  })

  it("applies a cross-lane panel move exactly once at drop", () => {
    const lanes = createBoardLanes(shellConfig())
    const moved = applyBoardDrop(lanes, "settings", "info")

    expect(moved.left.some((panel) => panel.id === "settings")).toBe(false)
    expect(moved.right.some((panel) => panel.id === "settings")).toBe(true)
    expect(applyBoardDrop(moved, "settings", "settings")).toBe(moved)
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
