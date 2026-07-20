import { ChevronDown, ChevronRight, Columns3, Copy, Folder, HardDrive, MoreHorizontal, Pencil, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderBreadcrumbColumns from "./FolderBreadcrumbColumns"

export interface FolderBreadcrumbItem {
  name: string
  path: string
  root: boolean
}

interface FolderBreadcrumbProps {
  path: string
  disabled?: boolean
  loading?: boolean
  vertical?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  canGoUp?: boolean
  client?: ReaderHttpClient
  sessionId?: string
  /** When the tab bar is hidden (single tab), show create next to path actions. */
  canCreateTab?: boolean
  onCreateTab?(): void
  onNavigate(path: string): void
  onNavigateAction?(action: "back" | "forward" | "up" | "refresh"): void
  onCopyPath?: (path: string) => Promise<void> | void
}

export function FolderBreadcrumb({ path, disabled = false, loading = false, vertical = false, canGoBack, canGoForward, canGoUp, client, sessionId, canCreateTab = false, onCreateTab, onNavigate, onNavigateAction, onCopyPath }: FolderBreadcrumbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const breadcrumbNavRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [maxVisibleItems, setMaxVisibleItems] = useState(5)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnsMode, setColumnsMode] = useState<"inline" | "floating">("inline")
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const items = useMemo(() => parseFolderPath(path), [path])
  const visible = useMemo(() => visibleFolderBreadcrumbItems(items, maxVisibleItems), [items, maxVisibleItems])

  useEffect(() => {
    if (vertical) return
    const nav = breadcrumbNavRef.current
    if (!nav) return
    requestAnimationFrame(() => { nav.scrollLeft = nav.scrollWidth })
  }, [path, visible.visible.length, vertical])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? container.clientWidth
      setMaxVisibleItems(Math.max(2, Math.floor(width / 88)))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
  }, [])

  function startEditing() {
    if (disabled || loading) return
    setFeedback(undefined)
    setEditValue(path)
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  function cancelEditing() {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurTimerRef.current = undefined
    setEditing(false)
    setEditValue("")
  }

  function confirmEditing() {
    const nextPath = normalizeEditableFolderPath(editValue)
    if (!nextPath) return
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurTimerRef.current = undefined
    setEditing(false)
    setEditValue("")
    if (nextPath !== path) onNavigate(nextPath)
  }

  async function copyCurrentPath() {
    if (!onCopyPath) return
    setFeedback(undefined)
    try {
      await onCopyPath(path)
      setFeedback({ kind: "status", text: "已复制当前路径" })
    } catch (error) {
      setFeedback({ kind: "alert", text: error instanceof Error ? error.message : String(error) })
    }
  }

  const columnsContent = !vertical && client?.treeDirectoryBrowser && sessionId && items[0] ? (
    <FolderBreadcrumbColumns
      client={client}
      sessionId={sessionId}
      rootPath={items[0].path}
      rootName={items[0].name}
      activePath={items.slice(1).map((item) => item.path)}
      currentPath={path}
      disabled={disabled || loading}
      onNavigate={onNavigate}
    />
  ) : null

  const columnsButton = (
    <Button
      type="button"
      size="icon-sm"
      variant={columnsOpen ? "secondary" : "ghost"}
      aria-label={columnsOpen ? "收起目录列" : "展开目录列"}
      title={columnsOpen ? "收起目录列" : "展开目录列"}
      aria-expanded={columnsOpen}
      disabled={disabled || loading}
      onClick={columnsMode === "inline" ? () => setColumnsOpen((current) => !current) : undefined}
    >
      <Columns3 />
    </Button>
  )

  return (
    <div className={vertical ? "h-full min-h-0" : "grid min-w-0 gap-1"} data-breadcrumb-columns-mode={columnsMode}>
    <div
      ref={containerRef}
      className={vertical
        ? "flex h-full min-h-32 w-full flex-col items-stretch overflow-y-auto rounded-md border bg-background p-1"
        : "flex h-8 min-w-0 items-center overflow-hidden rounded-md border bg-background px-1"}
      data-neoview-folder-breadcrumb="true"
      data-orientation={vertical ? "vertical" : "horizontal"}
      onKeyDownCapture={(event) => {
        if (disabled || loading || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.target instanceof HTMLElement && event.target.matches("input, textarea, [role='textbox'], [role='menu']")) return
        let action: "back" | "forward" | "up" | "refresh" | undefined
        if (!event.altKey && event.key === "F5") action = "refresh"
        else if (event.altKey && event.key === "ArrowLeft" && canGoBack) action = "back"
        else if (event.altKey && event.key === "ArrowRight" && canGoForward) action = "forward"
        else if (event.altKey && event.key === "ArrowUp" && canGoUp) action = "up"
        if (!action) return
        event.preventDefault()
        event.stopPropagation()
        onNavigateAction?.(action)
      }}
    >
      {editing ? (
        <form
          className="flex min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            confirmEditing()
          }}
        >
          <Input
            ref={inputRef}
            aria-label="浏览路径"
            className="h-7 min-w-0 flex-1 border-0 px-1.5 shadow-none focus-visible:ring-0"
            value={editValue}
            onChange={(event) => setEditValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              cancelEditing()
            }}
            onBlur={() => {
              blurTimerRef.current = setTimeout(cancelEditing, 150)
            }}
          />
        </form>
      ) : (
        <>
          <nav ref={breadcrumbNavRef} aria-label="当前目录" className={vertical ? "flex min-h-0 flex-1 flex-col items-stretch overflow-y-auto" : "flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}>
            {visible.visible.map((item, index) => {
              const current = item === items.at(-1)
              return (
                <span key={item.path} className={vertical ? "flex min-w-0 flex-col items-stretch" : "flex shrink-0 items-center"}>
                  {index > 0 || visible.collapsed.length > 0 ? <ChevronRight className={`shrink-0 text-muted-foreground ${vertical ? "mx-auto rotate-90" : ""}`} aria-hidden="true" /> : null}
                  {index === 1 && visible.collapsed.length > 0 ? (
                    <CollapsedSegments items={visible.collapsed} disabled={disabled || loading} onNavigate={onNavigate} />
                  ) : null}
                  {index === 1 && visible.collapsed.length > 0 ? <ChevronRight className={`shrink-0 text-muted-foreground ${vertical ? "mx-auto rotate-90" : ""}`} aria-hidden="true" /> : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={current ? "secondary" : "ghost"}
                    className={`h-6 min-w-0 shrink-0 px-1.5 text-xs ${vertical ? "w-full max-w-none justify-start" : "max-w-32"}`}
                    aria-current={current ? "page" : undefined}
                    disabled={disabled || loading}
                    title={item.path}
                    onClick={() => { if (!current) onNavigate(item.path) }}
                  >
                    {item.root ? <HardDrive data-icon="inline-start" /> : index === 0 ? <Folder data-icon="inline-start" /> : null}
                    <span className="truncate">{item.name}</span>
                  </Button>
                </span>
              )
            })}
          </nav>
          {!vertical && client?.treeDirectoryBrowser && sessionId && items[0] ? (
            <div className="flex shrink-0 items-center">
              {columnsMode === "floating" ? (
                <Popover open={columnsOpen} onOpenChange={setColumnsOpen}>
                  <PopoverTrigger asChild>{columnsButton}</PopoverTrigger>
                  <PopoverContent align="end" sideOffset={4} className="w-[min(48rem,calc(100vw-2rem))] overflow-hidden p-0">
                    {columnsContent}
                  </PopoverContent>
                </Popover>
              ) : columnsButton}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="icon-sm" variant="ghost" className="w-5 px-0" aria-label="目录列显示方式" title="目录列显示方式">
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-36">
                  <DropdownMenuRadioGroup value={columnsMode} onValueChange={(value) => setColumnsMode(value as "inline" | "floating")}>
                    <DropdownMenuRadioItem value="inline">下拉展开</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="floating">浮动窗口</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          {canCreateTab && onCreateTab ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="新建文件夹标签"
              title="新建文件夹标签"
              disabled={disabled || loading}
              onClick={onCreateTab}
            >
              <Plus />
            </Button>
          ) : null}
          <Button type="button" size="icon-sm" variant="ghost" aria-label="编辑路径" title="编辑路径" disabled={disabled || loading} onClick={startEditing}><Pencil /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="复制当前路径" title="复制当前路径" disabled={disabled || loading || !path || !onCopyPath} onClick={() => void copyCurrentPath()}><Copy /></Button>
        </>
      )}
      {feedback ? <span className="sr-only" role={feedback.kind}>{feedback.text}</span> : null}
    </div>
    {!vertical && columnsMode === "inline" && columnsOpen ? (
      <div className="min-w-0 overflow-hidden rounded-md border shadow-sm" data-breadcrumb-columns-inline="true">
        {columnsContent}
      </div>
    ) : null}
    </div>
  )
}

