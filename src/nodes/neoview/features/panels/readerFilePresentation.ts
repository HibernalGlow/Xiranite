import type {
  ReaderFilePresentationOverridesDto,
  ReaderFilePresentationOverridesPatch,
  ReaderFilePresentationViewMode,
  ReaderFolderViewConfig,
  ReaderFolderViewMode,
  ReaderHistoryListPreferencesDto,
} from "../../adapters/reader-http-client"

export interface ReaderFilePresentationConfig {
  viewMode: ReaderFilePresentationViewMode
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
}

export type ReaderFilePresentationSizeField = Exclude<keyof ReaderFilePresentationConfig, "viewMode">

const DEFAULT_PRESENTATION: ReaderFilePresentationConfig = {
  viewMode: "compact",
  contentWidthPercent: 35,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
}

export function resolveReaderFilePresentation(
  folderView: ReaderFolderViewConfig | undefined,
  overrides: ReaderFilePresentationOverridesDto | undefined,
): ReaderFilePresentationConfig {
  return {
    viewMode: overrides?.viewMode ?? inheritedFilePresentationViewMode(folderView?.viewMode),
    contentWidthPercent: overrides?.contentWidthPercent ?? folderView?.contentWidthPercent ?? DEFAULT_PRESENTATION.contentWidthPercent,
    thumbnailWidthPercent: overrides?.thumbnailWidthPercent ?? folderView?.thumbnailWidthPercent ?? DEFAULT_PRESENTATION.thumbnailWidthPercent,
    bannerWidthPercent: overrides?.bannerWidthPercent ?? folderView?.bannerWidthPercent ?? DEFAULT_PRESENTATION.bannerWidthPercent,
  }
}

export function applyReaderFilePresentationOverridePatch(
  current: ReaderFilePresentationOverridesDto | undefined,
  patch: ReaderFilePresentationOverridesPatch,
): ReaderFilePresentationOverridesDto {
  const next: ReaderFilePresentationOverridesDto = { ...current }
  for (const field of ["viewMode", "contentWidthPercent", "thumbnailWidthPercent", "bannerWidthPercent"] as const) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (value === null || value === undefined) delete next[field]
    else Object.assign(next, { [field]: value })
  }
  return next
}

export function legacyHistoryViewOverrides(
  preferences: ReaderHistoryListPreferencesDto | undefined,
): ReaderFilePresentationOverridesDto {
  if (preferences?.viewOverrides !== undefined) return preferences.viewOverrides
  const legacy = preferences?.viewMode
  if (legacy === "content") return { viewMode: "cover-list" }
  if (legacy === "banner") return { viewMode: "mosaic-list" }
  if (legacy === "thumbnail") return { viewMode: "cover-grid" }
  return legacy === "compact" ? { viewMode: "compact" } : {}
}

export function legacyHistoryViewMode(
  viewMode: ReaderFilePresentationViewMode,
): ReaderHistoryListPreferencesDto["viewMode"] {
  if (viewMode === "cover-list") return "content"
  if (viewMode === "mosaic-list") return "banner"
  if (viewMode === "cover-grid") return "thumbnail"
  return "compact"
}

export function filePresentationSizeField(
  viewMode: ReaderFolderViewMode | ReaderFilePresentationViewMode,
): ReaderFilePresentationSizeField | undefined {
  if (viewMode === "cover-list") return "contentWidthPercent"
  if (viewMode === "mosaic-list") return "bannerWidthPercent"
  if (viewMode === "cover-grid" || viewMode === "mosaic-grid") return "thumbnailWidthPercent"
  return undefined
}

function inheritedFilePresentationViewMode(viewMode: ReaderFolderViewMode | undefined): ReaderFilePresentationViewMode {
  if (viewMode === "cover-list" || viewMode === "mosaic-list" || viewMode === "cover-grid") return viewMode
  if (viewMode === "mosaic-grid") return "cover-grid"
  return "compact"
}
