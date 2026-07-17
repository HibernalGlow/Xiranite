#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport {
  fileName: string
  bytes: number
  modules: string[]
}

const reportPath = resolve("artifacts/production-chunks.json")
const indexPath = resolve("dist/index.html")
const chunks = JSON.parse(await readFile(reportPath, "utf8")) as ChunkReport[]
const indexHtml = await readFile(indexPath, "utf8")
const initialScript = /<script[^>]+src="\/([^"]+\.js)"/.exec(indexHtml)?.[1]
if (!initialScript) throw new Error(`Unable to find the initial module script in ${indexPath}`)

const initialChunk = chunks.find((chunk) => chunk.fileName === initialScript)
if (!initialChunk) throw new Error(`Initial chunk ${initialScript} is missing from ${reportPath}`)

const neoViewChunks = chunks.filter((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]nodes[/\\]neoview[/\\]/i.test(module)))
const neoViewChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i.test(module)))
if (!neoViewChunk) throw new Error(`Unable to find the NeoView entry chunk among: ${neoViewChunks.map((chunk) => chunk.fileName).join(", ")}`)
const browserExternalModules = chunks.flatMap((chunk) => chunk.modules
  .filter((module) => /(?:^|[/\\])__vite-browser-external(?::|[/\\])|^node:/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (browserExternalModules.length) {
  throw new Error(`Node built-ins were externalized into the browser build:\n${browserExternalModules.join("\n")}`)
}
const nodeOnlyNeoViewModules = neoViewChunks.flatMap((chunk) => chunk.modules
  .filter((module) => /[/\\]packages[/\\]nodes[/\\]neoview[/\\](?:src|dist)[/\\](?:core|application[/\\]browser[/\\]ReaderDirectorySort)\.(?:js|ts)$/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (nodeOnlyNeoViewModules.length) {
  throw new Error(`Node-only NeoView modules leaked into the browser build; import @xiranite/node-neoview/ui-core instead:\n${nodeOnlyNeoViewModules.join("\n")}`)
}
if (neoViewChunk.bytes > 40 * 1024) {
  throw new Error(`NeoView app chunk ${neoViewChunk.fileName} is ${neoViewChunk.bytes} bytes, above 40 KiB.`)
}

const eagerPanelModules = neoViewChunk.modules.filter((module) => /[/\\]features[/\\]panels[/\\](?:ReaderSidebar|cards[/\\])/i.test(module))
if (eagerPanelModules.length) throw new Error(`NeoView panel/card modules leaked into the reader entry chunk: ${eagerPanelModules.join(", ")}`)
const eagerPresentationModules = neoViewChunk.modules.filter((module) => /[/\\]features[/\\]reader[/\\](?:ReaderFrame|ReaderViewToolbar|PageImage)\.tsx$/i.test(module))
if (eagerPresentationModules.length) throw new Error(`NeoView presentation UI leaked into the reader entry chunk: ${eagerPresentationModules.join(", ")}`)
const readerFrameChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]reader[/\\]ReaderFrame\.tsx$/i.test(module)))
const readerViewToolbarChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]reader[/\\]ReaderViewToolbar\.tsx$/i.test(module)))
if (!readerFrameChunk || readerFrameChunk === neoViewChunk) throw new Error("NeoView ReaderFrame did not produce a deferred production chunk.")
if (!readerViewToolbarChunk || readerViewToolbarChunk === neoViewChunk) throw new Error("NeoView ReaderViewToolbar did not produce a deferred production chunk.")
if (!readerFrameChunk.modules.some((module) => /[/\\]features[/\\]reader[/\\]PageImage\.tsx$/i.test(module))) {
  throw new Error("NeoView PageImage is not colocated with the deferred ReaderFrame chunk.")
}
for (const chunk of new Set([readerFrameChunk, readerViewToolbarChunk])) {
  if (chunk.bytes > 16 * 1024) throw new Error(`NeoView deferred presentation chunk ${chunk.fileName} is ${chunk.bytes} bytes, above 16 KiB.`)
}
const deferredPanelChunks = neoViewChunks.filter((chunk) => chunk !== neoViewChunk && chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]/i.test(module)))
const readerSidebarChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i.test(module)))
if (!readerSidebarChunk) {
  throw new Error("NeoView ReaderSidebar did not produce a deferred production chunk.")
}
if (!deferredPanelChunks.some((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]/i.test(module)))) {
  throw new Error("NeoView cards did not produce deferred production chunks.")
}
for (const chunk of deferredPanelChunks) {
  if (chunk.bytes > 32 * 1024) throw new Error(`NeoView deferred panel chunk ${chunk.fileName} is ${chunk.bytes} bytes, above 32 KiB.`)
}
// [neoview.bookmark.chunk] [neoview.page-list.chunk] [neoview.shared-thumbnail.chunk] [neoview.shared-entry.chunk]
const bookmarkListChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]BookmarkListCard\.tsx$/i.test(module)))
const historyListChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]HistoryListCard\.tsx$/i.test(module)))
const pageNavigationChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]PageNavigationCard\.tsx$/i.test(module)))
const pageListToolbarChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]page-list[/\\]PageListToolbar\.tsx$/i.test(module)))
const pagePrewarmChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]page-list[/\\]prewarmPageThumbnails\.ts$/i.test(module)))
const pageContextActionsChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]page-list[/\\]PageListContextActions\.tsx$/i.test(module)))
const thumbnailSurfaceChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]thumbnails[/\\]ReaderThumbnailSurface\.tsx$/i.test(module)))
const entrySurfaceChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]shared[/\\]ReaderEntrySurface\.tsx$/i.test(module)))
if (!bookmarkListChunk || bookmarkListChunk === readerSidebarChunk) {
  throw new Error("NeoView BookmarkListCard did not produce an independent deferred production chunk.")
}
if (!historyListChunk || historyListChunk === readerSidebarChunk) {
  throw new Error("NeoView HistoryListCard did not produce an independent deferred production chunk.")
}
if (!pageNavigationChunk || pageNavigationChunk === readerSidebarChunk) {
  throw new Error("NeoView PageNavigationCard did not produce an independent deferred production chunk.")
}
if (!pageListToolbarChunk || pageListToolbarChunk === pageNavigationChunk || pageListToolbarChunk === readerSidebarChunk || pageListToolbarChunk === neoViewChunk || pageListToolbarChunk === initialChunk) {
  throw new Error("NeoView Page List toolbar did not produce a second-level deferred production chunk.")
}
if (!pagePrewarmChunk || pagePrewarmChunk === pageListToolbarChunk || pagePrewarmChunk === pageNavigationChunk || pagePrewarmChunk === readerSidebarChunk || pagePrewarmChunk === neoViewChunk || pagePrewarmChunk === initialChunk) {
  throw new Error("NeoView page thumbnail prewarm logic did not produce a second-level deferred production chunk.")
}
if (!pageContextActionsChunk || pageContextActionsChunk === pageNavigationChunk || pageContextActionsChunk === readerSidebarChunk || pageContextActionsChunk === neoViewChunk || pageContextActionsChunk === initialChunk) {
  throw new Error("NeoView Page List context actions did not produce a second-level deferred production chunk.")
}
if (!thumbnailSurfaceChunk || thumbnailSurfaceChunk === neoViewChunk || thumbnailSurfaceChunk === readerSidebarChunk || thumbnailSurfaceChunk === initialChunk) {
  throw new Error("NeoView shared thumbnail surface leaked into an eager reader/sidebar/initial chunk.")
}
if (!entrySurfaceChunk || entrySurfaceChunk === neoViewChunk || entrySurfaceChunk === readerSidebarChunk || entrySurfaceChunk === initialChunk) {
  throw new Error("NeoView shared entry surface leaked into an eager reader/sidebar/initial chunk.")
}
if (bookmarkListChunk.bytes > 16 * 1024) {
  throw new Error(`NeoView BookmarkListCard chunk ${bookmarkListChunk.fileName} is ${bookmarkListChunk.bytes} bytes, above 16 KiB.`)
}
if (historyListChunk.bytes > 16 * 1024) {
  throw new Error(`NeoView HistoryListCard chunk ${historyListChunk.fileName} is ${historyListChunk.bytes} bytes, above 16 KiB.`)
}
if (pageNavigationChunk.bytes > 16 * 1024) {
  throw new Error(`NeoView PageNavigationCard chunk ${pageNavigationChunk.fileName} is ${pageNavigationChunk.bytes} bytes, above 16 KiB.`)
}
if (pageContextActionsChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView Page List context actions chunk ${pageContextActionsChunk.fileName} is ${pageContextActionsChunk.bytes} bytes, above 8 KiB.`)
}
if (pagePrewarmChunk.bytes > 4 * 1024) {
  throw new Error(`NeoView page thumbnail prewarm chunk ${pagePrewarmChunk.fileName} is ${pagePrewarmChunk.bytes} bytes, above 4 KiB.`)
}
if (pageListToolbarChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView Page List toolbar chunk ${pageListToolbarChunk.fileName} is ${pageListToolbarChunk.bytes} bytes, above 8 KiB.`)
}
if (thumbnailSurfaceChunk.bytes > 4 * 1024) {
  throw new Error(`NeoView shared thumbnail surface chunk ${thumbnailSurfaceChunk.fileName} is ${thumbnailSurfaceChunk.bytes} bytes, above 4 KiB.`)
}
if (entrySurfaceChunk.bytes > 4 * 1024) {
  throw new Error(`NeoView shared entry surface chunk ${entrySurfaceChunk.fileName} is ${entrySurfaceChunk.bytes} bytes, above 4 KiB.`)
}
const timeInformationChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]TimeInformationCard\.tsx$/i.test(module)))
if (!timeInformationChunk || timeInformationChunk === readerSidebarChunk) {
  throw new Error("NeoView TimeInformationCard did not produce an independent deferred production chunk.")
}
if (timeInformationChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView TimeInformationCard chunk ${timeInformationChunk.fileName} is ${timeInformationChunk.bytes} bytes, above 8 KiB.`)
}
const bookInformationChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]BookInformationCard\.tsx$/i.test(module)))
if (!bookInformationChunk || bookInformationChunk === readerSidebarChunk) {
  throw new Error("NeoView BookInformationCard did not produce an independent deferred production chunk.")
}
if (bookInformationChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView BookInformationCard chunk ${bookInformationChunk.fileName} is ${bookInformationChunk.bytes} bytes, above 8 KiB.`)
}
const storageInformationChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]StorageInformationCard\.tsx$/i.test(module)))
if (!storageInformationChunk || storageInformationChunk === readerSidebarChunk) {
  throw new Error("NeoView StorageInformationCard did not produce an independent deferred production chunk.")
}
if (storageInformationChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView StorageInformationCard chunk ${storageInformationChunk.fileName} is ${storageInformationChunk.bytes} bytes, above 8 KiB.`)
}
// [neoview.image-information.chunk]
const imageInformationChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]ImageInformationCard\.tsx$/i.test(module)))
if (!imageInformationChunk || imageInformationChunk === readerSidebarChunk) {
  throw new Error("NeoView ImageInformationCard did not produce an independent deferred production chunk.")
}
if (imageInformationChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView ImageInformationCard chunk ${imageInformationChunk.fileName} is ${imageInformationChunk.bytes} bytes, above 8 KiB.`)
}
// [neoview.preload-status.chunk]
const preloadStatusChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]PreloadStatusCard\.tsx$/i.test(module)))
if (!preloadStatusChunk || preloadStatusChunk === neoViewChunk || preloadStatusChunk === readerSidebarChunk) {
  throw new Error("NeoView PreloadStatusCard did not produce an independent deferred production chunk.")
}
if (preloadStatusChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView PreloadStatusCard chunk ${preloadStatusChunk.fileName} is ${preloadStatusChunk.bytes} bytes, above 8 KiB.`)
}
const sidebarControlCardChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]SidebarControlCard\.tsx$/i.test(module)))
const sidebarFloatingControllerChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]shell[/\\]SidebarFloatingController\.tsx$/i.test(module)))
if (!sidebarControlCardChunk || sidebarControlCardChunk === neoViewChunk || sidebarControlCardChunk === readerSidebarChunk) {
  throw new Error("NeoView SidebarControlCard did not produce an independent deferred production chunk.")
}
if (!sidebarFloatingControllerChunk || sidebarFloatingControllerChunk === neoViewChunk || sidebarFloatingControllerChunk === readerSidebarChunk) {
  throw new Error("NeoView SidebarFloatingController did not produce an independent deferred production chunk.")
}
if (sidebarControlCardChunk === sidebarFloatingControllerChunk) {
  throw new Error("NeoView Sidebar Control Card and floating layer were merged into one lifecycle chunk.")
}
for (const chunk of [sidebarControlCardChunk, sidebarFloatingControllerChunk]) {
  if (chunk.bytes > 16 * 1024) throw new Error(`NeoView deferred Sidebar Control chunk ${chunk.fileName} is ${chunk.bytes} bytes, above 16 KiB.`)
}
const folderMainChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]FolderMainCard\.tsx$/i.test(module)))
const folderChromeLayoutChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderChromeLayout\.tsx$/i.test(module)))
const folderSelectionBarChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderSelectionBar\.tsx$/i.test(module)))
const folderContextActionsChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderContextActions\.tsx$/i.test(module)))
const folderRenameDialogChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderRenameDialog\.tsx$/i.test(module)))
const folderSearchChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderSearchPanel\.tsx$/i.test(module)))
const folderTreeChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]FolderTreePanel\.tsx$/i.test(module)))
const directoryWatchChunk = deferredPanelChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]folder[/\\]DirectoryWatch\.tsx$/i.test(module)))
if (!folderMainChunk) throw new Error("NeoView FolderMainCard deferred chunk is missing.")
if (!folderChromeLayoutChunk || folderChromeLayoutChunk === folderMainChunk) {
  throw new Error("NeoView FolderChromeLayout did not produce a second-level deferred production chunk.")
}
if (folderChromeLayoutChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView FolderChromeLayout chunk ${folderChromeLayoutChunk.fileName} is ${folderChromeLayoutChunk.bytes} bytes, above 8 KiB.`)
}
if (!folderSelectionBarChunk || folderSelectionBarChunk === folderMainChunk) {
  throw new Error("NeoView FolderSelectionBar did not produce a second-level deferred production chunk.")
}
if (folderSelectionBarChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView FolderSelectionBar chunk ${folderSelectionBarChunk.fileName} is ${folderSelectionBarChunk.bytes} bytes, above 8 KiB.`)
}
if (!folderContextActionsChunk || folderContextActionsChunk === folderMainChunk || folderContextActionsChunk === readerSidebarChunk || folderContextActionsChunk === neoViewChunk || folderContextActionsChunk === initialChunk) {
  throw new Error("NeoView Folder context actions did not produce a second-level deferred production chunk.")
}
if (folderContextActionsChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView Folder context actions chunk ${folderContextActionsChunk.fileName} is ${folderContextActionsChunk.bytes} bytes, above 8 KiB.`)
}
if (!folderRenameDialogChunk || folderRenameDialogChunk === folderContextActionsChunk || folderRenameDialogChunk === folderMainChunk || folderRenameDialogChunk === readerSidebarChunk || folderRenameDialogChunk === neoViewChunk || folderRenameDialogChunk === initialChunk) {
  throw new Error("NeoView Folder rename dialog did not produce a third-level deferred production chunk.")
}
if (folderRenameDialogChunk.bytes > 8 * 1024) {
  throw new Error(`NeoView Folder rename dialog chunk ${folderRenameDialogChunk.fileName} is ${folderRenameDialogChunk.bytes} bytes, above 8 KiB.`)
}
if (!folderSearchChunk || folderSearchChunk === folderMainChunk) {
  throw new Error("NeoView FolderSearchPanel did not produce a second-level deferred production chunk.")
}
if (folderSearchChunk.bytes > 16 * 1024) {
  throw new Error(`NeoView FolderSearchPanel chunk ${folderSearchChunk.fileName} is ${folderSearchChunk.bytes} bytes, above 16 KiB.`)
}
if (!folderTreeChunk || folderTreeChunk === folderMainChunk) {
  throw new Error("NeoView FolderTreePanel did not produce a second-level deferred production chunk.")
}
if (folderTreeChunk.bytes > 16 * 1024) {
  throw new Error(`NeoView FolderTreePanel chunk ${folderTreeChunk.fileName} is ${folderTreeChunk.bytes} bytes, above 16 KiB.`)
}
if (!directoryWatchChunk || directoryWatchChunk === folderMainChunk) {
  throw new Error("NeoView DirectoryWatch did not produce a second-level deferred production chunk.")
}
if (directoryWatchChunk.bytes > 4 * 1024) {
  throw new Error(`NeoView DirectoryWatch chunk ${directoryWatchChunk.fileName} is ${directoryWatchChunk.bytes} bytes, above 4 KiB.`)
}
const nativeWatcherModules = chunks.flatMap((chunk) => chunk.modules.filter((module) => /@parcel[/\\]watcher/i.test(module)))
if (nativeWatcherModules.length) throw new Error(`Native @parcel/watcher leaked into the frontend build: ${nativeWatcherModules.join(", ")}`)

const settingsWindowChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]ReaderSettingsWindow\.tsx$/i.test(module)))
const sidebarManagementSettingsCardChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]cards[/\\]SidebarManagementSettingsCard\.tsx$/i.test(module)))
const panelLayoutEditorChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]cards[/\\]PanelLayoutEditor\.tsx$/i.test(module)))
const inputBindingsSettingsCardChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]cards[/\\]InputBindingsSettingsCard\.tsx$/i.test(module)))
const gamepadRuntimeChunk = chunks.find((chunk) => chunk.modules.some((module) => /[/\\]node_modules[/\\]gamepad\.js[/\\]/i.test(module)))
// [neoview.bindings.chunk]
const gestureInputRuntimeChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]input[/\\]ReaderGestureInputRuntime\.tsx$/i.test(module)))
const kanbanRuntimeChunk = chunks.find((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]components[/\\]ui[/\\]kanban\.tsx$/i.test(module)))
if (!settingsWindowChunk) throw new Error("NeoView settings window did not produce a deferred production chunk.")
if (!sidebarManagementSettingsCardChunk) throw new Error("NeoView SidebarManagementSettingsCard did not produce a deferred production chunk.")
if (!panelLayoutEditorChunk) throw new Error("NeoView PanelLayoutEditor did not produce a second-level deferred production chunk.")
if (!inputBindingsSettingsCardChunk || inputBindingsSettingsCardChunk === settingsWindowChunk || inputBindingsSettingsCardChunk === neoViewChunk) throw new Error("NeoView InputBindingsSettingsCard did not produce a second-level deferred production chunk.")
if (!gamepadRuntimeChunk || gamepadRuntimeChunk === neoViewChunk || gamepadRuntimeChunk === initialChunk) throw new Error("gamepad.js leaked into an eager Reader/initial chunk.")
if (!gestureInputRuntimeChunk || gestureInputRuntimeChunk === neoViewChunk || gestureInputRuntimeChunk === initialChunk) throw new Error("NeoView gesture input runtime leaked into an eager Reader/initial chunk.")
if (!kanbanRuntimeChunk) throw new Error("Dice UI Kanban runtime chunk is missing from the PanelLayoutEditor build.")
if (settingsWindowChunk === panelLayoutEditorChunk) throw new Error("NeoView PanelLayoutEditor leaked into the base settings window chunk.")
if (initialChunk === kanbanRuntimeChunk || neoViewChunk === kanbanRuntimeChunk || settingsWindowChunk === kanbanRuntimeChunk) {
  throw new Error("Dice UI Kanban runtime leaked into an eager NeoView/initial/settings-window chunk.")
}
if (panelLayoutEditorChunk.bytes > 64 * 1024) throw new Error(`NeoView PanelLayoutEditor chunk ${panelLayoutEditorChunk.fileName} is ${panelLayoutEditorChunk.bytes} bytes, above 64 KiB.`)
if (sidebarManagementSettingsCardChunk.bytes > 16 * 1024) throw new Error(`NeoView SidebarManagementSettingsCard chunk ${sidebarManagementSettingsCardChunk.fileName} is ${sidebarManagementSettingsCardChunk.bytes} bytes, above 16 KiB.`)
if (inputBindingsSettingsCardChunk.bytes > 24 * 1024) throw new Error(`NeoView InputBindingsSettingsCard chunk ${inputBindingsSettingsCardChunk.fileName} is ${inputBindingsSettingsCardChunk.bytes} bytes, above 24 KiB.`)
if (gestureInputRuntimeChunk.bytes > 40 * 1024) throw new Error(`NeoView gesture input runtime chunk ${gestureInputRuntimeChunk.fileName} is ${gestureInputRuntimeChunk.bytes} bytes, above 40 KiB.`)
if (kanbanRuntimeChunk.bytes > 64 * 1024) throw new Error(`Dice UI Kanban runtime chunk ${kanbanRuntimeChunk.fileName} is ${kanbanRuntimeChunk.bytes} bytes, above 64 KiB.`)
const ordinaryReaderChunks = [neoViewChunk, ...deferredPanelChunks.filter((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i.test(module)))]
const eagerEditorModules = ordinaryReaderChunks.flatMap((chunk) => chunk.modules
  .filter((module) => /[/\\]features[/\\]settings[/\\]|@dnd-kit|[/\\]components[/\\]ui[/\\]kanban\.tsx$/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (eagerEditorModules.length) throw new Error(`NeoView settings/Kanban modules leaked into the ordinary reader path:\n${eagerEditorModules.join("\n")}`)

const initialNeoViewModules = initialChunk.modules.filter((module) => /[/\\]neoview[/\\]/i.test(module))
if (initialNeoViewModules.length) {
  throw new Error(`NeoView leaked into initial chunk ${initialScript}: ${initialNeoViewModules.join(", ")}`)
}

const zipModules = chunks.flatMap((chunk) => chunk.modules
  .filter((module) => /@zip\.js|[/\\]zip\.js[/\\]/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (zipModules.length) throw new Error(`zip.js leaked into the frontend build:\n${zipModules.join("\n")}`)

console.log(JSON.stringify({
  initialChunk: { fileName: initialChunk.fileName, bytes: initialChunk.bytes, neoviewModules: 0 },
  neoviewChunk: { fileName: neoViewChunk.fileName, bytes: neoViewChunk.bytes },
  deferredPresentationChunks: [...new Set([readerFrameChunk, readerViewToolbarChunk])].map((chunk) => ({ fileName: chunk.fileName, bytes: chunk.bytes })),
  deferredPanelChunks: deferredPanelChunks.map((chunk) => ({ fileName: chunk.fileName, bytes: chunk.bytes })),
  historyListChunk: { fileName: historyListChunk.fileName, bytes: historyListChunk.bytes },
  bookmarkListChunk: { fileName: bookmarkListChunk.fileName, bytes: bookmarkListChunk.bytes },
  pageNavigationChunk: { fileName: pageNavigationChunk.fileName, bytes: pageNavigationChunk.bytes },
  thumbnailSurfaceChunk: { fileName: thumbnailSurfaceChunk.fileName, bytes: thumbnailSurfaceChunk.bytes },
  entrySurfaceChunk: { fileName: entrySurfaceChunk.fileName, bytes: entrySurfaceChunk.bytes },
  timeInformationChunk: { fileName: timeInformationChunk.fileName, bytes: timeInformationChunk.bytes },
  bookInformationChunk: { fileName: bookInformationChunk.fileName, bytes: bookInformationChunk.bytes },
  storageInformationChunk: { fileName: storageInformationChunk.fileName, bytes: storageInformationChunk.bytes },
  imageInformationChunk: { fileName: imageInformationChunk.fileName, bytes: imageInformationChunk.bytes },
  preloadStatusChunk: { fileName: preloadStatusChunk.fileName, bytes: preloadStatusChunk.bytes },
  sidebarControlCardChunk: { fileName: sidebarControlCardChunk.fileName, bytes: sidebarControlCardChunk.bytes },
  sidebarFloatingControllerChunk: { fileName: sidebarFloatingControllerChunk.fileName, bytes: sidebarFloatingControllerChunk.bytes },
  folderSearchChunk: { fileName: folderSearchChunk.fileName, bytes: folderSearchChunk.bytes },
  folderTreeChunk: { fileName: folderTreeChunk.fileName, bytes: folderTreeChunk.bytes },
  directoryWatchChunk: { fileName: directoryWatchChunk.fileName, bytes: directoryWatchChunk.bytes },
  folderContextActionsChunk: { fileName: folderContextActionsChunk.fileName, bytes: folderContextActionsChunk.bytes },
  settingsWindowChunk: { fileName: settingsWindowChunk.fileName, bytes: settingsWindowChunk.bytes },
  sidebarManagementSettingsCardChunk: { fileName: sidebarManagementSettingsCardChunk.fileName, bytes: sidebarManagementSettingsCardChunk.bytes },
  inputBindingsSettingsCardChunk: { fileName: inputBindingsSettingsCardChunk.fileName, bytes: inputBindingsSettingsCardChunk.bytes },
  gestureInputRuntimeChunk: { fileName: gestureInputRuntimeChunk.fileName, bytes: gestureInputRuntimeChunk.bytes },
  gamepadRuntimeChunk: { fileName: gamepadRuntimeChunk.fileName, bytes: gamepadRuntimeChunk.bytes },
  panelLayoutEditorChunk: { fileName: panelLayoutEditorChunk.fileName, bytes: panelLayoutEditorChunk.bytes },
  kanbanRuntimeChunk: { fileName: kanbanRuntimeChunk.fileName, bytes: kanbanRuntimeChunk.bytes },
  zipJsFrontendModules: 0,
  browserExternalModules: 0,
  nodeOnlyNeoViewModules: 0,
}, null, 2))
