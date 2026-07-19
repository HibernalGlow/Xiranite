/* @jsxImportSource @opentui/react */
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { InteractionField } from "@xiranite/cli-runtime/interaction"
import { ResourceSchedulerService } from "@xiranite/services"
import type { ResourceScheduler } from "@xiranite/contract"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import {
  ProgressBar,
  NumberInput,
  TerminalImageDecodeService,
  TerminalImagePreview,
  TerminalThemeProvider,
  WorkbenchButton,
  WorkbenchField,
  WorkbenchPanel,
  resolveTerminalTheme,
  terminalIcon,
  useTerminalChromeActions,
  useTerminalTheme,
  type TerminalImageBackend,
  type TerminalImageStreamSource,
} from "@xiranite/cli-runtime/terminal/opentui"
import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderDirectorySortRule,
} from "./core.js"
import {
  READER_MEDIA_PRIORITY_MODES,
  READER_PAGE_SORT_MODES,
  type ReaderMediaPriorityMode,
  type ReaderPageOrderPatch,
  type ReaderPageSortMode,
} from "./application/reader/ReaderPageOrder.js"
import { ReaderSlideshow, type ReaderSlideshowConfig } from "./application/slideshow/ReaderSlideshow.js"
import type { NeoviewTuiInput, NeoviewTuiResult } from "./interaction.js"
import { createReaderHeadlessController } from "./platform.js"
import { projectReaderBookInformation } from "./domain/book/BookInformationProjection.js"
import { projectReaderTimeInformation } from "./domain/page/TimeInformationProjection.js"

