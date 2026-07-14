/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { InteractionField } from "@xiranite/cli-runtime/interaction"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import {
  ProgressBar,
  NumberInput,
  TerminalThemeProvider,
  WorkbenchButton,
  WorkbenchField,
  WorkbenchPanel,
  resolveTerminalTheme,
  terminalIcon,
  useTerminalChromeActions,
  useTerminalTheme,
} from "@xiranite/cli-runtime/terminal/opentui"
import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
} from "./core.js"
import type { NeoviewTuiInput, NeoviewTuiResult } from "./interaction.js"
import { createReaderHeadlessController } from "./platform.js"

interface ReaderTuiPort extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  listPages(cursor?: number, limit?: number): readonly HeadlessReaderPageSnapshot[]
  next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream>
  closeBook(): Promise<void>
}

export interface NeoviewTuiProps extends TerminalUiScreenProps<NeoviewTuiInput, NeoviewTuiResult> {
  createController?: () => Promise<ReaderTuiPort>
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
  createController = createReaderHeadlessController,
}: NeoviewTuiProps) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const pathField = defaultPathField(language)
  const controller = useRef<ReaderTuiPort | undefined>(undefined)
  const activeAbort = useRef<AbortController | undefined>(undefined)
  const [path, setPath] = useState(String(definition.schema.initialValues.path ?? ""))
  const [pageInput, setPageInput] = useState(1)
  const [focused, setFocused] = useState<"path" | "page" | "viewer">("path")
  const [snapshot, setSnapshot] = useState<HeadlessReaderSnapshot>()
  const [pages, setPages] = useState<readonly HeadlessReaderPageSnapshot[]>([])
  const [pageCursor, setPageCursor] = useState(0)
  const [phase, setPhase] = useState<"ready" | "opening" | "navigating" | "error">("ready")
  const [status, setStatus] = useState(language === "zh" ? "等待打开" : "Ready to open")

  const ensureController = useCallback(async () => {
    if (!controller.current) controller.current = await createController()
    return controller.current
  }, [createController])

  const applySnapshot = useCallback((value: HeadlessReaderSnapshot, port: ReaderTuiPort) => {
    const pageLimit = Math.min(value.book.pageCount, 500)
    const cursor = Math.max(0, Math.min(value.frame.anchorPageIndex - Math.floor(pageLimit / 2), value.book.pageCount - pageLimit))
    setSnapshot(value)
    setPageInput(value.frame.anchorPageIndex + 1)
    setPageCursor(cursor)
    setPages(port.listPages(cursor, pageLimit || 1))
    setStatus(`${value.book.displayName} · ${value.book.pageCount}`)
    setPhase("ready")
    setFocused("viewer")
  }, [])

  const run = useCallback(async (operation: (port: ReaderTuiPort, signal: AbortSignal) => Promise<HeadlessReaderSnapshot>, nextPhase: "opening" | "navigating") => {
    activeAbort.current?.abort()
    const abort = new AbortController()
    activeAbort.current = abort
    setPhase(nextPhase)
    setStatus(nextPhase === "opening" ? (language === "zh" ? "正在打开" : "Opening") : (language === "zh" ? "正在导航" : "Navigating"))
    try {
      const port = await ensureController()
      const value = await operation(port, abort.signal)
      if (!abort.signal.aborted) applySnapshot(value, port)
    } catch (error) {
      if (abort.signal.aborted) return
      setPhase("error")
      setStatus(error instanceof Error ? error.message : String(error))
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
    void run((port, signal) => port.open({ path: input, signal }), "opening")
  }, [language, path, run])

  const navigate = useCallback((action: "next" | "previous" | "goTo", index?: number) => {
    if (!snapshot || phase === "opening" || phase === "navigating") return
    void run((port, signal) => action === "next"
      ? port.next(signal)
      : action === "previous"
        ? port.previous(signal)
        : port.goTo(index ?? 0, signal), "navigating")
  }, [phase, run, snapshot])

  const reset = useCallback(() => {
    activeAbort.current?.abort()
    void controller.current?.closeBook()
    setSnapshot(undefined)
    setPages([])
    setPageCursor(0)
    setPageInput(1)
    setPhase("ready")
    setStatus(language === "zh" ? "等待打开" : "Ready to open")
    setFocused("path")
  }, [language])

  const exit = useCallback(() => {
    activeAbort.current?.abort()
    const value = controller.current
    controller.current = undefined
    if (value) void Promise.resolve(value[Symbol.asyncDispose]()).finally(onExit)
    else onExit()
  }, [onExit])

  useTerminalChromeActions({ onReset: reset, onExit: exit })
  useEffect(() => () => {
    activeAbort.current?.abort()
    void controller.current?.[Symbol.asyncDispose]()
    controller.current = undefined
  }, [])

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
    if (key.name === "home") navigate("goTo", 0)
    if (key.name === "end" && snapshot) navigate("goTo", Math.max(0, snapshot.book.pageCount - 1))
    if (key.name === "o") setFocused("path")
    if (key.name === "g") setFocused("page")
    if (key.name === "q") exit()
  })

  const activePages = new Set(snapshot?.frame.pages.map((page) => page.pageIndex) ?? [])
  const currentPage = snapshot?.visiblePages[0]
  const busy = phase === "opening" || phase === "navigating"

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

      <box height={8} flexShrink={0} marginTop={1} flexDirection="column">
        <box height={4} flexShrink={0}><WorkbenchField field={pathField} value={path} focused={focused === "path"} disabled={busy} t={t} onFocus={() => setFocused("path")} onChange={(value) => setPath(String(value))} /></box>
        <box height={3} flexShrink={0} flexDirection="row" gap={1} alignItems="center">
          <box width={18} flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={focused === "page" ? theme.colors.focusRing : theme.colors.foreground}>{language === "zh" ? "页" : "Page"}</text>
            <NumberInput id="field-page" value={pageInput} focused={focused === "page"} disabled={!snapshot || busy} min={1} max={Math.max(1, snapshot?.book.pageCount ?? 1)} colors={theme.colors} onFocus={() => setFocused("page")} onChange={setPageInput} />
          </box>
          <box width={9}><WorkbenchButton id="open" focused={focused === "path"} disabled={busy} onClick={openBook}>Open</WorkbenchButton></box>
          <box width={5}><WorkbenchButton id="previous" disabled={!snapshot || busy || snapshot.frame.atStart} onClick={() => navigate("previous")}>{"<"}</WorkbenchButton></box>
          <box width={6}><WorkbenchButton id="goto" focused={focused === "page"} disabled={!snapshot || busy} onClick={() => navigate("goTo", Math.max(0, pageInput - 1))}>Go</WorkbenchButton></box>
          <box width={5}><WorkbenchButton id="next" disabled={!snapshot || busy || snapshot.frame.atEnd} onClick={() => navigate("next")}>{">"}</WorkbenchButton></box>
          <box width={9}><WorkbenchButton id="close" disabled={!snapshot || busy} onClick={reset}>Close</WorkbenchButton></box>
        </box>
      </box>

      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        <WorkbenchPanel title={`${language === "zh" ? "页面" : "Pages"} · ${snapshot?.book.pageCount ?? 0}`} description={pages.length < (snapshot?.book.pageCount ?? 0) ? `${pageCursor + 1}-${pageCursor + pages.length} / ${snapshot?.book.pageCount}` : undefined} width="38%">
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

        <WorkbenchPanel title={language === "zh" ? "当前画面" : "Current frame"} description={snapshot ? `${snapshot.frame.direction} · ${snapshot.frame.layout.pageMode}` : undefined} flexGrow={1}>
          {snapshot ? (
            <box flexGrow={1} flexDirection="column">
              <box height={6} flexShrink={0} borderStyle="rounded" borderColor={theme.colors.focusRing} paddingLeft={1} paddingRight={1} flexDirection="column" justifyContent="center">
                <text fg={theme.colors.primary}><b>{snapshot.visiblePages.map((page) => page.name).join("  |  ")}</b></text>
                <text fg={theme.colors.mutedForeground}>{`${snapshot.frame.anchorPageIndex + 1} / ${snapshot.book.pageCount}`}</text>
              </box>
              <box marginTop={1} flexDirection="row" gap={1}>
                <WorkbenchPanel title={language === "zh" ? "页面元数据" : "Page metadata"} width="55%">
                  <text>{currentPage?.mediaKind ?? "-"}</text>
                  <text>{currentPage?.mimeType ?? "unknown type"}</text>
                  <text>{currentPage?.dimensions ? `${currentPage.dimensions.width} x ${currentPage.dimensions.height}` : "dimensions pending"}</text>
                  <text>{currentPage?.byteLength === undefined ? "size unknown" : `${currentPage.byteLength} bytes`}</text>
                </WorkbenchPanel>
                <WorkbenchPanel title={language === "zh" ? "画面状态" : "Frame state"} flexGrow={1}>
                  <text>{`generation ${snapshot.frame.generation}`}</text>
                  <text>{snapshot.frame.atStart ? "start" : snapshot.frame.atEnd ? "end" : "middle"}</text>
                  <text>{snapshot.frame.layout.panorama ? "panorama" : snapshot.frame.layout.pageMode}</text>
                </WorkbenchPanel>
              </box>
              <box flexGrow={1} />
              <ProgressBar value={snapshot.book.pageCount ? ((snapshot.frame.anchorPageIndex + 1) / snapshot.book.pageCount) * 100 : 0} label={status} />
            </box>
          ) : (
            <box flexGrow={1} alignItems="center" justifyContent="center"><text fg={theme.colors.mutedForeground}>{language === "zh" ? "未打开书籍" : "No book open"}</text></box>
          )}
        </WorkbenchPanel>
      </box>
    </box>
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
