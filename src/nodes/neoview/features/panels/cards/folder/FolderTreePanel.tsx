import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive, LoaderCircle, Pin, PinOff, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"

import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import type { ReaderDirectoryRootDto, ReaderDirectoryTreeChangesDto, ReaderDirectoryTreePageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { normalizeFolderNavigationPath } from "./DirectoryCatalog"

const TREE_ROW_HEIGHT = 30
const MAXIMUM_TREE_PAGES = 512
const MAXIMUM_TREE_EXPANDED_PATHS = 4_096
const MAXIMUM_TREE_REQUESTS = 32

interface FolderTreePanelProps {
  client: ReaderHttpClient
  sessionId: string
  currentPath: string
  watching: boolean
  disabled: boolean
  pinnedPaths: readonly string[]
  onNavigate(path: string): void
  onPinnedPathsChange(paths: string[]): void
}

interface TreeRow {
  path: string
  name: string
  depth: number
  root: boolean
  expanded: boolean
  loading: boolean
  error?: string
  loaded: boolean
  available: boolean
  pinnedRoot: boolean
  rowKey: string
}

export default function FolderTreePanel({ client, sessionId, currentPath, watching, disabled, pinnedPaths, onNavigate, onPinnedPathsChange }: FolderTreePanelProps) {
  const treeId = useId().replaceAll(":", "")
  const treeHostRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<VirtuosoHandle>(null)
  const controllersRef = useRef(new Map<string, AbortController>())
  const generationRef = useRef<number | undefined>(undefined)
  const [pages, setPages] = useState<ReadonlyMap<string, ReaderDirectoryTreePageDto>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [focusedPath, setFocusedPath] = useState(currentPath)
  const [generationEpoch, setGenerationEpoch] = useState(0)
  const [volumeRoots, setVolumeRoots] = useState<readonly ReaderDirectoryRootDto[]>([])
  const pagesRef = useRef(pages)
  const expandedRef = useRef(expanded)
  pagesRef.current = pages
  expandedRef.current = expanded
  const rootPath = useMemo(() => directoryRoot(normalizeFolderNavigationPath(currentPath)), [currentPath])
  const roots = useMemo(() => treeRoots(rootPath, pinnedPaths, volumeRoots), [rootPath, pinnedPaths, volumeRoots])

  const loadPage = useCallback(async (path: string, refresh = false, scopeSignal?: AbortSignal, preserveTree = false) => {
    if (!client.treeDirectoryBrowser || scopeSignal?.aborted) return
    const normalizedPath = normalizeFolderNavigationPath(path)
    const key = directoryPathKey(normalizedPath)
    controllersRef.current.get(key)?.abort()
    if (controllersRef.current.size >= MAXIMUM_TREE_REQUESTS) {
      const oldest = controllersRef.current.entries().next().value as [string, AbortController] | undefined
      if (oldest) {
        oldest[1].abort()
        controllersRef.current.delete(oldest[0])
        setLoading((current) => setValue(current, oldest[0], false))
      }
    }
    const controller = new AbortController()
    const requestSignal = scopeSignal
      ? AbortSignal.any([controller.signal, scopeSignal])
      : controller.signal
    controllersRef.current.set(key, controller)
    const clearRequest = () => {
      if (controllersRef.current.get(key) !== controller) return
      controllersRef.current.delete(key)
      setLoading((current) => setValue(current, key, false))
    }
    requestSignal.addEventListener("abort", clearRequest, { once: true })
    setLoading((current) => setValue(current, key, true))
    setErrors((current) => mapWithout(current, key))
    try {
      const page = await client.treeDirectoryBrowser(sessionId, normalizedPath, refresh, requestSignal)
      if (requestSignal.aborted) return
      const currentGeneration = generationRef.current
      if (currentGeneration !== undefined && page.generation < currentGeneration) return
      const generationChanged = currentGeneration !== undefined && page.generation > currentGeneration
      generationRef.current = page.generation
      if (generationChanged && !preserveTree) {
        setErrors(new Map())
        setExpanded(new Set())
        setGenerationEpoch((current) => current + 1)
      }
      setPages((current) => boundedMapWith(
        generationChanged && !preserveTree ? new Map() : current,
        directoryPathKey(page.path),
        page,
        MAXIMUM_TREE_PAGES,
      ))
    } catch (error) {
      if (requestSignal.aborted) return
      setErrors((current) => boundedMapWith(current, key, errorMessage(error), MAXIMUM_TREE_PAGES))
    } finally {
      requestSignal.removeEventListener("abort", clearRequest)
      clearRequest()
    }
  }, [client, sessionId])

  useEffect(() => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    generationRef.current = undefined
    setPages(new Map())
    setExpanded(new Set())
    setLoading(new Set())
    setErrors(new Map())
    return () => {
      for (const controller of controllersRef.current.values()) controller.abort()
      controllersRef.current.clear()
    }
  }, [sessionId, rootPath])

  useEffect(() => {
    if (!client.listDirectoryRoots) return
    const controller = new AbortController()
    void client.listDirectoryRoots(controller.signal).then((roots) => {
      if (!controller.signal.aborted) setVolumeRoots(roots)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [client.listDirectoryRoots])

  useEffect(() => {
    const watchTree = client.watchDirectoryTreeBrowser
    if (!watching || !watchTree) return
    const controller = new AbortController()
    void (async () => {
      let revision = 0
      while (!controller.signal.aborted) {
        const batch = await watchTree(sessionId, revision, controller.signal)
        if (!batch) continue
        revision = batch.revision
        if (batch.watchError) throw new Error(batch.watchError)
        await applyTreeChanges(batch, controller.signal)
      }
    })().catch((error) => {
      if (controller.signal.aborted) return
      setErrors((current) => boundedMapWith(current, directoryPathKey(currentPath), errorMessage(error), MAXIMUM_TREE_PAGES))
    })
    return () => controller.abort()

    async function applyTreeChanges(batch: ReaderDirectoryTreeChangesDto, signal: AbortSignal) {
      if (batch.reset) {
        generationRef.current = batch.generation
        setPages(new Map())
        setExpanded(new Set(directoryAncestors(currentPath).map(directoryPathKey)))
        setGenerationEpoch((current) => current + 1)
        return
      }
      const loaded = pagesRef.current
      const expandedPaths = expandedRef.current
      for (const path of batch.paths) {
        signal.throwIfAborted()
        const key = directoryPathKey(path)
        if (!loaded.has(key)) continue
        if (!expandedPaths.has(key)) {
          setPages((current) => mapWithout(current, key))
          continue
        }
        await loadPage(path, false, signal, true)
      }
    }
  }, [client.watchDirectoryTreeBrowser, currentPath, loadPage, sessionId, watching])

  useEffect(() => {
    if (!client.treeDirectoryBrowser || !currentPath) return
    const controller = new AbortController()
    const ancestors = directoryAncestors(currentPath)
    void (async () => {
      for (const path of ancestors) {
        if (controller.signal.aborted) return
        setExpanded((current) => setValue(current, directoryPathKey(path), true, MAXIMUM_TREE_EXPANDED_PATHS))
        await loadPage(path, false, controller.signal)
      }
    })()
    return () => controller.abort()
  }, [client.treeDirectoryBrowser, currentPath, generationEpoch, loadPage])

  const rows = useMemo(
    () => flattenTree(roots, pages, expanded, loading, errors),
    [roots, pages, expanded, loading, errors],
  )
  const currentIndex = useMemo(() => rows.findIndex((row) => samePath(row.path, currentPath)), [rows, currentPath])
  const requestedFocusedIndex = useMemo(() => rows.findIndex((row) => samePath(row.path, focusedPath)), [rows, focusedPath])
  const focusedIndex = requestedFocusedIndex >= 0 ? requestedFocusedIndex : currentIndex >= 0 ? currentIndex : rows.length ? 0 : -1

  useEffect(() => setFocusedPath(currentPath), [currentPath])

  useEffect(() => {
    if (focusedIndex < 0) return
    const frame = requestAnimationFrame(() => {
      treeRef.current?.scrollIntoView({ index: focusedIndex, behavior: "auto" })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedIndex])

  async function toggle(row: TreeRow) {
    if (!row.available) return
    const key = directoryPathKey(row.path)
    if (row.expanded) {
      setExpanded((current) => setValue(current, key, false, MAXIMUM_TREE_EXPANDED_PATHS))
      return
    }
    setExpanded((current) => setValue(current, key, true, MAXIMUM_TREE_EXPANDED_PATHS))
    if (!row.loaded || row.error) await loadPage(row.path, Boolean(row.error))
  }

  function focusRow(index: number) {
    const row = rows[index]
    if (row) setFocusedPath(row.path)
  }

  function togglePinned(path: string) {
    const pinned = pinnedPaths.some((candidate) => samePath(candidate, path))
    onPinnedPathsChange(pinned
      ? pinnedPaths.filter((candidate) => !samePath(candidate, path))
      : [...pinnedPaths, path])
  }

  function refreshRow(row: TreeRow) {
    setExpanded((current) => setValue(current, directoryPathKey(row.path), true, MAXIMUM_TREE_EXPANDED_PATHS))
    void loadPage(row.path, true)
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || disabled) return
    const row = rows[focusedIndex]
    if (!row) return
    let nextIndex = focusedIndex
    let handled = true
    if (event.key === "ArrowDown") nextIndex = Math.min(focusedIndex + 1, rows.length - 1)
    else if (event.key === "ArrowUp") nextIndex = Math.max(focusedIndex - 1, 0)
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = rows.length - 1
    else if (event.key === "ArrowRight") {
      if (!row.expanded) void toggle(row)
      else if (rows[focusedIndex + 1]?.depth === row.depth + 1) nextIndex = focusedIndex + 1
    } else if (event.key === "ArrowLeft") {
      if (row.expanded) void toggle(row)
      else {
        for (let index = focusedIndex - 1; index >= 0; index -= 1) {
          if (rows[index]!.depth < row.depth) {
            nextIndex = index
            break
          }
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      onNavigate(row.path)
    } else {
      handled = false
    }
    if (!handled) return
    event.preventDefault()
    event.stopPropagation()
    if (nextIndex !== focusedIndex) focusRow(nextIndex)
  }

  if (!client.treeDirectoryBrowser) {
    return <div className="grid h-72 place-items-center text-xs text-muted-foreground">文件树不可用</div>
  }

  return (
    <div
      ref={treeHostRef}
      className="h-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-neoview-folder-tree="true"
      data-current-index={currentIndex >= 0 ? currentIndex : undefined}
      data-focused-index={focusedIndex >= 0 ? focusedIndex : undefined}
      data-tree-root-count={roots.length}
      data-platform-root-count={volumeRoots.length}
      role="tree"
      aria-label="文件树"
      aria-activedescendant={focusedIndex >= 0 ? `${treeId}-row-${focusedIndex}` : undefined}
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
    >
      <Virtuoso
        ref={treeRef}
        style={{ height: "100%" }}
        data={rows}
        fixedItemHeight={TREE_ROW_HEIGHT}
        computeItemKey={(_index, row) => `${sessionId}:${row.rowKey}`}
        itemContent={(index, row) => {
          const current = samePath(row.path, currentPath)
          const focused = index === focusedIndex
          const ancestor = !current && isPathAncestor(row.path, currentPath)
          const pinned = pinnedPaths.some((path) => samePath(path, row.path))
          return (
            <ContextMenu onOpenChange={(open) => { if (open) setFocusedPath(row.path) }}>
              <ContextMenuTrigger asChild>
                <div
              id={`${treeId}-row-${index}`}
              className={`group flex h-[30px] min-w-0 items-center border-b border-border/30 pr-1 text-xs hover:bg-accent/50 ${current ? "bg-accent" : focused ? "bg-muted/70" : ""} ${ancestor ? "font-medium" : ""}`}
              style={{ paddingLeft: `${4 + row.depth * 14}px` }}
              data-tree-path={row.path}
              data-current={current || undefined}
              data-focused={focused || undefined}
              data-ancestor={ancestor || undefined}
              data-pinned-root={row.pinnedRoot || undefined}
              data-pinned={pinned || undefined}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={current}
              aria-expanded={row.expanded}
            >
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                aria-label={`${row.expanded ? "折叠" : "展开"}${row.name}`}
                aria-expanded={row.expanded}
                disabled={disabled || row.loading || !row.available}
                tabIndex={-1}
                onClick={() => {
                  setFocusedPath(row.path)
                  treeHostRef.current?.focus()
                  void toggle(row)
                }}
              >
                {row.loading ? <LoaderCircle className="animate-spin" /> : row.expanded ? <ChevronDown /> : <ChevronRight />}
              </Button>
              {row.pinnedRoot ? <Pin className="mr-1 size-4 shrink-0 text-primary" /> : row.root ? <HardDrive className="mr-1 size-4 shrink-0 text-primary" /> : row.expanded ? <FolderOpen className="mr-1 size-4 shrink-0 text-amber-500" /> : <Folder className="mr-1 size-4 shrink-0 text-amber-500" />}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline"
                title={row.path}
                aria-current={current ? "page" : undefined}
                disabled={disabled || !row.available}
                tabIndex={-1}
                onClick={() => {
                  setFocusedPath(row.path)
                  treeHostRef.current?.focus()
                  onNavigate(row.path)
                }}
              >
                {row.name}
              </button>
              {row.loaded && !pages.get(directoryPathKey(row.path))?.entries.length && !row.error ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">空</span>
              ) : null}
              {!row.available ? <span className="shrink-0 text-[10px] text-muted-foreground">不可用</span> : null}
              {row.error ? <span className="min-w-0 truncate text-[10px] text-destructive" title={row.error}>{row.error}</span> : null}
              {row.error ? (
                <Button type="button" size="icon-sm" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" aria-label={`重试加载${row.name}`} onClick={() => { void loadPage(row.path, true) }}>
                  <RefreshCw />
                </Button>
              ) : null}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem disabled={disabled || !row.available} onSelect={() => onNavigate(row.path)}>
                  <FolderOpen />打开目录
                </ContextMenuItem>
                <ContextMenuItem disabled={disabled} onSelect={() => togglePinned(row.path)}>
                  {pinned ? <PinOff /> : <Pin />}{pinned ? "取消固定" : "固定到文件树"}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={disabled || row.loading || !row.available} onSelect={() => refreshRow(row)}>
                  <RefreshCw />刷新
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        }}
      />
    </div>
  )
}

export function directoryRoot(path: string): string {
  const normalized = normalizeFolderNavigationPath(path).replaceAll("\\", "/")
  const unc = /^(\/\/[^/]+\/[^/]+)(?:\/|$)/u.exec(normalized)
  if (unc) return `${unc[1]}/`
  const drive = /^([A-Za-z]:)(?:\/|$)/u.exec(normalized)
  if (drive) return `${drive[1]}\\`
  return "/"
}

export function directoryAncestors(path: string): string[] {
  const normalizedPath = normalizeFolderNavigationPath(path)
  const normalized = normalizedPath.replaceAll("\\", "/").replace(/\/+$/u, "")
  const root = directoryRoot(normalizedPath)
  const rootNormalized = root.replaceAll("\\", "/").replace(/\/+$/u, "")
  const remainder = normalized.slice(rootNormalized.length).replace(/^\/+|\/+$/gu, "")
  const separator = root.includes("\\") ? "\\" : "/"
  const values = [root]
  let current = root.replace(/[\\/]$/u, "")
  for (const segment of remainder.split("/").filter(Boolean)) {
    current = `${current}${separator}${segment}`
    values.push(current)
  }
  return values
}

interface TreeRoot {
  path: string
  name: string
  pinned: boolean
  available: boolean
}

function treeRoots(rootPath: string, pinnedPaths: readonly string[], volumeRoots: readonly ReaderDirectoryRootDto[]): TreeRoot[] {
  const roots: TreeRoot[] = []
  for (const rawPath of pinnedPaths) {
    const path = normalizeFolderNavigationPath(rawPath)
    if (!roots.some((root) => samePath(root.path, path))) roots.push({ path, name: pinnedLabel(path), pinned: true, available: true })
  }
  for (const root of volumeRoots) {
    const path = normalizeFolderNavigationPath(root.path)
    const existing = roots.find((candidate) => samePath(candidate.path, path))
    if (existing) {
      existing.name = root.label
      existing.available = root.available
    } else {
      roots.push({ path, name: root.label, pinned: false, available: root.available })
    }
  }
  const existingRoot = roots.find((root) => samePath(root.path, rootPath))
  if (existingRoot) existingRoot.available = true
  else roots.push({ path: rootPath, name: rootLabel(rootPath), pinned: false, available: true })
  return roots
}

function flattenTree(
  roots: readonly TreeRoot[],
  pages: ReadonlyMap<string, ReaderDirectoryTreePageDto>,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  errors: ReadonlyMap<string, string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (path: string, name: string, depth: number, root: boolean, pinnedRoot: boolean, branchKey: string, available: boolean) => {
    const key = directoryPathKey(path)
    const page = pages.get(key)
    const open = expanded.has(key)
    rows.push({ path, name, depth, root, pinnedRoot, available, rowKey: `${branchKey}:${key}`, expanded: open, loading: loading.has(key), error: errors.get(key), loaded: Boolean(page) })
    if (!open || !page) return
    for (const entry of page.entries) visit(entry.path, entry.name, depth + 1, false, false, branchKey, true)
  }
  for (const root of roots) {
    const branchKey = `${root.pinned ? "pin" : "root"}:${directoryPathKey(root.path)}`
    visit(root.path, root.name, 0, true, root.pinned, branchKey, root.available)
  }
  return rows
}

function rootLabel(root: string): string {
  return root.replaceAll("\\", "/").replace(/\/$/u, "") || "/"
}

function pinnedLabel(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  return normalized.split("/").at(-1) || rootLabel(path)
}

export function directoryPathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  const value = normalized || "/"
  return /^(?:[A-Za-z]:|\/\/)/u.test(value) ? value.toLowerCase() : value
}

function samePath(left: string, right: string): boolean {
  return directoryPathKey(left) === directoryPathKey(right)
}

function isPathAncestor(candidate: string, path: string): boolean {
  const ancestor = directoryPathKey(candidate)
  const target = directoryPathKey(path)
  return target !== ancestor && target.startsWith(ancestor === "/" ? "/" : `${ancestor}/`)
}

function setValue(values: ReadonlySet<string>, value: string, included: boolean, maximum = Number.POSITIVE_INFINITY): ReadonlySet<string> {
  const next = new Set(values)
  if (included) next.add(value)
  else next.delete(value)
  while (next.size > maximum) {
    const oldest = next.values().next().value as string | undefined
    if (oldest === undefined) break
    next.delete(oldest)
  }
  return next
}

function boundedMapWith<K, V>(values: ReadonlyMap<K, V>, key: K, value: V, maximum: number): ReadonlyMap<K, V> {
  const next = new Map(values)
  next.delete(key)
  next.set(key, value)
  while (next.size > maximum) {
    const oldest = next.keys().next().value as K | undefined
    if (oldest === undefined) break
    next.delete(oldest)
  }
  return next
}

function mapWithout<T>(values: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  if (!values.has(key)) return values
  const next = new Map(values)
  next.delete(key)
  return next
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
