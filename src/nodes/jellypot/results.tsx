import type { CommandResult, JellyPotCheck, JellyPotCommandPlan, JellyPotData } from "@xiranite/node-jellypot/core"
import type { LucideIcon } from "lucide-react"
import { CheckCircle2, ClipboardList, Copy, ScrollText, Terminal, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function JellyPotStatsPanel({ result }: { result: JellyPotData | null }) {
  const commandCount = result?.commandResults.length || result?.commands.length || 0
  const stats = [
    ["检查项", result?.checks.length ?? 0],
    ["通过", result?.checks.filter((item) => item.exists).length ?? 0],
    ["命令", commandCount],
    ["错误", result?.errors.length ?? 0],
  ] as const

  return (
    <div data-testid="jellypot-stats-panel" className="grid shrink-0 grid-cols-4 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "通过" && Number(value) > 0 && "text-green-600 dark:text-green-400", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function JellyPotResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: JellyPotData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasCommands = Boolean(props.result?.commands.length || props.result?.commandResults.length)
  const preferredTab = props.running ? "logs" : props.result?.checks.length ? "checks" : hasCommands ? "commands" : "logs"
  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="checks">检查</TabsTrigger>
        <TabsTrigger value="commands">命令</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="checks" className="min-h-0 flex-1">
        <CheckPanel compact={props.compact} checks={props.result?.checks ?? []} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="commands" className="min-h-0 flex-1">
        <CommandPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function CheckPanel(props: {
  compact?: boolean
  checks: JellyPotCheck[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.checks.length} icon={ClipboardList} label="检查" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.checks.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {props.checks.map((check) => {
              const Icon = check.exists ? CheckCircle2 : TriangleAlert
              return (
                <div key={`${check.name}-${check.path}`} className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium" title={check.name}>
                      <Icon className={cn("size-3.5 shrink-0", check.exists ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")} />
                      {check.name}
                    </div>
                    <Badge variant={check.exists ? "default" : "outline"} className="shrink-0">{check.exists ? "存在" : "缺失"}</Badge>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={check.path}>{check.path}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={ClipboardList} title="等待检查" description="运行状态检查后会显示 PotPlayer、浏览器和注册表路径。" />
        )}
      </ScrollArea>
    </section>
  )
}

function CommandPanel(props: {
  compact?: boolean
  result: JellyPotData | null
  onCopy: () => void
}) {
  const results = props.result?.commandResults ?? []
  const commands = props.result?.commands ?? []
  const rows: Array<{ plan: JellyPotCommandPlan; result?: JellyPotCommandPlan & CommandResult }> = results.length
    ? results.map((item) => ({ plan: item, result: item }))
    : commands.map((plan) => ({ plan }))

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={rows.length} icon={Terminal} label="命令" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {rows.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {rows.map((row) => (
              <CommandRow key={`${row.plan.label}-${row.plan.command}`} plan={row.plan} result={row.result} />
            ))}
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={Terminal} title="等待命令" description="播放媒体、打开 Jellyfin 或导入注册表后会显示命令计划。" />
        )}
      </ScrollArea>
    </section>
  )
}

function CommandRow({ plan, result }: { plan: JellyPotCommandPlan; result?: JellyPotCommandPlan & CommandResult }) {
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

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof ScrollText
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
