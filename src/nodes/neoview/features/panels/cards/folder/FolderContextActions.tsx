import { BookOpen, BookmarkPlus, ClipboardPaste, Copy, ExternalLink, FileText, FolderInput, FolderOpen, PanelsTopLeft, Pencil, Pin, PinOff, RefreshCw, Scissors, Tags, Trash2, Undo2 } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { useContextMenu, useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import { publishReaderLibraryMutation } from "../../../library/reader-library-mutations"
import type { ReaderFileUndoResultDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderDirectorySelectionDescriptorDto } from "../../../../adapters/reader-http-client"
import type { ReaderFolderConfirmationConfig } from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
import { useFolderClipboard } from "./FolderClipboard"
import type { FolderCatalogUpdater } from "./FolderEmmEditor"
import { runDissolvefFolder } from "./FolderDissolvefAction"
import { createOptimisticFolderDeletion } from "./FolderOptimisticDeletion"

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
  currentSourceKind,
  selection,
  selectedCount = 0,
  onActivate,
  onEnterRawDirectory,
  onOpenInNewTab,
  onOpenAsBook,
  onDeleteThroughBinding,
  onUndoFileDeletion,
  switchToast,
  onRenamed,
  onDeleteStarted,
  onDeleteFailed,
  confirmations = { trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true },
  onCatalogUpdate = () => undefined,
  onRefreshEmm = () => undefined,
  onRefreshDirectory,
  onReloadThumbnail,
  renameRequest,
  onRenameRequestHandled,
  treePinnedPaths = [],
  onToggleTreePin,
}: {
  client: ReaderHttpClient
  disabled: boolean
  copyText?: (text: string) => Promise<void>
  sessionId?: string
  generation?: number
  currentPath?: string
  currentSourceKind?: "directory" | "efu"
  selection?: ReaderDirectorySelectionDescriptorDto
  selectedCount?: number
  onActivate(entry: FolderContextEntry): void | Promise<void>
  onEnterRawDirectory?(entry: FolderContextEntry): void | Promise<void>
  onOpenInNewTab(path: string): void
  onOpenAsBook?: (path: string) => void | Promise<void>
  onDeleteThroughBinding?: ReaderPanelContext["onDeleteThroughBinding"]
  onUndoFileDeletion?(): Promise<ReaderFileUndoResultDto>
  switchToast?: ReaderSwitchToastPort
  onRenamed?(destinationPath: string): void | Promise<void>
  onDeleteStarted?(entry: FolderContextEntry): void
  onDeleteFailed?(entry: FolderContextEntry): void | Promise<void>
  confirmations?: ReaderFolderConfirmationConfig
  onCatalogUpdate?(update: FolderCatalogUpdater): void
  onRefreshEmm?(focusPath: string): Promise<void> | void
  /** Refresh the current directory listing (F5 / toolbar 刷新). */
  onRefreshDirectory?(): void | Promise<void>
  /** Reload the thumbnail for the concrete context entry (Neo 重载缩略图). */
  onReloadThumbnail?(entry: FolderContextEntry): void | Promise<void>
  renameRequest?: FolderContextEntry
  onRenameRequestHandled?(): void
  /** Paths pinned to the folder tree root list (shown above volume roots). */
  treePinnedPaths?: readonly string[]
  onToggleTreePin?(path: string): void
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
    if (action === "refresh") {
      if (!onRefreshDirectory) return
      setPending(true)
      setFeedback(undefined)
      try {
        await onRefreshDirectory()
        const message = "已刷新当前目录"
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
      } catch (error) {
        const message = `刷新目录失败：${errorMessage(error)}`
        setFeedback({ kind: "alert", text: message })
        switchToast?.show({ title: message })
      } finally {
        setPending(false)
      }
      return
    }
    if (action === "reload-thumbnail") {
      if (!onReloadThumbnail) return
      setPending(true)
      setFeedback(undefined)
      try {
        await onReloadThumbnail(entry)
        const message = `已重载 ${entry.name} 的缩略图`
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
      } catch (error) {
        const message = `重载缩略图失败：${errorMessage(error)}`
        setFeedback({ kind: "alert", text: message })
        switchToast?.show({ title: message })
      } finally {
        setPending(false)
      }
      return
    }
    if (action === "undo-delete") {
      if (!onUndoFileDeletion) return
      setPending(true)
      try {
        await onUndoFileDeletion()
      } catch (error) {
        setFeedback({ kind: "alert", text: errorMessage(error) })
      } finally {
        setPending(false)
      }
      return
    }
    if (action === "dissolve") {
      if (entry.kind !== "directory") return
      setPending(true)
      setFeedback(undefined)
      try {
        await runDissolvefFolder(entry.path)
        await onRefreshDirectory?.()
        const message = `已解散 ${entry.name}`
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
      } catch (error) {
        const message = `解散文件夹失败：${errorMessage(error)}`
        setFeedback({ kind: "alert", text: message })
        switchToast?.show({ title: message })
      } finally {
        setPending(false)
      }
      return
    }
    if (action === "trash" || action === "delete") {
      if (!onDeleteThroughBinding) return
      const optimisticDelete = createOptimisticFolderDeletion(entry, onDeleteStarted, onDeleteFailed)
      setPending(true)
      setFeedback(undefined)
      optimisticDelete.start()
      try {
        const result = await onDeleteThroughBinding(entry.path, action)
        if (!result || result.status !== "succeeded") {
          await optimisticDelete.restore()
          const failure = result?.status === "failed" && result.outcome.status === "failed"
            ? result.outcome.error
            : new Error("删除动作绑定不可用，文件未删除。")
          const message = errorMessage(failure)
          setFeedback({ kind: "alert", text: message })
          switchToast?.show({ title: message })
        }
      } catch (error) {
        await optimisticDelete.restore()
        const message = errorMessage(error)
        setFeedback({ kind: "alert", text: message })
        switchToast?.show({ title: message })
      } finally {
        setPending(false)
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
      const defaultConfirmation = strategy === "permanent"
        ? confirmations.permanentDelete
        : confirmations.trash
      const shouldConfirm = folderDeleteConfirmation(event.detail, defaultConfirmation)
      const unavailable = disabled || pending || !onDeleteThroughBinding
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
  }, [confirmations, contextMenu, disabled, onDeleteThroughBinding, pending])

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
      canPaste: clipboard.clipboard.available
        && Boolean(client.pasteDirectoryClipboard)
        && (entry.kind === "directory" || currentSourceKind !== "efu"),
      canOpenSystem: Boolean(client.openSystemPath),
      canReveal: Boolean(client.revealSystemPath),
      canOpenAsBook: Boolean(onOpenAsBook),
      canEnterRawDirectory: Boolean(onEnterRawDirectory),
      canBookmark: Boolean(client.findBookmarkByPath && client.saveBookmark && client.removeBookmark),
      canRename: Boolean(client.executeFileOperations),
      canTrash: Boolean(onDeleteThroughBinding),
      canDelete: Boolean(onDeleteThroughBinding),
      canUndoDelete: Boolean(onUndoFileDeletion),
      confirmations,
      canEditMetadata: Boolean(sessionId && generation !== undefined && selection && client.resolveDirectorySelection && client.readDirectoryEmm && client.editDirectoryEmm),
      canRefresh: Boolean(onRefreshDirectory),
      canReloadThumbnail: Boolean(onReloadThumbnail),
      canPinTree: entry.kind === "directory" && Boolean(onToggleTreePin),
      treePinned: entry.kind === "directory" && treePinnedPaths.some((path) => sameTreePinPath(path, entry.path)),
      onAction: run,
      onUndoDelete: () => run("undo-delete", entry),
      onToggleTreePin: () => {
        onToggleTreePin?.(entry.path)
        const pinned = treePinnedPaths.some((path) => sameTreePinPath(path, entry.path))
        const message = pinned ? `已取消置顶 ${entry.name}` : `已置顶 ${entry.name} 到文件树`
        setFeedback({ kind: "status", text: message })
        switchToast?.show({ title: message })
      },
    }) : null
  })

  return (
    <>
      {feedback ? <div role={feedback.kind} className={feedback.kind === "alert" ? "absolute bottom-2 right-2 z-50 max-w-[min(30rem,calc(100%-1rem))] rounded bg-destructive/10 px-2 py-1 text-xs text-destructive shadow-sm" : "sr-only"}>{feedback.text}</div> : null}
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

type FolderContextAction =
  | "activate"
  | "enter-raw"
  | "new-tab"
  | "open-as-book"
  | "system-open"
  | "reveal"
  | "copy"
  | "cut"
  | "paste"
  | "copy-path"
  | "copy-name"
  | "toggle-bookmark"
  | "edit-metadata"
  | "rename"
  | "trash"
  | "delete"
  | "undo-delete"
  | "dissolve"
  | "refresh"
  | "reload-thumbnail"

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
    confirmations?: ReaderFolderConfirmationConfig
    canEditMetadata?: boolean
    canRefresh?: boolean
    canReloadThumbnail?: boolean
    canPinTree?: boolean
    treePinned?: boolean
    onAction(action: FolderContextAction, entry: FolderContextEntry): void | Promise<void>
    onUndoDelete?(): void | Promise<void>
    onToggleTreePin?(): void
  },
): ContextMenuItemDef[] {
  const unavailable = options.disabled || options.pending
  const primaryAction: FolderContextAction = entry.kind === "file" && !entry.readerSupported ? "system-open" : "activate"
  const trashItem = buildTrashContextMenuItem(entry, {
    disabled: unavailable || !options.canTrash,
    confirm: options.confirmations?.trash ?? false,
    onTrash: () => options.onAction("trash", entry),
  })
  const deleteItem = buildDeleteContextMenuItem(entry, {
    disabled: unavailable || !options.canDelete,
    confirm: options.confirmations?.permanentDelete ?? true,
    onDelete: () => options.onAction("delete", entry),
  })

  // Row 1 — Neo-style edit icons: cut / copy / paste / trash / rename
  const editIcons: ContextMenuItemDef[] = [
    { id: "neoview-folder-cut", label: "剪切", icon: <Scissors />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("cut", entry) },
    { id: "neoview-folder-copy", label: "复制", icon: <Copy />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("copy", entry) },
    {
      id: "neoview-folder-paste",
      label: entry.kind === "directory" ? "粘贴到此文件夹" : "粘贴到当前文件夹",
      icon: <ClipboardPaste />,
      disabled: unavailable || !options.canPaste,
      onSelect: () => options.onAction("paste", entry),
    },
    trashItem,
    { id: "neoview-folder-rename", label: "重命名", icon: <Pencil />, disabled: unavailable || !options.canRename, onSelect: () => options.onAction("rename", entry) },
  ]

  // Row 2 — Neo-style open / navigate icons
  const openIcons: ContextMenuItemDef[] = []
  if (entry.kind === "directory") {
    openIcons.push(
      {
        id: "neoview-folder-enter-raw",
        label: "进入文件夹",
        icon: <FolderOpen />,
        disabled: unavailable || !options.canEnterRawDirectory,
        onSelect: () => options.onAction("enter-raw", entry),
      },
      {
        id: "neoview-folder-open-new-tab",
        label: "在新标签页中打开",
        icon: <PanelsTopLeft />,
        disabled: unavailable,
        onSelect: () => options.onAction("new-tab", entry),
      },
      {
        id: "neoview-folder-open-as-book",
        label: "作为书籍打开",
        icon: <BookOpen />,
        disabled: unavailable || !options.canOpenAsBook,
        onSelect: () => options.onAction("open-as-book", entry),
      },
    )
  } else {
    openIcons.push(
      {
        id: "neoview-folder-open",
        label: "打开",
        icon: <BookOpen />,
        disabled: unavailable || (primaryAction === "system-open" && !options.canOpenSystem),
        onSelect: () => options.onAction(primaryAction, entry),
      },
      {
        id: "neoview-folder-system-open",
        label: "用默认软件打开",
        icon: <ExternalLink />,
        disabled: unavailable || !options.canOpenSystem,
        onSelect: () => options.onAction("system-open", entry),
      },
    )
  }
  openIcons.push({
    id: "neoview-folder-reveal",
    label: "在资源管理器中显示",
    icon: <FolderOpen />,
    disabled: unavailable || !options.canReveal,
    onSelect: () => options.onAction("reveal", entry),
  })
  if (options.canUndoDelete) {
    openIcons.push({
      id: "neoview-folder-undo-delete",
      label: "撤销上次删除",
      icon: <Undo2 />,
      disabled: unavailable,
      onSelect: options.onUndoDelete,
    })
  }

  // Submenu: open variants not already primary for this entry kind
  const openMore: ContextMenuItemDef[] = []
  if (entry.kind === "directory") {
    openMore.push(
      {
        id: "neoview-folder-open",
        label: "打开",
        icon: <FolderOpen />,
        disabled: unavailable,
        onSelect: () => options.onAction("activate", entry),
      },
      {
        id: "neoview-folder-system-open",
        label: "用默认软件打开",
        icon: <ExternalLink />,
        disabled: unavailable || !options.canOpenSystem,
        onSelect: () => options.onAction("system-open", entry),
      },
    )
  } else {
    openMore.push(
      {
        id: "neoview-folder-open-new-tab",
        label: "在新标签页中打开",
        icon: <PanelsTopLeft />,
        disabled: unavailable,
        onSelect: () => options.onAction("new-tab", entry),
      },
    )
  }

  return [
    { type: "icon-row", id: "neoview-folder-edit-row", label: "编辑", children: editIcons },
    { type: "icon-row", id: "neoview-folder-open-row", label: "打开", children: openIcons },
    { type: "separator" },
    {
      id: "neoview-folder-toggle-bookmark",
      label: "添加/移除书签",
      icon: <BookmarkPlus />,
      disabled: unavailable || !options.canBookmark,
      onSelect: () => options.onAction("toggle-bookmark", entry),
    },
    {
      id: "neoview-folder-edit-metadata",
      label: "编辑标签与评分",
      icon: <Tags />,
      disabled: unavailable || !options.canEditMetadata,
      onSelect: () => options.onAction("edit-metadata", entry),
    },
    ...(options.canPinTree
      ? [{
          id: "neoview-folder-pin-tree",
          label: options.treePinned ? "取消置顶（文件树）" : "置顶到文件树",
          icon: options.treePinned ? <PinOff /> : <Pin />,
          disabled: unavailable,
          onSelect: options.onToggleTreePin,
        } satisfies ContextMenuItemDef]
      : []),
    ...(entry.kind === "directory"
      ? [{
          id: "neoview-folder-dissolve",
          label: "解散当前文件夹",
          icon: <FolderInput />,
          disabled: unavailable,
          confirm: {
            title: "解散当前文件夹？",
            description: `“${entry.name}”中的内容将移到上级目录，随后删除该文件夹。可通过 Dissolvef 操作历史撤销。`,
            confirmLabel: "解散当前文件夹",
            cancelLabel: "取消",
          },
          onSelect: () => options.onAction("dissolve", entry),
        } satisfies ContextMenuItemDef]
      : []),
    { type: "separator" },
    {
      type: "submenu",
      id: "neoview-folder-open-more",
      label: "打开方式",
      icon: <ExternalLink />,
      children: openMore,
    },
    {
      type: "submenu",
      id: "neoview-folder-copy-info",
      label: "复制信息",
      icon: <Copy />,
      children: [
        { id: "neoview-folder-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", entry) },
        { id: "neoview-folder-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", entry) },
      ],
    },
    {
      id: "neoview-folder-refresh",
      label: "刷新当前目录",
      icon: <RefreshCw />,
      disabled: unavailable || !options.canRefresh,
      onSelect: () => options.onAction("refresh", entry),
    },
    {
      id: "neoview-folder-reload-thumbnail",
      label: "重载缩略图",
      icon: <RefreshCw />,
      disabled: unavailable || !options.canReloadThumbnail,
      onSelect: () => options.onAction("reload-thumbnail", entry),
    },
    // Permanent delete stays a full-row destructive action for discoverability;
    // recycle-bin trash lives in the icon toolbar (Neo layout).
    deleteItem,
    { type: "separator" },
    { id: "neoview-folder-entry-name", type: "label", label: entry.name },
  ]
}

/** Walk icon-rows / submenus to find a nested item by id (for tests and capability checks). */
export function findFolderContextMenuItem(
  items: readonly ContextMenuItemDef[],
  id: string,
): ContextMenuItemDef | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children?.length) {
      const nested = findFolderContextMenuItem(item.children, id)
      if (nested) return nested
    }
  }
  return undefined
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

function sameTreePinPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
  return normalize(left) === normalize(right)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
