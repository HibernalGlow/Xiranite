import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen, ImageIcon, LoaderCircle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import {
  createReaderHttpClient,
  type ReaderHttpClient,
  type ReaderNavigationDto,
  type ReaderSessionDto,
  type ReaderShellConfigDto,
  type ReaderSidebarLayoutPatch,
} from "../adapters/reader-http-client"
import { PageImage } from "../features/reader/PageImage"
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { ReaderEdgeShell, type ReaderEdgeSlot } from "../features/shell/ReaderEdgeShell"
import { ThumbnailStrip } from "../features/thumbnails/ThumbnailStrip"

type ReaderSidebarModule = typeof import("../features/panels/ReaderSidebar")
let readerSidebarModule: Promise<ReaderSidebarModule> | undefined
function loadReaderSidebar(): Promise<ReaderSidebarModule> {
  readerSidebarModule ??= import("../features/panels/ReaderSidebar")
  return readerSidebarModule
}
const LazyReaderSidebar = lazy(async () => ({ default: (await loadReaderSidebar()).ReaderSidebar }))

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
  const [client] = useState<ReaderHttpClient>(() => injectedClient ?? createReaderHttpClient())
  const clientRef = useRef(client)
  const sessionRef = useRef<string | undefined>(undefined)
  const operationRef = useRef<AbortController | undefined>(undefined)
  const [path, setPath] = useState(initialPath)
  const [session, setSession] = useState<ReaderSessionDto | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [shell, setShell] = useState<ReaderShellConfigDto | undefined>(undefined)
  const prefetchPages = useReaderImagePreloader(session?.sessionId)

  useEffect(() => () => {
    operationRef.current?.abort()
    const sessionId = sessionRef.current
    if (sessionId) void clientRef.current.close(sessionId).catch(() => undefined)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void clientRef.current.config(controller.signal).then(setShell).catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function openPath(nextPath = path) {
    const normalizedPath = nextPath.trim()
    if (!normalizedPath || busy) return
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const previousSession = sessionRef.current
      const opened = await clientRef.current.open(normalizedPath, controller.signal)
      if (controller.signal.aborted) return
      sessionRef.current = opened.sessionId
      setSession(opened)
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

  async function navigate(action: "next" | "previous") {
    await updateNavigation((sessionId, signal) => clientRef.current.navigate(sessionId, action, signal))
  }

  async function goTo(pageIndex: number) {
    if (pageIndex === session?.frame.anchorPageIndex) return
    await updateNavigation((sessionId, signal) => clientRef.current.goTo(sessionId, pageIndex, signal))
  }

  async function updateNavigation(
    request: (sessionId: string, signal: AbortSignal) => Promise<ReaderNavigationDto>,
  ) {
    const sessionId = sessionRef.current
    if (!sessionId || busy) return
    const controller = new AbortController()
    operationRef.current?.abort()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const result = await request(sessionId, controller.signal)
      if (!controller.signal.aborted) setSession((current) => current ? applyNavigation(current, result) : current)
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function closeSession() {
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
      <div className="border-b border-border/70 bg-background/90 shadow-sm backdrop-blur-md" style={edgeSurfaceStyle(shell, "top")}>
        <div className={cn("flex items-center gap-2", compact ? "p-2" : "px-3 py-2.5")}>
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="漫画、图片或目录路径"
            className="min-w-0 flex-1"
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
          {pickFile ? <Button aria-label="选择漫画或图片文件" type="button" size="sm" variant="outline" onClick={() => void choose("file")}><ImageIcon />{compact ? null : "文件"}</Button> : null}
          {pickDirectory ? <Button aria-label="选择图片目录" type="button" size="sm" variant="outline" onClick={() => void choose("directory")}><FolderOpen />{compact ? null : "目录"}</Button> : null}
          <Button aria-label="打开书籍" type="button" size="sm" onClick={() => void openPath()} disabled={!path.trim() || busy}>
            {busy && !session ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
            {compact ? null : "打开"}
          </Button>
        </div>
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

  const panelContext = session ? { session, client, disabled: busy, onGoTo: goTo } : undefined
  const leftEdge: ReaderEdgeSlot | undefined = panelContext && (shell?.edges.left.enabled ?? true) ? {
    ariaLabel: "NeoView 左侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.left.triggerSize,
    initialVisible: shell?.edges.left.initialVisible,
    pinned: shell?.edges.left.pinned,
    preload: () => void loadReaderSidebar(),
    render: () => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-r border-border/70 bg-background/85" aria-label="正在加载左侧面板" />}>
        <LazyReaderSidebar side="left" context={panelContext} shell={shell} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} />
      </Suspense>
    ),
  } : undefined
  const rightEdge: ReaderEdgeSlot | undefined = panelContext && (shell?.edges.right.enabled ?? true) ? {
    ariaLabel: "NeoView 右侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.right.triggerSize,
    initialVisible: shell?.edges.right.initialVisible,
    pinned: shell?.edges.right.pinned,
    preload: () => void loadReaderSidebar(),
    render: () => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-l border-border/70 bg-background/85" aria-label="正在加载右侧面板" />}>
        <LazyReaderSidebar side="right" context={panelContext} shell={shell} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} />
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
      }}
    >
      <ReaderEdgeShell edges={{ top: topEdge, right: rightEdge, bottom: bottomEdge, left: leftEdge }}>
        <div className="relative h-full min-h-0 overflow-hidden bg-black/95">
          {!session ? (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55">
              <div><BookOpen className="mx-auto mb-3 size-8 opacity-60" /><p>打开漫画或图片开始阅读</p></div>
            </div>
          ) : (
            <div className={cn("flex h-full w-full items-center justify-center", session.visiblePages.length > 1 && "gap-1")}>
              {session.visiblePages.map((page) => (
                <PageImage
                  key={`${page.id}:${page.contentVersion}`}
                  page={page}
                />
              ))}
            </div>
          )}
          {busy && session ? <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white"><LoaderCircle className="size-4 animate-spin" /></div> : null}
        </div>
      </ReaderEdgeShell>
    </div>
  )
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
