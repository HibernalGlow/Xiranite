import { BookOpen, Copy, ExternalLink, FileText, FolderOpen, Star, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import type { ReaderBookmarkDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"

export type BookmarkContextAction = "open" | "system-open" | "reveal" | "copy-path" | "copy-name" | "toggle-star" | "remove"

export default function BookmarkContextActions({
  client,
  disabled,
  items,
  copyText,
  onOpen,
  onToggleStar,
  onRemove,
}: {
  client: ReaderHttpClient
  disabled: boolean
  items: readonly ReaderBookmarkDto[]
  copyText?: (text: string) => Promise<void>
  onOpen?(item: ReaderBookmarkDto): void | Promise<void>
  onToggleStar(item: ReaderBookmarkDto): void | Promise<void>
  onRemove(item: ReaderBookmarkDto): void | Promise<void>
}) {
  const operationRef = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()

  useEffect(() => () => operationRef.current?.abort(), [])

  async function run(action: BookmarkContextAction, item: ReaderBookmarkDto) {
    if (pending) return
    const operation = new AbortController()
    operationRef.current?.abort()
    operationRef.current = operation
    setPending(true)
    setFeedback(undefined)
    try {
      if (action === "open") {
        if (!onOpen) throw new Error("当前 Reader 不支持打开此书签。")
        await onOpen(item)
      }
      else if (action === "system-open") {
        if (!client.openSystemPath) throw new Error("当前后端不支持使用默认软件打开。")
        await client.openSystemPath(item.source.path, operation.signal)
      } else if (action === "reveal") {
        if (!client.revealSystemPath) throw new Error("当前后端不支持在资源管理器中显示。")
        await client.revealSystemPath(item.source.path, operation.signal)
      } else if (action === "copy-path" || action === "copy-name") {
        if (!copyText) throw new Error("当前宿主不支持复制文本。")
        await copyText(action === "copy-path" ? item.source.path : item.name)
      } else if (action === "toggle-star") await onToggleStar(item)
      else await onRemove(item)
      operation.signal.throwIfAborted()
      setFeedback({ kind: "status", text: feedbackText(action, item) })
    } catch (error) {
      if (!operation.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined
        setPending(false)
      }
    }
  }

  useContextMenuBuilder("neoview-bookmark-entry", ({ data }) => {
    const item = items.find((candidate) => candidate.id === data.bookmarkContextId)
    return item ? buildBookmarkContextMenuItems(item, {
      disabled,
      pending,
      canOpen: Boolean(onOpen),
      canCopyText: Boolean(copyText),
      canOpenSystem: Boolean(client.openSystemPath),
      canReveal: Boolean(client.revealSystemPath),
      onAction: run,
    }) : null
  })

  return feedback ? (
    <div role={feedback.kind} className={feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>
      {feedback.text}
    </div>
  ) : null
}

export function buildBookmarkContextMenuItems(
  item: ReaderBookmarkDto,
  options: {
    disabled: boolean
    pending: boolean
    canOpen: boolean
    canCopyText: boolean
    canOpenSystem: boolean
    canReveal: boolean
    onAction(action: BookmarkContextAction, item: ReaderBookmarkDto): void | Promise<void>
  },
): ContextMenuItemDef[] {
  const unavailable = options.disabled || options.pending
  return [
    { id: "neoview-bookmark-open", label: "打开", icon: <BookOpen />, disabled: unavailable || !options.canOpen, onSelect: () => options.onAction("open", item) },
    { id: "neoview-bookmark-system-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: unavailable || !options.canOpenSystem, onSelect: () => options.onAction("system-open", item) },
    { id: "neoview-bookmark-reveal", label: "在资源管理器中显示", icon: <FolderOpen />, disabled: unavailable || !options.canReveal, onSelect: () => options.onAction("reveal", item) },
    { type: "separator" },
    { id: "neoview-bookmark-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", item) },
    { id: "neoview-bookmark-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", item) },
    { type: "separator" },
    { id: "neoview-bookmark-toggle-star", label: item.starred ? "取消收藏" : "收藏", icon: <Star />, disabled: unavailable, onSelect: () => options.onAction("toggle-star", item) },
    {
      id: "neoview-bookmark-remove",
      label: "删除书签",
      icon: <Trash2 />,
      destructive: true,
      disabled: unavailable,
      confirm: {
        title: "删除书签？",
        description: `“${item.name}”将从书签库移除，源文件不会被删除。`,
        confirmLabel: "删除书签",
        cancelLabel: "取消",
      },
      onSelect: () => options.onAction("remove", item),
    },
    { type: "separator" },
    { id: "neoview-bookmark-entry-name", type: "label", label: item.name },
  ]
}

function feedbackText(action: BookmarkContextAction, item: ReaderBookmarkDto): string {
  if (action === "copy-path") return `已复制 ${item.name} 的路径`
  if (action === "copy-name") return `已复制名称 ${item.name}`
  if (action === "reveal") return `已在资源管理器中定位 ${item.name}`
  if (action === "toggle-star") return item.starred ? `已取消收藏 ${item.name}` : `已收藏 ${item.name}`
  if (action === "remove") return `已删除书签 ${item.name}`
  return `已打开 ${item.name}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
