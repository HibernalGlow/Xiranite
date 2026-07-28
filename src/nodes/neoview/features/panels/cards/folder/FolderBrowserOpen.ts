import type {
  ReaderDirectoryPageDto,
  ReaderFolderViewConfig,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"

import { folderErrorMessage, normalizeFolderNavigationPath } from "./DirectoryCatalog"

export interface FolderBrowserOpenResult {
  opened: boolean
  message?: string
}

export interface FolderBrowserOpenPort {
  client: ReaderHttpClient
  folderView: ReaderFolderViewConfig
  clearSearchSession(): void
  beginNavigation(): number
  isCurrentGeneration(generation: number): boolean
  navigationSignal(): AbortSignal | undefined
  setSearchOpen(open: boolean): void
  setTreeOpen(open: boolean): void
  setLoading(loading: boolean): void
  setError(message: string | undefined): void
  setOpenRetry(path: string): void
  clearRetry(): void
  currentSessionId(): string | undefined
  replaceSessionId(sessionId: string): void
  releaseThumbnailContext(): void
  applyPage(page: ReaderDirectoryPageDto): void
}

export async function openFolderBrowser(path: string, port: FolderBrowserOpenPort): Promise<FolderBrowserOpenResult> {
  const normalized = normalizeFolderNavigationPath(path)
  if (!normalized || !port.client.openDirectoryBrowser) {
    return { opened: false, message: !normalized ? "Folder open target is empty." : "Folder browser is unavailable." }
  }
  port.clearSearchSession()
  port.setSearchOpen(false)
  port.setTreeOpen(false)
  const generation = port.beginNavigation()
  port.setLoading(true)
  port.setError(undefined)
  port.setOpenRetry(normalized)
  try {
    let opened = await port.client.openDirectoryBrowser(normalized, port.navigationSignal(), undefined, true)
    if (!port.isCurrentGeneration(generation)) {
      void port.client.closeDirectoryBrowser?.(opened.sessionId).catch(() => undefined)
      return { opened: false, message: "Folder open was superseded." }
    }
    const previous = port.currentSessionId()
    if (previous && previous !== opened.sessionId) port.releaseThumbnailContext()
    port.replaceSessionId(opened.sessionId)
    port.applyPage(opened)
    port.clearRetry()
    if (previous && previous !== opened.sessionId) void port.client.closeDirectoryBrowser?.(previous).catch(() => undefined)
    const preferredFilter = port.folderView.typeFilter ?? "library"
    const showHiddenFolders = port.folderView.showHiddenFolders ?? false
    const hideMissingEfuEntries = port.folderView.hideMissingEfuEntries ?? false
    if (
      port.client.filterDirectoryBrowser
      && (preferredFilter !== opened.filter || showHiddenFolders || (opened.sourceKind === "efu" && hideMissingEfuEntries))
    ) {
      opened = await port.client.filterDirectoryBrowser(
        opened.sessionId,
        preferredFilter,
        undefined,
        port.navigationSignal(),
        showHiddenFolders,
        hideMissingEfuEntries,
      )
      if (!port.isCurrentGeneration(generation)) return { opened: false, message: "Folder open was superseded." }
      port.applyPage(opened)
    }
    return { opened: true }
  } catch (cause) {
    const message = folderErrorMessage(cause)
    if (port.isCurrentGeneration(generation) && !port.navigationSignal()?.aborted) port.setError(message)
    return { opened: false, message }
  } finally {
    if (port.isCurrentGeneration(generation)) port.setLoading(false)
  }
}
