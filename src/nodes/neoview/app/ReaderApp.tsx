import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { BookOpen, ChevronRight, FolderOpen, ImageIcon, LoaderCircle, X } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  DEFAULT_READER_INPUT_BINDINGS,
  READER_CARD_MANIFEST,
  READER_PANEL_MANIFEST,
  ReaderSlideshow,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderPresentation,
  type ReaderInputAction,
  type ReaderInputBindingsConfig,
} from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { FloatingWindowCaptionControls, FloatingWindowTitlebarReservation, useFloatingWindowFrame } from "@/components/workspace/FloatingWindowFrame"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import {
  createReaderHttpClient,
  READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  ReaderHttpError,
  type ReaderHttpClient,
  type ReaderBookmarkListPreferencesDto,
  type ReaderHistoryListPreferencesDto,
  type ReaderNavigationDto,
  type ReaderBookSettingsUpdateDto,
  type ReaderRuntimeConfigDto,
  type ReaderPageListPreferencesDto,
  type ReaderSessionDto,
  type ReaderShellConfigDto,
  type ReaderSidebarLayoutPatch,
  type ReaderCardLayoutPatch,
  type ReaderBoardLayoutPatch,
  type ReaderViewDefaultsPatch,
  type ReaderFolderViewConfig,
  type ReaderFolderViewPatch,
  type ReaderSlideshowConfig,
  type ReaderSlideshowPatch,
  type ReaderShellControlPatch,
  type ReaderShellEdge,
  type ReaderShellLockMode,
  type ReaderInputBindingsPatch,
} from "../adapters/reader-http-client"
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { ReaderControlledEdgeShell, type ReaderControlledEdgeSlot } from "../features/shell/ReaderControlledEdgeShell"
import { createReaderShellControlStore, type ReaderShellControlHydration, type ReaderShellControlSnapshot } from "../features/shell/ReaderShellControlStore"
import type { ReaderShellControlPort } from "../features/shell/ReaderShellControlPort"
import { ReaderWindowBar } from "../features/shell/ReaderWindowBar"
import { ThumbnailStrip } from "../features/thumbnails/ThumbnailStrip"
import { useReaderInputRouter } from "../features/input/ReaderInputRouter"

type ReaderSidebarModule = typeof import("../features/panels/ReaderSidebar")
const INITIAL_VIEW_DEFAULTS = {
  fitMode: DEFAULT_READER_PRESENTATION.fitMode,
  pageMode: "single",
} satisfies ReaderRuntimeConfigDto["viewDefaults"]
const INITIAL_HISTORY_LIST_PREFERENCES: ReaderHistoryListPreferencesDto = {
  viewMode: "compact",
}
const INITIAL_BOOKMARK_LIST_PREFERENCES: ReaderBookmarkListPreferencesDto = {
  activeListId: "all",
}
const INITIAL_PAGE_LIST_PREFERENCES: ReaderPageListPreferencesDto = {
  viewMode: "list",
  followProgress: true,
}
const INITIAL_SLIDESHOW_CONFIG: ReaderSlideshowConfig = {
  intervalSeconds: 5,
  loop: false,
  random: false,
  fadeTransition: true,
}
const INITIAL_FOLDER_VIEW_CONFIG: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
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
  tabs: { pinned: [], layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top" },
}
let readerSidebarModule: Promise<ReaderSidebarModule> | undefined
function loadReaderSidebar(): Promise<ReaderSidebarModule> {
  readerSidebarModule ??= import("../features/panels/ReaderSidebar")
  return readerSidebarModule
}
const LazyReaderSidebar = lazy(async () => ({ default: (await loadReaderSidebar()).ReaderSidebar }))
const LazyReaderGestureInputRuntime = lazy(async () => ({
  default: (await import("../features/input/ReaderGestureInputRuntime")).ReaderGestureInputRuntime,
}))

type ReaderSettingsWindowModule = typeof import("../features/settings/ReaderSettingsWindow")
let readerSettingsWindowModule: Promise<ReaderSettingsWindowModule> | undefined
function loadReaderSettingsWindow(): Promise<ReaderSettingsWindowModule> {
  readerSettingsWindowModule ??= import("../features/settings/ReaderSettingsWindow")
  return readerSettingsWindowModule
}
const LazyReaderSettingsWindow = lazy(async () => ({ default: (await loadReaderSettingsWindow()).ReaderSettingsWindow }))

type ReaderFrameModule = typeof import("../features/reader/ReaderFrame")
let readerFrameModule: Promise<ReaderFrameModule> | undefined
function loadReaderFrame(): Promise<ReaderFrameModule> {
  readerFrameModule ??= import("../features/reader/ReaderFrame")
  return readerFrameModule
}
const LazyReaderFrame = lazy(async () => ({ default: (await loadReaderFrame()).ReaderFrame }))

