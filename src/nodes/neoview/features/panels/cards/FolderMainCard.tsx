import { lazy, Suspense } from "react"

import type { ReaderFolderViewConfig } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { FolderClipboardProvider } from "./folder/FolderClipboard"
import { DEFAULT_FOLDER_VIEW, FolderBrowserPane } from "./folder/FolderBrowserPane"

const FolderTabsHost = lazy(() => import("./folder/FolderTabsHost"))

export default function FolderMainCard(context: ReaderPanelContext) {
  const folderView: ReaderFolderViewConfig = context.folderView
    ? {
        ...context.folderView,
        emptyArea: {
          ...DEFAULT_FOLDER_VIEW.emptyArea,
          ...context.folderView.emptyArea,
        },
        hoverPreviewEnabled: context.folderView.hoverPreviewEnabled ?? DEFAULT_FOLDER_VIEW.hoverPreviewEnabled,
        hoverPreviewDelayMs: context.folderView.hoverPreviewDelayMs ?? DEFAULT_FOLDER_VIEW.hoverPreviewDelayMs,
        penetration: {
          ...DEFAULT_FOLDER_VIEW.penetration,
          ...context.folderView.penetration,
        },
        tabs: context.folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs,
      }
    : DEFAULT_FOLDER_VIEW
  return (
    <FolderClipboardProvider client={context.client}>
      <Suspense fallback={<div className="h-8 rounded-md border bg-muted/30" aria-hidden="true" />}>
        <FolderTabsHost context={context} folderView={folderView} BrowserPane={FolderBrowserPane} />
      </Suspense>
    </FolderClipboardProvider>
  )
}

export type { FolderBrowserCloneProvider, FolderBrowserCloneSnapshot, SavedDirectoryState } from "./folder/FolderBrowserPane"
export { isThumbnailDemandNeeded, mergeThumbnailUrls, mergeThumbnailUrlSets } from "./folder/FolderBrowserPane"
