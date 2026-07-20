export type FolderKeyboardCommand =
  | { kind: "move"; targetIndex: number }
  | { kind: "refresh" }
  | { kind: "activate" }
  | { kind: "enter-raw" }
  | { kind: "trash" }
  | { kind: "rename" }
  | { kind: "back" }
  | { kind: "up" }
  | { kind: "select-all" }
  | { kind: "clear-selection" }
  | { kind: "search" }
  | { kind: "context-menu" }

export interface FolderKeyboardInput {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export interface FolderKeyboardContext {
  currentIndex: number
  total: number
  isGrid: boolean
  gridColumns: number
  pageStep: number
  canGoBack: boolean
  hasParent: boolean
  multiSelectMode: boolean
}

/**
 * Resolve the folder surface's command vocabulary without reading DOM or React
 * state. Keeping this pure makes the keyboard contract usable by every virtual
 * renderer and prevents editable controls from leaking shortcuts into the card.
 */
export function resolveFolderKeyboardCommand(
  input: FolderKeyboardInput,
  context: FolderKeyboardContext,
): FolderKeyboardCommand | undefined {
  const key = input.key
  const modified = Boolean(input.ctrlKey || input.metaKey)

  if (key === "F5") return { kind: "refresh" }
  if (modified && key.toLowerCase() === "f") return { kind: "search" }
  if (modified && key.toLowerCase() === "a") return { kind: "select-all" }
  if (key === "Escape" && context.multiSelectMode) return { kind: "clear-selection" }
  if (key === "Backspace") {
    if (context.canGoBack) return { kind: "back" }
    if (context.hasParent) return { kind: "up" }
    return undefined
  }
  if (context.total <= 0) return undefined
  if (key === "ContextMenu" || (Boolean(input.shiftKey) && key === "F10")) return { kind: "context-menu" }
  if (key === "Enter") return input.altKey ? { kind: "enter-raw" } : { kind: "activate" }
  if (key === "Delete") return { kind: "trash" }
  if (key === "F2") return { kind: "rename" }

  let targetIndex: number | undefined
  if (key === "ArrowUp") targetIndex = context.currentIndex - Math.max(1, context.gridColumns)
  else if (key === "ArrowDown") targetIndex = context.currentIndex + Math.max(1, context.gridColumns)
  else if (key === "ArrowLeft" && context.isGrid) targetIndex = context.currentIndex - 1
  else if (key === "ArrowRight" && context.isGrid) targetIndex = context.currentIndex + 1
  else if (key === "PageUp") targetIndex = context.currentIndex - Math.max(1, context.pageStep)
  else if (key === "PageDown") targetIndex = context.currentIndex + Math.max(1, context.pageStep)
  else if (key === "Home") targetIndex = 0
  else if (key === "End") targetIndex = context.total - 1
  if (targetIndex === undefined) return undefined
  return { kind: "move", targetIndex: Math.min(Math.max(targetIndex, 0), context.total - 1) }
}
