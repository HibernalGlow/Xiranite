import type {
  CommandResult,
  PackuCommandPlan,
  PackuConfigSummary,
  PackuDatabaseRecord,
  PackuToolData,
} from "@xiranite/packu-node-runtime/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Copy, Gauge, KeyRound, ScrollText, Settings2, Terminal, Video } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type StatItem = {
  label: string
  value: number
  icon: LucideIcon
  accent: string
  suffix?: string
}

export function BitvStatsDashboard(props: {
  result: PackuToolData | null
  progress: number
  compact?: boolean
}) {
  const items: StatItem[] = [
    { label: "视频数", value: props.result?.selectedPaths.length ?? 0, icon: Video, accent: "text-chart-1" },
    { label: "配置键", value: props.result?.config?.keys.length ?? 0, icon: KeyRound, accent: "text-chart-2" },
    { label: "错误", value: props.result?.errors.length ?? 0, icon: AlertTriangle, accent: "text-destructive" },
    { label: "进度", value: props.progress ?? 0, icon: Gauge, accent: "text-chart-4", suffix: "%" },
  ]

  if (props.compact) {
    return (
      <div data-testid="bitv-stats-dashboard" className="grid shrink-0 grid-cols-2 gap-1.5">
        {items.map((item) => (
          <CompactStatCard key={item.label} item={item} />
        ))}
      </div>
    )
  }

  return (
    <div data-testid="bitv-stats-dashboard" className="grid shrink-0 grid-cols-2 gap-2 @4xl/bitv:grid-cols-4">
      {items.map((item) => (
        <StatCard key={item.label} item={item} progress={item.label === "进度" ? props.progress : undefined} />
      ))}
    </div>
  )
}

function StatCard({ item, progress }: { item: StatItem; progress?: number }) {
  const Icon = item.icon
  const isError = item.label === "错误" && item.value > 0
  return (
    <div className="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border bg-gradient-to-br from-background/90 to-muted/40 p-3 shadow-sm">
      <div className="pointer-events-none absolute -right-3 -top-3 opacity-[0.07]">
        <Icon className="size-20" />
      </div>
      <div className="relative flex items-center gap-1.5">
        <div className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-muted/60", item.accent)}>
          <Icon className="size-4" />
        </div>
        <span className="truncate text-xs font-medium text-muted-foreground">{item.label}</span>
      </div>
      <div className="relative flex items-baseline gap-0.5">
        <span className={cn("text-2xl font-bold tabular-nums leading-none", isError && "text-destructive")}>
          {item.value}
        </span>
        {item.suffix && <span className="text-sm font-semibold text-muted-foreground">{item.suffix}</span>}
      </div>
      {progress !== undefined && (
        <Progress value={progress} className="h-1.5" />
      )}
    </div>
  )
}

function CompactStatCard({ item }: { item: StatItem }) {
  const Icon = item.icon
  const isError = item.label === "错误" && item.value > 0
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/70 px-2.5 py-2">
      <div className={cn("grid size-6 shrink-0 place-items-center rounded-md bg-muted/60", item.accent)}>
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-muted-foreground">{item.label}</div>
        <div className={cn("text-base font-bold tabular-nums leading-tight", isError && "text-destructive")}>
          {item.value}{item.suffix}
        </div>
      </div>
    </div>
  )
}

export function BitvCommandPreview(props: {
  result: PackuToolData | null
  onCopy: () => void
}) {
  const command: PackuCommandPlan | undefined = props.result?.command
  const commandResult: CommandResult | undefined = props.result?.commandResult
  const hasCommand = Boolean(command?.command)
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={hasCommand ? 1 : 0} icon={Terminal} label="命令预览" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {hasCommand && command ? (
          <div className="grid gap-2 p-3">
            <CommandRow plan={command} result={commandResult} />
            <IntegrationSummary result={props.result} />
          </div>
        ) : (
          <EmptyState icon={Terminal} title="等待命令" description="运行生成计划后会显示命令预览。" />
        )}
      </ScrollArea>
    </section>
  )
}

