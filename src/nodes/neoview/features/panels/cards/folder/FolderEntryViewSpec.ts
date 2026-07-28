import type { ReaderFolderViewConfig, ReaderFolderViewMode } from "../../../../adapters/reader-http-client"

export interface FolderEntrySelectionSpec {
  multiSelectMode: boolean
  chainSelectMode: boolean
  checkModeClickBehavior: "open" | "select"
}

export interface FolderEntryViewSpec {
  config: ReaderFolderViewConfig
  thumbnailProbeEnabled: boolean
  wrapTitle: boolean
  deletion: {
    enabled: boolean
    strategy: "trash" | "permanent"
    confirm: boolean
  }
  selection: FolderEntrySelectionSpec
}

export interface FolderEntryViewSpecSource {
  folderView: ReaderFolderViewConfig
  viewMode: ReaderFolderViewMode
  previewGridEnabled: boolean
  previewCount: ReaderFolderViewConfig["previewCount"]
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: ReaderFolderViewConfig["hoverPreviewDelayMs"]
  thumbnailProbesEnabled: boolean
  deleteMode: boolean
  deleteStrategy: "trash" | "permanent"
  activeDeleteConfirmation: boolean
  multiSelectMode: boolean
  chainSelectMode: boolean
  checkModeClickBehavior: "open" | "select"
}

/** Resolve persisted preferences and live pane state once for every entry viewport. */
export function createFolderEntryViewSpec(
  source: FolderEntryViewSpecSource,
  active: boolean,
  wrapTitle: boolean,
): FolderEntryViewSpec {
  return {
    config: {
      ...source.folderView,
      viewMode: source.viewMode,
      previewGridEnabled: source.previewGridEnabled,
      previewCount: source.previewCount,
      contentWidthPercent: source.contentWidthPercent,
      thumbnailWidthPercent: source.thumbnailWidthPercent,
      bannerWidthPercent: source.bannerWidthPercent,
      hoverPreviewEnabled: active && source.hoverPreviewEnabled,
      hoverPreviewDelayMs: source.hoverPreviewDelayMs,
    },
    thumbnailProbeEnabled: source.thumbnailProbesEnabled,
    wrapTitle,
    deletion: {
      enabled: source.deleteMode,
      strategy: source.deleteStrategy,
      confirm: source.activeDeleteConfirmation,
    },
    selection: {
      multiSelectMode: source.multiSelectMode,
      chainSelectMode: source.chainSelectMode,
      checkModeClickBehavior: source.checkModeClickBehavior,
    },
  }
}

export function folderEntryGridWidthPercent(spec: FolderEntryViewSpec): number {
  return spec.config.viewMode === "mosaic-list"
    ? spec.config.bannerWidthPercent
    : spec.config.thumbnailWidthPercent
}

export function folderEntryGridListClassName(viewMode: ReaderFolderViewMode): string {
  return viewMode === "mosaic-list"
    ? "grid grid-flow-dense gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),10rem),1fr))]"
    : "grid grid-flow-dense gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),5.5rem),1fr))]"
}
