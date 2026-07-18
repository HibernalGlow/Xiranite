import { Copy, ExternalLink, FolderOpen, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import type { ReaderHttpClient, ReaderPageCopyActionDto } from "../../../../adapters/reader-http-client"

export default function PageListContextActions({ client, sessionId, disabled, copyFiles, onGoTo }: {
  client: ReaderHttpClient
  sessionId: string
  disabled: boolean
  copyFiles?: (paths: string[]) => Promise<void>
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  const actionRef = useRef<AbortController>()
  const clipboardLeaseRef = useRef<{ sessionId: string; token: string }>()
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    clipboardLeaseRef.current = undefined
    return () => actionRef.current?.abort()
  }, [sessionId])

  async function runAction(action: "copy" | "reveal" | "open", pageId: string, pageName: string) {
    if (!client.pageAction || pending) return
    const operation = new AbortController()
    actionRef.current?.abort()
    actionRef.current = operation
    setPending(true)
    setFeedback(undefined)
    try {
      const result = await client.pageAction(sessionId, pageId, action, operation.signal)
      if (action === "copy") {
        if (!result || !("path" in result) || !result.path || !copyFiles) throw new Error("当前宿主不支持复制页面文件。")
        await commitPageClipboardCopy(result, {
          sessionId,
          signal: operation.signal,
          leaseRef: clipboardLeaseRef,
          copyFiles,
          releaseLease: client.releasePageActionLease,
        })
      }
      operation.signal.throwIfAborted()
      setFeedback({
        kind: "status",
        text: action === "copy" ? `已复制 ${pageName}` : action === "reveal" ? `已定位 ${pageName}` : `已打开 ${pageName}`,
      })
    } catch (error) {
      if (!operation.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      if (actionRef.current === operation) {
        actionRef.current = undefined
        setPending(false)
      }
    }
  }

  useContextMenuBuilder("neoview-page-list", ({ data }) => buildPageListContextMenuItems(data, {
    disabled,
    actionUnavailable: pending || !client.pageAction,
    canCopy: Boolean(copyFiles),
    onGoTo,
    onAction: runAction,
  }))

  if (!feedback) return null
  return <div role={feedback.kind} className={feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>{feedback.text}</div>
}

export function buildPageListContextMenuItems(
  data: Record<string, string>,
  options: {
    disabled: boolean
    actionUnavailable: boolean
    canCopy: boolean
    onGoTo(pageIndex: number): void | Promise<void>
    onAction(action: "copy" | "reveal" | "open", pageId: string, pageName: string): void | Promise<void>
  },
): ContextMenuItemDef[] | null {
  const pageId = data.pageId
  const pageIndex = Number(data.pageIndex)
  const pageName = data.pageName
  if (!pageId || !pageName || !Number.isSafeInteger(pageIndex)) return null
  const actionDisabled = options.disabled || options.actionUnavailable
  return [
    {
      id: "neoview-page-copy",
      label: "复制文件",
      icon: <Copy />,
      disabled: actionDisabled || !options.canCopy,
      onSelect: () => options.onAction("copy", pageId, pageName),
    },
    { type: "separator" },
    { id: "neoview-page-go-to", label: "跳转到此页", icon: <Play />, disabled: options.disabled, onSelect: () => options.onGoTo(pageIndex) },
    { id: "neoview-page-reveal", label: "在资源管理器中显示", icon: <FolderOpen />, disabled: actionDisabled, onSelect: () => options.onAction("reveal", pageId, pageName) },
    { id: "neoview-page-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: actionDisabled, onSelect: () => options.onAction("open", pageId, pageName) },
    { type: "separator" },
    { id: "neoview-page-name", type: "label", label: pageName },
  ]
}

export async function commitPageClipboardCopy(
  result: ReaderPageCopyActionDto,
  options: {
    sessionId: string
    signal: AbortSignal
    leaseRef: { current: { sessionId: string; token: string } | undefined }
    copyFiles(paths: string[]): Promise<void>
    releaseLease?: (sessionId: string, leaseToken: string) => Promise<void>
  },
): Promise<void> {
  const nextLease = result.leaseToken ? { sessionId: options.sessionId, token: result.leaseToken } : undefined
  try {
    await options.copyFiles([result.path])
    options.signal.throwIfAborted()
    const previousLease = options.leaseRef.current
    options.leaseRef.current = nextLease
    if (previousLease && (previousLease.sessionId !== nextLease?.sessionId || previousLease.token !== nextLease?.token)) {
      await options.releaseLease?.(previousLease.sessionId, previousLease.token).catch(() => undefined)
    }
  } catch (error) {
    if (nextLease && options.leaseRef.current?.token !== nextLease.token) {
      await options.releaseLease?.(nextLease.sessionId, nextLease.token).catch(() => undefined)
    }
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