type ReaderViewToolbarModule = typeof import("../features/reader/ReaderViewToolbar")
let readerViewToolbarModule: Promise<ReaderViewToolbarModule> | undefined
function loadReaderViewToolbar(): Promise<ReaderViewToolbarModule> {
  readerViewToolbarModule ??= import("../features/reader/ReaderViewToolbar")
  return readerViewToolbarModule
}
const LazyReaderViewToolbar = lazy(async () => ({ default: (await loadReaderViewToolbar()).ReaderViewToolbar }))

const LazySidebarFloatingController = lazy(() => import("../features/shell/SidebarFloatingController"))

function loadReaderPresentation(): Promise<unknown> {
  return Promise.all([loadReaderFrame(), loadReaderViewToolbar()])
}

export interface ReaderAppProps {
  initialPath?: string
  client?: ReaderHttpClient
  pickFile?: () => Promise<string | undefined>
  pickDirectory?: () => Promise<string | undefined>
  copyText?: (text: string) => Promise<void>
  copyFiles?: (paths: string[]) => Promise<void>
  onPathCommitted?: (path: string) => void
}

export function ReaderApp({
  initialPath = "",
  client: injectedClient,
  pickFile,
  pickDirectory,
  copyText,
  copyFiles,
  onPathCommitted,
}: ReaderAppProps) {
  const surface = useNodeSurface()
  const floatingFrame = useFloatingWindowFrame()
  const [client] = useState<ReaderHttpClient>(() => injectedClient ?? createReaderHttpClient())
  const clientRef = useRef(client)
  const shellRef = useRef<ReaderShellConfigDto | undefined>(undefined)
  const sessionRef = useRef<string | undefined>(undefined)
  const operationRef = useRef<AbortController | undefined>(undefined)
  const slideshowSessionRef = useRef<ReaderSessionDto | undefined>(undefined)
  const [slideshow] = useState(() => new ReaderSlideshow({
    readPosition: () => {
      const current = slideshowSessionRef.current
      return {
        pageCount: current?.book.pageCount ?? 0,
        currentPageIndex: current?.frame.anchorPageIndex ?? 0,
        atEnd: current?.frame.atEnd ?? true,
      }
    },
    nextPage: () => navigate("next", true),
    goToPage: (pageIndex) => goTo(pageIndex, true),
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const viewDefaultsRef = useRef<ReaderRuntimeConfigDto["viewDefaults"]>({ ...INITIAL_VIEW_DEFAULTS })
  const confirmedViewDefaultsRef = useRef<ReaderRuntimeConfigDto["viewDefaults"]>({ ...INITIAL_VIEW_DEFAULTS })
  const viewDefaultsWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const viewDefaultsGenerationRef = useRef(0)
  const pageListPreferencesRef = useRef<ReaderPageListPreferencesDto>({ ...INITIAL_PAGE_LIST_PREFERENCES })
  const confirmedPageListPreferencesRef = useRef<ReaderPageListPreferencesDto>({ ...INITIAL_PAGE_LIST_PREFERENCES })
  const pageListPreferencesWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pageListPreferencesGenerationRef = useRef(0)
  const bookmarkListPreferencesGenerationRef = useRef(0)
  const historyListPreferencesGenerationRef = useRef(0)
  const slideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const confirmedSlideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const slideshowWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const slideshowGenerationRef = useRef(0)
  const folderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const confirmedFolderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const folderViewWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const folderViewGenerationRef = useRef(0)
  const inputBindingsRef = useRef<ReaderInputBindingsConfig>(structuredClone(DEFAULT_READER_INPUT_BINDINGS))
  const shellControlWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const shellControlGenerationRef = useRef(0)
  const presentationTouchedRef = useRef(false)
  const [path, setPath] = useState(initialPath)
  const [session, setSession] = useState<ReaderSessionDto | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [shell, setShell] = useState<ReaderShellConfigDto | undefined>(undefined)
  const [shellControlStore] = useState(() => createReaderShellControlStore({
    edges: {
      top: { open: true },
      left: { open: true, pinned: true },
    },
  }))
  const [shellControl] = useState<ReaderShellControlPort>(() => ({
    store: shellControlStore,
    requestOpen: requestShellEdgeOpen,
    setPinned: setShellEdgePinned,
    cycleLock: cycleShellEdgeLock,
    setLock: setShellEdgeLock,
    setFloating: setShellFloatingControl,
    setTriggerSize: setShellEdgeTriggerSize,
    reset: resetShellControl,
    persist: persistShellControl,
  }))
  const [viewDefaults, setViewDefaults] = useState<ReaderRuntimeConfigDto["viewDefaults"]>(() => ({ ...INITIAL_VIEW_DEFAULTS }))
  const [pageListPreferences, setPageListPreferences] = useState<ReaderPageListPreferencesDto>(() => ({ ...INITIAL_PAGE_LIST_PREFERENCES }))
  const [bookmarkListPreferences, setBookmarkListPreferences] = useState<ReaderBookmarkListPreferencesDto>(() => ({ ...INITIAL_BOOKMARK_LIST_PREFERENCES }))
  const [historyListPreferences, setHistoryListPreferences] = useState<ReaderHistoryListPreferencesDto>(() => ({ ...INITIAL_HISTORY_LIST_PREFERENCES }))
  const [folderView, setFolderView] = useState<ReaderFolderViewConfig>(() => structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const [inputBindings, setInputBindings] = useState<ReaderInputBindingsConfig>(() => structuredClone(DEFAULT_READER_INPUT_BINDINGS))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [presentation, setPresentation] = useState<ReaderPresentation>(() => ({ ...DEFAULT_READER_PRESENTATION }))
  const prefetchPages = useReaderImagePreloader(session?.sessionId)
  slideshowSessionRef.current = session
  shellRef.current = shell

  useEffect(() => () => {
    operationRef.current?.abort()
    slideshow.dispose()
    const sessionId = sessionRef.current
    if (sessionId) void clientRef.current.close(sessionId).catch(() => undefined)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void clientRef.current.config(controller.signal).then((config) => {
      if (viewDefaultsGenerationRef.current === 0) {
        viewDefaultsRef.current = config.viewDefaults
        confirmedViewDefaultsRef.current = config.viewDefaults
        setViewDefaults(config.viewDefaults)
      }
      if (pageListPreferencesGenerationRef.current === 0) {
        pageListPreferencesRef.current = config.pageList
        confirmedPageListPreferencesRef.current = config.pageList
        setPageListPreferences(config.pageList)
      }
      if (bookmarkListPreferencesGenerationRef.current === 0) setBookmarkListPreferences(config.bookmarkList)
      if (historyListPreferencesGenerationRef.current === 0) setHistoryListPreferences(config.historyList)
      setShell(config.shell)
      shellControlStore.hydrate(shellControlHydration(config.shell))
      if (folderViewGenerationRef.current === 0) {
        folderViewRef.current = config.folderView
        confirmedFolderViewRef.current = config.folderView
        setFolderView(config.folderView)
      }
      if (slideshowGenerationRef.current === 0) {
        slideshowConfigRef.current = config.slideshow
        confirmedSlideshowConfigRef.current = config.slideshow
        slideshow.configure(config.slideshow)
      }
      inputBindingsRef.current = config.inputBindings
      setInputBindings(config.inputBindings)
      if (!presentationTouchedRef.current) {
        setPresentation((current) => ({ ...current, fitMode: config.viewDefaults.fitMode }))
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function openPath(nextPath = path) {
    const normalizedPath = nextPath.trim()
    if (!normalizedPath || busy) return
    slideshow.stop()
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const previousSession = sessionRef.current
      const presentationReady = loadReaderPresentation()
      const opened = await clientRef.current.open(normalizedPath, controller.signal)
      try {
        await presentationReady
      } catch (error) {
        await clientRef.current.close(opened.sessionId).catch(() => undefined)
        throw error
      }
      if (controller.signal.aborted) {
        void clientRef.current.close(opened.sessionId).catch(() => undefined)
        return
      }
      sessionRef.current = opened.sessionId
      setSession(opened)
      setPresentation({ ...DEFAULT_READER_PRESENTATION, fitMode: viewDefaultsRef.current.fitMode })
      presentationTouchedRef.current = false
      setPath(normalizedPath)
      onPathCommitted?.(normalizedPath)
      if (previousSession && previousSession !== opened.sessionId) {
        void clientRef.current.close(previousSession).catch(() => undefined)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function navigate(action: "next" | "previous", slideshowAction = false): Promise<boolean> {
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.navigate(sessionId, action, signal))
    if (updated && !slideshowAction) slideshow.resetOnUserAction()
    return updated
  }

  async function goTo(pageIndex: number, slideshowAction = false): Promise<boolean> {
    if (pageIndex === slideshowSessionRef.current?.frame.anchorPageIndex) return false
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.goTo(sessionId, pageIndex, signal))
    if (updated && !slideshowAction) slideshow.resetOnUserAction()
    return updated
  }

  async function updateNavigation(
    request: (sessionId: string, signal: AbortSignal) => Promise<ReaderNavigationDto>,
  ): Promise<boolean> {
    const sessionId = sessionRef.current
    if (!sessionId || busy) return false
    const controller = new AbortController()
    operationRef.current?.abort()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const result = await request(sessionId, controller.signal)
      if (!controller.signal.aborted) setSession((current) => current ? applyNavigation(current, result) : current)
      return !controller.signal.aborted
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
      return false
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function applyBookSettingsUpdate(sessionId: string, update: ReaderBookSettingsUpdateDto) {
    if (sessionRef.current !== sessionId) return
    setSession((current) => current?.sessionId === sessionId ? applyNavigation(current, update) : current)
  }

  function updatePresentation(next: ReaderPresentation) {
    const fitModeChanged = next.fitMode !== presentation.fitMode
    presentationTouchedRef.current = true
    setPresentation(next)
    if (fitModeChanged) void persistViewDefaults({ fitMode: next.fitMode })
  }

  async function updatePageMode(pageMode: "single" | "double") {
    if (pageMode === session?.frame.layout.pageMode) return
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { layout: { pageMode } },
      signal,
    ))
    if (updated) void persistViewDefaults({ pageMode })
  }

  async function updateCurrentBookPageMode(pageMode: "single" | "double") {
    if (pageMode === session?.frame.layout.pageMode) return
    await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { layout: { pageMode } },
      signal,
    ))
  }

  async function updateCurrentBookReadingDirection(direction: "left-to-right" | "right-to-left") {
    if (direction === session?.frame.direction) return
    await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { direction },
      signal,
    ))
  }

  async function persistHistoryListPreferences(patch: Partial<ReaderHistoryListPreferencesDto>): Promise<ReaderHistoryListPreferencesDto> {
    const generation = ++historyListPreferencesGenerationRef.current
    const next = { ...historyListPreferences, ...patch }
    if (!clientRef.current.updateHistoryList) {
      setHistoryListPreferences(next)
      return next
    }
    const updated = await clientRef.current.updateHistoryList({ historyList: patch })
    if (generation === historyListPreferencesGenerationRef.current) setHistoryListPreferences(updated)
    return updated
  }

  async function persistBookmarkListPreferences(patch: Partial<ReaderBookmarkListPreferencesDto>): Promise<ReaderBookmarkListPreferencesDto> {
    const generation = ++bookmarkListPreferencesGenerationRef.current
    const next = { ...bookmarkListPreferences, ...patch }
    if (!clientRef.current.updateBookmarkList) {
      setBookmarkListPreferences(next)
      return next
    }
    const updated = await clientRef.current.updateBookmarkList({ bookmarkList: patch })
    if (generation === bookmarkListPreferencesGenerationRef.current) setBookmarkListPreferences(updated)
    return updated
  }

  async function persistPageListPreferences(patch: Partial<ReaderPageListPreferencesDto>) {
    const next = { ...pageListPreferencesRef.current, ...patch }
    pageListPreferencesRef.current = next
    setPageListPreferences(next)
    if (!clientRef.current.updatePageList) {
      confirmedPageListPreferencesRef.current = next
      return
    }
    const generation = ++pageListPreferencesGenerationRef.current
    const write = pageListPreferencesWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updatePageList!({ pageList: patch })
        confirmedPageListPreferencesRef.current = updated
        if (generation === pageListPreferencesGenerationRef.current) {
          pageListPreferencesRef.current = updated
          setPageListPreferences(updated)
        }
      } catch (cause) {
        if (generation === pageListPreferencesGenerationRef.current) {
          const confirmed = confirmedPageListPreferencesRef.current
          pageListPreferencesRef.current = confirmed
          setPageListPreferences(confirmed)
        }
        throw cause
      }
    })
    pageListPreferencesWriteQueueRef.current = write.catch(() => undefined)
    await write
  }

  async function persistViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    const next = { ...viewDefaultsRef.current, ...patch }
    viewDefaultsRef.current = next
    setViewDefaults(next)
    const generation = ++viewDefaultsGenerationRef.current
    const write = viewDefaultsWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateViewDefaults({ viewDefaults: patch })
        confirmedViewDefaultsRef.current = updated
        if (generation === viewDefaultsGenerationRef.current) {
          viewDefaultsRef.current = updated
          setViewDefaults(updated)
        }
      } catch (cause) {
        if (generation === viewDefaultsGenerationRef.current) {
          const confirmed = confirmedViewDefaultsRef.current
          viewDefaultsRef.current = confirmed
          setViewDefaults(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    viewDefaultsWriteQueueRef.current = write
    await write
  }

  async function applyConfiguredViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    const fitMode = patch.fitMode
    if (fitMode) {
      presentationTouchedRef.current = true
      setPresentation((current) => ({ ...current, fitMode, manualScale: 1 }))
      await persistViewDefaults({ fitMode })
    }
    if (patch.pageMode) {
      if (sessionRef.current) await updatePageMode(patch.pageMode)
      else await persistViewDefaults({ pageMode: patch.pageMode })
    }
  }

  async function persistInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderInputBindingsConfig> {
    if (!clientRef.current.updateInputBindings) throw new Error("当前 Reader 后端不支持操作绑定设置。")
    const updated = await clientRef.current.updateInputBindings({ inputBindings: patch })
    inputBindingsRef.current = updated
    setInputBindings(updated)
    return updated
  }

  function executeInputAction(action: ReaderInputAction): void {
    switch (action) {
      case "reader.previous-page":
        void navigate("previous")
        break
      case "reader.next-page":
        void navigate("next")
        break
      case "reader.zoom-in":
        presentationTouchedRef.current = true
        setPresentation((current) => ({ ...current, manualScale: stepReaderManualScale(current.manualScale, 1) }))
        break
      case "reader.zoom-out":
        presentationTouchedRef.current = true
        setPresentation((current) => ({ ...current, manualScale: stepReaderManualScale(current.manualScale, -1) }))
        break
      case "reader.reset-view":
        presentationTouchedRef.current = true
        setPresentation({ ...DEFAULT_READER_PRESENTATION })
        break
      case "reader.rotate-clockwise":
        presentationTouchedRef.current = true
        setPresentation((current) => ({ ...current, rotation: rotateReaderPresentation(current.rotation, 1) }))
        break
      case "reader.open-settings":
        setSettingsOpen(true)
        break
    }
  }

  const inputRouter = useReaderInputRouter({ config: inputBindings, disabled: busy, execute: executeInputAction })

  async function persistSlideshow(patch: ReaderSlideshowPatch["slideshow"]) {
    slideshow.configure(patch)
    const normalizedPatch = patch.intervalSeconds === undefined
      ? patch
      : { ...patch, intervalSeconds: slideshow.getSnapshot().intervalSeconds }
    const next = { ...slideshowConfigRef.current, ...normalizedPatch }
    slideshowConfigRef.current = next
    const generation = ++slideshowGenerationRef.current
    const write = slideshowWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateSlideshow({ slideshow: normalizedPatch })
        confirmedSlideshowConfigRef.current = updated
        if (generation === slideshowGenerationRef.current) {
          slideshowConfigRef.current = updated
          slideshow.configure(updated)
        }
      } catch (cause) {
        if (generation === slideshowGenerationRef.current) {
          const confirmed = confirmedSlideshowConfigRef.current
          slideshowConfigRef.current = confirmed
          slideshow.configure(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    slideshowWriteQueueRef.current = write
    await write
  }

  async function persistFolderView(patch: ReaderFolderViewPatch["folderView"]) {
    const next: ReaderFolderViewConfig = {
      ...folderViewRef.current,
      ...patch,
      details: {
        ...folderViewRef.current.details,
        ...patch.details,
        columnWidths: {
          ...folderViewRef.current.details.columnWidths,
          ...patch.details?.columnWidths,
        },
      },
      search: {
        ...folderViewRef.current.search,
        ...patch.search,
      },
      emptyArea: {
        ...folderViewRef.current.emptyArea,
        ...patch.emptyArea,
      },
      tree: {
        ...folderViewRef.current.tree,
        ...patch.tree,
      },
      tabs: {
        ...(folderViewRef.current.tabs ?? DEFAULT_FOLDER_VIEW.tabs),
        ...patch.tabs,
      },
    }
    folderViewRef.current = next
    setFolderView(next)
    if (!clientRef.current.updateFolderView) {
      confirmedFolderViewRef.current = next
      return
    }
    const generation = ++folderViewGenerationRef.current
    const write = folderViewWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateFolderView!({ folderView: patch })
        confirmedFolderViewRef.current = updated
        if (generation === folderViewGenerationRef.current) {
          folderViewRef.current = updated
          setFolderView(updated)
        }
      } catch (cause) {
        if (generation === folderViewGenerationRef.current) {
          const confirmed = confirmedFolderViewRef.current
          folderViewRef.current = confirmed
          setFolderView(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    folderViewWriteQueueRef.current = write
    await write
  }

  async function closeSession() {
    slideshow.stop()
    operationRef.current?.abort()
    operationRef.current = undefined
    const sessionId = sessionRef.current
    sessionRef.current = undefined
    setSession(undefined)
    setBusy(false)
    if (sessionId) await clientRef.current.close(sessionId).catch(() => undefined)
  }

  function requestShellEdgeOpen(edge: ReaderShellEdge, open: boolean) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.requestOpen(edge, open)
    const next = shellControlStore.getSnapshot().edges[edge]
    if (previous.edges[edge].lockMode !== next.lockMode) {
      enqueueShellControl({ edges: { [edge]: { lockMode: next.lockMode, pinned: next.pinned } } }, previous)
    }
  }

  function setShellEdgePinned(edge: ReaderShellEdge, pinned: boolean) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setPinned(edge, pinned)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function cycleShellEdgeLock(edge: ReaderShellEdge) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.cycleLock(edge)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function setShellEdgeLock(edge: ReaderShellEdge, lockMode: ReaderShellLockMode) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setLock(edge, lockMode)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function setShellFloatingControl(patch: Partial<ReaderShellControlSnapshot["floating"]>) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setFloating(patch)
    enqueueShellControl({ floating: patch }, previous)
  }

  function setShellEdgeTriggerSize(edge: ReaderShellEdge, triggerSize: number) {
    enqueueShellControl({ edges: { [edge]: { triggerSize } } })
  }

  function resetShellControl() {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.replace(defaultShellControlSnapshot())
    enqueueShellControl({ reset: "known-defaults" }, previous)
  }

  function persistShellControl(patch: ReaderShellControlPatch["shellControl"]) {
    enqueueShellControl(patch)
  }

  function enqueueShellControl(patch: ReaderShellControlPatch["shellControl"], rollback?: ReaderShellControlSnapshot) {
    const generation = ++shellControlGenerationRef.current
    shellControlWriteQueueRef.current = shellControlWriteQueueRef.current.then(async () => {
      const update = clientRef.current.updateShellControl
      if (!update) return
      try {
        const updated = await update({ expectedRevision: shellRef.current?.revision ?? 0, shellControl: patch })
        shellRef.current = updated
        setShell(updated)
        if (generation === shellControlGenerationRef.current) shellControlStore.replace(shellControlSnapshot(updated))
      } catch (cause) {
        if (generation === shellControlGenerationRef.current && rollback) shellControlStore.replace(rollback)
        if (cause instanceof ReaderHttpError && cause.status === 409) {
          const latest = await clientRef.current.config().catch(() => undefined)
          if (latest) {
            shellRef.current = latest.shell
            setShell(latest.shell)
            if (generation === shellControlGenerationRef.current) shellControlStore.replace(shellControlSnapshot(latest.shell))
          }
        }
        setError(errorMessage(cause))
      }
    })
  }

  async function commitSidebarLayout(patch: ReaderSidebarLayoutPatch) {
    const previousControl = shellControlStore.getSnapshot()
    if (patch.pinned !== undefined) shellControlStore.setPinned(patch.side, patch.pinned)
    try {
      const updated = await clientRef.current.updateSidebarLayout(patch)
      setShell(updated)
    } catch (cause) {
      if (patch.pinned !== undefined) shellControlStore.replace(previousControl)
      setShell((current) => current ? { ...current, sidebars: { ...current.sidebars } } : current)
      setError(errorMessage(cause))
    }
  }

  async function commitCardLayout(patch: ReaderCardLayoutPatch) {
    const previous = shell
    const { cardId, ...changes } = patch
    if (previous) {
      const current = previous.cardLayout[cardId]
      if (current) {
        const next = { ...current, ...changes }
        if (changes.height === null) delete next.height
        setShell({
          ...previous,
          cardLayout: { ...previous.cardLayout, [cardId]: next },
        })
      }
    }
    try {
      setShell(await clientRef.current.updateCardLayout(patch))
    } catch (cause) {
      setShell(previous)
      setError(errorMessage(cause))
    }
  }

  async function commitBoardLayout(patch: ReaderBoardLayoutPatch) {
    try {
      setShell(await clientRef.current.updateBoardLayout(patch))
    } catch (cause) {
      if (cause instanceof ReaderHttpError && cause.status === 409) {
        const latest = await clientRef.current.config().catch(() => undefined)
        if (latest) setShell(latest.shell)
      }
      setError(errorMessage(cause))
      throw cause
    }
  }

  async function choose(source: "file" | "directory") {
    const selected = source === "file" ? await pickFile?.() : await pickDirectory?.()
    if (selected) {
      setPath(selected)
      await openPath(selected)
    }
  }

  const compact = surface.mode === "collapsed" || surface.mode === "compact" || surface.mode === "portrait"
  const frame = session?.frame
  const pathSegments = readerPathSegments(path)
  useReaderAdjacentPagePreloader({
    client,
    sessionId: session?.sessionId,
    activePageIndex: frame?.anchorPageIndex,
    totalPages: session?.book.pageCount,
    preload: prefetchPages,
  })

  const topEdge: ReaderControlledEdgeSlot = {
    ariaLabel: "NeoView 顶部工具栏",
    triggerSize: shell?.edges.top.triggerSize,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div
        className="border-b border-border/55 bg-background/94 text-foreground shadow-[0_10px_30px_rgb(0_0_0/0.22)] backdrop-blur-xl"
        data-reader-edge-chrome="top"
        style={edgeSurfaceStyle(shell, "top")}
      >
        <div className={cn(floatingFrame && "xiranite-app-region-drag")} onDoubleClick={floatingFrame?.handleTitlebarDoubleClick}>
          <ReaderWindowBar control={shellControl} disabled={!shell} onOpenSettings={() => setSettingsOpen(true)} windowControls={<FloatingWindowCaptionControls integrated />} />
        </div>
        <div className={cn("xiranite-app-region-no-drag min-h-11 border-b border-border/45", compact ? "px-2" : "px-3")} data-reader-breadcrumb-bar="true">
          {session ? (
            <div className="grid min-h-11 grid-cols-[minmax(3.5rem,1fr)_minmax(0,3fr)_minmax(3.5rem,1fr)] items-center gap-1.5">
              <Button className="justify-self-start" aria-label="关闭书籍" type="button" size="icon-sm" variant="ghost" onClick={() => void closeSession()}><X /></Button>
              <nav className="flex min-w-0 items-center justify-center gap-1 overflow-hidden text-center" aria-label="当前书籍路径" data-reader-breadcrumb-path="true">
                {pathSegments.map((segment, index) => (
                  <span className="contents" key={`${segment}-${index}`}>
                    {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/65" aria-hidden="true" /> : null}
                    <span className={cn("truncate text-xs", index === pathSegments.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{segment}</span>
                  </span>
                ))}
              </nav>
              <span className="justify-self-end text-[11px] tabular-nums text-muted-foreground">{(frame?.anchorPageIndex ?? 0) + 1} / {session.book.pageCount}</span>
            </div>
          ) : (
            <div className="flex min-h-11 items-center gap-1.5">
              <Input aria-label="漫画、图片或目录路径" className="h-8 min-w-0 flex-1" value={path} placeholder="选择 CBZ、ZIP、图片或目录" onChange={(event) => setPath(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); void openPath() } }} />
              {pickFile ? <Button aria-label="选择漫画或图片文件" type="button" size={compact ? "icon-sm" : "sm"} variant="ghost" onClick={() => void choose("file")}><ImageIcon />{compact ? null : "文件"}</Button> : null}
              {pickDirectory ? <Button aria-label="选择图片目录" type="button" size={compact ? "icon-sm" : "sm"} variant="ghost" onClick={() => void choose("directory")}><FolderOpen />{compact ? null : "目录"}</Button> : null}
              <Button aria-label="打开书籍" type="button" size={compact ? "icon-sm" : "sm"} onClick={() => void openPath()} disabled={!path.trim() || busy}>{busy ? <LoaderCircle className="animate-spin" /> : <BookOpen />}{compact ? null : "打开"}</Button>
            </div>
          )}
        </div>
        {session ? (
          <Suspense fallback={null}>
            <LazyReaderViewToolbar
              disabled={busy}
              pageMode={frame?.layout.pageMode ?? "single"}
              presentation={presentation}
              onChange={updatePresentation}
              onPageModeChange={(pageMode) => void updatePageMode(pageMode)}
              slideshow={slideshow}
              onSlideshowChange={persistSlideshow}
            />
          </Suspense>
        ) : null}
        {error ? <div role="alert" className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
      </div>
    ),
  }

  const bottomEdge: ReaderControlledEdgeSlot | undefined = session && (shell?.edges.bottom.enabled ?? true) ? {
    ariaLabel: "NeoView 底部缩略图与导航栏",
    triggerSize: shell?.edges.bottom.triggerSize,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div
        className="border-t border-border/55 bg-background/94 shadow-[0_-12px_30px_rgb(0_0_0/0.24)] backdrop-blur-xl"
        data-reader-edge-chrome="bottom"
        style={edgeSurfaceStyle(shell, "bottom")}
      >
        <ThumbnailStrip
          sessionId={session.sessionId}
          totalPages={session.book.pageCount}
          activePageIndex={session.frame.anchorPageIndex}
          currentPages={session.visiblePages}
          client={client}
          compact={compact}
          disabled={busy}
          pinned={shell?.edges.bottom.pinned ?? false}
          onPinnedChange={(pinned) => shellControl.setPinned("bottom", pinned)}
          onSelect={goTo}
        />
      </div>
    ),
  } : undefined

  const panelContext = {
    client,
    disabled: busy,
    onGoTo: goTo,
    onBookSettingsUpdated: applyBookSettingsUpdate,
    bookmarkListPreferences,
    onBookmarkListPreferences: persistBookmarkListPreferences,
    historyListPreferences,
    onHistoryListPreferences: persistHistoryListPreferences,
    pageListPreferences,
    onPageListPreferences: persistPageListPreferences,
    onPageModeChange: updateCurrentBookPageMode,
    onReadingDirectionChange: updateCurrentBookReadingDirection,
    sourcePath: path,
    systemActions: {
      copyText,
      copyFiles,
      revealPath: client.revealSystemPath,
    },
    onOpen: openPath,
    shell,
    shellControl,
    onBoardLayout: commitBoardLayout,
    viewDefaults,
    onViewDefaults: applyConfiguredViewDefaults,
    folderView,
    onFolderView: persistFolderView,
    presentation,
    ...(session ? { session } : {}),
  }
  const leftEdge: ReaderControlledEdgeSlot | undefined = (session || hasSessionlessPanel("left", shell)) && (shell?.edges.left.enabled ?? true) ? {
    ariaLabel: "NeoView 左侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.left.triggerSize,
    preload: () => void loadReaderSidebar(),
    render: (active) => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-r border-border/70 bg-background/85" aria-label="正在加载左侧面板" />}>
        <LazyReaderSidebar side="left" context={panelContext} shell={shell} active={active} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined
  const rightEdge: ReaderControlledEdgeSlot | undefined = (session || hasSessionlessPanel("right", shell)) && (shell?.edges.right.enabled ?? true) ? {
    ariaLabel: "NeoView 右侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.right.triggerSize,
    preload: () => void loadReaderSidebar(),
    render: (active) => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-l border-border/70 bg-background/85" aria-label="正在加载右侧面板" />}>
        <LazyReaderSidebar side="right" context={panelContext} shell={shell} active={active} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined

  return (
    <div
      ref={surface.ref}
      data-reader-app="true"
      data-input-context="reader"
      className="h-full min-h-0 w-full touch-none overflow-hidden bg-background text-foreground"
      tabIndex={0}
      onPointerUp={inputRouter.onPointerUp}
    >
      <Suspense fallback={null}>
        <LazyReaderGestureInputRuntime disabled={busy} target={surface.ref} dispatch={inputRouter.dispatch} />
      </Suspense>
      <FloatingWindowTitlebarReservation />
      <ReaderControlledEdgeShell store={shellControlStore} edges={{ top: topEdge, right: rightEdge, bottom: bottomEdge, left: leftEdge }}>
        <div className="relative h-full min-h-0 overflow-hidden bg-black/95">
          {!session ? (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55">
              <div><BookOpen className="mx-auto mb-3 size-8 opacity-60" /><p>打开漫画或图片开始阅读</p></div>
            </div>
          ) : (
            <Suspense fallback={null}>
              <LazyReaderFrame pages={session.visiblePages} presentation={presentation} />
            </Suspense>
          )}
          {busy && session ? <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white"><LoaderCircle className="size-4 animate-spin" /></div> : null}
          {shell ? <DeferredSidebarFloatingController control={shellControl} disabled={busy} /> : null}
        </div>
      </ReaderControlledEdgeShell>
      {settingsOpen && shell ? (
        <Suspense fallback={null}>
          <LazyReaderSettingsWindow
            shell={shell}
            viewDefaults={viewDefaults}
            inputBindings={inputBindings}
            onClose={() => setSettingsOpen(false)}
            onBoardLayout={commitBoardLayout}
            onViewDefaults={applyConfiguredViewDefaults}
            onInputBindings={persistInputBindings}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function DeferredSidebarFloatingController({ control, disabled }: { control: ReaderShellControlPort; disabled: boolean }) {
  const enabled = useSyncExternalStore(
    control.store.subscribe,
    () => control.store.getSnapshot().floating.enabled,
    () => control.store.getSnapshot().floating.enabled,
  )
  return enabled ? (
    <Suspense fallback={null}>
      <LazySidebarFloatingController control={control} disabled={disabled} />
    </Suspense>
  ) : null
}

function shellControlHydration(shell: ReaderShellConfigDto): ReaderShellControlHydration {
  return {
    edges: Object.fromEntries((Object.keys(shell.edges) as ReaderShellEdge[]).map((edge) => [edge, {
      open: shell.edges[edge].initialVisible,
      pinned: shell.edges[edge].pinned,
      lockMode: shell.edges[edge].lockMode ?? "auto",
    }])) as ReaderShellControlHydration["edges"],
    floating: shell.floatingControl ?? { enabled: true, position: { x: 100, y: 100 } },
  }
}

function shellControlSnapshot(shell: ReaderShellConfigDto): ReaderShellControlSnapshot {
  return shellControlHydration(shell) as ReaderShellControlSnapshot
}

function defaultShellControlSnapshot(): ReaderShellControlSnapshot {
  return {
    edges: {
      top: { open: true, pinned: false, lockMode: "auto" },
      right: { open: false, pinned: false, lockMode: "auto" },
      bottom: { open: false, pinned: false, lockMode: "auto" },
      left: { open: true, pinned: true, lockMode: "auto" },
    },
    floating: { enabled: true, position: { x: 100, y: 100 } },
  }
}

function hasSessionlessPanel(side: "left" | "right", shell: ReaderShellConfigDto | undefined): boolean {
  if (!shell) return false
  return READER_CARD_MANIFEST.some((card) => {
    if (card.requiresSession) return false
    const cardConfig = shell.cardLayout[card.id]
    if (!(cardConfig?.visible ?? card.defaultVisible)) return false
    const panelId = cardConfig?.panelId ?? card.defaultPanelId
    const panelConfig = shell.panelLayout[panelId]
    const panelManifest = READER_PANEL_MANIFEST.find((panel) => panel.id === panelId)
    return (panelConfig?.visible ?? panelManifest?.defaultVisible ?? true)
      && (panelConfig?.position ?? panelManifest?.defaultPosition ?? "left") === side
  })
}

function edgeSurfaceStyle(shell: ReaderShellConfigDto | undefined, edge: "top" | "bottom"): React.CSSProperties | undefined {
  if (!shell) return undefined
  return {
    backgroundColor: `color-mix(in oklch, var(--background) ${shell.opacity[edge]}%, transparent)`,
    backdropFilter: `blur(${shell.blur[edge]}px)`,
  }
}

function readerPathSegments(path: string): string[] {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length ? segments : ["未选择"]
}

function applyNavigation(session: ReaderSessionDto, navigation: ReaderNavigationDto): ReaderSessionDto {
  return { ...session, frame: navigation.frame, visiblePages: navigation.visiblePages }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
