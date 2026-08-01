import { Check, ClipboardCheck, FolderSearch, RefreshCw, Save, ShieldQuestion, Trash2 } from "lucide-react"
import type { ReviewResolution } from "@xiranite/node-clipm/contracts"
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
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { fileName } from "../workspace-state"
import { FeedbackHistoryView } from "./FeedbackHistoryView"
import { PreferenceScore, StatusBadge, ViewHeading } from "./shared"

export function CorrectionsView({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running, patch } = controller
  const reviewItems = data.reviewItems ?? []
  const selected = reviewItems.find((item) => item.reviewId === data.selectedReviewId)
  const recovery = data.recoveryStatus
  const strongestObservation = recovery?.observations?.[0]

  async function scanFeedback() {
    const response = await controller.run({ action: "feedback-scan", path: data.path })
    if (response?.success) await controller.refreshCorrections()
  }

  async function applyFeedback() {
    const response = await controller.run({
      action: "feedback-apply",
      workId: data.feedbackWorkId,
      classification: data.feedbackClassification,
      ranking: data.feedbackRanking,
      source: "gui",
    })
    if (response?.success) await controller.refreshCorrections()
  }

  async function resolveReview() {
    if (!selected) return
    const response = await controller.run({
      action: "review-resolve",
      reviewId: selected.reviewId,
      resolution: data.reviewResolution ?? "use_filename",
      existingWorkId: (data.reviewResolution ?? "use_filename") === "link_existing" ? data.reviewExistingWorkId : undefined,
    })
    if (response?.success) await controller.refreshCorrections()
  }

  async function removeMetadata() {
    const response = await controller.run({
      action: "work-remove-metadata",
      path: data.metadataRemovalPath,
    })
    if (response?.success) await controller.refreshCorrections()
  }

  return <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto @5xl/clipm:grid-cols-[minmax(320px,0.82fr)_minmax(500px,1.4fr)] @5xl/clipm:overflow-hidden">
    <section className="flex min-h-[540px] min-w-0 flex-col border-r @5xl/clipm:min-h-0">
      <ViewHeading icon={ClipboardCheck} title="修正输入" detail="扫描文件名变化，或按作品 ID 写入独立的 P/N 与数值评分" />
      <div className="grid gap-4 p-3">
        <div className="grid gap-2 border-b pb-4">
          <label className="text-xs font-medium" htmlFor="clipm-feedback-path">扫描路径</label>
          <div className="flex gap-2"><Input id="clipm-feedback-path" aria-label="修正扫描路径" className="font-mono text-xs" value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} /><Button size="sm" variant="outline" disabled={running || !data.path?.trim()} onClick={() => void scanFeedback()}><FolderSearch />扫描修正</Button></div>
          {data.feedbackScan ? <div className="grid grid-cols-3 divide-x border text-center text-xs"><Count label="扫描" value={data.feedbackScan.scannedWorkCount} /><Count label="同步" value={data.feedbackScan.synchronizedWorkCount} /><Count label="导入" value={data.feedbackScan.importedFeedbackCount} /></div> : null}
        </div>

        <div className="grid gap-3">
          <label className="text-xs font-medium" htmlFor="clipm-feedback-work">作品 ID</label>
          <Input id="clipm-feedback-work" aria-label="修正作品 ID" className="font-mono text-xs" value={data.feedbackWorkId ?? ""} disabled={running} onChange={(event) => patch({ feedbackWorkId: event.currentTarget.value })} />
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <span className="text-xs font-medium">偏好</span>
            <ToggleGroup aria-label="人工偏好" type="single" value={data.feedbackClassification} variant="selection" size="sm" className="grid w-full grid-cols-2" disabled={running} onValueChange={(value) => value && patch({ feedbackClassification: value as "P" | "N" })}>
              <ToggleGroupItem value="P" className="min-w-0 data-[state=on]:!border-emerald-600 data-[state=on]:!bg-emerald-600 data-[state=on]:!text-white dark:data-[state=on]:!border-emerald-400 dark:data-[state=on]:!bg-emerald-400 dark:data-[state=on]:!text-emerald-950">P 喜欢</ToggleGroupItem>
              <ToggleGroupItem value="N" className="min-w-0 data-[state=on]:!border-rose-600 data-[state=on]:!bg-rose-600 data-[state=on]:!text-white dark:data-[state=on]:!border-rose-400 dark:data-[state=on]:!bg-rose-400 dark:data-[state=on]:!text-rose-950">N 不喜欢</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3"><label className="text-xs font-medium" htmlFor="clipm-feedback-ranking">评分</label><Input id="clipm-feedback-ranking" aria-label="人工评分" type="number" min={0} max={1000} step={1} value={data.feedbackRanking ?? ""} disabled={running} onChange={(event) => patch({ feedbackRanking: event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value) })} /></div>
          <Button disabled={running || !data.feedbackWorkId?.trim() || (data.feedbackClassification === undefined && data.feedbackRanking === undefined)} onClick={() => void applyFeedback()}><Save />保存人工修正</Button>
          {data.feedbackApply ? <div className="flex items-center justify-between gap-3 border px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-medium">{fileName(data.feedbackApply.work.path)}</div><div className="font-mono text-[10px] text-muted-foreground">{data.feedbackApply.work.workId}</div></div><PreferenceScore label={data.feedbackApply.work.label} score={data.feedbackApply.work.score} /></div> : null}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <label className="text-xs font-medium" htmlFor="clipm-remove-metadata-path">移除 CM 元数据</label>
          <Input id="clipm-remove-metadata-path" aria-label="移除元数据作品路径" className="font-mono text-xs" placeholder="单本漫画路径" value={data.metadataRemovalPath ?? ""} disabled={running} onChange={(event) => patch({ metadataRemovalPath: event.currentTarget.value })} />
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" disabled={running || !data.metadataRemovalPath?.trim()}><Trash2 />移除 CM 元数据</Button></AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader><AlertDialogTitle>移除这本作品的 CM 元数据？</AlertDialogTitle><AlertDialogDescription>将删除 ClipM 数据库身份、根元数据和文件名后缀。作品内容不会被删除。</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={running} onClick={() => void removeMetadata()}><Trash2 />确认移除</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {data.metadataRemovalResult ? <div className="truncate border px-3 py-2 font-mono text-[10px] text-muted-foreground" title={data.metadataRemovalResult.finalPath}>{data.metadataRemovalResult.finalPath}</div> : null}
        </div>
      </div>
    </section>

    <div className="grid min-h-[720px] min-w-0 grid-rows-[minmax(280px,0.9fr)_minmax(360px,1.1fr)] @5xl/clipm:min-h-0">
      <FeedbackHistoryView controller={controller} />
      <section className="flex min-h-0 min-w-0 flex-col border-t">
        <ViewHeading icon={ShieldQuestion} title="冲突审核" detail="身份冲突必须选择明确事实源后才能继续写入" actions={<div className="flex items-center gap-1.5"><NativeSelect aria-label="审核状态" size="sm" value={data.reviewStatus ?? "pending"} onChange={(event) => patch({ reviewStatus: event.currentTarget.value as "pending" | "resolved", reviewItems: undefined })}><NativeSelectOption value="pending">待处理</NativeSelectOption><NativeSelectOption value="resolved">已处理</NativeSelectOption></NativeSelect><Button aria-label="刷新恢复证据" title="刷新恢复证据" size="icon-sm" variant="ghost" disabled={running} onClick={() => void controller.run({ action: "recovery-status", recoveryLimit: 25 })}><RefreshCw /></Button></div>} />
        {recovery ? <div data-testid="clipm-recovery-status" className="grid shrink-0 grid-cols-[auto_auto_minmax(0,1fr)] items-stretch divide-x border-b bg-muted/10 text-xs">
          <Count label="页级覆盖" value={recovery.embeddedWorkCount} />
          <Count label="相似观察" value={recovery.observationCount} />
          <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2"><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-medium">感知候选</span><Badge variant={recovery.candidateGenerationEnabled ? "default" : "outline"}>{recovery.candidateGenerationEnabled ? "已启用" : "校准中"}</Badge></div><div className="truncate text-[10px] text-muted-foreground">{strongestObservation ? `最高 ${strongestObservation.meanSimilarity.toFixed(4)} / ${strongestObservation.matchedPageCount} 页共识` : "等待真实评分积累页级证据"}</div></div><span className="shrink-0 font-mono text-[10px]">{recovery.threshold === null || recovery.threshold === undefined ? "阈值 --" : `阈值 ${recovery.threshold.toFixed(4)}`}</span></div>
        </div> : null}
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <Table className="min-w-[680px] text-xs"><TableHeader><TableRow><TableHead className="w-16">选择</TableHead><TableHead className="w-36">类型</TableHead><TableHead>路径</TableHead><TableHead className="w-24">状态</TableHead></TableRow></TableHeader><TableBody>
            {reviewItems.length ? reviewItems.map((item) => <TableRow key={item.reviewId} data-state={item.reviewId === data.selectedReviewId ? "selected" : undefined}><TableCell><Button aria-label={`选择审核 ${item.reviewId}`} size="icon-xs" variant={item.reviewId === data.selectedReviewId ? "default" : "outline"} onClick={() => patch({ selectedReviewId: item.reviewId })}>{item.reviewId === data.selectedReviewId ? <Check /> : <ShieldQuestion />}</Button></TableCell><TableCell><Badge variant="outline">{item.kind}</Badge></TableCell><TableCell><div className="truncate font-medium" title={item.path}>{fileName(item.path)}</div><div className="truncate font-mono text-[10px] text-muted-foreground" title={item.path}>{item.path}</div></TableCell><TableCell><StatusBadge value={item.status} /></TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-40 text-center text-muted-foreground">当前队列为空</TableCell></TableRow>}
          </TableBody>
          </Table>
        </ScrollArea>
        <div className="grid shrink-0 gap-2 border-t bg-muted/10 p-3 @3xl/clipm:grid-cols-[minmax(180px,0.8fr)_minmax(220px,1fr)_auto]">
          <NativeSelect aria-label="审核解决方式" value={data.reviewResolution ?? "use_filename"} disabled={!selected || running} onChange={(event) => patch({ reviewResolution: event.currentTarget.value as ReviewResolution })}><NativeSelectOption value="use_filename">采用文件名修正</NativeSelectOption><NativeSelectOption value="use_json">采用根目录 JSON</NativeSelectOption><NativeSelectOption value="link_existing">关联已有作品</NativeSelectOption><NativeSelectOption value="new_work">作为新作品</NativeSelectOption></NativeSelect>
          <Input aria-label="关联作品 ID" className="font-mono text-xs" placeholder="existing work ID" disabled={!selected || running || (data.reviewResolution ?? "use_filename") !== "link_existing"} value={data.reviewExistingWorkId ?? ""} onChange={(event) => patch({ reviewExistingWorkId: event.currentTarget.value })} />
          <Button disabled={!selected || running || ((data.reviewResolution ?? "use_filename") === "link_existing" && !data.reviewExistingWorkId?.trim())} onClick={() => void resolveReview()}><Check />确认处理</Button>
        </div>
      </section>
    </div>
  </div>
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="px-2 py-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="font-mono text-base font-semibold tabular-nums">{value}</div></div>
}
