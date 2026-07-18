import { BookOpen, BookmarkPlus, ClipboardPaste, Copy, ExternalLink, FileText, FolderOpen, PanelsTopLeft, Pencil, Scissors, Tags, Trash2 } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { useContextMenu, useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import { publishReaderLibraryMutation } from "../../../library/reader-library-mutations"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderDirectorySelectionDescriptorDto } from "../../../../adapters/reader-http-client"
import { useFolderClipboard } from "./FolderClipboard"
import type { FolderCatalogUpdater } from "./FolderEmmEditor"

const FolderRenameDialog = lazy(() => import("./FolderRenameDialog"))
const FolderEmmEditor = lazy(() => import("./FolderEmmEditor"))

export interface FolderContextEntry {
  index: number
  path: string
  name: string
  kind: "file" | "directory"
  readerSupported: boolean
}

export default function FolderContextActions({
  client,
  disabled,
  copyText,
  sessionId,
  generation,
  currentPath,
  selection,
  selectedCount = 0,
  onActivate,
  onOpenInNewTab,
  onOpenAsBook,
  onRenamed,
  onTrashed,
  onCatalogUpdate = () => undefined,
  onRefreshEmm = () => undefined,
}: {
  client: ReaderHttpClient
  disabled: boolean
  copyText?: (text: string) => Promise<void>
  sessionId?: string
  generation?: number
  currentPath?: string
  selection?: ReaderDirectorySelectionDescriptorDto
  selectedCount?: number
  onActivate(entry: FolderContextEntry): void | Promise<void>
  onOpenInNewTab(path: string): void
  onOpenAsBook?: (path: string) => void | Promise<void>
  onRenamed?(destinationPath: string): void | Promise<void>
  onTrashed?(entry: FolderContextEntry): void | Promise<void>
  onCatalogUpdate?(update: FolderCatalogUpdater): void
  onRefreshEmm?(focusPath: string): Promise<void> | void
}) {
  const clipboard = useFolderClipboard()
  const contextMenu = useContextMenu()
  const operationRef = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const [renameEntry, setRenameEntry] = useState<FolderContextEntry>()
  const [emmEntry, setEmmEntry] = useState<FolderContextEntry>()

  useEffect(() => () => operationRef.current?.abort(), [])

  async function run(action: FolderContextAction, entry: FolderContextEntry) {
    if (pending) return
    if (action === "rename") {
      setRenameEntry(entry)
      return
    }
    if (action === "edit-metadata") {
      setEmmEntry(entry)
      return
    }
    if (action === "trash") {
      const execute = client.executeFileOperations
      if (!execute) return
      const operation = new AbortController()
      operationRef.current?.abort()
      operationRef.current = operation
      setPending(true)
      setFeedback(undefined)
      let movedToTrash = false
      try {
        const result = await execute([{ kind: "trash", sourcePath: entry.path }], true, operation.signal)
        const failed = result.results.find((item) => item.status !== "succeeded")
        if (failed || result.succeeded !== 1) throw new Error(fileOperationError(failed?.errorCode, failed?.error))
        movedToTrash = true
        await onTrashed?.(entry)
        operation.signal.throwIfAborted()
        setFeedback({ kind: "status", text: `已将 ${entry.name} 移到回收站` })
      } catch (error) {
        if (!operation.signal.aborted) {
          setFeedback({
            kind: "alert",
            text: movedToTrash
              ? `已将 ${entry.name} 移到回收站，但列表刷新失败，请手动刷新。${errorMessage(error)}`
              : errorMessage(error),
          })
        }
      } finally {
        if (operationRef.current === operation) {
          operationRef.current = undefined
          setPending(false)
        }
      }
      return
    }
    if (action === "copy" || action === "cut") {
      if (!sessionId || generation === undefined) return
      try {
        await clipboard.prepare(sessionId, {
          generation,
          allSelected: false,
          ranges: [],
          explicit: [{ path: entry.path, index: entry.index }],
        }, action === "copy" ? "copy" : "move")
      } catch {
        // The shared clipboard surface owns accessible failure feedback.
      }
      return
    }
    if (action === "paste") {
      const destinationPath = entry.kind === "directory" ? entry.path : currentPath
      if (!destinationPath) return
      try {
        await clipboard.paste(destinationPath)
      } catch {
        // The shared clipboard surface owns accessible failure feedback.
      }
      return
    }
    const operation = new AbortController()
    operationRef.current?.abort()
    operationRef.current = operation
    setPending(true)
    setFeedback(undefined)
    try {
      if (action === "activate") {
        await onActivate(entry)
      } else if (action === "new-tab") {
        onOpenInNewTab(entry.path)
      } else if (action === "open-as-book") {
        if (!onOpenAsBook) throw new Error("当前 Reader 不支持打开此目录。")
        await onOpenAsBook(entry.path)
      } else if (action === "system-open") {
        if (!client.openSystemPath) throw new Error("当前后端不支持默认软件打开。")
        await client.openSystemPath(entry.path, operation.signal)
      } else if (action === "reveal") {
        if (!client.revealSystemPath) throw new Error("当前后端不支持系统定位。")
        await client.revealSystemPath(entry.path, operation.signal)
      } else if (action === "toggle-bookmark") {
        if (!client.findBookmarkByPath || !client.saveBookmark || !client.removeBookmark) {
          throw new Error("当前后端不支持切换书签。")
        }
        const existing = await client.findBookmarkByPath(entry.path, operation.signal)
        operation.signal.throwIfAborted()
        if (existing) await client.removeBookmark(existing.id, operation.signal)
        else {
          await client.saveBookmark({
            source: { kind: "path", path: entry.path },
            name: entry.name,
            kind: entry.kind === "directory" ? "folder" : "file",
          }, operation.signal)
        }
        publishReaderLibraryMutation()
        operation.signal.throwIfAborted()
        setFeedback({ kind: "status", text: existing ? `已从书签移除 ${entry.name}` : `已将 ${entry.name} 添加到书签` })
        return
      } else {
        if (!copyText) throw new Error("当前宿主不支持复制文本。")
        await copyText(action === "copy-path" ? entry.path : entry.name)
      }
      operation.signal.throwIfAborted()
      setFeedback({ kind: "status", text: feedbackText(action, entry) })
    } catch (error) {
      if (!operation.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined
        setPending(false)
      }
    }
  }

  useEffect(() => {
    const requestTrash = (event: Event) => {
      if (!contextMenu || !(event instanceof CustomEvent)) return
      const entry = folderTrashCommandEntry(event.detail)
      if (!entry) return
      const returnFocus = event.target instanceof HTMLElement ? event.target : undefined
      contextMenu.confirm(buildTrashContextMenuItem(entry, {
        disabled: disabled || pending || !client.executeFileOperations,
        onTrash: () => run("trash", entry),
      }), returnFocus)
    }
    window.addEventListener("neoview-folder-trash-request", requestTrash)
    return () => window.removeEventListener("neoview-folder-trash-request", requestTrash)
  }, [client.executeFileOperations, contextMenu, disabled, pending])

  useContextMenuBuilder("neoview-folder-entry", ({ data }) => {
    const entry = folderContextEntry(data)
    return entry ? buildFolderContextMenuItems(entry, {
      disabled,
      pending,
      canCopyText: Boolean(copyText),
      canClipboard: Boolean(sessionId && generation !== undefined && client.prepareDirectoryClipboard),
      canPaste: clipboard.clipboard.available && Boolean(client.pasteDirectoryClipboard),
      canOpenSystem: Boolean(client.openSystemPath),
      canReveal: Boolean(client.revealSystemPath),
      canOpenAsBook: Boolean(onOpenAsBook),
      canBookmark: Boolean(client.findBookmarkByPath && client.saveBookmark && client.removeBookmark),
      canRename: Boolean(client.executeFileOperations),
      canTrash: Boolean(client.executeFileOperations),
      canEditMetadata: Boolean(sessionId && generation !== undefined && selection && client.resolveDirectorySelection && client.readDirectoryEmm && client.editDirectoryEmm),
      onAction: run,
    }) : null
  })

  return (
    <>
      {feedback ? <div role={feedback.kind} className={feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>{feedback.text}</div> : null}
      {renameEntry ? (
        <Suspense fallback={null}>
          <FolderRenameDialog
            client={client}
            entry={renameEntry}
            onClose={() => setRenameEntry(undefined)}
            onRenamed={async (destinationPath) => {
              await onRenamed?.(destinationPath)
              setFeedback({ kind: "status", text: `已重命名为 ${destinationPath.slice(Math.max(destinationPath.lastIndexOf("/"), destinationPath.lastIndexOf("\\")) + 1)}` })
            }}
          />
        </Suspense>
      ) : null}
      {emmEntry && sessionId && generation !== undefined && selection ? (
        <Suspense fallback={null}>
          <FolderEmmEditor
            client={client}
            sessionId={sessionId}
            generation={generation}
            selection={selection}
            selectedCount={Math.max(1, selectedCount)}
            fallbackEntry={emmEntry}
            onCatalogUpdate={onCatalogUpdate}
            onRefresh={onRefreshEmm}
            onClose={() => setEmmEntry(undefined)}
          />
        </Suspense>
      ) : null}
    </>
  )
}

type FolderContextAction = "activate" | "new-tab" | "open-as-book" | "system-open" | "reveal" | "copy" | "cut" | "paste" | "copy-path" | "copy-name" | "toggle-bookmark" | "edit-metadata" | "rename" | "trash"

export function buildFolderContextMenuItems(
  entry: FolderContextEntry,
  options: {
    disabled: boolean
    pending: boolean
    canCopyText: boolean
    canClipboard: boolean
    canPaste: boolean
    canOpenSystem: boolean
    canReveal: boolean
    canOpenAsBook: boolean
    canBookmark: boolean
    canRename: boolean
    canTrash: boolean
    canEditMetadata?: boolean
    onAction(action: FolderContextAction, entry: FolderContextEntry): void | Promise<void>
  },
): ContextMenuItemDef[] {
  const unavailable = options.disabled || options.pending
  const primaryAction: FolderContextAction = entry.kind === "file" && !entry.readerSupported ? "system-open" : "activate"
  const items: ContextMenuItemDef[] = [
    {
      id: "neoview-folder-open",
      label: "打开",
      icon: entry.kind === "directory" ? <FolderOpen /> : <BookOpen />,
      disabled: unavailable || (primaryAction === "system-open" && !options.canOpenSystem),
      onSelect: () => options.onAction(primaryAction, entry),
    },
  ]
  if (entry.kind === "directory") {
    items.push(
      { id: "neoview-folder-open-new-tab", label: "在新标签页中打开", icon: <PanelsTopLeft />, disabled: unavailable, onSelect: () => options.onAction("new-tab", entry) },
      { id: "neoview-folder-open-as-book", label: "作为书籍打开", icon: <BookOpen />, disabled: unavailable || !options.canOpenAsBook, onSelect: () => options.onAction("open-as-book", entry) },
    )
  }
  items.push(
    { id: "neoview-folder-system-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: unavailable || !options.canOpenSystem, onSelect: () => options.onAction("system-open", entry) },
    { id: "neoview-folder-reveal", label: "在资源管理器中显示", icon: <FolderOpen />, disabled: unavailable || !options.canReveal, onSelect: () => options.onAction("reveal", entry) },
    { type: "separator" },
    { id: "neoview-folder-copy", label: "复制", icon: <Copy />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("copy", entry) },
    { id: "neoview-folder-cut", label: "剪切", icon: <Scissors />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("cut", entry) },
    { id: "neoview-folder-paste", label: entry.kind === "directory" ? "粘贴到此文件夹" : "粘贴到当前文件夹", icon: <ClipboardPaste />, disabled: unavailable || !options.canPaste, onSelect: () => options.onAction("paste", entry) },
    { type: "separator" },
    { id: "neoview-folder-toggle-bookmark", label: "添加/移除书签", icon: <BookmarkPlus />, disabled: unavailable || !options.canBookmark, onSelect: () => options.onAction("toggle-bookmark", entry) },
    { id: "neoview-folder-edit-metadata", label: "编辑标签与评分", icon: <Tags />, disabled: unavailable || !options.canEditMetadata, onSelect: () => options.onAction("edit-metadata", entry) },
    { type: "separator" },
    { id: "neoview-folder-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", entry) },
    { id: "neoview-folder-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", entry) },
    { id: "neoview-folder-rename", label: "重命名", icon: <Pencil />, disabled: unavailable || !options.canRename, onSelect: () => options.onAction("rename", entry) },
    buildTrashContextMenuItem(entry, {
      disabled: unavailable || !options.canTrash,
      onTrash: () => options.onAction("trash", entry),
    }),
    { type: "separator" },
    { id: "neoview-folder-entry-name", type: "label", label: entry.name },
  )
  return items
}

