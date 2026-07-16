import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen, ImageIcon, LoaderCircle, Settings2, X } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  READER_CARD_MANIFEST,
  READER_PANEL_MANIFEST,
  ReaderSlideshow,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderPresentation,
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
  type ReaderNavigationDto,
  type ReaderRuntimeConfigDto,
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
} from "../adapters/reader-http-client"
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { ReaderEdgeShell, type ReaderEdgeSlot } from "../features/shell/ReaderEdgeShell"
import { ThumbnailStrip } from "../features/thumbnails/ThumbnailStrip"

type ReaderSidebarModule = typeof import("../features/panels/ReaderSidebar")
const INITIAL_VIEW_DEFAULTS = {
  fitMode: DEFAULT_READER_PRESENTATION.fitMode,
  pageMode: "single",
} satisfies ReaderRuntimeConfigDto["viewDefaults"]
const INITIAL_SLIDESHOW_CONFIG: ReaderSlideshowConfig = {
  intervalSeconds: 5,
  loop: false,
  random: false,
  fadeTransition: true,
}
const INITIAL_FOLDER_VIEW_CONFIG: ReaderFolderViewConfig = {
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
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
}
let readerSidebarModule: Promise<ReaderSidebarModule> | undefined
function loadReaderSidebar(): Promise<ReaderSidebarModule> {
  readerSidebarModule ??= import("../features/panels/ReaderSidebar")
  return readerSidebarModule
}
const LazyReaderSidebar = lazy(async () => ({ default: (await loadReaderSidebar()).ReaderSidebar }))

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

function loadReaderPresentation(): Promise<unknown> {
  return Promise.all([loadReaderFrame(), loadReaderViewToolbar()])
}

export interface ReaderAppProps {
  initialPath?: string
  client?: ReaderHttpClient
  pickFile?: () => Promise<string | undefined>
  pickDirectory?: () => Promise<string | undefined>
  onPathCommitted?: (path: string) => void
}

