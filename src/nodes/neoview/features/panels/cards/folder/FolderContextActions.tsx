import { BookOpen, BookmarkPlus, ClipboardPaste, Copy, ExternalLink, FileText, FolderOpen, PanelsTopLeft, Pencil, Scissors, Tags, Trash2, Undo2 } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { useContextMenu, useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import { publishReaderLibraryMutation } from "../../../library/reader-library-mutations"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderDirectorySelectionDescriptorDto } from "../../../../adapters/reader-http-client"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
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
  onEnterRawDirectory,
  onOpenInNewTab,
  onOpenAsBook,
  switchToast,
  onRenamed,
  onTrashed,
  onUndoDelete,
  confirmDelete = true,
  onCatalogUpdate = () => undefined,
  onRefreshEmm = () => undefined,
  renameRequest,
  onRenameRequestHandled,
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
  onEnterRawDirectory?(entry: FolderContextEntry): void | Promise<void>
  onOpenInNewTab(path: string): void
  onOpenAsBook?: (path: string) => void | Promise<void>
  switchToast?: ReaderSwitchToastPort
  onRenamed?(destinationPath: string): void | Promise<void>
  onTrashed?(entry: FolderContextEntry): void | Promise<void>
  onUndoDelete?(): void | Promise<void>
  confirmDelete?: boolean
  onCatalogUpdate?(update: FolderCatalogUpdater): void
  onRefreshEmm?(focusPath: string): Promise<void> | void
  renameRequest?: FolderContextEntry
  onRenameRequestHandled?(): void
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
    if (action === "enter-raw") {
      await onEnterRawDirectory?.(entry)
      return
    }
    if (action === "undo-delete") {
      if (!client.undoLatestFileOperations) return
      const operation = new AbortController()
      operationRef.current?.abort()
      operationRef.current = operation
      setPending(true)
      try {
        const result = await client.undoLatestFileOperations(true, operation.signal)
        if (result.failed > 0) throw new Error(`撤销完成 ${result.succeeded} 项，${result.failed} 项失败`)
        await onUndoDelete?.()
        switchToast?.show({ title: `已撤销 ${result.succeeded} 项回收站操作` })
      } catch (error) {
        setFeedback({ kind: "alert", text: errorMessage(error) })
      } finally {
        if (operationRef.current === operation) operationRef.current = undefined
        setPending(false)
      }
      return
    }
    if (action === "trash" || action === "delete") {
      const execute = client.executeFileOperations
      if (!execute) return
      const operation = new AbortController()
      operationRef.current?.abort()
      operationRef.current = operation
      setPending(true)
      setFeedback(undefined)
      let movedToTrash = false
      let completed = false
      try {
        const result = await execute([{ kind: action, sourcePath: entry.path }], true, operation.signal)
        const failed = result.results.find((item) => item.status !== "succeeded")
        if (failed || result.succeeded !== 1) throw new Error(fileOperationError(action, failed?.errorCode, failed?.error))
        movedToTrash = action === "trash"
        completed = true
        await onTrashed?.(entry)
        operation.signal.throwIfAborted()
        const message = action === "trash" ? `已将 ${entry.name} 移到回收站` : `已永久删除 ${entry.name}`
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
      } catch (error) {
        if (!operation.signal.aborted) {
          const message = movedToTrash
            ? `已将 ${entry.name} 移到回收站，但列表刷新失败，请手动刷新。${errorMessage(error)}`
            : completed ? `已永久删除 ${entry.name}，但列表刷新失败，请手动刷新。${errorMessage(error)}`
              : action === "delete" ? `永久删除 ${entry.name} 失败：${errorMessage(error)}` : errorMessage(error)
          setFeedback({
            kind: "alert",
            text: message,
          })
          switchToast?.show({ title: message })
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
        const message = existing ? `已从书签移除 ${entry.name}` : `已将 ${entry.name} 添加到书签`
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
        return
      } else {
        if (!copyText) throw new Error("当前宿主不支持复制文本。")
        await copyText(action === "copy-path" ? entry.path : entry.name)
      }
      operation.signal.throwIfAborted()
      const message = feedbackText(action, entry)
      setFeedback({ kind: "status", text: message })
      switchToast?.show({ title: message })
    } catch (error) {
      if (!operation.signal.aborted) {
        const message = errorMessage(error)
        setFeedback({ kind: "alert", text: message })
        switchToast?.show({ title: message })
      }
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
      const strategy = folderDeleteStrategy(event.detail)
      const shouldConfirm = folderDeleteConfirmation(event.detail, confirmDelete)
      const unavailable = disabled || pending || !client.executeFileOperations
      if (unavailable) return
      const item = strategy === "permanent"
        ? buildDeleteContextMenuItem(entry, { disabled: unavailable, confirm: shouldConfirm, onDelete: () => run("delete", entry) })
        : buildTrashContextMenuItem(entry, { disabled: unavailable, confirm: shouldConfirm, onTrash: () => run("trash", entry) })
      if (shouldConfirm) contextMenu.confirm(item, returnFocus)
      else void item.onSelect?.()
    }
    window.addEventListener("neoview-folder-trash-request", requestTrash)
    window.addEventListener("neoview-folder-delete-request", requestTrash)
    return () => {
      window.removeEventListener("neoview-folder-trash-request", requestTrash)
      window.removeEventListener("neoview-folder-delete-request", requestTrash)
    }
  }, [client.executeFileOperations, confirmDelete, contextMenu, disabled, pending])

  useEffect(() => {
    if (!renameRequest || disabled || pending || !client.executeFileOperations) return
    setRenameEntry(renameRequest)
    onRenameRequestHandled?.()
  }, [client.executeFileOperations, disabled, onRenameRequestHandled, pending, renameRequest])

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
      canEnterRawDirectory: Boolean(onEnterRawDirectory),
      canBookmark: Boolean(client.findBookmarkByPath && client.saveBookmark && client.removeBookmark),
      canRename: Boolean(client.executeFileOperations),
      canTrash: Boolean(client.executeFileOperations),
      canDelete: Boolean(client.executeFileOperations),
      canUndoDelete: Boolean(client.undoLatestFileOperations),
      confirmDelete,
      canEditMetadata: Boolean(sessionId && generation !== undefined && selection && client.resolveDirectorySelection && client.readDirectoryEmm && client.editDirectoryEmm),
      onAction: run,
      onUndoDelete: () => run("undo-delete", entry),
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
              const message = `已重命名为 ${destinationPath.slice(Math.max(destinationPath.lastIndexOf("/"), destinationPath.lastIndexOf("\\")) + 1)}`
              setFeedback({ kind: "status", text: message })
              switchToast?.show({ title: message })
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

