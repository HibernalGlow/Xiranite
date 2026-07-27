export const FOLDER_ENTRY_REMOVED_EVENT = "entry-removed"

export function publishFolderEntryRemoved(events: EventTarget, path: string): void {
  const targetPath = path.trim()
  if (!targetPath) return
  events.dispatchEvent(new CustomEvent(FOLDER_ENTRY_REMOVED_EVENT, { detail: { path: targetPath } }))
}

export function folderEntryRemovedPath(event: Event): string | undefined {
  if (!(event instanceof CustomEvent)) return undefined
  const detail = event.detail as { path?: unknown } | undefined
  return typeof detail?.path === "string" && detail.path.trim() ? detail.path : undefined
}