export function ReaderApp({
  initialPath = "",
  client: injectedClient,
  pickFile,
  pickDirectory,
  onPathCommitted,
}: ReaderAppProps) {
  const surface = useNodeSurface()
  const floatingFrame = useFloatingWindowFrame()
  const [client] = useState<ReaderHttpClient>(() => injectedClient ?? createReaderHttpClient())
  const clientRef = useRef(client)
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
  const slideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const confirmedSlideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const slideshowWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const slideshowGenerationRef = useRef(0)
  const folderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const confirmedFolderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const folderViewWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const folderViewGenerationRef = useRef(0)
  const presentationTouchedRef = useRef(false)
  const [path, setPath] = useState(initialPath)
  const [session, setSession] = useState<ReaderSessionDto | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [shell, setShell] = useState<ReaderShellConfigDto | undefined>(undefined)
  const [viewDefaults, setViewDefaults] = useState<ReaderRuntimeConfigDto["viewDefaults"]>(() => ({ ...INITIAL_VIEW_DEFAULTS }))
  const [folderView, setFolderView] = useState<ReaderFolderViewConfig>(() => structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [presentation, setPresentation] = useState<ReaderPresentation>(() => ({ ...DEFAULT_READER_PRESENTATION }))
  const prefetchPages = useReaderImagePreloader(session?.sessionId)
  slideshowSessionRef.current = session

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
      setShell(config.shell)
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

  async function commitSidebarLayout(patch: ReaderSidebarLayoutPatch) {
    try {
      const updated = await clientRef.current.updateSidebarLayout(patch)
      setShell(updated)
    } catch (cause) {
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
  useReaderAdjacentPagePreloader({
    client,
    sessionId: session?.sessionId,
    activePageIndex: frame?.anchorPageIndex,
    totalPages: session?.book.pageCount,
    preload: prefetchPages,
  })

  const topEdge: ReaderEdgeSlot = {
    ariaLabel: "NeoView 顶部工具栏",
    initialVisible: shell?.edges.top.initialVisible ?? true,
    pinned: shell?.edges.top.pinned,
    triggerSize: shell?.edges.top.triggerSize,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div className={cn("border-b border-border/70 bg-background/90 shadow-sm backdrop-blur-md", floatingFrame && "xiranite-app-region-drag")} style={edgeSurfaceStyle(shell, "top")} onDoubleClick={floatingFrame?.handleTitlebarDoubleClick}>
        <div className={cn("flex items-center gap-2", compact ? "p-2" : "px-3 py-2.5")}>
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="漫画、图片或目录路径"
            className="xiranite-app-region-no-drag min-w-0 flex-1"
            value={path}
            placeholder="选择 CBZ、ZIP、图片或目录"
            onChange={(event) => setPath(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.stopPropagation()
                void openPath()
              }
            }}
          />
          {pickFile ? <Button className="xiranite-app-region-no-drag" aria-label="选择漫画或图片文件" type="button" size="sm" variant="outline" onClick={() => void choose("file")}><ImageIcon />{compact ? null : "文件"}</Button> : null}
          {pickDirectory ? <Button className="xiranite-app-region-no-drag" aria-label="选择图片目录" type="button" size="sm" variant="outline" onClick={() => void choose("directory")}><FolderOpen />{compact ? null : "目录"}</Button> : null}
          <Button className="xiranite-app-region-no-drag" aria-label="打开书籍" type="button" size="sm" onClick={() => void openPath()} disabled={!path.trim() || busy}>
            {busy && !session ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
            {compact ? null : "打开"}
          </Button>
          <Button className="xiranite-app-region-no-drag" aria-label="打开 NeoView 设置" type="button" size="icon-sm" variant="ghost" disabled={!shell} onClick={() => setSettingsOpen(true)}><Settings2 /></Button><FloatingWindowCaptionControls integrated />
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

  const bottomEdge: ReaderEdgeSlot | undefined = session && (shell?.edges.bottom.enabled ?? true) ? {
    ariaLabel: "NeoView 底部缩略图与导航栏",
    initialVisible: shell?.edges.bottom.initialVisible ?? true,
    pinned: shell?.edges.bottom.pinned,
    triggerSize: shell?.edges.bottom.triggerSize,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div className="border-t border-border/70 bg-background/90 shadow-[0_-4px_16px_rgb(0_0_0/0.15)] backdrop-blur-md" style={edgeSurfaceStyle(shell, "bottom")}>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0 truncate text-xs text-muted-foreground" title={session.book.displayName}>{session.book.displayName}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button aria-label="上一页" type="button" size="icon-sm" variant="outline" disabled={busy || frame?.atStart} onClick={() => void navigate("previous")}><ChevronLeft /></Button>
            <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
              {(frame?.anchorPageIndex ?? 0) + 1} / {session.book.pageCount}
            </span>
            <Button aria-label="下一页" type="button" size="icon-sm" variant="outline" disabled={busy || frame?.atEnd} onClick={() => void navigate("next")}><ChevronRight /></Button>
            <Button aria-label="关闭书籍" type="button" size="icon-sm" variant="ghost" onClick={() => void closeSession()}><X /></Button>
          </div>
        </div>
        {session.book.pageCount > 1 ? (
          <ThumbnailStrip
            sessionId={session.sessionId}
            totalPages={session.book.pageCount}
            activePageIndex={session.frame.anchorPageIndex}
            currentPages={session.visiblePages}
            client={client}
            compact={compact}
            disabled={busy}
            onSelect={goTo}
          />
        ) : null}
      </div>
    ),
  } : undefined

  const panelContext = {
    client,
    disabled: busy,
    onGoTo: goTo,
    onPageModeChange: updateCurrentBookPageMode,
    sourcePath: path,
    onOpen: openPath,
    shell,
    onBoardLayout: commitBoardLayout,
    viewDefaults,
    onViewDefaults: applyConfiguredViewDefaults,
    folderView,
    onFolderView: persistFolderView,
    ...(session ? { session } : {}),
  }
  const leftEdge: ReaderEdgeSlot | undefined = (session || hasSessionlessPanel("left", shell)) && (shell?.edges.left.enabled ?? true) ? {
    ariaLabel: "NeoView 左侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.left.triggerSize,
    initialVisible: shell?.edges.left.initialVisible,
    pinned: shell?.edges.left.pinned,
    preload: () => void loadReaderSidebar(),
    render: () => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-r border-border/70 bg-background/85" aria-label="正在加载左侧面板" />}>
        <LazyReaderSidebar side="left" context={panelContext} shell={shell} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined
  const rightEdge: ReaderEdgeSlot | undefined = (session || hasSessionlessPanel("right", shell)) && (shell?.edges.right.enabled ?? true) ? {
    ariaLabel: "NeoView 右侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.right.triggerSize,
    initialVisible: shell?.edges.right.initialVisible,
    pinned: shell?.edges.right.pinned,
    preload: () => void loadReaderSidebar(),
    render: () => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-l border-border/70 bg-background/85" aria-label="正在加载右侧面板" />}>
        <LazyReaderSidebar side="right" context={panelContext} shell={shell} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined

  return (
    <div
      ref={surface.ref}
      className="h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return
        if (event.key === "ArrowLeft") void navigate("previous")
        if (event.key === "ArrowRight") void navigate("next")
        if (event.key === "+" || event.key === "=") setPresentation((current) => ({ ...current, manualScale: stepReaderManualScale(current.manualScale, 1) }))
        if (event.key === "-") setPresentation((current) => ({ ...current, manualScale: stepReaderManualScale(current.manualScale, -1) }))
        if (event.key.toLowerCase() === "r") setPresentation((current) => ({ ...current, rotation: rotateReaderPresentation(current.rotation, 1) }))
        if (event.key === "0") setPresentation({ ...DEFAULT_READER_PRESENTATION })
      }}
    >
      <FloatingWindowTitlebarReservation />
      <ReaderEdgeShell edges={{ top: topEdge, right: rightEdge, bottom: bottomEdge, left: leftEdge }}>
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
        </div>
      </ReaderEdgeShell>
      {settingsOpen && shell ? (
        <Suspense fallback={null}>
          <LazyReaderSettingsWindow
            shell={shell}
            viewDefaults={viewDefaults}
            onClose={() => setSettingsOpen(false)}
            onBoardLayout={commitBoardLayout}
            onViewDefaults={applyConfiguredViewDefaults}
          />
        </Suspense>
      ) : null}
    </div>
  )
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

function applyNavigation(session: ReaderSessionDto, navigation: ReaderNavigationDto): ReaderSessionDto {
  return { ...session, frame: navigation.frame, visiblePages: navigation.visiblePages }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