type FolderContextAction = "activate" | "enter-raw" | "new-tab" | "open-as-book" | "system-open" | "reveal" | "copy" | "cut" | "paste" | "copy-path" | "copy-name" | "toggle-bookmark" | "edit-metadata" | "rename" | "trash" | "delete" | "undo-delete"

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
    canEnterRawDirectory?: boolean
    canBookmark: boolean
    canRename: boolean
    canTrash: boolean
    canDelete?: boolean
    canUndoDelete?: boolean
    confirmDelete?: boolean
    canEditMetadata?: boolean
    onAction(action: FolderContextAction, entry: FolderContextEntry): void | Promise<void>
    onUndoDelete?(): void | Promise<void>
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
  if (options.canUndoDelete) {
    items.push({
      id: "neoview-folder-undo-delete",
      label: "撤销上次删除",
      icon: <Undo2 />,
      disabled: unavailable,
      onSelect: options.onUndoDelete,
    })
  }
  if (entry.kind === "directory") {
    items.push(
      { id: "neoview-folder-enter-raw", label: "进入文件夹", icon: <FolderOpen />, disabled: unavailable || !options.canEnterRawDirectory, onSelect: () => options.onAction("enter-raw", entry) },
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
      confirm: options.confirmDelete !== false,
      onTrash: () => options.onAction("trash", entry),
    }),
    buildDeleteContextMenuItem(entry, {
      disabled: unavailable || !options.canDelete,
      confirm: options.confirmDelete !== false,
      onDelete: () => options.onAction("delete", entry),
    }),
    { type: "separator" },
    { id: "neoview-folder-entry-name", type: "label", label: entry.name },
  )
  return items
}

export function buildTrashContextMenuItem(
  entry: FolderContextEntry,
  options: { disabled: boolean; confirm?: boolean; onTrash(): void | Promise<void> },
): ContextMenuItemDef {
  return {
    id: "neoview-folder-trash",
    label: "移到回收站",
    icon: <Trash2 />,
    destructive: true,
    disabled: options.disabled,
    ...(options.confirm === false ? {} : { confirm: {
      title: "移到回收站？",
      description: `“${entry.name}”将移到系统回收站。NeoView 无法直接撤销此操作。`,
      confirmLabel: "移到回收站",
      cancelLabel: "取消",
    } }),
    onSelect: options.onTrash,
  }
}

export function buildDeleteContextMenuItem(
  entry: FolderContextEntry,
  options: { disabled: boolean; confirm?: boolean; onDelete(): void | Promise<void> },
): ContextMenuItemDef {
  return {
    id: "neoview-folder-delete",
    label: "永久删除",
    icon: <Trash2 />,
    destructive: true,
    disabled: options.disabled,
    ...(options.confirm === false ? {} : { confirm: {
      title: "永久删除？",
      description: `“${entry.name}”将被永久删除，无法从回收站恢复。`,
      confirmLabel: "永久删除",
      cancelLabel: "取消",
    } }),
    onSelect: options.onDelete,
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

function folderDeleteStrategy(value: unknown): "trash" | "permanent" {
  if (!value || typeof value !== "object") return "trash"
  return (value as { strategy?: unknown }).strategy === "permanent" ? "permanent" : "trash"
}

function folderDeleteConfirmation(value: unknown, fallback: boolean): boolean {
  if (!value || typeof value !== "object") return fallback
  return (value as { confirm?: unknown }).confirm !== false
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

function fileOperationError(action: "trash" | "delete", code?: string, message?: string): string {
  if (code === "EPERM" || code === "EACCES") return action === "delete" ? "没有权限永久删除此项目。" : "没有权限将此项目移到回收站。"
  if (code === "ENOENT") return "项目已经不存在，请刷新文件夹。"
  return message || (action === "delete" ? "永久删除失败。" : "移到回收站失败。")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
