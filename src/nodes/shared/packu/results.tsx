import type {
  CommandResult,
  PackuCommandPlan,
  PackuConfigSummary,
  PackuDatabaseRecord,
  PackuIntegrationProfile,
  PackuToolData,
} from "@xiranite/packu-node-runtime/core"
import type { LucideIcon } from "lucide-react"
import { Copy, ScrollText, Settings2, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function PackuStatsPanel({ result }: { result: PackuToolData | null }) {
  const stats = [
    ["选中", result?.selectedPaths.length ?? 0],
    ["归档", 0],
    ["配置键", result?.config?.keys.length ?? 0],
    ["错误", result?.errors.length ?? 0],
  ] as const

  return (
    <div data-testid="packu-stats-panel" className="grid shrink-0 grid-cols-4 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function PackuResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: PackuToolData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasCommand = Boolean(props.result?.command?.command)
  const hasConfig = Boolean(props.result?.config?.keys.length)
  const preferredTab = props.running ? "logs" : hasCommand ? "command" : hasConfig ? "integration" : "logs"
  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="command">命令</TabsTrigger>
        <TabsTrigger value="integration">集成</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="command" className="min-h-0 flex-1">
        <CommandPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="integration" className="min-h-0 flex-1">
        <IntegrationPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function CommandPanel(props: {
  compact?: boolean
  result: PackuToolData | null
  onCopy: () => void
}) {
  const command: PackuCommandPlan | undefined = props.result?.command
  const commandResult: CommandResult | undefined = props.result?.commandResult
  const hasCommand = Boolean(command?.command)
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={hasCommand ? 1 : 0} icon={Terminal} label="命令" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {hasCommand && command ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            <CommandRow plan={command} result={commandResult} />
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={Terminal} title="等待命令" description="运行计划或状态检查后会显示命令。" />
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

function IntegrationPanel(props: {
  compact?: boolean
  result: PackuToolData | null
  onCopy: () => void
}) {
  const integration: PackuIntegrationProfile | undefined = props.result?.integration
  const config: PackuConfigSummary | undefined = props.result?.config
  const database: PackuDatabaseRecord | undefined = props.result?.database
  const rows: Array<{ label: string; value: string }> = []
  if (integration) {
    rows.push({ label: "源码目录", value: integration.sourceRoot })
    rows.push({ label: "模块名", value: integration.moduleName })
    for (const candidate of integration.configCandidates) {
      rows.push({ label: "配置候选", value: candidate })
    }
    if (integration.databasePath) rows.push({ label: "数据库路径", value: integration.databasePath })
    if (integration.databaseLabel) rows.push({ label: "数据库标签", value: integration.databaseLabel })
    rows.push({ label: "记录运行", value: integration.recordRun ? "是" : "否" })
  }
  if (config) {
    rows.push({ label: "配置文件", value: config.path })
    rows.push({ label: "配置键", value: config.keys.join(", ") })
    rows.push({ label: "配置表", value: config.tables.join(", ") })
  }
  if (database) {
    rows.push({ label: "数据库启用", value: database.enabled ? "是" : "否" })
    rows.push({ label: "数据库模式", value: database.mode })
  }
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={rows.length} icon={Settings2} label="集成" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {rows.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {rows.map((row, index) => (
              <IntegrationRow key={`${row.label}-${index}`} label={row.label} value={row.value} />
            ))}
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={Settings2} title="等待集成" description="运行状态检查后会显示源码目录、模块名和配置候选。" />
        )}
      </ScrollArea>
    </section>
  )
}

function IntegrationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-[11px]" title={value}>{value || "—"}</div>
    </div>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: LucideIcon
  lines: string[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.lines.length} icon={props.icon} label="日志" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 text-xs leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <EmptyState compact={props.compact} icon={props.icon} title="等待日志" description={props.emptyText} />
        )}
      </ScrollArea>
    </section>
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
          <span>{props.count ? `${props.count} 项${props.label}` : `等待${props.label}`}</span>
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
