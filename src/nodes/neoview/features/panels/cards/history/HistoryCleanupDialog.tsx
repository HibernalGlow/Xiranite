import { CalendarDays, FolderOpen, Hash, SearchX, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ReaderHttpClient, ReaderRecentCleanupRequestDto } from "../../../../adapters/reader-http-client"

type CleanupAction =
  | { kind: "invalid"; label: string }
  | { kind: "recent"; label: string; request: ReaderRecentCleanupRequestDto }

export default function HistoryCleanupDialog({ open, client, pickDirectory, onOpenChange, onCompleted }: {
  open: boolean
  client: ReaderHttpClient
  pickDirectory?: () => Promise<string | undefined>
  onOpenChange(open: boolean): void
  onCompleted(result: { deleted: number; message: string }): void
}) {
  const [oldestCount, setOldestCount] = useState("10")
  const [olderThanDays, setOlderThanDays] = useState("30")
  const [folderPath, setFolderPath] = useState("")
  const [confirmation, setConfirmation] = useState<CleanupAction>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const requestRef = useRef<AbortController>()

  useEffect(() => () => requestRef.current?.abort(), [])

  function changeOpen(next: boolean) {
    if (!next) requestRef.current?.abort()
    onOpenChange(next)
  }

  function confirmOldest() {
    const limit = boundedInteger(oldestCount, 1, 500)
    if (!limit) return setError("最旧记录数量必须是 1 到 500 的整数。")
    setConfirmation({ kind: "recent", label: `删除最旧的 ${limit} 条历史记录`, request: { kind: "oldest", limit } })
  }

  function confirmBefore() {
    const days = boundedInteger(olderThanDays, 1, 36_500)
    if (!days) return setError("天数必须是 1 到 36500 的整数。")
    setConfirmation({
      kind: "recent",
      label: `删除 ${days} 天以前的历史记录`,
      request: { kind: "before", before: Date.now() - days * 86_400_000, limit: 500 },
    })
  }

  function confirmFolder() {
    const path = folderPath.trim()
    if (!path) return setError("请输入或选择文件夹路径。")
    setConfirmation({ kind: "recent", label: `删除文件夹“${path}”下的历史记录`, request: { kind: "folder", path } })
  }

  async function chooseFolder() {
    if (!pickDirectory) return
    const selected = await pickDirectory()
    if (selected) setFolderPath(selected)
  }

  async function execute() {
    if (!confirmation) return
    const action = confirmation
    setConfirmation(undefined)
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setPending(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const result = action.kind === "invalid"
        ? await client.cleanupInvalidLibrary?.("recents", controller.signal)
        : await client.cleanupRecents?.(action.request, controller.signal)
      if (!result) throw new Error("当前后端不支持历史清理。")
      const successMessage = action.kind === "invalid"
        ? `已扫描 ${result.scanned} 条，删除 ${result.deleted} 条失效记录。`
        : `清理完成，删除 ${result.deleted} 条历史记录。`
      setMessage(successMessage)
      onCompleted({ deleted: result.deleted, message: successMessage })
      onOpenChange(false)
    } catch (cause) {
      if (controller.signal.aborted) setMessage("清理已取消。")
      else setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestRef.current === controller) requestRef.current = undefined
      setPending(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-md overflow-y-auto" data-neoview-history-cleanup="true">
          <DialogHeader>
            <DialogTitle>高级清理历史记录</DialogTitle>
            <DialogDescription>按旧版规则清理历史记录。所有操作只删除记录，不删除源文件。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <CleanupRow icon={<SearchX />} label="清理失效路径" description="检查已加载范围内不存在的源路径。">
              <Button type="button" variant="secondary" disabled={pending || !client.cleanupInvalidLibrary} onClick={() => setConfirmation({ kind: "invalid", label: "检查并删除失效的历史记录" })}>执行</Button>
            </CleanupRow>

            <CleanupRow icon={<Hash />} label="清理最旧记录" description="一次最多删除 500 条。">
              <Input className="w-24" type="number" min={1} max={500} value={oldestCount} aria-label="最旧记录数量" onChange={(event) => setOldestCount(event.target.value)} />
              <Button type="button" variant="secondary" disabled={pending} onClick={confirmOldest}>执行</Button>
            </CleanupRow>

            <CleanupRow icon={<CalendarDays />} label="按时间清理" description="删除指定天数以前的记录。">
              <Input className="w-24" type="number" min={1} max={36_500} value={olderThanDays} aria-label="历史记录保留天数" onChange={(event) => setOlderThanDays(event.target.value)} />
              <Button type="button" variant="secondary" disabled={pending} onClick={confirmBefore}>执行</Button>
            </CleanupRow>

            <div className="grid gap-2 rounded border p-3">
              <div className="flex items-center gap-2 font-medium"><FolderOpen className="size-4" />按文件夹清理</div>
              <p className="text-[10px] text-muted-foreground">删除该文件夹及其子路径的历史记录。</p>
              <div className="flex min-w-0 gap-2">
                <Input className="min-w-0 flex-1" value={folderPath} aria-label="历史清理文件夹路径" placeholder="输入或选择文件夹路径" onChange={(event) => setFolderPath(event.target.value)} />
                {pickDirectory ? <Button type="button" size="icon-sm" variant="outline" aria-label="选择历史清理文件夹" disabled={pending} onClick={() => void chooseFolder()}><FolderOpen /></Button> : null}
                <Button type="button" variant="secondary" disabled={pending || !folderPath.trim()} onClick={confirmFolder}>执行</Button>
              </div>
            </div>

            <Button type="button" variant="destructive" disabled={pending} onClick={() => setConfirmation({ kind: "recent", label: "清空全部历史记录", request: { kind: "all", confirmed: true } })}>
              <Trash2 />清空全部历史记录
            </Button>
          </div>

          {pending ? (
            <div className="flex items-center justify-between rounded border bg-muted/30 p-2 text-xs" aria-live="polite">
              <span>正在清理历史记录…</span>
              <Button type="button" size="sm" variant="outline" aria-label="取消清理" onClick={() => requestRef.current?.abort()}><X />取消</Button>
            </div>
          ) : null}
          {message ? <div className="rounded bg-emerald-500/10 p-2 text-xs text-emerald-700" role="status">{message}</div> : null}
          {error ? <div className="rounded bg-destructive/10 p-2 text-xs text-destructive" role="alert">{error}</div> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmation)} onOpenChange={(next) => { if (!next && !pending) setConfirmation(undefined) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清理历史记录</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.label}？此操作不可撤销，但不会删除源文件。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={pending} variant="destructive" onClick={(event) => { event.preventDefault(); void execute() }}>确认清理</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CleanupRow({ icon, label, description, children }: { icon: ReactNode; label: string; description: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 rounded border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">{icon}{label}</div>
        <p className="mt-1 text-[10px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center justify-end gap-2">{children}</div>
    </div>
  )
}

function boundedInteger(value: string, minimum: number, maximum: number): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined
}
