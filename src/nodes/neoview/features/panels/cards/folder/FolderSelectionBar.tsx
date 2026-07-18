import { Ban, CheckSquare, ClipboardPaste, Copy, Link, LoaderCircle, MousePointer2, Scissors, Square, SquareX, Trash, Trash2, Undo2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useContextMenu } from "@/components/context-menu"
import type {
  ReaderDirectorySelectionDescriptorDto,
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderFileUndoStateDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
import { useFolderClipboard } from "./FolderClipboard"

export default function FolderSelectionBar({ client, sessionId, selection, selectedCount, total, currentPath, disabled, chainSelectMode, clickBehavior, switchToast, onSelectAll, onInvert, onToggleChain, onToggleClickBehavior, onClear, onClose, onTrashCompleted, onDeleteCompleted }: {
  client: ReaderHttpClient
  sessionId: string
  selection: ReaderDirectorySelectionDescriptorDto
  selectedCount: number
  total: number
  currentPath: string
  disabled: boolean
  chainSelectMode: boolean
  clickBehavior: "open" | "select"
  switchToast?: ReaderSwitchToastPort
  onSelectAll(): void
  onInvert(): void
  onToggleChain(): void
  onToggleClickBehavior(): void
  onClear(): void
  onClose(): void
  onTrashCompleted(snapshot: ReaderDirectorySelectionOperationSnapshotDto): void | Promise<void>
  onDeleteCompleted?(snapshot: ReaderDirectorySelectionOperationSnapshotDto): void | Promise<void>
}) {
  const clipboard = useFolderClipboard()
  const contextMenu = useContextMenu()
  const completedRef = useRef(onTrashCompleted)
  completedRef.current = onTrashCompleted
  const deleteCompletedRef = useRef(onDeleteCompleted)
  deleteCompletedRef.current = onDeleteCompleted
  const operationKindRef = useRef<"trash" | "delete">("trash")
  const [operation, setOperation] = useState<ReaderDirectorySelectionOperationSnapshotDto>()
  const [undoState, setUndoState] = useState<ReaderFileUndoStateDto>()
  const [undoPending, setUndoPending] = useState(false)
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
          if (operationKindRef.current === "delete") await deleteCompletedRef.current?.(snapshot)
          else await completedRef.current(snapshot)
          if (operationKindRef.current === "trash") void refreshUndoState()
          if (!controller.signal.aborted) {
            const permanent = operationKindRef.current === "delete"
            setFeedback(snapshot.failed > 0
              ? { kind: "alert", text: permanent ? `永久删除 ${snapshot.succeeded} 项，${snapshot.failed} 项失败。` : `移到回收站 ${snapshot.succeeded} 项，${snapshot.failed} 项失败。` }
              : { kind: "status", text: permanent ? `已永久删除 ${snapshot.succeeded} 项。` : `已将 ${snapshot.succeeded} 项移到回收站。` })
            switchToast?.show({
              title: snapshot.failed > 0
                ? permanent ? `永久删除 ${snapshot.succeeded} 项，${snapshot.failed} 项失败。` : `移到回收站 ${snapshot.succeeded} 项，${snapshot.failed} 项失败。`
                : permanent ? `已永久删除 ${snapshot.succeeded} 项。` : `已将 ${snapshot.succeeded} 项移到回收站。`,
            })
          }
        } else if (snapshot.status === "failed") {
          const message = snapshot.error ?? "批量文件操作失败。"
          setFeedback({ kind: "alert", text: message })
          switchToast?.show({ title: message })
        } else if (snapshot.status === "cancelled") {
          const message = `已取消；已处理 ${snapshot.processed} / ${snapshot.total} 项。`
          setFeedback({ kind: "status", text: message })
          switchToast?.show({ title: message })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = errorMessage(error)
          setFeedback({ kind: "alert", text: message })
          switchToast?.show({ title: message })
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timeout) clearTimeout(timeout)
    }
  }, [client.directorySelectionOperation, operation?.id])

  async function startDestructiveOperation(kind: "trash" | "delete") {
    if (!client.startDirectorySelectionOperation || selectedCount === 0 || operation?.status === "running") return
    setFeedback(undefined)
    setUndoState(undefined)
    try {
      operationKindRef.current = kind
      setOperation(await client.startDirectorySelectionOperation(sessionId, selection, kind))
    } catch (error) {
      const message = errorMessage(error)
      setFeedback({ kind: "alert", text: message })
      switchToast?.show({ title: message })
    }
  }

  async function cancelOperation() {
    if (!operation || !client.cancelDirectorySelectionOperation) return
    try {
      setOperation(await client.cancelDirectorySelectionOperation(operation.id))
    } catch (error) {
      const message = errorMessage(error)
      setFeedback({ kind: "alert", text: message })
      switchToast?.show({ title: message })
    }
  }

  async function refreshUndoState() {
    if (!client.fileUndoState) return
    try {
      setUndoState(await client.fileUndoState())
    } catch {
      setUndoState(undefined)
    }
  }

  async function undoLatestTrash() {
    if (undoPending || !undoState?.available || !client.undoLatestFileOperations) return
    const controller = new AbortController()
    setUndoPending(true)
    setFeedback(undefined)
    try {
      const result = await client.undoLatestFileOperations(true, controller.signal)
      if (result.failed > 0) throw new Error(`撤销完成 ${result.succeeded} 项，${result.failed} 项失败。`)
      const completed = operation
      if (completed) await completedRef.current(completed)
      setUndoState(undefined)
      const message = `已撤销 ${result.succeeded} 项回收站操作`
      setFeedback({ kind: "status", text: message })
      switchToast?.show({ title: message })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error)
        setFeedback({ kind: "alert", text: `撤销失败：${message}` })
        switchToast?.show({ title: `撤销失败：${message}` })
      }
    } finally {
      setUndoPending(false)
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
          <>
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
              onSelect: () => { void startDestructiveOperation("trash") },
            })}
          >
            <Trash2 />
          </Action>
          <Action
            label="永久删除所选项目"
            className="text-destructive hover:text-destructive"
            disabled={disabled || selectedCount === 0 || !contextMenu || !client.startDirectorySelectionOperation || !client.directorySelectionOperation}
            onClick={() => contextMenu?.confirm({
              id: "neoview-folder-delete-selection",
              label: `永久删除 ${selectedCount} 个项目`,
              icon: <Trash />,
              destructive: true,
              confirm: {
                title: `永久删除 ${selectedCount} 个项目？`,
                description: "操作会在后台分批执行，删除后无法从回收站恢复；可以在多选栏中查看进度或取消。",
                confirmLabel: "永久删除",
                cancelLabel: "取消",
              },
              onSelect: () => { void startDestructiveOperation("delete") },
            })}
          ><Trash /></Action>
          {undoState?.available && client.undoLatestFileOperations ? (
            <Action
              label="撤销上次移到回收站"
              disabled={disabled || undoPending}
              onClick={() => { void undoLatestTrash() }}
            ><Undo2 /></Action>
          ) : null}
          </>
        )}
        <Action label="取消全部选择" disabled={disabled || running || selectedCount === 0} onClick={onClear}><SquareX /></Action>
        <Action label="关闭多选模式" disabled={running} onClick={onClose}>{running ? <LoaderCircle className="animate-spin" /> : <X />}</Action>
      </div>
      {feedback ? <span role={feedback.kind} className={feedback.kind === "alert" ? "text-xs text-destructive" : "sr-only"}>{feedback.text}</span> : null}
    </div>
  )
}

function Action({ label, disabled = false, pressed, className, onClick, children }: { label: string; disabled?: boolean; pressed?: boolean; className?: string; onClick(): void; children: ReactNode }) {
  return (
    <Button type="button" size="icon-sm" variant={pressed ? "default" : "ghost"} className={className} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
