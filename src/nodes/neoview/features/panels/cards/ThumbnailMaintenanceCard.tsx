/**
 * @migrated-from src/lib/cards/properties/ThumbnailMaintenanceCard.svelte
 * @source-hash sha256:cf84c01530d011d23b609559c6b97a3ebc421d38fa000f744572b7d191481b72
 * @migrated-from src/lib/components/panels/emm/ThumbnailDbMaintenanceCard.svelte
 * @source-hash sha256:44efe1d10d1d1cb7bd2b0d6a27d9929876041b842ae1222dac617c007bdd8677
 * @migration-status adapted
 */
import { Clock, Database, FolderX, Loader2, RefreshCcw, ShieldX, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  ReaderThumbnailCleanupCommandDto,
  ReaderThumbnailCleanupResultDto,
  ReaderThumbnailMaintenanceSnapshotDto,
} from "../../../adapters/reader-http-client"
import { ReaderHttpError } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"

const DEFAULT_LIMIT = 500
const DEFAULT_SCAN_LIMIT = 500

type Operation = "refresh" | "invalid" | "empty" | "expired" | "failures"
type Feedback = { tone: "success" | "warning" | "error"; text: string }

export default function ThumbnailMaintenanceCard({ client, panelActive = true, disabled }: ReaderPanelContext) {
  const [snapshot, setSnapshot] = useState<ReaderThumbnailMaintenanceSnapshotDto>()
  const [operation, setOperation] = useState<Operation>()
  const [expireDays, setExpireDays] = useState(30)
  const [feedback, setFeedback] = useState<Feedback>()
  const controllerRef = useRef<AbortController>()
  const generationRef = useRef(0)

  useEffect(() => {
    if (!panelActive || disabled) return
    if (!client.thumbnailMaintenance) {
      setFeedback(unavailableFeedback())
      return
    }
    const controller = new AbortController()
    const generation = ++generationRef.current
    controllerRef.current = controller
    setOperation("refresh")
    setFeedback(undefined)
    void client.thumbnailMaintenance(controller.signal).then((value) => {
      if (generation === generationRef.current) setSnapshot(value)
    }).catch((error: unknown) => {
      if (generation === generationRef.current && !controller.signal.aborted) {
        setFeedback({ tone: "error", text: maintenanceError(error) })
      }
    }).finally(() => {
      if (generation === generationRef.current) setOperation(undefined)
    })
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = undefined
    }
  }, [client, disabled, panelActive])

  useEffect(() => {
    if (!disabled || !operation) return
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = undefined
    setOperation(undefined)
  }, [disabled, operation])

  if (!panelActive) return null

  function cancelOperation() {
    if (!operation) return
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = undefined
    setOperation(undefined)
    setFeedback({ tone: "warning", text: "缁存姢鎿嶄綔宸插彇娑堝師" })
  }

  async function refresh() {
    if (!client.thumbnailMaintenance) return setFeedback(unavailableFeedback())
    await run("refresh", (signal) => client.thumbnailMaintenance!(signal), (value) => {
      setSnapshot(value)
      return "统计信息已刷新"
    })
  }

  async function cleanup(command: ReaderThumbnailCleanupCommandDto) {
    if (!client.cleanupThumbnails) return setFeedback(unavailableFeedback())
    await run(command.kind, (signal) => client.cleanupThumbnails!(command, signal), cleanupMessage)
  }

  async function clearFailures() {
    if (!client.clearThumbnailFailures) return setFeedback(unavailableFeedback())
    await run("failures", (signal) => client.clearThumbnailFailures!(DEFAULT_LIMIT, signal), (deleted) => `已清除 ${deleted} 条失败记录`)
  }

  async function run<T>(kind: Operation, request: (signal: AbortSignal) => Promise<T>, message: (value: T) => string) {
    if (operation) return
    const controller = new AbortController()
    const generation = ++generationRef.current
    controllerRef.current?.abort()
    controllerRef.current = controller
    setOperation(kind)
    setFeedback(undefined)
    try {
      const value = await request(controller.signal)
      if (generation !== generationRef.current) return
      const successMessage = message(value)
      setFeedback({ tone: "success", text: successMessage })
      if (kind !== "refresh" && client.thumbnailMaintenance) {
        try {
          setSnapshot(await client.thumbnailMaintenance(controller.signal))
        } catch (error) {
          if (generation === generationRef.current && !controller.signal.aborted) {
            setFeedback({ tone: "warning", text: `${successMessage}；统计刷新失败：${maintenanceError(error)}` })
          }
        }
      }
    } catch (error) {
      if (generation === generationRef.current && !controller.signal.aborted) {
        setFeedback({ tone: "error", text: maintenanceError(error) })
      }
    } finally {
      if (generation === generationRef.current) setOperation(undefined)
    }
  }

  const busy = disabled || operation !== undefined
  const failedRows = snapshot?.failedRows ?? 0
  return (
    <div className="space-y-4 text-xs" data-neoview-thumbnail-maintenance="true">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <Database className="size-4 shrink-0" aria-hidden="true" />
          <span>缩略图数据库维护</span>
        </div>
        {operation ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            data-testid="thumbnail-maintenance-cancel"
            aria-label="Cancel maintenance operation"
            title="Cancel maintenance operation"
            onClick={cancelOperation}
          >
            <X className="size-3.5" aria-hidden="true" />
            <span>Cancel</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={busy}
          aria-label="刷新缩略图数据库统计"
          title="刷新统计"
          onClick={() => void refresh()}
        >
          {operation === "refresh" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
        </Button>
      </div>

      {snapshot ? <MaintenanceStatistics snapshot={snapshot} /> : operation === "refresh" && !feedback ? (
        <div className="grid grid-cols-2 gap-2" aria-label="正在加载缩略图数据库统计">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded bg-muted" />)}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={feedback.tone === "success"
            ? "rounded bg-emerald-500/10 p-2 text-emerald-700"
            : feedback.tone === "warning"
              ? "rounded bg-amber-500/10 p-2 text-amber-700"
              : "rounded bg-destructive/10 p-2 text-destructive"}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.text}
        </div>
      ) : null}

      <section className="space-y-2" aria-labelledby="thumbnail-invalid-heading">
        <h3 id="thumbnail-invalid-heading" className="font-medium">清理无效记录</h3>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={FolderX} disabled={busy} onClick={() => void cleanup({ kind: "invalid", scanLimit: DEFAULT_SCAN_LIMIT, limit: DEFAULT_LIMIT })}>无效路径</ActionButton>
          <ActionButton icon={Trash2} disabled={busy} onClick={() => void cleanup({ kind: "empty", limit: DEFAULT_LIMIT })}>空 Blob</ActionButton>
        </div>
        <ActionButton icon={ShieldX} disabled={busy || failedRows === 0} destructive onClick={() => void clearFailures()}>
          清除失败记录 ({failedRows.toLocaleString()})
        </ActionButton>
      </section>

      <section className="space-y-2 border-t pt-3" aria-labelledby="thumbnail-expired-heading">
        <h3 id="thumbnail-expired-heading" className="font-medium">清理过期条目</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="thumbnail-expire-days" className="shrink-0">超过</Label>
          <Input
            id="thumbnail-expire-days"
            type="number"
            min={1}
            max={3650}
            value={expireDays}
            disabled={busy}
            className="h-8 w-24"
            onChange={(event) => setExpireDays(clampDays(event.currentTarget.valueAsNumber))}
          />
          <span className="text-muted-foreground">天</span>
        </div>
        <p className="text-[10px] text-muted-foreground">始终保留文件夹缩略图。</p>
        <ActionButton icon={Clock} disabled={busy} onClick={() => void cleanup({ kind: "expired", days: expireDays, limit: DEFAULT_LIMIT, preserveFolders: true })}>
          清理过期条目
        </ActionButton>
      </section>

      <p className="border-t pt-3 text-[10px] leading-relaxed text-muted-foreground">
        在线维护仅执行有界清理。数据库压缩、备份、恢复和路径规范化请使用需要确认的离线维护命令。
      </p>
    </div>
  )
}

