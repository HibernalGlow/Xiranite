import { History, RefreshCw, Undo2 } from "lucide-react"
import type { FeedbackEventRecord } from "@xiranite/node-clipm/contracts"
import { useMemo } from "react"
import { localSourceThumbnailClient } from "@/backend/sourceThumbnailClient"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SourceThumbnailSurface } from "@/nodes/shared/SourceThumbnailSurface"
import { useSourceThumbnails } from "@/nodes/shared/useSourceThumbnails"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { fileName } from "../workspace-state"
import { IconButton, ViewHeading } from "./shared"

export function FeedbackHistoryView({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running } = controller
  const events = data.feedbackEvents ?? []
  const thumbnailItems = useMemo(() => events
    .filter((event): event is FeedbackEventRecord & { currentPath: string } => Boolean(event.currentPath))
    .slice(0, 64)
    .map((event) => ({ id: event.eventId, path: event.currentPath, kind: "file" as const })), [events])
  const thumbnailIds = useMemo(() => new Set(thumbnailItems.map((item) => item.id)), [thumbnailItems])
  const thumbnails = useSourceThumbnails(localSourceThumbnailClient, "clipm:recent-corrections", thumbnailItems)

  async function undoFeedback(eventId: string) {
    const response = await controller.run({ action: "feedback-undo", eventId, source: "gui" })
    if (response?.success) await controller.refreshCorrections()
  }

  return <section className="flex min-h-0 min-w-0 flex-col">
    <ViewHeading
      icon={History}
      title="最近修正"
      detail="查看修正链并安全恢复当前仍生效的事件"
      actions={<IconButton icon={RefreshCw} label="刷新修正与审核" disabled={running} onClick={controller.refreshCorrections} />}
    />
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <Table className="min-w-[680px] text-xs">
        <TableHeader><TableRow><TableHead>作品</TableHead><TableHead className="w-44">变更</TableHead><TableHead className="w-36">来源与时间</TableHead><TableHead className="w-24">操作</TableHead></TableRow></TableHeader>
        <TableBody>{events.length ? events.map((event) => <FeedbackEventRow key={event.eventId} event={event} thumbnailUrl={thumbnails.urls.get(event.eventId)} thumbnailLoading={thumbnails.loading && thumbnailIds.has(event.eventId)} running={running} onUndo={undoFeedback} />) : <TableRow><TableCell colSpan={4} className="h-36 text-center text-muted-foreground">暂无修正记录</TableCell></TableRow>}</TableBody>
      </Table>
    </ScrollArea>
  </section>
}

function FeedbackEventRow({
  event,
  thumbnailUrl,
  thumbnailLoading,
  running,
  onUndo,
}: {
  event: FeedbackEventRecord
  thumbnailUrl?: string
  thumbnailLoading: boolean
  running: boolean
  onUndo(eventId: string): Promise<void>
}) {
  const workLabel = event.currentPath ? fileName(event.currentPath) : event.workId
  return <TableRow data-testid={`clipm-feedback-${event.eventId}`}>
    <TableCell><div className="flex min-w-0 items-center gap-2"><SourceThumbnailSurface url={thumbnailUrl} alt={`${workLabel} 缩略图`} loading={thumbnailLoading} className="size-12 rounded-sm" /><div className="min-w-0"><div className="max-w-64 truncate font-medium" title={event.currentPath ?? event.workId}>{workLabel}</div><div className="max-w-64 truncate font-mono text-[10px] text-muted-foreground">{event.workId}</div></div></div></TableCell>
    <TableCell className="font-mono tabular-nums">{feedbackChanges(event).map((change) => <div key={change}>{change}</div>)}</TableCell>
    <TableCell><Badge variant="outline">{event.source}</Badge><div className="mt-1 whitespace-nowrap text-[10px] text-muted-foreground">{formatDateTime(event.occurredAt)}</div></TableCell>
    <TableCell>{event.undoneBy
      ? <Badge variant="outline">已撤销</Badge>
      : event.currentPath && event.undoApplicable
        ? <UndoFeedbackButton event={event} running={running} onUndo={onUndo} />
        : <Badge variant="outline">{event.currentPath ? "已被后续修正覆盖" : "作品已移除"}</Badge>}
    </TableCell>
  </TableRow>
}

function UndoFeedbackButton({ event, running, onUndo }: { event: FeedbackEventRecord; running: boolean; onUndo(eventId: string): Promise<void> }) {
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button aria-label={`撤销修正 ${event.eventId}`} title="撤销此修正" size="icon-xs" variant="outline" disabled={running}><Undo2 /></Button></AlertDialogTrigger>
    <AlertDialogContent size="sm">
      <AlertDialogHeader><AlertDialogTitle>撤销这次修正？</AlertDialogTitle><AlertDialogDescription>将恢复 {fileName(event.currentPath ?? event.workId)} 的上一组有效值，并同步文件名与根元数据。</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={running} onClick={() => void onUndo(event.eventId)}><Undo2 />确认撤销</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function feedbackChanges(event: FeedbackEventRecord): string[] {
  const changes: string[] = []
  if (event.classificationAfter != null) changes.push(`P/N ${event.classificationBefore ?? "--"} -> ${event.classificationAfter}`)
  if (event.rankingAfter != null) changes.push(`评分 ${event.rankingBefore ?? "--"} -> ${event.rankingAfter}`)
  return changes
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value))
}