export function buildTrashContextMenuItem(
  entry: FolderContextEntry,
  options: { disabled: boolean; onTrash(): void | Promise<void> },
): ContextMenuItemDef {
  return {
    id: "neoview-folder-trash",
    label: "移到回收站",
    icon: <Trash2 />,
    destructive: true,
    disabled: options.disabled,
    confirm: {
      title: "移到回收站？",
      description: `“${entry.name}”将移到系统回收站。NeoView 无法直接撤销此操作。`,
      confirmLabel: "移到回收站",
      cancelLabel: "取消",
    },
    onSelect: options.onTrash,
  }
}

function folderTrashCommandEntry(value: unknown): FolderContextEntry | undefined {
  if (!value || typeof value !== "object") return undefined
  const data = value as Partial<FolderContextEntry>
  if (!Number.isSafeInteger(data.index) || typeof data.path !== "string" || !data.path
    || typeof data.name !== "string" || !data.name || (data.kind !== "file" && data.kind !== "directory")
    || typeof data.readerSupported !== "boolean") return undefined
  return data as FolderContextEntry
}

export function folderContextEntry(data: Record<string, string>): FolderContextEntry | undefined {
  const index = Number(data.folderIndex)
  const kind = data.folderKind
  if (!Number.isSafeInteger(index) || !data.folderPath || !data.folderName || (kind !== "file" && kind !== "directory")) return undefined
  return {
    index,
    path: data.folderPath,
    name: data.folderName,
    kind,
    readerSupported: data.folderReaderSupported === "true",
  }
}

function feedbackText(action: FolderContextAction, entry: FolderContextEntry): string {
  if (action === "copy-path") return `已复制 ${entry.name} 的路径`
  if (action === "copy-name") return `已复制名称 ${entry.name}`
  if (action === "reveal") return `已在文件管理器中定位 ${entry.name}`
  if (action === "add-bookmark") return `已将 ${entry.name} 添加到书签`
  if (action === "new-tab") return `已在新标签页中打开 ${entry.name}`
  if (action === "open-as-book") return `已作为书籍打开 ${entry.name}`
  return `已打开 ${entry.name}`
}

function fileOperationError(code?: string, message?: string): string {
  if (code === "EPERM" || code === "EACCES") return "没有权限将此项目移到回收站。"
  if (code === "ENOENT") return "项目已经不存在，请刷新文件夹。"
  return message || "移到回收站失败。"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
