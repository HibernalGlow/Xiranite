export interface ReaderEntryClickModifiers {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function readerEntryClickIntent(
  event: ReaderEntryClickModifiers,
  explicitSelection = false,
): "open" | "select" {
  return explicitSelection || event.ctrlKey || event.metaKey || event.shiftKey ? "select" : "open"
}
