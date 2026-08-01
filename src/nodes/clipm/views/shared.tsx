import type { ComponentType } from "react"
import type { LucideProps } from "lucide-react"
import { CheckCircle2, FileArchive, Folder, Terminal, TriangleAlert } from "lucide-react"
import type { WorkScoreFailure, WorkScoreResult } from "@xiranite/node-clipm/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { fileName } from "../workspace-state"

export type Icon = ComponentType<LucideProps>

export function ViewHeading(props: { icon: Icon; title: string; detail: string; actions?: React.ReactNode }) {
  const Icon = props.icon
  return <div className="flex min-h-11 shrink-0 items-center gap-3 border-b bg-muted/20 px-3 py-2">
    <Icon className="size-4 text-primary" />
    <div className="min-w-0 flex-1">
      <h4 className="text-sm font-semibold">{props.title}</h4>
      <p className="truncate text-[11px] text-muted-foreground">{props.detail}</p>
    </div>
    {props.actions}
  </div>
}

export function IconButton(props: {
  icon: Icon
  label: string
  disabled?: boolean
  variant?: React.ComponentProps<typeof Button>["variant"]
  onClick(): Promise<void> | void
}) {
  const Icon = props.icon
  return <Tooltip><TooltipTrigger asChild>
    <Button aria-label={props.label} size="icon-sm" variant={props.variant ?? "outline"} disabled={props.disabled} onClick={() => void props.onClick()}><Icon /></Button>
  </TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase()
  const variant = normalized === "failed" || normalized === "error" || normalized === "rejected"
    ? "destructive"
    : normalized === "active" || normalized === "accepted" || normalized === "healthy"
      ? "default"
      : "outline"
  return <Badge variant={variant}>{value}</Badge>
}

export function WorkScoreTable({ works }: { works: WorkScoreResult[] }) {
  return <ScrollArea className="min-h-0 min-w-0 flex-1">
    <Table className="min-w-[620px] text-xs">
      <TableHeader><TableRow><TableHead className="w-24">偏好</TableHead><TableHead>作品</TableHead><TableHead className="w-24">模型</TableHead><TableHead className="w-28">元数据</TableHead></TableRow></TableHeader>
      <TableBody>{works.length ? works.map((work) => <TableRow key={work.workId} data-testid={`clipm-work-${work.workId}`}>
        <TableCell><PreferenceScore label={work.label} score={work.score} /></TableCell>
        <TableCell><div className="flex min-w-0 items-center gap-2">{isArchive(work.path) ? <FileArchive className="size-4 shrink-0 text-cyan-600" /> : <Folder className="size-4 shrink-0 text-amber-600" />}<div className="min-w-0"><div className="truncate font-medium" title={work.path}>{fileName(work.path)}</div><div className="truncate font-mono text-[10px] text-muted-foreground" title={work.path}>{work.path}</div></div></div></TableCell>
        <TableCell><div className="font-mono">v{work.bundleVersion}</div><div className="font-mono text-[10px] text-muted-foreground">{work.shortCode}</div></TableCell>
        <TableCell><StatusBadge value={work.metadataWriteStatus ?? "skipped"} /></TableCell>
      </TableRow>) : <EmptyTable colSpan={4} label="暂无评分结果" />}</TableBody>
    </Table>
  </ScrollArea>
}

export function FailureTable({ failures }: { failures: WorkScoreFailure[] }) {
  return <ScrollArea className="min-h-0 flex-1"><div className="grid gap-2 p-3">
    {failures.length ? failures.map((failure) => <div key={`${failure.path}:${failure.errorType}`} className="border border-destructive/40 p-2 text-xs">
      <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-destructive" />{fileName(failure.path)}</div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{failure.errorType}</div>
      <div className="mt-1 break-all text-destructive">{failure.message}</div>
    </div>) : <div className="grid min-h-40 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" />没有评分失败</span></div>}
  </div></ScrollArea>
}

export function LogsPanel({ logs }: { logs?: string[] }) {
  return <div className="flex min-h-0 flex-col border-t bg-muted/10">
    <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium"><Terminal className="size-3.5" />运行记录</div>
    <ScrollArea className="h-28 px-3 pb-3"><pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-muted-foreground">{logs?.join("\n") || "READY"}</pre></ScrollArea>
  </div>
}

export function PreferenceScore({ label, score }: { label: "P" | "N"; score: number }) {
  return <div className={cn("flex w-fit items-center gap-2 border-l-2 pl-2", label === "P" ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : "border-rose-500 text-rose-700 dark:text-rose-400")}>
    <span className="text-sm font-semibold">{label}</span><span className="font-mono text-base font-semibold tabular-nums">{score}</span>
  </div>
}

function EmptyTable({ colSpan, label }: { colSpan: number; label: string }) {
  return <TableRow><TableCell colSpan={colSpan} className="h-40 text-center text-muted-foreground">{label}</TableCell></TableRow>
}

function isArchive(path: string): boolean {
  return /\.(?:zip|cbz|7z|cb7|rar|cbr)$/i.test(path)
}
