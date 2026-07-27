import {
  createDirectorySelection,
  selectDirectorySingle,
  type DirectorySelectionModel,
} from "./DirectorySelection"
import {
  directoryEntryAt,
  directoryEntryIndex,
  nearestLoadedDirectoryEntry,
  removeDirectoryCatalogEntry,
  type DirectoryCatalog,
} from "./DirectoryCatalog"

export interface FolderCatalogRemoval {
  catalog: DirectoryCatalog
  focusedIndex: number | undefined
  focusedPath: string | undefined
  selection: DirectorySelectionModel
}

/** Applies the same focus hand-off for a File Card deletion from any entry point. */
export function removeFolderCatalogEntry({
  catalog,
  targetPath,
  sourcePath,
  focusedPath,
}: {
  catalog: DirectoryCatalog
  targetPath: string
  sourcePath?: string
  focusedPath?: string
}): FolderCatalogRemoval | undefined {
  const removedIndex = directoryEntryIndex(catalog, targetPath)
  if (removedIndex === undefined) return undefined

  const nextCatalog = removeDirectoryCatalogEntry(catalog, targetPath)
  let nextIndex = sourcePath ? directoryEntryIndex(nextCatalog, sourcePath) : undefined
  if (nextIndex === undefined && focusedPath) nextIndex = directoryEntryIndex(nextCatalog, focusedPath)
  const nearestEntry = nextIndex === undefined ? nearestLoadedDirectoryEntry(nextCatalog, removedIndex) : undefined
  nextIndex ??= nearestEntry?.index
  const nextEntry = nearestEntry?.entry ?? (nextIndex === undefined ? undefined : directoryEntryAt(nextCatalog, nextIndex))
  return {
    catalog: nextCatalog,
    focusedIndex: nextIndex,
    focusedPath: nextEntry?.path,
    selection: nextEntry && nextIndex !== undefined
      ? selectDirectorySingle(nextCatalog.generation, nextEntry.path, nextIndex)
      : createDirectorySelection(nextCatalog.generation),
  }
}
