import { BookOpen, Copy, ExternalLink, FileText, FolderOpen, PanelsTopLeft } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"

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
  onActivate,
  onOpenInNewTab,
  onOpenAsBook,
}: {
  client: ReaderHttpClient
  disabled: boolean
  copyText?: (text: string) => Promise<void>
  onActivate(entry: FolderContextEntry): void | Promise<void>
  onOpenInNewTab(path: string): void
  onOpenAsBook?: (path: string) => void | Promise<void>
}) {
  const operationRef = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()

  useEffect(() => () => operationRef.current?.abort(), [])

  async function run(action: FolderContextAction, entry: FolderContextEntry) {
    if (pending) return
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

  useContextMenuBuilder("neoview-folder-entry", ({ data }) => {
    const entry = folderContextEntry(data)
    return entry ? buildFolderContextMenuItems(entry, {
      disabled,
      pending,
      canCopyText: Boolean(copyText),
      canOpenSystem: Boolean(client.openSystemPath),
      canReveal: Boolean(client.revealSystemPath),
      canOpenAsBook: Boolean(onOpenAsBook),
      onAction: run,
    }) : null
  })

  if (!feedback) return null
  return <div role={feedback.kind} className={feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>{feedback.text}</div>
}

type FolderContextAction = "activate" | "new-tab" | "open-as-book" | "system-open" | "reveal" | "copy-path" | "copy-name"

export function buildFolderContextMenuItems(
  entry: FolderContextEntry,
  options: {
    disabled: boolean
    pending: boolean
    canCopyText: boolean
    canOpenSystem: boolean
    canReveal: boolean
    canOpenAsBook: boolean
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
    { id: "neoview-folder-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", entry) },
    { id: "neoview-folder-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", entry) },
    { type: "separator" },
    { id: "neoview-folder-entry-name", type: "label", label: entry.name },
  )
  return items
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
  if (action === "new-tab") return `已在新标签页中打开 ${entry.name}`
  if (action === "open-as-book") return `已作为书籍打开 ${entry.name}`
  return `已打开 ${entry.name}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