function MaintenanceStatistics({ snapshot }: { snapshot: ReaderThumbnailMaintenanceSnapshotDto }) {
  const hasDatabaseSize = snapshot.databaseBytes !== undefined || snapshot.walBytes !== undefined || snapshot.shmBytes !== undefined
  const databaseBytes = hasDatabaseSize
    ? (snapshot.databaseBytes ?? 0) + (snapshot.walBytes ?? 0) + (snapshot.shmBytes ?? 0)
    : undefined
  return (
    <div className="space-y-2" aria-label="缩略图数据库统计">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="总条目" value={snapshot.totalRows.toLocaleString()} />
        <Metric label="文件夹" value={snapshot.folderRows.toLocaleString()} />
        <Metric label="数据库" value={formatBytes(databaseBytes)} />
        <Metric label="失败记录" value={snapshot.failedRows.toLocaleString()} danger={snapshot.failedRows > 0} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>文件 {snapshot.fileRows.toLocaleString()}</span>
        <span>空 Blob {snapshot.emptyBlobs.toLocaleString()}</span>
        <span>Blob {formatBytes(snapshot.blobBytes)}</span>
        <span>Database {formatBytes(snapshot.databaseBytes)}</span>
        <span>WAL {formatBytes(snapshot.walBytes)}</span>
        <span>SHM {formatBytes(snapshot.shmBytes)}</span>
        <span>待写入 {snapshot.writer.pendingWrites.toLocaleString()}</span>
        <span>Writer {snapshot.writer.flushing ? "写入中" : "空闲"}</span>
        <span>忙重试 {snapshot.writer.busyRetries.toLocaleString()}</span>
      </div>
      {Object.keys(snapshot.failuresByReason).length ? (
        <p className="break-words text-[10px] text-muted-foreground">
          失败分类 {Object.entries(snapshot.failuresByReason).map(([reason, count]) => `${reason} ${count}`).join("，")}
        </p>
      ) : null}
    </div>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={danger ? "mt-1 font-semibold tabular-nums text-destructive" : "mt-1 font-semibold tabular-nums"}>{value}</div>
    </div>
  )
}

