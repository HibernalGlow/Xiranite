import { Ban, CheckSquare, ClipboardPaste, Copy, Link, LoaderCircle, MousePointer2, Scissors, Square, SquareX, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useContextMenu } from "@/components/context-menu"
import type {
  ReaderDirectorySelectionDescriptorDto,
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import { useFolderClipboard } from "./FolderClipboard"

export default function FolderSelectionBar({ client, sessionId, selection, selectedCount, total, currentPath, disabled, chainSelectMode, clickBehavior, onSelectAll, onInvert, onToggleChain, onToggleClickBehavior, onClear, onClose, onTrashCompleted }: {
  client: ReaderHttpClient
  sessionId: string
  selection: ReaderDirectorySelectionDescriptorDto
  selectedCount: number
  total: number
  currentPath: string
  disabled: boolean
  chainSelectMode: boolean
  clickBehavior: "open" | "select"
  onSelectAll(): void
  onInvert(): void
  onToggleChain(): void
  onToggleClickBehavior(): void
  onClear(): void
  onClose(): void
  onTrashCompleted(snapshot: ReaderDirectorySelectionOperationSnapshotDto): void | Promise<void>
}) {
  const clipboard = useFolderClipboard()
  const contextMenu = useContextMenu()
  const completedRef = useRef(onTrashCompleted)
  completedRef.current = onTrashCompleted
  const [operation, setOperation] = useState<ReaderDirectorySelectionOperationSnapshotDto>()
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()

  useEffect(() => {
    const operationId = operation?.id
    if (!operationId || operation.status !== "running" || !client.directorySelectionOperation) return
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const poll = async () => {
      try {
        const snapshot = await client.directorySelectionOperation!(operationId, controller.signal)
        if (controller.signal.aborted) return
        setOperation(snapshot)
        if (snapshot.status === "running") {
          timeout = setTimeout(() => { void poll() }, 150)
          return
        }
        if (!finished && snapshot.status === "completed") {
          finished = true
          await completedRef.current(snapshot)
          if (!controller.signal.aborted) {
            setFeedback(snapshot.failed > 0
              ? { kind: "alert", text: `已移到回收站 ${snapshot.succeeded} 项，${snapshot.failed} 项失败。` }
              : { kind: "status", text: `已将 ${snapshot.succeeded} 项移到回收站。` })
          }
        } else if (snapshot.status === "failed") {
          setFeedback({ kind: "alert", text: snapshot.error ?? "批量文件操作失败。" })
        } else if (snapshot.status === "cancelled") {
          setFeedback({ kind: "status", text: `已取消；已处理 ${snapshot.processed} / ${snapshot.total} 项。` })
        }
      } catch (error) {
        if (!controller.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timeout) clearTimeout(timeout)
    }
  }, [client.directorySelectionOperation, operation?.id])

  async function startTrash() {
    if (!client.startDirectorySelectionOperation || selectedCount === 0 || operation?.status === "running") return
    setFeedback(undefined)
    try {
      setOperation(await client.startDirectorySelectionOperation(sessionId, selection, "trash"))
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
    }
  }

  async function cancelOperation() {
    if (!operation || !client.cancelDirectorySelectionOperation) return
    try {
      setOperation(await client.cancelDirectorySelectionOperation(operation.id))
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
    }
  }

  const runningClipboard = clipboard.operation?.status === "running"
  const runningTrash = operation?.status === "running"
  const running = runningClipboard || runningTrash
  const activeOperation = runningTrash ? operation : runningClipboard ? clipboard.operation : undefined
  return (
    <div className="flex min-w-0 items-center gap-1 border-y px-1 py-1" data-neoview-folder-selection-bar="true" data-selection-operation={operation?.status}>
      <span className="min-w-[4.5rem] text-xs font-medium tabular-nums">
        {running && activeOperation ? <><span className="text-primary">{activeOperation.processed}</span> / {activeOperation.total}</> : <><span className="text-primary">{selectedCount}</span> / {total}</>}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
        <Action label="选择全部项目" disabled={disabled || running || selectedCount === total} onClick={onSelectAll}><CheckSquare /></Action>
        <Action label="反转选择状态" disabled={disabled || running || total === 0} onClick={onInvert}><Square /></Action>
        <Action label="链接选中模式" disabled={disabled || running} pressed={chainSelectMode} onClick={onToggleChain}><Link /></Action>
        <Button
          type="button"
          size="sm"
          variant={clickBehavior === "select" ? "default" : "ghost"}
          className="h-7 gap-1 px-2 text-xs"
          aria-label={`点击行为：${clickBehavior === "select" ? "点选" : "点开"}`}
          aria-pressed={clickBehavior === "select"}
          title={`点击卡片会${clickBehavior === "select" ? "选中或取消选中" : "打开项目"}`}
          disabled={disabled || running}
          onClick={onToggleClickBehavior}
        >
          <MousePointer2 />{clickBehavior === "select" ? "点选" : "点开"}
        </Button>
        <Action
          label="复制所选项目"
          disabled={disabled || running || selectedCount === 0 || !client.prepareDirectoryClipboard}
          onClick={() => { void clipboard.prepare(sessionId, selection, "copy").catch(() => undefined) }}
        ><Copy /></Action>
        <Action
          label="剪切所选项目"
          disabled={disabled || running || selectedCount === 0 || !client.prepareDirectoryClipboard}
          onClick={() => { void clipboard.prepare(sessionId, selection, "move").catch(() => undefined) }}
        ><Scissors /></Action>
        <Action
          label="粘贴到当前目录"
          disabled={disabled || running || !clipboard.clipboard.available || !client.pasteDirectoryClipboard}
          onClick={() => { void clipboard.paste(currentPath).catch(() => undefined) }}
        ><ClipboardPaste /></Action>
        {running ? (
          <Action
            label="取消批量操作"
            disabled={!client.cancelDirectorySelectionOperation}
            onClick={() => { if (runningTrash) void cancelOperation(); else void clipboard.cancel() }}
          ><Ban /></Action>
        ) : (
          <Action
            label="将所选项目移到回收站"
            disabled={disabled || selectedCount === 0 || !contextMenu || !client.startDirectorySelectionOperation || !client.directorySelectionOperation}
            onClick={() => contextMenu?.confirm({
              id: "neoview-folder-trash-selection",
              label: `将 ${selectedCount} 个项目移到回收站`,
              icon: <Trash2 />,
              destructive: true,
              confirm: {
                title: `将 ${selectedCount} 个项目移到回收站？`,
                description: "操作会在后台分批执行；可以在多选栏中查看进度或取消。",
                confirmLabel: "移到回收站",
                destructive: true,
              },
              onSelect: startTrash,
            })}
          >
            <Trash2 />
          </Action>
        )}
        <Action label="取消全部选择" disabled={disabled || running || selectedCount === 0} onClick={onClear}><SquareX /></Action>
        <Action label="关闭多选模式" disabled={running} onClick={onClose}>{running ? <LoaderCircle className="animate-spin" /> : <X />}</Action>
      </div>
      {feedback ? <span role={feedback.kind} className={feedback.kind === "alert" ? "text-xs text-destructive" : "sr-only"}>{feedback.text}</span> : null}
    </div>
  )
}

function Action({ label, disabled = false, pressed, onClick, children }: { label: string; disabled?: boolean; pressed?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <Button type="button" size="icon-sm" variant={pressed ? "default" : "ghost"} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
