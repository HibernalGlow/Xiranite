import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { useContextMenu, useContextMenuBuilder } from "@/components/context-menu"
import { publishReaderLibraryMutation } from "../../../library/reader-library-mutations"
import type { ReaderFileUndoResultDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderDirectorySelectionDescriptorDto } from "../../../../adapters/reader-http-client"
import type { ReaderFolderConfirmationConfig } from "../../../../adapters/reader-http-client"
import type { ReaderFolderMigrationTarget } from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
import { useFolderClipboard } from "./FolderClipboard"
import type { FolderCatalogUpdater } from "./FolderEmmEditor"
import { runDissolvefFolder } from "./FolderDissolvefAction"
import {
  migrateFolderEntryToDirectory,
  migrateFolderEntryToPickedDirectory,
} from "./FolderMigratefAction"
import { createOptimisticFolderDeletion } from "./FolderOptimisticDeletion"
import {
  buildDeleteContextMenuItem,
  buildFolderContextMenuItems,
  buildTrashContextMenuItem,
  type FolderContextAction,
  type FolderContextEntry,
} from "./FolderContextMenuItems"

export {
  buildDeleteContextMenuItem,
  buildFolderContextMenuItems,
  buildTrashContextMenuItem,
  findFolderContextMenuItem,
} from "./FolderContextMenuItems"
export type { FolderContextEntry } from "./FolderContextMenuItems"

const FolderRenameDialog = lazy(() => import("./FolderRenameDialog"))
const FolderEmmEditor = lazy(() => import("./FolderEmmEditor"))
const FolderMigrationTargetsDialog = lazy(() => import("./FolderMigrationTargetsDialog"))
const ClassfBlacklistQuickAddDialog = lazy(() => import("@/nodes/classf/ClassfBlacklistQuickAddDialog"))

export default function FolderContextActions({
  client,
  disabled,
  copyText,
  sessionId,
  generation,
  currentPath,
  currentSourceKind,
  pickDirectory,
  migrationTargets = [],
  onMigrationTargetsChange,
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
  pickDirectory?: () => Promise<string | undefined>
  migrationTargets?: readonly ReaderFolderMigrationTarget[]
  onMigrationTargetsChange?(targets: ReaderFolderMigrationTarget[]): void | Promise<void>
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
  const [classfBlacklistEntry, setClassfBlacklistEntry] = useState<FolderContextEntry>()
  const [migrationTargetsOpen, setMigrationTargetsOpen] = useState(false)

  useEffect(() => () => operationRef.current?.abort(), [])

  async function migrateEntry(entry: FolderContextEntry, targetPath?: string) {
    if (!targetPath && !pickDirectory) return
    setPending(true)
    setFeedback(undefined)
    try {
      const migrationFeedback = targetPath
        ? await migrateFolderEntryToDirectory({
            sourcePath: entry.path,
            sourceName: entry.name,
            targetPath,
            onMigrated: onRefreshDirectory,
          })
        : await migrateFolderEntryToPickedDirectory({
            sourcePath: entry.path,
            sourceName: entry.name,
            pickDirectory: pickDirectory!,
            onMigrated: onRefreshDirectory,
          })
      if (migrationFeedback) {
        setFeedback(migrationFeedback)
        switchToast?.show({ title: migrationFeedback.text })
      }
    } finally {
      setPending(false)
    }
  }

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
    if (action === "add-classf-blacklist") {
      setClassfBlacklistEntry(entry)
      return
    }
    if (action === "manage-migration-targets") {
      setMigrationTargetsOpen(true)
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
    if (action === "migrate-picker") {
      await migrateEntry(entry)
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
      canMigrate: Boolean(pickDirectory || migrationTargets.length),
      canPickMigrationDirectory: Boolean(pickDirectory),
      canManageMigrationTargets: Boolean(pickDirectory && onMigrationTargetsChange),
      migrationTargets,
      treePinned: entry.kind === "directory" && treePinnedPaths.some((path) => sameTreePinPath(path, entry.path)),
      onAction: run,
      onMigrateTarget: (targetEntry, target) => migrateEntry(targetEntry, target.path),
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
      {classfBlacklistEntry ? (
        <Suspense fallback={null}>
          <ClassfBlacklistQuickAddDialog
            sourceName={classfBlacklistEntry.name}
            copySourceName={copyText}
            onClose={() => setClassfBlacklistEntry(undefined)}
            onSaved={({ addedCount, totalCount }) => {
              const message = addedCount ? `已加入 ${addedCount} 个 ClassF 黑名单关键词` : "ClassF 黑名单关键词已存在"
              setFeedback({ kind: "status", text: `${message}（共 ${totalCount} 个）` })
              switchToast?.show({ title: message })
            }}
          />
        </Suspense>
      ) : null}
      {migrationTargetsOpen && pickDirectory && onMigrationTargetsChange ? (
        <Suspense fallback={null}>
          <FolderMigrationTargetsDialog
            targets={migrationTargets}
            pickDirectory={pickDirectory}
            onSave={onMigrationTargetsChange}
            onClose={() => setMigrationTargetsOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
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
