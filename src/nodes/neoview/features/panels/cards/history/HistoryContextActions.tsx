import { BookOpen, BookmarkPlus, Copy, ExternalLink, FileText, FolderOpen, PanelsTopLeft, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import type { ReaderHttpClient, ReaderRecentDto } from "../../../../adapters/reader-http-client"

export type HistoryContextAction = "open" | "browse-folder" | "open-new-tab" | "system-open" | "reveal" | "copy-path" | "copy-name" | "reload-thumbnail" | "add-bookmark" | "remove"

export default function HistoryContextActions({ client, disabled, items, copyText, onOpen, onBrowseFolder, onOpenInNewTab, onReloadThumbnail, onRemove, onChanged }: {
  client: ReaderHttpClient
  disabled: boolean
  items: readonly ReaderRecentDto[]
  copyText?: (text: string) => Promise<void>
  onOpen?(item: ReaderRecentDto): void | Promise<void>
  onBrowseFolder?(item: ReaderRecentDto): void | Promise<void>
  onOpenInNewTab?(item: ReaderRecentDto): void | Promise<void>
  onReloadThumbnail(item: ReaderRecentDto): void | Promise<void>
  onRemove(item: ReaderRecentDto): void | Promise<void>
  onChanged(): void
}) {
  const operationRef = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()

  useEffect(() => () => operationRef.current?.abort(), [])

  async function run(action: HistoryContextAction, item: ReaderRecentDto) {
    if (pending) return
    const operation = new AbortController()
    operationRef.current?.abort()
    operationRef.current = operation
    setPending(true)
    setFeedback(undefined)
    try {
      if (action === "open") {
        if (!onOpen) throw new Error("当前 Reader 不支持打开此历史记录。")
        await onOpen(item)
      } else if (action === "browse-folder") {
        if (!onBrowseFolder) throw new Error("当前 Reader 不支持浏览此历史记录所在文件夹。")
        await onBrowseFolder(item)
      } else if (action === "open-new-tab") {
        if (!onOpenInNewTab) throw new Error("当前 Reader 不支持在新标签页中打开文件夹。")
        await onOpenInNewTab(item)
      } else if (action === "system-open") {
        if (!client.openSystemPath) throw new Error("当前后端不支持使用默认软件打开。")
        await client.openSystemPath(item.source.path, operation.signal)
      } else if (action === "reveal") {
        if (!client.revealSystemPath) throw new Error("当前后端不支持在资源管理器中显示。")
        await client.revealSystemPath(item.source.path, operation.signal)
      } else if (action === "copy-path" || action === "copy-name") {
        if (!copyText) throw new Error("当前宿主不支持复制文本。")
        await copyText(action === "copy-path" ? item.source.path : item.displayName)
      } else if (action === "reload-thumbnail") {
        await onReloadThumbnail(item)
      } else if (action === "add-bookmark") {
        if (!client.saveBookmark) throw new Error("当前后端不支持添加书签。")
        await client.saveBookmark({ source: item.source, name: item.displayName, starred: false, listIds: [] }, operation.signal)
        onChanged()
      } else {
        await onRemove(item)
        onChanged()
      }
      operation.signal.throwIfAborted()
      setFeedback({ kind: "status", text: feedbackText(action, item) })
    } catch (error) {
      if (!operation.signal.aborted) setFeedback({ kind: "alert", text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined
        setPending(false)
      }
    }
  }

  useContextMenuBuilder("neoview-history-entry", ({ data }) => {
    const item = items.find((candidate) => candidate.bookId === data.historyContextId)
    return item ? buildHistoryContextMenuItems(item, {
      disabled,
      pending,
      canOpen: Boolean(onOpen),
      canBrowseFolder: Boolean(onBrowseFolder),
      canOpenInNewTab: Boolean(onOpenInNewTab),
      canCopyText: Boolean(copyText),
      canOpenSystem: Boolean(client.openSystemPath),
      canReveal: Boolean(client.revealSystemPath),
      canBookmark: Boolean(client.saveBookmark),
      onAction: run,
    }) : null
  })

  useEffect(() => setReady(true), [])

  return (
    <>
      {ready ? <span className="sr-only" data-neoview-history-context-actions="ready">历史记录文件操作已就绪</span> : null}
      {feedback ? <div role={feedback.kind} className={feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>{feedback.text}</div> : null}
    </>
  )
}

export function buildHistoryContextMenuItems(item: ReaderRecentDto, options: {
  disabled: boolean
  pending: boolean
  canOpen: boolean
  canBrowseFolder: boolean
  canOpenInNewTab: boolean
  canCopyText: boolean
  canOpenSystem: boolean
  canReveal: boolean
  canBookmark: boolean
  onAction(action: HistoryContextAction, item: ReaderRecentDto): void | Promise<void>
}): ContextMenuItemDef[] {
  const unavailable = options.disabled || options.pending
  const folderItems: ContextMenuItemDef[] = [
    { id: "neoview-history-browse-folder", label: "打开对应文件夹", icon: <FolderOpen />, disabled: unavailable || !options.canBrowseFolder, onSelect: () => options.onAction("browse-folder", item) },
    { id: "neoview-history-open-new-tab", label: "在新标签页打开", icon: <PanelsTopLeft />, disabled: unavailable || !options.canOpenInNewTab, onSelect: () => options.onAction("open-new-tab", item) },
  ]
  return [
    ...folderItems,
    { id: "neoview-history-open", label: "继续阅读", icon: <BookOpen />, disabled: unavailable || !options.canOpen, onSelect: () => options.onAction("open", item) },
    { id: "neoview-history-system-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: unavailable || !options.canOpenSystem, onSelect: () => options.onAction("system-open", item) },
    { id: "neoview-history-reveal", label: "在资源管理器中显示", icon: <FolderOpen />, disabled: unavailable || !options.canReveal, onSelect: () => options.onAction("reveal", item) },
    { type: "separator" },
    { id: "neoview-history-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", item) },
    { id: "neoview-history-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", item) },
    { id: "neoview-history-reload-thumbnail", label: "重新加载缩略图", icon: <RefreshCw />, disabled: unavailable, onSelect: () => options.onAction("reload-thumbnail", item) },
    { id: "neoview-history-add-bookmark", label: "添加书签", icon: <BookmarkPlus />, disabled: unavailable || !options.canBookmark, onSelect: () => options.onAction("add-bookmark", item) },
    { type: "separator" },
    { id: "neoview-history-remove", label: "从历史记录移除", icon: <Trash2 />, destructive: true, disabled: unavailable, confirm: { title: "移除历史记录？", description: `“${item.displayName}”将从阅读历史中移除，源文件不会被删除。`, confirmLabel: "移除历史", cancelLabel: "取消" }, onSelect: () => options.onAction("remove", item) },
    { type: "separator" },
    { id: "neoview-history-entry-name", type: "label", label: item.displayName },
  ]
}

function feedbackText(action: HistoryContextAction, item: ReaderRecentDto): string {
  if (action === "copy-path") return `已复制 ${item.displayName} 的路径`
  if (action === "copy-name") return `已复制名称 ${item.displayName}`
  if (action === "reveal") return `已在资源管理器中定位 ${item.displayName}`
  if (action === "reload-thumbnail") return `已重新加载 ${item.displayName} 的缩略图`
  if (action === "add-bookmark") return `已将 ${item.displayName} 添加到书签`
  if (action === "remove") return `已从历史记录移除 ${item.displayName}`
  return `已打开 ${item.displayName}`
}