export interface ReaderTuiPort extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  listPages(cursor?: number, limit?: number): readonly HeadlessReaderPageSnapshot[] | Promise<readonly HeadlessReaderPageSnapshot[]>
  next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  openAdjacent?(
    direction: "next" | "previous",
    sort?: ReaderDirectorySortRule,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderSnapshot | undefined>
  goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  updatePageOrder(order: ReaderPageOrderPatch, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  getSlideshowConfig?(signal?: AbortSignal): Promise<ReaderSlideshowConfig>
  updateSlideshowConfig?(patch: Partial<ReaderSlideshowConfig>, signal?: AbortSignal): Promise<ReaderSlideshowConfig>
  openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream>
  closeBook(): Promise<void>
}

export interface NeoviewTuiProps extends TerminalUiScreenProps<NeoviewTuiInput, NeoviewTuiResult> {
  createController?: () => Promise<ReaderTuiPort>
  imageBackend?: TerminalImageBackend
  resourceScheduler?: ResourceScheduler
  defaultArchivePasswords?: OpenHeadlessReaderInput["archivePasswords"]
}

export function createNeoviewTuiScreen(
  createController?: () => Promise<ReaderTuiPort>,
  defaultArchivePasswords?: OpenHeadlessReaderInput["archivePasswords"],
) {
  return function ConnectedNeoviewTui(props: Omit<NeoviewTuiProps, "createController">) {
    return <NeoviewTui {...props} createController={createController} defaultArchivePasswords={defaultArchivePasswords} />
  }
}

export function NeoviewTui(props: NeoviewTuiProps) {
  const [themeName] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return (
    <TerminalThemeProvider theme={resolveTerminalTheme(themeName === "inherit" ? "nord" : themeName)}>
      <ReaderWorkbench {...props} />
    </TerminalThemeProvider>
  )
}

function ReaderWorkbench({
  definition,
  language,
  onExit,
  createController,
  imageBackend = "sixel",
  resourceScheduler,
  defaultArchivePasswords,
}: NeoviewTuiProps) {
  const theme = useTerminalTheme()
  const dimensions = useTerminalDimensions()
  const t = createTerminalTranslator(language)
  const pathField = defaultPathField(language)
  const controller = useRef<ReaderTuiPort | undefined>(undefined)
  const resources = useMemo(() => resourceScheduler ?? new ResourceSchedulerService(), [resourceScheduler])
  const imageDecodeService = useMemo(() => new TerminalImageDecodeService({
    maxBytes: 32 * 1024 * 1024,
    maxConcurrent: 2,
    resourceScheduler: resources,
    ownerId: "neoview:tui",
  }), [resources])
  const activeAbort = useRef<AbortController | undefined>(undefined)
  const [path, setPath] = useState(String(definition.schema.initialValues.path ?? ""))
  const [pageInput, setPageInput] = useState(1)
  const [focused, setFocused] = useState<"path" | "page" | "viewer">("path")
  const [snapshot, setSnapshot] = useState<HeadlessReaderSnapshot>()
  const [pages, setPages] = useState<readonly HeadlessReaderPageSnapshot[]>([])
  const [pageCursor, setPageCursor] = useState(0)
  const [phase, setPhase] = useState<"ready" | "opening" | "navigating" | "error">("ready")
  const [status, setStatus] = useState(language === "zh" ? "等待打开" : "Ready to open")
  const snapshotRef = useRef<HeadlessReaderSnapshot | undefined>(undefined)
  const slideshowNavigateRef = useRef<(action: "next" | "goTo", pageIndex?: number) => Promise<boolean>>(async () => false)
  const slideshowConfirmedConfig = useRef<ReaderSlideshowConfig>({ intervalSeconds: 5, loop: false, random: false })
  const slideshowWriteQueue = useRef<Promise<void>>(Promise.resolve())
  const slideshowGeneration = useRef(0)
  const [slideshow] = useState(() => new ReaderSlideshow({
    readPosition: () => {
      const current = snapshotRef.current
      return {
        pageCount: current?.book.pageCount ?? 0,
        currentPageIndex: current?.frame.anchorPageIndex ?? 0,
        atEnd: current?.frame.atEnd ?? true,
      }
    },
    nextPage: () => slideshowNavigateRef.current("next"),
    goToPage: (pageIndex) => slideshowNavigateRef.current("goTo", pageIndex),
    onError: (error) => {
      setPhase("error")
      setStatus(error instanceof Error ? error.message : String(error))
    },
  }))
  const slideshowSnapshot = useSyncExternalStore(slideshow.subscribe, slideshow.getSnapshot, slideshow.getSnapshot)
  snapshotRef.current = snapshot

  const ensureController = useCallback(async () => {
    if (!controller.current) {
      const next = createController
        ? await createController()
        : await createReaderHeadlessController({ resourceScheduler: resources })
      try {
        if (next.getSlideshowConfig) {
          const config = await next.getSlideshowConfig()
          slideshowConfirmedConfig.current = config
          slideshow.configure(config)
        }
        controller.current = next
      } catch (error) {
        try {
          await next[Symbol.asyncDispose]()
        } catch {
          // Preserve the configuration load failure while still attempting cleanup.
        }
        throw error
      }
    }
    return controller.current
  }, [createController, resources, slideshow])

  const applySnapshot = useCallback(async (value: HeadlessReaderSnapshot, port: ReaderTuiPort) => {
    const pageLimit = Math.min(value.book.pageCount, 100)
    const cursor = Math.max(0, Math.min(value.frame.anchorPageIndex - Math.floor(pageLimit / 2), value.book.pageCount - pageLimit))
    const nextPages = await port.listPages(cursor, pageLimit || 1)
    setSnapshot(value)
    setPageInput(value.frame.anchorPageIndex + 1)
    setPageCursor(cursor)
    setPages(nextPages)
    const book = projectReaderBookInformation({
      ...value.book,
      currentPage: value.book.pageCount > 0 ? value.frame.anchorPageIndex + 1 : 0,
    }, language)
    setStatus(`${book.displayTitle} · ${book.typeLabel} · ${book.pageText} · ${book.progressText}`)
    setPhase("ready")
    setFocused("viewer")
  }, [language])

  const run = useCallback(async (operation: (port: ReaderTuiPort, signal: AbortSignal) => Promise<HeadlessReaderSnapshot>, nextPhase: "opening" | "navigating"): Promise<boolean> => {
    activeAbort.current?.abort()
    const abort = new AbortController()
    activeAbort.current = abort
    setPhase(nextPhase)
    setStatus(nextPhase === "opening" ? (language === "zh" ? "正在打开" : "Opening") : (language === "zh" ? "正在导航" : "Navigating"))
    try {
      const port = await ensureController()
      const value = await operation(port, abort.signal)
      if (abort.signal.aborted) return false
      await applySnapshot(value, port)
      return true
    } catch (error) {
      if (abort.signal.aborted) return false
      setPhase("error")
      setStatus(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      if (activeAbort.current === abort) activeAbort.current = undefined
    }
  }, [applySnapshot, ensureController, language])

  const openBook = useCallback(() => {
    const input = path.trim()
    if (!input) {
      setPhase("error")
      setStatus(language === "zh" ? "请输入书籍路径" : "Enter a book path")
      setFocused("path")
      return
    }
    void run((port, signal) => port.open({ path: input, signal, archivePasswords: defaultArchivePasswords }), "opening")
  }, [defaultArchivePasswords, language, path, run])

  const navigate = useCallback((action: "next" | "previous" | "goTo", index?: number, slideshowAction = false): Promise<boolean> => {
    if (!snapshot || phase === "opening" || phase === "navigating") return Promise.resolve(false)
    return run((port, signal) => action === "next"
      ? port.next(signal)
      : action === "previous"
        ? port.previous(signal)
        : port.goTo(index ?? 0, signal), "navigating").then((changed) => {
      if (changed && !slideshowAction) slideshow.resetOnUserAction()
      return changed
    })
  }, [phase, run, slideshow, snapshot])
  slideshowNavigateRef.current = (action, pageIndex) => navigate(action, pageIndex, true)

  const navigateBook = useCallback((direction: "next" | "previous") => {
    if (!snapshot || phase === "opening" || phase === "navigating") return
    void run(async (port, signal) => {
      if (!port.openAdjacent) throw new Error(language === "zh" ? "相邻书籍导航不可用" : "Adjacent-book navigation is unavailable")
      const value = await port.openAdjacent(direction, undefined, signal)
      if (value) return value
      throw new Error(language === "zh" ? "没有相邻书籍" : "No adjacent book is available")
    }, "navigating")
  }, [language, phase, run, snapshot])

  const cyclePageOrder = useCallback((field: "sortMode" | "mediaPriority") => {
    if (!snapshot || phase === "opening" || phase === "navigating") return
    const values = field === "sortMode" ? READER_PAGE_SORT_MODES : READER_MEDIA_PRIORITY_MODES
    const current = snapshot.pageOrder[field]
    const next = values[(values.indexOf(current as never) + 1) % values.length]
    void run((port, signal) => port.updatePageOrder({ [field]: next }, signal), "navigating")
  }, [phase, run, snapshot])

  const persistSlideshow = useCallback((patch: Partial<ReaderSlideshowConfig>) => {
    slideshow.configure(patch)
    const optimistic = slideshow.getSnapshot()
    const nextConfig: ReaderSlideshowConfig = {
      intervalSeconds: optimistic.intervalSeconds,
      loop: optimistic.loop,
      random: optimistic.random,
    }
    const generation = ++slideshowGeneration.current
    const write = slideshowWriteQueue.current.then(async () => {
      const port = await ensureController()
      const updated = port.updateSlideshowConfig
        ? await port.updateSlideshowConfig(patch)
        : nextConfig
      slideshowConfirmedConfig.current = updated
      if (generation === slideshowGeneration.current) slideshow.configure(updated)
    }).catch((error) => {
      if (generation === slideshowGeneration.current) slideshow.configure(slideshowConfirmedConfig.current)
      setPhase("error")
      setStatus(error instanceof Error ? error.message : String(error))
    })
    slideshowWriteQueue.current = write
  }, [ensureController, slideshow])

  const cycleSlideshowInterval = useCallback(() => {
    const intervals = [3, 5, 10, 15, 30, 60]
    const currentIndex = intervals.indexOf(slideshow.getSnapshot().intervalSeconds)
    persistSlideshow({ intervalSeconds: intervals[(currentIndex + 1) % intervals.length] })
  }, [persistSlideshow, slideshow])

  const reset = useCallback(() => {
    activeAbort.current?.abort()
    slideshow.stop()
    void controller.current?.closeBook()
    imageDecodeService.clear()
    setSnapshot(undefined)
    setPages([])
    setPageCursor(0)
    setPageInput(1)
    setPhase("ready")
    setStatus(language === "zh" ? "等待打开" : "Ready to open")
    setFocused("path")
  }, [imageDecodeService, language, slideshow])

  const exit = useCallback(() => {
    activeAbort.current?.abort()
    slideshow.dispose()
    imageDecodeService.clear()
    const value = controller.current
    controller.current = undefined
    if (value) {
      void slideshowWriteQueue.current
        .then(() => value[Symbol.asyncDispose](), () => value[Symbol.asyncDispose]())
        .then(onExit, onExit)
    }
    else onExit()
  }, [imageDecodeService, onExit, slideshow])

  useTerminalChromeActions({ onReset: reset, onExit: exit })
  useEffect(() => () => {
    activeAbort.current?.abort()
    slideshow.dispose()
    imageDecodeService.clear()
    const value = controller.current
    controller.current = undefined
    if (value) {
      void slideshowWriteQueue.current
        .then(() => value[Symbol.asyncDispose](), () => value[Symbol.asyncDispose]())
        .catch(() => undefined)
    }
  }, [imageDecodeService, slideshow])

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (focused !== "viewer") setFocused("viewer")
      else exit()
      return
    }
    if (focused === "path") {
      if (key.name === "return" || key.name === "enter") openBook()
      return
    }
    if (focused === "page") {
      if (key.name === "return" || key.name === "enter") navigate("goTo", Math.max(0, pageInput - 1))
      return
    }
    if (key.name === "left" || key.name === "p") navigate("previous")
    if (key.name === "right" || key.name === "n") navigate("next")
    if (key.sequence === "[") navigateBook("previous")
    if (key.sequence === "]") navigateBook("next")
    if (key.name === "home") navigate("goTo", 0)
    if (key.name === "end" && snapshot) navigate("goTo", Math.max(0, snapshot.book.pageCount - 1))
    if (key.name === "o") setFocused("path")
    if (key.name === "g") setFocused("page")
    if (key.name === "s") cyclePageOrder("sortMode")
    if (key.name === "m") cyclePageOrder("mediaPriority")
    if (key.name === "space" && snapshot && !busy) slideshow.toggle()
    if (key.name === "i" && snapshot && !busy) cycleSlideshowInterval()
    if (key.name === "l" && snapshot && !busy) persistSlideshow({ loop: !slideshowSnapshot.loop })
    if (key.name === "r" && snapshot && !busy) persistSlideshow({ random: !slideshowSnapshot.random })
    if (key.name === "q") exit()
  })

  const activePages = new Set(snapshot?.frame.pages.map((page) => page.pageIndex) ?? [])
  const currentPage = snapshot?.visiblePages[0]
  const bookInformation = snapshot ? projectReaderBookInformation({
    ...snapshot.book,
    currentPage: snapshot.book.pageCount > 0 ? snapshot.frame.anchorPageIndex + 1 : 0,
  }, language) : undefined
  const timeInformation = projectReaderTimeInformation(currentPage?.timestamps, language)
  const busy = phase === "opening" || phase === "navigating"
  const pagePaneWidth = Math.max(24, Math.min(42, Math.floor(dimensions.width * 0.3)))
  const framePaneWidth = Math.max(20, dimensions.width - pagePaneWidth - 8)
  const previewHeight = Math.max(6, dimensions.height - 26)
  const visiblePageCount = Math.max(1, snapshot?.visiblePages.length ?? 1)
  const previewWidth = Math.max(8, Math.floor((framePaneWidth - visiblePageCount + 1) / visiblePageCount))
  const openPage = useCallback(async (pageIndex: number, signal: AbortSignal) => {
    const port = await ensureController()
    return port.openPageStream(pageIndex, signal)
  }, [ensureController])

  return (
    <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
      <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column">
          <text fg={theme.colors.primary}><b>{`${terminalIcon("status")} NEOVIEW // READER`}</b></text>
          <text fg={phase === "error" ? theme.colors.error : theme.colors.mutedForeground}>{status}</text>
        </box>
        <text fg={busy ? theme.colors.warning : snapshot ? theme.colors.success : theme.colors.mutedForeground}>
          {busy ? "LOADING" : snapshot ? "BOOK OPEN" : "IDLE"}
        </text>
      </box>

      <box height={11} flexShrink={0} marginTop={1} flexDirection="column">
        <box height={4} flexShrink={0}><WorkbenchField field={pathField} value={path} focused={focused === "path"} disabled={busy} t={t} onFocus={() => setFocused("path")} onChange={(value) => setPath(String(value))} /></box>
        <box height={3} flexShrink={0} flexDirection="row" gap={1} alignItems="center">
          <box width={18} flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={focused === "page" ? theme.colors.focusRing : theme.colors.foreground}>{language === "zh" ? "页" : "Page"}</text>
            <NumberInput id="field-page" value={pageInput} focused={focused === "page"} disabled={!snapshot || busy} min={1} max={Math.max(1, snapshot?.book.pageCount ?? 1)} colors={theme.colors} onFocus={() => setFocused("page")} onChange={setPageInput} />
          </box>
          <box width={9}><WorkbenchButton id="open" focused={focused === "path"} disabled={busy} onClick={openBook}>Open</WorkbenchButton></box>
          <box width={6}><WorkbenchButton id="previous-book" disabled={!snapshot || busy} onClick={() => navigateBook("previous")}>{"<<"}</WorkbenchButton></box>
          <box width={5}><WorkbenchButton id="previous" disabled={!snapshot || busy || snapshot.frame.atStart} onClick={() => navigate("previous")}>{"<"}</WorkbenchButton></box>
          <box width={6}><WorkbenchButton id="goto" focused={focused === "page"} disabled={!snapshot || busy} onClick={() => navigate("goTo", Math.max(0, pageInput - 1))}>Go</WorkbenchButton></box>
          <box width={5}><WorkbenchButton id="next" disabled={!snapshot || busy || snapshot.frame.atEnd} onClick={() => navigate("next")}>{">"}</WorkbenchButton></box>
          <box width={6}><WorkbenchButton id="next-book" disabled={!snapshot || busy} onClick={() => navigateBook("next")}>{">>"}</WorkbenchButton></box>
          <box width={9}><WorkbenchButton id="close" disabled={!snapshot || busy} onClick={reset}>Close</WorkbenchButton></box>
          <box width={24}><WorkbenchButton id="page-sort" disabled={!snapshot || busy} onClick={() => cyclePageOrder("sortMode")}>{`S:${shortSortLabel(snapshot?.pageOrder.sortMode)}`}</WorkbenchButton></box>
          <box width={18}><WorkbenchButton id="media-priority" disabled={!snapshot || busy} onClick={() => cyclePageOrder("mediaPriority")}>{`M:${shortMediaLabel(snapshot?.pageOrder.mediaPriority)}`}</WorkbenchButton></box>
        </box>
        <box height={3} flexShrink={0} flexDirection="row" gap={1} alignItems="center">
          <box width={18}><WorkbenchButton id="slideshow-toggle" disabled={!snapshot || busy} onClick={() => slideshow.toggle()}>{`SL:${slideshowSnapshot.state === "playing" ? "pause" : "play"}`}</WorkbenchButton></box>
          <box width={14}><WorkbenchButton id="slideshow-interval" disabled={!snapshot || busy} onClick={cycleSlideshowInterval}>{`I:${slideshowSnapshot.intervalSeconds}s`}</WorkbenchButton></box>
          <box width={14}><WorkbenchButton id="slideshow-loop" disabled={!snapshot || busy} onClick={() => persistSlideshow({ loop: !slideshowSnapshot.loop })}>{`L:${slideshowSnapshot.loop ? "on" : "off"}`}</WorkbenchButton></box>
          <box width={14}><WorkbenchButton id="slideshow-random" disabled={!snapshot || busy} onClick={() => persistSlideshow({ random: !slideshowSnapshot.random })}>{`R:${slideshowSnapshot.random ? "on" : "off"}`}</WorkbenchButton></box>
          <text fg={slideshowSnapshot.state === "playing" ? theme.colors.success : theme.colors.mutedForeground}>{slideshowSnapshot.state === "playing" ? `${Math.ceil(slideshowSnapshot.remainingSeconds)}s` : slideshowSnapshot.state}</text>
        </box>
      </box>

      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        <WorkbenchPanel title={`${language === "zh" ? "页面" : "Pages"} · ${snapshot?.book.pageCount ?? 0}`} description={pages.length < (snapshot?.book.pageCount ?? 0) ? `${pageCursor + 1}-${pageCursor + pages.length} / ${snapshot?.book.pageCount}` : undefined} width={pagePaneWidth}>
          <scrollbox id="neoview-pages" flexGrow={1}>
            {pages.map((page) => (
              <box key={page.id} flexDirection="row">
                <text fg={activePages.has(page.index) ? theme.colors.primary : theme.colors.mutedForeground}>
                  {`${activePages.has(page.index) ? ">" : " "} ${String(page.index + 1).padStart(5)}  ${page.name}`}
                </text>
              </box>
            ))}
          </scrollbox>
        </WorkbenchPanel>

        <WorkbenchPanel title={language === "zh" ? "当前画面" : "Current frame"} description={snapshot ? `${snapshot.frame.direction} · ${snapshot.frame.layout.pageMode} · ${snapshot.pageOrder.sortMode} · ${snapshot.pageOrder.mediaPriority} · SL:${slideshowSnapshot.state}` : undefined} flexGrow={1}>
          {snapshot ? (
            <box flexGrow={1} flexDirection="column">
              <box height={previewHeight} flexShrink={0} flexDirection="row" gap={1} justifyContent="center" overflow="hidden">
                {snapshot.visiblePages.map((page) => (
                  <ReaderPagePreview
                    key={`${page.id}:${page.contentVersion}`}
                    page={page}
                    width={previewWidth}
                    height={previewHeight}
                    openPage={openPage}
                    backend={imageBackend}
                    decodeService={imageDecodeService}
                  />
                ))}
              </box>
              <box height={5} flexShrink={0} marginTop={1} paddingLeft={1} paddingRight={1} flexDirection="column">
                <text fg={theme.colors.primary}><b>{snapshot.visiblePages.map((page) => page.name).join("  |  ")}</b></text>
                <text fg={theme.colors.mutedForeground}>{`${bookInformation?.pageText} · ${currentPage?.dimensions ? `${currentPage.dimensions.width} x ${currentPage.dimensions.height}` : currentPage?.mimeType ?? currentPage?.mediaKind ?? "-"}`}</text>
                <text fg={theme.colors.mutedForeground}>{`${language === "zh" ? "创建" : "Created"}: ${timeInformation.createdText} · ${language === "zh" ? "修改" : "Modified"}: ${timeInformation.modifiedText}`}</text>
                <text fg={theme.colors.mutedForeground}>{`${language === "zh" ? "访问" : "Accessed"}: ${timeInformation.accessedText} · ${timeInformation.sourceLabel}`}</text>
              </box>
              <ProgressBar value={bookInformation?.progressPercent ?? 0} label={status} />
            </box>
          ) : (
            <box flexGrow={1} alignItems="center" justifyContent="center"><text fg={theme.colors.mutedForeground}>{language === "zh" ? "未打开书籍" : "No book open"}</text></box>
          )}
        </WorkbenchPanel>
      </box>
    </box>
  )
}

