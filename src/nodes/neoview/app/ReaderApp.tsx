import { useEffect, useRef, useState } from "react"
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
} from "../adapters/reader-http-client"

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

  useEffect(() => () => {
    operationRef.current?.abort()
    const sessionId = sessionRef.current
    if (sessionId) void clientRef.current.close(sessionId).catch(() => undefined)
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
    const sessionId = sessionRef.current
    if (!sessionId || busy) return
    const controller = new AbortController()
    operationRef.current?.abort()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const result = await clientRef.current.navigate(sessionId, action, controller.signal)
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

  async function choose(source: "file" | "directory") {
    const selected = source === "file" ? await pickFile?.() : await pickDirectory?.()
    if (selected) {
      setPath(selected)
      await openPath(selected)
    }
  }

  const compact = surface.mode === "collapsed" || surface.mode === "compact" || surface.mode === "portrait"
  const frame = session?.frame

  return (
    <div
      ref={surface.ref}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return
        if (event.key === "ArrowLeft") void navigate("previous")
        if (event.key === "ArrowRight") void navigate("next")
      }}
    >
      <div className={cn("flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/95", compact ? "p-2" : "px-3 py-2.5")}>
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
        {pickFile && <Button aria-label="选择漫画或图片文件" type="button" size="sm" variant="outline" onClick={() => void choose("file")}><ImageIcon />{compact ? null : "文件"}</Button>}
        {pickDirectory && <Button aria-label="选择图片目录" type="button" size="sm" variant="outline" onClick={() => void choose("directory")}><FolderOpen />{compact ? null : "目录"}</Button>}
        <Button aria-label="打开书籍" type="button" size="sm" onClick={() => void openPath()} disabled={!path.trim() || busy}>
          {busy && !session ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
          {compact ? null : "打开"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/95">
        {!session ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55">
            <div><BookOpen className="mx-auto mb-3 size-8 opacity-60" /><p>打开漫画或图片开始阅读</p></div>
          </div>
        ) : (
          <div className={cn("flex h-full w-full items-center justify-center", session.visiblePages.length > 1 && "gap-1")}>
            {session.visiblePages.map((page) => (
              <img
                key={`${page.id}:${page.contentVersion}`}
                src={page.assetUrl}
                alt={page.name}
                draggable={false}
                decoding="async"
                className="max-h-full min-h-0 max-w-full select-none object-contain"
              />
            ))}
          </div>
        )}
        {busy && session && <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white"><LoaderCircle className="size-4 animate-spin" /></div>}
      </div>

      {session && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
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
      )}
      {error && <div role="alert" className="shrink-0 border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
    </div>
  )
}

function applyNavigation(session: ReaderSessionDto, navigation: ReaderNavigationDto): ReaderSessionDto {
  return { ...session, frame: navigation.frame, visiblePages: navigation.visiblePages }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
