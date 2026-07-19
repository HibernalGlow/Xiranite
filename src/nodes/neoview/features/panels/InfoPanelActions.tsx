import { Copy, FolderOpen, MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenuBuilder, type ContextMenuItemDef } from "@/components/context-menu"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ReaderPanelContext } from "./registry"
import { useReaderMetadata } from "./cards/useReaderMetadata"

export function InfoPanelActions({ context }: { context: ReaderPanelContext }) {
  const session = context.session
  if (!session) return null
  return <ActiveInfoPanelActions context={{ ...context, session }} />
}

function ActiveInfoPanelActions({ context }: { context: ReaderPanelContext & { session: NonNullable<ReaderPanelContext["session"]> } }) {
  const metadata = useReaderMetadata(context.client, context.session.sessionId, context.session.frame.generation)
  const path = metadata.value?.book.sourcePath ?? metadata.value?.page?.displayPath
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const operationRef = useRef<AbortController>()
  useEffect(() => () => operationRef.current?.abort(), [context.session.sessionId, path])

  const unavailable = pending || metadata.loading || Boolean(metadata.error) || !path
  const copyDisabled = unavailable || !context.systemActions?.copyText
  const revealDisabled = unavailable || !context.systemActions?.revealPath

  async function run(action: "copy" | "reveal") {
    if (!path || pending) return
    const operation = new AbortController()
    operationRef.current?.abort()
    operationRef.current = operation
    setPending(true)
    setFeedback(undefined)
    try {
      if (action === "copy") {
        const copyText = context.systemActions?.copyText
        if (!copyText) throw new Error("当前宿主不支持复制路径。")
        await copyText(path)
        setFeedback({ kind: "status", text: "已复制书籍路径" })
      } else {
        const revealPath = context.systemActions?.revealPath
        if (!revealPath) throw new Error("当前宿主不支持系统定位。")
        await revealPath(path, operation.signal)
        setFeedback({ kind: "status", text: "已在文件管理器中定位" })
      }
    } catch (error) {
      if (!operation.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined
        setPending(false)
      }
    }
  }

  const items: ContextMenuItemDef[] = [
    { id: "neoview-info-copy", label: "复制路径", icon: <Copy />, disabled: copyDisabled, onSelect: () => run("copy") },
    { type: "separator" },
    { id: "neoview-info-reveal", label: "在资源管理器中打开", icon: <FolderOpen />, disabled: revealDisabled, onSelect: () => run("reveal") },
  ]
  useContextMenuBuilder("neoview-info", () => items)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="ml-auto size-7" size="icon" variant="ghost" aria-label="信息面板操作"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={copyDisabled} onSelect={() => void run("copy")}><Copy />复制路径</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={revealDisabled} onSelect={() => void run("reveal")}><FolderOpen />在资源管理器中打开</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {feedback ? (
        <span
          className={feedback.kind === "alert" ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}
          role={feedback.kind}
          aria-live="polite"
          data-info-panel-feedback="true"
        >
          {feedback.text}
        </span>
      ) : null}
    </>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
