import type { ReaderFolderViewConfig, ReaderFolderViewPatch } from "../adapters/reader-http-client"

export function mergeReaderFolderViewPatch(
  current: ReaderFolderViewConfig,
  patch: ReaderFolderViewPatch["folderView"],
  defaults: ReaderFolderViewConfig,
): ReaderFolderViewConfig {
  return {
    ...current,
    ...patch,
    details: {
      ...current.details,
      ...patch.details,
      columnWidths: { ...current.details.columnWidths, ...patch.details?.columnWidths },
    },
    search: { ...current.search, ...patch.search },
    emptyArea: { ...current.emptyArea, ...patch.emptyArea },
    titleWrap: { ...current.titleWrap, ...patch.titleWrap },
    confirmations: { ...current.confirmations, ...patch.confirmations },
    penetration: { ...current.penetration, ...patch.penetration },
    tree: { ...current.tree, ...patch.tree },
    tabs: { ...(current.tabs ?? defaults.tabs), ...patch.tabs },
  }
}
