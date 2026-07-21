import { MillerColumns } from "@primitiv-ui/react"
import { ChevronRight, Folder, HardDrive, LoaderCircle, RotateCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderDirectoryEntryDto, ReaderDirectoryRootDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { folderDirectoryRoots, sameFolderDirectoryPath } from "./FolderDirectoryRoots"

const FULL_WIDTH_COLUMN_COUNT = 3

interface FolderBreadcrumbColumnsProps {
  client: ReaderHttpClient
  sessionId: string
  rootPath: string
  rootName: string
  activePath: readonly string[]
  currentPath: string
  disabled: boolean
  onNavigate(path: string): void
}

export default function FolderBreadcrumbColumns({ client, sessionId, rootPath, rootName, activePath, currentPath, disabled, onNavigate }: FolderBreadcrumbColumnsProps) {
  const loadDirectory = client.treeDirectoryBrowser
  const [volumeRoots, setVolumeRoots] = useState<readonly ReaderDirectoryRootDto[]>([])
  const roots = useMemo(() => folderDirectoryRoots(rootPath, [], volumeRoots, rootName), [rootName, rootPath, volumeRoots])
  const selectedPath = useMemo(() => [rootPath, ...activePath], [activePath, rootPath])
  const visibleStart = Math.max(0, selectedPath.length + 1 - FULL_WIDTH_COLUMN_COUNT)

  useEffect(() => {
    if (!client.listDirectoryRoots) return
    const controller = new AbortController()
    void client.listDirectoryRoots(controller.signal).then((values) => {
      if (!controller.signal.aborted) setVolumeRoots(values)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [client.listDirectoryRoots])

  if (!loadDirectory) return null

  return (
    <MillerColumns.Root
      className="flex h-[min(19rem,55vh)] min-h-40 overflow-x-auto overflow-y-hidden bg-background"
      aria-label="目录列导航"
      value={selectedPath}
      onValueChange={(path) => {
        const destination = path.at(-1) ?? rootPath
        if (!sameFolderPath(destination, currentPath)) onNavigate(destination)
      }}
      data-neoview-breadcrumb-columns="true"
    >
      <MillerColumns.Column
        className={columnClass(0, visibleStart)}
        aria-label="驱动器"
        data-breadcrumb-column-collapsed={visibleStart > 0 || undefined}
      >
        <div className={visibleStart > 0 ? "absolute inset-0 opacity-0 pointer-events-none" : undefined}>
          {roots.map((root) => {
            const currentRoot = sameFolderDirectoryPath(root.path, rootPath)
            return (
              <MillerColumns.Item<HTMLButtonElement> key={`${root.pinned ? "pin" : "root"}:${root.path}`} value={root.path} disabled={disabled || !root.available} asChild>
                <button
                  type="button"
                  className="flex h-8 w-full shrink-0 items-center gap-1.5 border-l-2 border-transparent px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=selected]:border-primary data-[state=selected]:bg-accent"
                  title={root.path}
                >
                  <HardDrive className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{root.name}</span>
                  {!root.available ? <span className="text-[10px] text-muted-foreground">不可用</span> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </button>
                {currentRoot ? (
                  <MillerColumns.Column
                    className={columnClass(1, visibleStart)}
                    aria-label={root.name}
                    data-breadcrumb-column-collapsed={1 < visibleStart || undefined}
                  >
                    <DirectoryColumnContents
                      loadDirectory={loadDirectory}
                      sessionId={sessionId}
                      path={root.path}
                      name={root.name}
                      depth={1}
                      visibleStart={visibleStart}
                      disabled={disabled}
                      onNavigate={onNavigate}
                    />
                  </MillerColumns.Column>
                ) : null}
              </MillerColumns.Item>
            )
          })}
        </div>
      </MillerColumns.Column>
    </MillerColumns.Root>
  )
}

function DirectoryColumnContents({ loadDirectory, sessionId, path, name, depth, visibleStart, disabled, onNavigate }: {
  loadDirectory: NonNullable<ReaderHttpClient["treeDirectoryBrowser"]>
  sessionId: string
  path: string
  name: string
  depth: number
  visibleStart: number
  disabled: boolean
  onNavigate(path: string): void
}) {
  const [entries, setEntries] = useState<readonly ReaderDirectoryEntryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const collapsed = depth < visibleStart

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    void loadDirectory(sessionId, path, retry > 0, controller.signal).then((page) => {
      if (!controller.signal.aborted) setEntries(page.entries.filter((entry) => entry.kind === "directory"))
    }).catch((cause) => {
      if (controller.signal.aborted) return
      setEntries([])
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [loadDirectory, path, retry, sessionId])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={collapsed
          ? "h-full min-h-0 w-8 justify-start rounded-none border-b px-1 text-xs font-medium [writing-mode:vertical-rl]"
          : "sticky top-0 z-10 h-9 shrink-0 justify-start rounded-none border-b bg-muted/60 px-2 text-sm font-medium"}
        title={path}
        disabled={disabled}
        onClick={() => onNavigate(path)}
      >
        {isRootPath(path) ? <HardDrive className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
        <span className="truncate">{name}</span>
      </Button>
      {!collapsed && loading ? (
        <div className="grid min-h-24 flex-1 place-items-center text-muted-foreground" role="status" aria-label={`正在读取 ${name}`}>
          <LoaderCircle className="size-4 animate-spin" />
        </div>
      ) : !collapsed && error ? (
        <div className="grid min-h-24 flex-1 content-center gap-2 p-2 text-center text-xs" role="alert">
          <span className="text-destructive">{error}</span>
          <Button type="button" size="sm" variant="outline" className="mx-auto h-7" onClick={() => setRetry((value) => value + 1)}>
            <RotateCw />重试
          </Button>
        </div>
      ) : entries.length ? (
        <div className={collapsed ? "absolute inset-0 opacity-0 pointer-events-none" : undefined}>
          {entries.map((entry) => (
            <MillerColumns.Item<HTMLButtonElement> key={entry.path} value={entry.path} disabled={disabled} asChild>
              <button
                type="button"
                className="flex h-8 w-full shrink-0 items-center gap-1.5 border-l-2 border-transparent px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=selected]:border-primary data-[state=selected]:bg-accent"
                title={entry.path}
              >
                <Folder className="size-4 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              <MillerColumns.Column
                className={columnClass(depth + 1, visibleStart)}
                aria-label={entry.name}
                data-breadcrumb-column-collapsed={depth + 1 < visibleStart || undefined}
              >
                <DirectoryColumnContents
                  loadDirectory={loadDirectory}
                  sessionId={sessionId}
                  path={entry.path}
                  name={entry.name}
                  depth={depth + 1}
                  visibleStart={visibleStart}
                  disabled={disabled}
                  onNavigate={onNavigate}
                />
              </MillerColumns.Column>
            </MillerColumns.Item>
          ))}
        </div>
      ) : !collapsed ? (
        <div className="p-3 text-center text-xs text-muted-foreground">没有子目录</div>
      ) : null}
    </>
  )
}

function columnClass(depth: number, visibleStart: number): string {
  return depth < visibleStart
    ? "relative flex h-full w-8 min-w-8 flex-col overflow-hidden border-r"
    : "relative flex w-48 min-w-40 flex-col overflow-y-auto border-r"
}

function sameFolderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replaceAll("/", "\\").toLocaleLowerCase()
  return normalize(left) === normalize(right)
}

function isRootPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(path) || path === "/" || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path)
}