function CollapsedSegments({ items, disabled, onNavigate }: { items: readonly FolderBreadcrumbItem[]; disabled: boolean; onNavigate(path: string): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="显示折叠路径" title="显示折叠路径" disabled={disabled}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {items.map((item) => <DropdownMenuItem key={item.path} onSelect={() => onNavigate(item.path)}><Folder />{item.name}</DropdownMenuItem>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function parseFolderPath(path: string): readonly FolderBreadcrumbItem[] {
  const value = path.trim()
  if (!value) return []

  if (/^(?:bookmark|history):/i.test(value)) {
    return [{ name: /^bookmark:/i.test(value) ? "书签" : "历史", path: value, root: true }]
  }

  if (/^[\\/]{2}/.test(value)) {
    const parts = value.replace(/\//g, "\\").split("\\").filter(Boolean)
    if (!parts.length) return [{ name: "网络", path: "\\\\", root: true }]
    const rootParts = parts.slice(0, Math.min(2, parts.length))
    const rootPath = `\\\\${rootParts.join("\\")}\\`
    const items: FolderBreadcrumbItem[] = [{ name: `\\\\${rootParts.join("\\")}`, path: rootPath, root: true }]
    let current = rootPath
    for (const part of parts.slice(rootParts.length)) {
      current += part
      items.push({ name: part, path: current, root: false })
      current += "\\"
    }
    return items
  }

  const windows = /^([A-Za-z]:)(?:[\\/]|$)/.exec(value)
  if (windows) {
    const normalized = value.replace(/\//g, "\\")
    const parts = normalized.split("\\").filter(Boolean)
    const rootPath = `${windows[1]}\\`
    const items: FolderBreadcrumbItem[] = [{ name: windows[1]!, path: rootPath, root: true }]
    let current = rootPath
    for (const part of parts.slice(1)) {
      current += part
      items.push({ name: part, path: current, root: false })
      current += "\\"
    }
    return items
  }

  if (value.startsWith("/")) {
    const items: FolderBreadcrumbItem[] = [{ name: "/", path: "/", root: true }]
    let current = ""
    for (const part of value.split("/").filter(Boolean)) {
      current += `/${part}`
      items.push({ name: part, path: current, root: false })
    }
    return items
  }

  const separator = value.includes("\\") ? "\\" : "/"
  let current = ""
  return value.split(/[\\/]/).filter(Boolean).map((part, index) => {
    current = current ? `${current}${separator}${part}` : part
    return { name: part, path: current, root: index === 0 }
  })
}

export function normalizeEditableFolderPath(path: string): string {
  const value = path.trim()
  if (!value || /^(?:bookmark|history):/i.test(value)) return value
  if (/^[\\/]{2}/.test(value)) return `\\\\${value.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\")}`
  if (/^[A-Za-z]:/.test(value)) {
    const normalized = value.replace(/\//g, "\\")
    if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}\\`
    return /^[A-Za-z]:\\/.test(normalized) ? normalized : `${normalized.slice(0, 2)}\\${normalized.slice(2)}`
  }
  return value
}

export function visibleFolderBreadcrumbItems(items: readonly FolderBreadcrumbItem[], maximum: number): { collapsed: readonly FolderBreadcrumbItem[]; visible: readonly FolderBreadcrumbItem[] } {
  const limit = Math.max(2, maximum)
  if (items.length <= limit) return { collapsed: [], visible: items }
  const tailCount = limit - 1
  return {
    collapsed: items.slice(1, items.length - tailCount),
    visible: [items[0]!, ...items.slice(items.length - tailCount)],
  }
}

export default FolderBreadcrumb