function ActionButton({ icon: Icon, destructive = false, ...props }: {
  icon: typeof Trash2
  destructive?: boolean
  disabled: boolean
  children: ReactNode
  onClick(): void
}) {
  return (
    <Button type="button" variant="outline" size="sm" className={destructive ? "w-full gap-1.5 text-destructive hover:text-destructive" : "w-full gap-1.5"} data-testid={Icon === FolderX ? "thumbnail-maintenance-invalid" : undefined} {...props}>
      <Icon className="size-3.5" aria-hidden="true" />
      {props.children}
    </Button>
  )
}

function cleanupMessage(value: ReaderThumbnailCleanupResultDto): string {
  if (value.kind === "invalid") {
    const wrapped = value.wrapped ? "，扫描游标已回绕" : ""
    return `已扫描 ${value.scanned} 条，删除 ${value.deleted} 条，保留不可用卷 ${value.unavailableVolumeRowsPreserved} 条${wrapped}`
  }
  if (value.kind === "expired") return `已删除 ${value.deleted} 条过期记录（截止 ${value.cutoff}）`
  return `已删除 ${value.deleted} 条空 Blob 记录`
}

function maintenanceError(error: unknown): string {
  if (error instanceof ReaderHttpError && error.status === 501) return "当前后端未启用缩略图维护"
  if (error instanceof ReaderHttpError && error.status === 503) return "缩略图数据库正忙，请稍后重试"
  return "缩略图维护失败，请重试"
}

function unavailableFeedback(): Feedback {
  return { tone: "error", text: "当前后端未启用缩略图维护" }
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3650, Math.max(1, Math.trunc(value)))
}

function formatBytes(value: number | undefined): string {
  if (!Number.isFinite(value) || value === undefined || value < 0) return "--"
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(2)} MB`
  return `${(value / 1_073_741_824).toFixed(2)} GB`
}
