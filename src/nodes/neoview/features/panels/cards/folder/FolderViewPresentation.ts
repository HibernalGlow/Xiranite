import type {
  ReaderFolderTitleWrapConfig,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client";

export interface FolderViewPresentationOption {
  value: ReaderFolderViewMode;
  label: string;
}

/**
 * The File Card's shared view catalog. Adding a visual mode requires declaring
 * its menu label and title policy here before it can reach a renderer.
 */
export const FOLDER_VIEW_PRESENTATION_OPTIONS = [
  { value: "compact", label: "紧凑列表" },
  { value: "cover-list", label: "封面列表" },
  { value: "mosaic-list", label: "横幅" },
  { value: "details", label: "详细信息" },
  { value: "cover-grid", label: "封面网格" },
  { value: "mosaic-grid", label: "自由缩略图" },
] as const satisfies readonly FolderViewPresentationOption[];

export const DEFAULT_FOLDER_TITLE_WRAP: ReaderFolderTitleWrapConfig = {
  compact: false,
  "cover-list": false,
  "mosaic-list": false,
  details: false,
  "cover-grid": true,
  "mosaic-grid": false,
};

export function resolveFolderTitleWrap(
  titleWrap: Partial<ReaderFolderTitleWrapConfig> | undefined,
  viewMode: ReaderFolderViewMode,
): boolean {
  return titleWrap?.[viewMode] ?? DEFAULT_FOLDER_TITLE_WRAP[viewMode];
}

export function folderTitleClassName(wrapTitle: boolean): string {
  return wrapTitle ? "line-clamp-2 break-words leading-4" : "truncate";
}
