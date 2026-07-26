import {
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react"
import type { ListRange, VirtuosoGridHandle, VirtuosoHandle } from "react-virtuoso"

import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryNavigationDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import { readerEntryClickIntent } from "../shared/ReaderEntryInteraction"
import {
  directoryEntryAt,
  FOLDER_MOSAIC_GROUP_SIZE,
  isEditableKeyboardEvent,
  viewUsesFixedGrid,
  viewUsesGrid,
  viewUsesMosaicGrid,
  viewUsesVirtuosoList,
  visibleGridColumnCount,
  visiblePageStep,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import {
  chainDirectorySelection,
  createDirectorySelection,
  extendDirectorySelection,
  selectAllDirectoryEntries,
  selectDirectorySingle,
  toggleDirectorySelection,
  type DirectorySelectionModel,
} from "./DirectorySelection"
import type { FolderContextEntry } from "./FolderContextActions"
import type { FolderViewMode } from "./FolderBrowserState"
import { resolveFolderKeyboardCommand, type FolderKeyboardCommand } from "./FolderKeyboardCommands"

type FocusedKeyboardCommand = Extract<
  FolderKeyboardCommand["kind"],
  "activate" | "enter-raw" | "trash" | "rename" | "context-menu"
>

export function useFolderSelectionController({
  client,
  catalog,
  catalogRef,
  visibleRangeRef,
  viewMode,
  disabled,
  loading,
  penetrationEnabled,
  listRef,
  gridRef,
  mosaicRef,
  listHostRef,
  requestRange,
  navigate,
  activate,
  setSearchOpen,
}: {
  client: ReaderHttpClient
  catalog: DirectoryCatalog | undefined
  catalogRef: RefObject<DirectoryCatalog | undefined>
  visibleRangeRef: RefObject<ListRange>
  viewMode: FolderViewMode
  disabled: boolean
  loading: boolean
  penetrationEnabled: boolean
  listRef: RefObject<VirtuosoHandle | null>
  gridRef: RefObject<VirtuosoGridHandle | null>
  mosaicRef: RefObject<VirtuosoHandle | null>
  listHostRef: RefObject<HTMLDivElement | null>
  requestRange(range: ListRange): void
  navigate(navigation: ReaderDirectoryNavigationDto): void
  activate(
    entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">,
    rawDirectory?: boolean,
  ): void
  setSearchOpen: Dispatch<SetStateAction<boolean>>
}) {
  const pendingKeyboardCommandRef = useRef<{
    generation: number
    index: number
    kind: FocusedKeyboardCommand
  }>()
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
    pendingKeyboardCommandRef.current = undefined
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

  function handleDirectoryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isEditableKeyboardEvent(event)) return
    const currentCatalog = catalogRef.current
    if (!currentCatalog || disabled || loading) return
    const currentIndex = Math.min(
      Math.max(focusedIndexRef.current ?? visibleRangeRef.current.startIndex, 0),
      Math.max(0, currentCatalog.total - 1),
    )
    const gridColumns = viewUsesGrid(viewMode) ? visibleGridColumnCount(listHostRef.current) : 1
    const pageStep = visiblePageStep(viewMode, gridColumns)
    const command = resolveFolderKeyboardCommand(
      {
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      {
        currentIndex,
        total: currentCatalog.total,
        isGrid: viewUsesGrid(viewMode),
        gridColumns,
        pageStep,
        canGoBack: currentCatalog.canGoBack,
        hasParent: Boolean(currentCatalog.parentPath),
        multiSelectMode,
      },
    )
    if (!command) {
      if (event.key !== " ") return
      const entry = directoryEntryAt(currentCatalog, currentIndex)
      if (!entry) return
      event.preventDefault()
      event.stopPropagation()
      setMultiSelectMode(true)
      setSelection((current) => toggleDirectorySelection(current, currentCatalog.generation, entry.path, currentIndex))
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (command.kind === "refresh") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "refresh" })
      return
    }
    if (command.kind === "search") {
      pendingKeyboardCommandRef.current = undefined
      setSearchOpen(true)
      return
    }
    if (command.kind === "select-all") {
      pendingKeyboardCommandRef.current = undefined
      setMultiSelectMode(true)
      setSelection(selectAllDirectoryEntries(currentCatalog.generation))
      return
    }
    if (command.kind === "clear-selection") {
      pendingKeyboardCommandRef.current = undefined
      setSelection(createDirectorySelection(currentCatalog.generation))
      setMultiSelectMode(false)
      return
    }
    if (command.kind === "back") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "back" })
      return
    }
    if (command.kind === "up") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "up" })
      return
    }
    if (
      command.kind === "activate"
      || command.kind === "enter-raw"
      || command.kind === "trash"
      || command.kind === "rename"
      || command.kind === "context-menu"
    ) {
      runFocusedKeyboardEntry(command.kind, currentCatalog, currentIndex)
      return
    }
    if (command.kind !== "move") return
    pendingKeyboardCommandRef.current = undefined
    const nextIndex = command.targetIndex
    const entry = directoryEntryAt(currentCatalog, nextIndex)
    focusedIndexRef.current = nextIndex
    setFocusedIndex(nextIndex)
    setFocusedPath(entry?.path)
    if (event.shiftKey) {
      setSelection((current) =>
        extendDirectorySelection(current, currentCatalog.generation, nextIndex, {
          additive: event.ctrlKey || event.metaKey,
          fallbackAnchor: currentIndex,
          anchorPath: focusedPath,
          endPath: entry?.path,
        }),
      )
    } else if (!event.ctrlKey && !event.metaKey) {
      setSelection(
        entry
          ? selectDirectorySingle(currentCatalog.generation, entry.path, nextIndex)
          : extendDirectorySelection(createDirectorySelection(currentCatalog.generation), currentCatalog.generation, nextIndex, {
              additive: false,
              fallbackAnchor: nextIndex,
            }),
      )
    }
    requestRange({ startIndex: nextIndex, endIndex: nextIndex })
    scrollToDirectoryIndex(nextIndex)
  }

  function runFocusedKeyboardEntry(kind: FocusedKeyboardCommand, currentCatalog: DirectoryCatalog, index: number): void {
    const entry = directoryEntryAt(currentCatalog, index)
    if (!entry) {
      if (!client.listDirectoryBrowser) return
      pendingKeyboardCommandRef.current = {
        generation: currentCatalog.generation,
        index,
        kind,
      }
      requestRange({ startIndex: index, endIndex: index })
      scrollToDirectoryIndex(index)
      return
    }
    pendingKeyboardCommandRef.current = undefined
    if (kind === "activate") {
      activate(entry)
    } else if (kind === "enter-raw" && entry.kind === "directory") {
      activate(entry, true)
    } else if (kind === "rename") {
      if (client.executeFileOperations) setRenameRequest({ index, ...entry })
    } else if (kind === "trash") {
      if (!client.executeFileOperations) return
      listHostRef.current?.dispatchEvent(
        new CustomEvent("neoview-folder-trash-request", {
          bubbles: true,
          detail: { index, ...entry },
        }),
      )
    } else {
      dispatchFocusedFolderContextMenu(index, entry)
    }
  }

  function dispatchFocusedFolderContextMenu(index: number, entry: ReaderDirectoryEntryDto): void {
    const host = listHostRef.current
    if (!host) return
    const mounted = host.querySelector<HTMLElement>(`[data-folder-index="${index}"]`)
    if (mounted) {
      mounted.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))
      return
    }
    const proxy = document.createElement("button")
    proxy.type = "button"
    proxy.tabIndex = -1
    proxy.hidden = true
    proxy.dataset.contextMenu = "neoview-folder-entry"
    proxy.dataset.folderIndex = String(index)
    proxy.dataset.folderPath = entry.path
    proxy.dataset.folderName = entry.name
    proxy.dataset.folderKind = entry.kind
    proxy.dataset.folderReaderSupported = String(entry.readerSupported)
    host.append(proxy)
    proxy.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))
    proxy.remove()
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
    pendingKeyboardCommandRef,
    toggleMultiSelectMode,
    selectEntry,
    scrollToDirectoryIndex,
    handleDirectoryKeyDown,
    runFocusedKeyboardEntry,
  }
}
