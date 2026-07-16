import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive, LoaderCircle, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"

import { Button } from "@/components/ui/button"
import type { ReaderDirectoryTreePageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"

const TREE_HEIGHT = 288
const TREE_ROW_HEIGHT = 30
const MAXIMUM_TREE_PAGES = 512
const MAXIMUM_TREE_EXPANDED_PATHS = 4_096
const MAXIMUM_TREE_REQUESTS = 32

interface FolderTreePanelProps {
  client: ReaderHttpClient
  sessionId: string
  currentPath: string
  disabled: boolean
  onNavigate(path: string): void
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
}

export default function FolderTreePanel({ client, sessionId, currentPath, disabled, onNavigate }: FolderTreePanelProps) {
  const treeRef = useRef<VirtuosoHandle>(null)
  const controllersRef = useRef(new Map<string, AbortController>())
  const generationRef = useRef<number | undefined>(undefined)
  const [pages, setPages] = useState<ReadonlyMap<string, ReaderDirectoryTreePageDto>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [generationEpoch, setGenerationEpoch] = useState(0)
  const rootPath = useMemo(() => directoryRoot(currentPath), [currentPath])

  const loadPage = useCallback(async (path: string, refresh = false, scopeSignal?: AbortSignal) => {
    if (!client.treeDirectoryBrowser || scopeSignal?.aborted) return
    const key = directoryPathKey(path)
    controllersRef.current.get(key)?.abort()
    if (controllersRef.current.size >= MAXIMUM_TREE_REQUESTS) {
      const oldest = controllersRef.current.entries().next().value as [string, AbortController] | undefined
      oldest?.[1].abort()
      if (oldest) controllersRef.current.delete(oldest[0])
    }
    const controller = new AbortController()
    const requestSignal = scopeSignal
      ? AbortSignal.any([controller.signal, scopeSignal])
      : controller.signal
    controllersRef.current.set(key, controller)
    setLoading((current) => setValue(current, key, true))
    setErrors((current) => mapWithout(current, key))
    try {
      const page = await client.treeDirectoryBrowser(sessionId, path, refresh, requestSignal)
      if (requestSignal.aborted) return
      const currentGeneration = generationRef.current
      if (currentGeneration !== undefined && page.generation < currentGeneration) return
      const generationChanged = currentGeneration !== undefined && page.generation > currentGeneration
      generationRef.current = page.generation
      if (generationChanged) {
        setErrors(new Map())
        setExpanded(new Set())
        setGenerationEpoch((current) => current + 1)
      }
      setPages((current) => boundedMapWith(
        generationChanged ? new Map() : current,
        directoryPathKey(page.path),
        page,
        MAXIMUM_TREE_PAGES,
      ))
    } catch (error) {
      if (requestSignal.aborted) return
      setErrors((current) => boundedMapWith(current, key, errorMessage(error), MAXIMUM_TREE_PAGES))
    } finally {
      if (controllersRef.current.get(key) === controller) controllersRef.current.delete(key)
      if (!controller.signal.aborted) setLoading((current) => setValue(current, key, false))
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
    () => flattenTree(rootPath, pages, expanded, loading, errors),
    [rootPath, pages, expanded, loading, errors],
  )
  const currentIndex = useMemo(() => rows.findIndex((row) => samePath(row.path, currentPath)), [rows, currentPath])

  useEffect(() => {
    if (currentIndex < 0) return
    const frame = requestAnimationFrame(() => {
      treeRef.current?.scrollToIndex({ index: currentIndex, align: "center" })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentIndex])

  async function toggle(row: TreeRow) {
    const key = directoryPathKey(row.path)
    if (row.expanded) {
      setExpanded((current) => setValue(current, key, false, MAXIMUM_TREE_EXPANDED_PATHS))
      return
    }
    setExpanded((current) => setValue(current, key, true, MAXIMUM_TREE_EXPANDED_PATHS))
    if (!row.loaded || row.error) await loadPage(row.path, Boolean(row.error))
  }

  if (!client.treeDirectoryBrowser) {
    return <div className="grid h-72 place-items-center text-xs text-muted-foreground">文件树不可用</div>
  }

  return (
    <div className="h-72" data-neoview-folder-tree="true" data-current-index={currentIndex >= 0 ? currentIndex : undefined} role="tree" aria-label="文件树" tabIndex={0}>
      <Virtuoso
        ref={treeRef}
        style={{ height: TREE_HEIGHT }}
        data={rows}
        fixedItemHeight={TREE_ROW_HEIGHT}
        computeItemKey={(_index, row) => `${sessionId}:${directoryPathKey(row.path)}`}
        itemContent={(_index, row) => {
          const current = samePath(row.path, currentPath)
          const ancestor = !current && isPathAncestor(row.path, currentPath)
          return (
            <div
              className={`group flex h-[30px] min-w-0 items-center border-b border-border/30 pr-1 text-xs hover:bg-accent/50 ${current ? "bg-accent" : ""} ${ancestor ? "font-medium" : ""}`}
              style={{ paddingLeft: `${4 + row.depth * 14}px` }}
              data-tree-path={row.path}
              data-current={current || undefined}
              data-ancestor={ancestor || undefined}
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
                disabled={disabled || row.loading}
                onClick={() => { void toggle(row) }}
              >
                {row.loading ? <LoaderCircle className="animate-spin" /> : row.expanded ? <ChevronDown /> : <ChevronRight />}
              </Button>
              {row.root ? <HardDrive className="mr-1 size-4 shrink-0 text-primary" /> : row.expanded ? <FolderOpen className="mr-1 size-4 shrink-0 text-amber-500" /> : <Folder className="mr-1 size-4 shrink-0 text-amber-500" />}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline"
                title={row.path}
                aria-current={current ? "page" : undefined}
                disabled={disabled}
                onClick={() => onNavigate(row.path)}
              >
                {row.name}
              </button>
              {row.loaded && !pages.get(directoryPathKey(row.path))?.entries.length && !row.error ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">空</span>
              ) : null}
              {row.error ? <span className="min-w-0 truncate text-[10px] text-destructive" title={row.error}>{row.error}</span> : null}
              {row.error ? (
                <Button type="button" size="icon-sm" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" aria-label={`重试加载${row.name}`} onClick={() => { void loadPage(row.path, true) }}>
                  <RefreshCw />
                </Button>
              ) : null}
            </div>
          )
        }}
      />
    </div>
  )
}

export function directoryRoot(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  const unc = /^(\/\/[^/]+\/[^/]+)(?:\/|$)/u.exec(normalized)
  if (unc) return `${unc[1]}/`
  const drive = /^([A-Za-z]:)(?:\/|$)/u.exec(normalized)
  if (drive) return `${drive[1]}\\`
  return "/"
}

export function directoryAncestors(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  const root = directoryRoot(path)
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

function flattenTree(
  rootPath: string,
  pages: ReadonlyMap<string, ReaderDirectoryTreePageDto>,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  errors: ReadonlyMap<string, string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (path: string, name: string, depth: number, root: boolean) => {
    const key = directoryPathKey(path)
    const page = pages.get(key)
    const open = expanded.has(key)
    rows.push({ path, name, depth, root, expanded: open, loading: loading.has(key), error: errors.get(key), loaded: Boolean(page) })
    if (!open || !page) return
    for (const entry of page.entries) visit(entry.path, entry.name, depth + 1, false)
  }
  visit(rootPath, rootLabel(rootPath), 0, true)
  return rows
}

function rootLabel(root: string): string {
  return root.replaceAll("\\", "/").replace(/\/$/u, "") || "/"
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
