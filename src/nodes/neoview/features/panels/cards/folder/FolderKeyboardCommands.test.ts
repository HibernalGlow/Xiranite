import { describe, expect, it } from "vitest"

import { resolveFolderKeyboardCommand } from "./FolderKeyboardCommands"

const context = {
  currentIndex: 10,
  total: 100,
  isGrid: true,
  gridColumns: 4,
  pageStep: 8,
  canGoBack: true,
  hasParent: true,
  multiSelectMode: true,
}

describe("resolveFolderKeyboardCommand", () => {
  it("maps virtualized focus movement and clamps sparse indexes", () => {
    expect(resolveFolderKeyboardCommand({ key: "ArrowDown" }, context)).toEqual({ kind: "move", targetIndex: 14 })
    expect(resolveFolderKeyboardCommand({ key: "PageUp" }, context)).toEqual({ kind: "move", targetIndex: 2 })
    expect(resolveFolderKeyboardCommand({ key: "Home" }, context)).toEqual({ kind: "move", targetIndex: 0 })
    expect(resolveFolderKeyboardCommand({ key: "End" }, { ...context, currentIndex: 99 })).toEqual({ kind: "move", targetIndex: 99 })
    expect(resolveFolderKeyboardCommand({ key: "ArrowLeft" }, { ...context, isGrid: false })).toBeUndefined()
  })

  it("keeps the Explorer command set stable", () => {
    expect(resolveFolderKeyboardCommand({ key: "Enter" }, context)).toEqual({ kind: "activate" })
    expect(resolveFolderKeyboardCommand({ key: "Backspace" }, context)).toEqual({ kind: "back" })
    expect(resolveFolderKeyboardCommand({ key: "F5" }, { ...context, total: 0 })).toEqual({ kind: "refresh" })
    expect(resolveFolderKeyboardCommand({ key: "Delete" }, context)).toEqual({ kind: "trash" })
    expect(resolveFolderKeyboardCommand({ key: "F2" }, context)).toEqual({ kind: "rename" })
    expect(resolveFolderKeyboardCommand({ key: "a", ctrlKey: true }, context)).toEqual({ kind: "select-all" })
    expect(resolveFolderKeyboardCommand({ key: "f", metaKey: true }, context)).toEqual({ kind: "search" })
    expect(resolveFolderKeyboardCommand({ key: "Escape" }, context)).toEqual({ kind: "clear-selection" })
    expect(resolveFolderKeyboardCommand({ key: "F10", shiftKey: true }, context)).toEqual({ kind: "context-menu" })
  })

  it("prefers navigation state and never fabricates a parent route", () => {
    expect(resolveFolderKeyboardCommand({ key: "Backspace" }, { ...context, canGoBack: false })).toEqual({ kind: "up" })
    expect(resolveFolderKeyboardCommand({ key: "Backspace" }, { ...context, canGoBack: false, hasParent: false })).toBeUndefined()
    expect(resolveFolderKeyboardCommand({ key: "Escape" }, { ...context, multiSelectMode: false })).toBeUndefined()
  })
})
