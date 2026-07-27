import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react"

import type { ReaderDirectoryNavigationDto } from "../../../../adapters/reader-http-client"
import type { DirectoryCatalog } from "./DirectoryCatalog"
import type { DirectorySelectionModel } from "./DirectorySelection"
import { removeFolderCatalogEntry } from "./FolderCatalogRemoval"
import { FOLDER_ENTRY_REMOVED_EVENT, folderEntryRemovedPath } from "./FolderNavigationEvents"

type FolderNavigationOptions = {
  keepTree?: boolean
  focusPath?: string
  preserveThumbnailCache?: boolean
}

export function useFolderExternalDeletion({
  events,
  enabled,
  catalogRef,
  sourcePath,
  focusedPath,
  focusedIndexRef,
  commitCatalog,
  setFocusedIndex,
  setFocusedPath,
  setSelection,
  navigate,
}: {
  events?: EventTarget
  enabled: boolean
  catalogRef: RefObject<DirectoryCatalog | undefined>
  sourcePath?: string
  focusedPath?: string
  focusedIndexRef: RefObject<number | undefined>
  commitCatalog(catalog: DirectoryCatalog): void
  setFocusedIndex: Dispatch<SetStateAction<number | undefined>>
  setFocusedPath: Dispatch<SetStateAction<string | undefined>>
  setSelection: Dispatch<SetStateAction<DirectorySelectionModel>>
  navigate(navigation: ReaderDirectoryNavigationDto, options?: FolderNavigationOptions): Promise<void>
}): void {
  const handlersRef = useRef({
    catalogRef,
    sourcePath,
    focusedPath,
    focusedIndexRef,
    commitCatalog,
    setFocusedIndex,
    setFocusedPath,
    setSelection,
    navigate,
  })
  handlersRef.current = {
    catalogRef,
    sourcePath,
    focusedPath,
    focusedIndexRef,
    commitCatalog,
    setFocusedIndex,
    setFocusedPath,
    setSelection,
    navigate,
  }

  useEffect(() => {
    if (!events || !enabled) return
    const entryRemoved = (event: Event) => {
      const targetPath = folderEntryRemovedPath(event)
      const handlers = handlersRef.current
      const catalog = handlers.catalogRef.current
      if (!targetPath || !catalog) return
      const removal = removeFolderCatalogEntry({
        catalog,
        targetPath,
        sourcePath: handlers.sourcePath,
        focusedPath: handlers.focusedPath,
      })
      if (!removal) return
      handlers.commitCatalog(removal.catalog)
      handlers.focusedIndexRef.current = removal.focusedIndex
      handlers.setFocusedIndex(removal.focusedIndex)
      handlers.setFocusedPath(removal.focusedPath)
      handlers.setSelection(removal.selection)
      void handlers.navigate(
        { action: "refresh" },
        { keepTree: true, focusPath: removal.focusedPath, preserveThumbnailCache: true },
      )
    }
    events.addEventListener(FOLDER_ENTRY_REMOVED_EVENT, entryRemoved)
    return () => events.removeEventListener(FOLDER_ENTRY_REMOVED_EVENT, entryRemoved)
  }, [enabled, events])
}