function CommandRow({ plan, result }: { plan: PackuCommandPlan; result?: CommandResult }) {
  const status = result ? (result.code === 0 ? "success" : "error") : "planned"
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="truncate font-mono text-xs" title={plan.command}>{plan.command}</div>
        <Badge variant={status === "error" ? "destructive" : status === "success" ? "default" : "outline"} className="shrink-0">{status}</Badge>
      </div>
      <div className="truncate font-mono text-[11px] text-muted-foreground" title={plan.args.join(" ")}>
        {plan.label} {"->"} {plan.args.join(" ")}
      </div>
      {result?.stderr ? <div className="truncate font-mono text-[11px] text-destructive" title={result.stderr}>{result.stderr}</div> : null}
    </div>
  )
}

function IntegrationSummary({ result }: { result: PackuToolData | null }) {
  const integration = result?.integration
  if (!integration) return null
  const rows: Array<{ label: string; value: string }> = [
    { label: "源码目录", value: integration.sourceRoot },
    { label: "模块名", value: integration.moduleName },
  ]
  for (const candidate of integration.configCandidates) {
    rows.push({ label: "配置候选", value: candidate })
  }
  if (integration.databasePath) rows.push({ label: "数据库路径", value: integration.databasePath })
  if (integration.databaseLabel) rows.push({ label: "数据库标签", value: integration.databaseLabel })
  return (
    <div className="grid gap-1.5">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
          <span className="shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
          <span className="truncate font-mono text-[11px]" title={row.value}>{row.value || "—"}</span>
        </div>
      ))}
    </div>
  )
}

export function BitvReportLog(props: {
  compact?: boolean
  logs: string[]
  result: PackuToolData | null
  running?: boolean
  onCopy: () => void
}) {
  const config = props.result?.config
  const database = props.result?.database
  const hasConfigInfo = Boolean(config || database)
  return (
    <section data-testid="bitv-report-log" className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.logs.length} icon={ScrollText} label="分析报告" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        <div className={props.compact ? "grid gap-2 p-2" : "grid gap-2 p-3"}>
          {hasConfigInfo && <ConfigReport config={config} database={database} />}
          {props.logs.length ? (
            <pre className={props.compact ? "whitespace-pre-wrap font-mono text-[11px] leading-5 text-muted-foreground" : "whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground"}>
              {props.logs.join("\n")}
            </pre>
          ) : (
            <EmptyState compact={props.compact} icon={ScrollText} title="等待报告" description="码率分析的 stdout/stderr 和日志会显示在这里。" />
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function ConfigReport({ config, database }: { config?: PackuConfigSummary; database?: PackuDatabaseRecord }) {
  const rows: Array<{ label: string; value: string }> = []
  if (config) {
    rows.push({ label: "配置文件", value: config.path })
    rows.push({ label: "配置键", value: config.keys.join(", ") })
    rows.push({ label: "配置表", value: config.tables.join(", ") })
  }
  if (database) {
    rows.push({ label: "数据库启用", value: database.enabled ? "是" : "否" })
    rows.push({ label: "数据库模式", value: database.mode })
  }
  if (!rows.length) return null
  return (
    <div className="grid gap-1.5 rounded-md border border-dashed bg-muted/20 p-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Settings2 className="size-3" />
        配置摘要
      </div>
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="flex min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
          <span className="truncate font-mono text-[11px]" title={row.value}>{row.value || "—"}</span>
        </div>
      ))}
    </div>
  )
}

function PanelHeader(props: {
  count: number
  icon: LucideIcon
  label: string
  onCopy: () => void
}) {
  const Icon = props.icon
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.label}</span>
        </div>
        <Button disabled={!props.count} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
    </>
  )
}

function EmptyState(props: { compact?: boolean; icon: LucideIcon; title: string; description: string }) {
  const Icon = props.icon
  return (
    <div className={props.compact ? "flex h-full min-h-20 items-center justify-center p-4 text-center text-xs text-muted-foreground" : "flex h-full min-h-28 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
      <span className="flex flex-col items-center gap-1.5">
        <Icon className="size-4" />
        <span className="font-medium text-foreground/80">{props.title}</span>
        <span>{props.description}</span>
      </span>
    </div>
  )
}
