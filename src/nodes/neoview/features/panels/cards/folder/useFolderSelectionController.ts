import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react"
import type { VirtuosoGridHandle, VirtuosoHandle } from "react-virtuoso"

import type {
  ReaderDirectoryEntryDto,
} from "../../../../adapters/reader-http-client"
import { readerEntryClickIntent } from "../shared/ReaderEntryInteraction"
import {
  FOLDER_MOSAIC_GROUP_SIZE,
  viewUsesFixedGrid,
  viewUsesMosaicGrid,
  viewUsesVirtuosoList,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import {
  chainDirectorySelection,
  createDirectorySelection,
  extendDirectorySelection,
  selectDirectorySingle,
  toggleDirectorySelection,
  type DirectorySelectionModel,
} from "./DirectorySelection"
import type { FolderContextEntry } from "./FolderContextActions"
import type { FolderViewMode } from "./FolderBrowserState"

export function useFolderSelectionController({
  catalog,
  catalogRef,
  viewMode,
  penetrationEnabled,
  listRef,
  gridRef,
  mosaicRef,
  activate,
}: {
  catalog: DirectoryCatalog | undefined
  catalogRef: RefObject<DirectoryCatalog | undefined>
  viewMode: FolderViewMode
  penetrationEnabled: boolean
  listRef: RefObject<VirtuosoHandle | null>
  gridRef: RefObject<VirtuosoGridHandle | null>
  mosaicRef: RefObject<VirtuosoHandle | null>
  activate(
    entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">,
    rawDirectory?: boolean,
  ): void
}) {
  const focusedIndexRef = useRef<number>()
  const chainAnchorIndexRef = useRef<number>()
  const [selection, setSelection] = useState<DirectorySelectionModel>(() => createDirectorySelection(0))
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [chainSelectMode, setChainSelectMode] = useState(false)
  const [checkModeClickBehavior, setCheckModeClickBehavior] = useState<"open" | "select">("open")
  const [renameRequest, setRenameRequest] = useState<FolderContextEntry>()
  const [focusedPath, setFocusedPath] = useState<string>()
  const [focusedIndex, setFocusedIndex] = useState<number>()

  function toggleMultiSelectMode(): void {
    if (multiSelectMode) {
      setSelection(createDirectorySelection(catalog?.generation ?? selection.generation))
      chainAnchorIndexRef.current = undefined
      setChainSelectMode(false)
    }
    setMultiSelectMode((current) => !current)
  }

  function selectEntry(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void {
    const previousFocusIndex = focusedIndexRef.current
    focusedIndexRef.current = index
    setFocusedIndex(index)
    setFocusedPath(entry.path)
    const generation = catalogRef.current?.generation ?? selection.generation
    if (multiSelectMode && chainSelectMode) {
      const chainAnchorIndex = chainAnchorIndexRef.current
      setSelection((current) =>
        chainDirectorySelection(current, generation, index, {
          anchorIndex: chainAnchorIndex,
          anchorPath: chainAnchorIndex === previousFocusIndex ? focusedPath : undefined,
          endPath: entry.path,
        }),
      )
      chainAnchorIndexRef.current = index
    } else if (event.shiftKey) {
      setSelection((current) =>
        extendDirectorySelection(current, generation, index, {
          additive: event.ctrlKey || event.metaKey,
          fallbackAnchor: previousFocusIndex ?? 0,
          anchorPath: focusedPath,
          endPath: entry.path,
        }),
      )
    } else if (readerEntryClickIntent(event, multiSelectMode && checkModeClickBehavior === "select") === "select") {
      setSelection((current) => toggleDirectorySelection(current, generation, entry.path, index))
    } else if (entry.kind === "directory" && penetrationEnabled && event.detail >= 2) {
      activate(entry, true)
    } else {
      activate(entry)
    }
  }

  function scrollToDirectoryIndex(index: number): void {
    if (viewUsesVirtuosoList(viewMode)) {
      listRef.current?.scrollToIndex({ index, align: "center" })
    } else if (viewUsesFixedGrid(viewMode)) {
      gridRef.current?.scrollToIndex({ index, align: "center" })
    } else if (viewUsesMosaicGrid(viewMode)) {
      mosaicRef.current?.scrollToIndex({
        index: Math.floor(index / FOLDER_MOSAIC_GROUP_SIZE),
        align: "center",
      })
    }
  }

  return {
    selection,
    setSelection,
    multiSelectMode,
    setMultiSelectMode,
    chainSelectMode,
    setChainSelectMode,
    checkModeClickBehavior,
    setCheckModeClickBehavior,
    renameRequest,
    setRenameRequest,
    focusedPath,
    setFocusedPath,
    focusedIndex,
    setFocusedIndex,
    focusedIndexRef,
    chainAnchorIndexRef,
    toggleMultiSelectMode,
    selectEntry,
    scrollToDirectoryIndex,
  }
}
