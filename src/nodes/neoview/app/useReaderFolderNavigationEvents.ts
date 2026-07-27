import { useMemo } from "react"

export function useReaderFolderNavigationEvents() {
  return useMemo(() => {
    const folderNavigationEvents = new EventTarget()
    return {
      folderNavigationEvents,
      browsePath: (path: string) => {
        folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path, newTab: false } }))
      },
      activateInFolderCard: (path: string): boolean => {
        const detail = { path, handled: false }
        folderNavigationEvents.dispatchEvent(new CustomEvent("activate", { detail }))
        return detail.handled
      },
      openFolderPathInNewTab: (path: string) => {
        folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path, newTab: true } }))
      },
    }
  }, [])
}
