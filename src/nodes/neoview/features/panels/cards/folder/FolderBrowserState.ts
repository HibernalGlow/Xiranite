import { type GridStateSnapshot, type StateSnapshot } from "react-virtuoso"
import { type ReaderDirectoryPageDto, type ReaderFolderViewMode, type ReaderFolderViewConfig } from "../../../../adapters/reader-http-client"
import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "../../../../adapters/reader-http-client"
import { type DirectorySelectionModel } from "./DirectorySelection"
import { DEFAULT_FOLDER_TAG_DISPLAY } from "./FolderEntryPresentation"
import { DEFAULT_FOLDER_TITLE_WRAP } from "./FolderViewPresentation"

export type FolderViewMode = ReaderFolderViewMode
export type FolderPreviewCount = 4 | 9 | 16
export const DEFAULT_FOLDER_VIEW: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewGridEnabled: false,
  previewCount: 4,
  contentWidthPercent: 35,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  titleWrap: { ...DEFAULT_FOLDER_TITLE_WRAP },
  typeFilter: "library",
  showHiddenFolders: false,
  hideMissingEfuEntries: false,
  confirmations: {
    trash: false,
    permanentDelete: true,
    batchTrash: false,
    batchPermanentDelete: true,
  },
  migration: { quickTargets: [] },
  tagDisplay: DEFAULT_FOLDER_TAG_DISPLAY,
  penetration: {
    enabled: false,
    expandBranchesInline: false,
    inlineBranchLimitsEnabled: true,
    inlineBranchMaxDirectories: 4,
    inlineBranchMaxFiles: 4,
    inlineBranchMaxItems: 4,
    showInternalFiles: true,
    internalItemsMode: "single",
    maxDepth: 3,
    terminalTargets: ["archive", "document", "media-directory", "file"],
  },
  emptyArea: {
    singleClickAction: "none",
    doubleClickAction: "goUp",
    showBackButton: false,
  },
  details: {
    columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
    hiddenColumns: [],
    pinnedLeft: ["name"],
    pinnedRight: [],
    columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  },
  search: {
    includeSubfolders: true,
    showHistoryOnFocus: true,
    searchInPath: false,
  },
  tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
  tabs: {
    pinned: [],
    layout: "top",
    width: 160,
    breadcrumbPosition: "top",
    toolbarPosition: "top",
  },
}
export interface SavedDirectoryState {
  total?: number
  viewMode: FolderViewMode
  previewCount: FolderPreviewCount
  multiSelectMode: boolean
  selection: DirectorySelectionModel
  focusedPath?: string
  focusedIndex?: number
  anchorIndex: number
  listSnapshot?: StateSnapshot
  gridSnapshot?: GridStateSnapshot
  gridScrollTop?: number
  mosaicSnapshot?: StateSnapshot
  mosaicScrollTop?: number
  detailsScrollTop?: number
  thumbnailUrls?: ReadonlyMap<string, string>
  thumbnailUrlSets?: ReadonlyMap<string, readonly string[]>
  thumbnailProfiles?: ReadonlyMap<string, string>
}
export interface FolderBrowserCloneSnapshot {
  sourceSessionId: string
  clonedPage?: ReaderDirectoryPageDto
  currentState: SavedDirectoryState
  navigationStates: ReadonlyMap<number, SavedDirectoryState>
}
export type FolderBrowserCloneProvider = (close?: boolean) => Promise<FolderBrowserCloneSnapshot | undefined>