function shortSortLabel(mode: ReaderPageSortMode | undefined): string {
  if (!mode) return "sort"
  return mode
    .replace("fileName", "name")
    .replace("fileSize", "size")
    .replace("timeStamp", "time")
    .replace("Descending", " desc")
}

function shortMediaLabel(mode: ReaderMediaPriorityMode | undefined): string {
  if (!mode) return "media"
  return mode.replace("videoFirst", "video first").replace("imageFirst", "image first")
}

function ReaderPagePreview({
  page,
  width,
  height,
  openPage,
  backend,
  decodeService,
}: {
  page: HeadlessReaderPageSnapshot
  width: number
  height: number
  openPage: (pageIndex: number, signal: AbortSignal) => Promise<HeadlessPageStream>
  backend: TerminalImageBackend
  decodeService: TerminalImageDecodeService
}) {
  const source = useMemo<TerminalImageStreamSource>(() => ({
    cacheKey: `neoview:${page.id}:${page.contentVersion}`,
    open: (signal) => openPage(page.index, signal),
  }), [openPage, page.contentVersion, page.id, page.index])
  return (
    <TerminalImagePreview
      source={source}
      width={width}
      height={height}
      alt={page.name}
      fit="contain"
      backend={backend}
      decodeService={decodeService}
      maxAnimationFrames={1}
    />
  )
}

function defaultPathField(language: "zh" | "en"): InteractionField {
  return {
    id: "path",
    label: language === "zh" ? "书籍路径" : "Book path",
    kind: "text",
    placeholder: language === "zh" ? "图像、目录、CBZ、CBR 或 CB7" : "Image, directory, CBZ, CBR or CB7",
  }
}
