import type { CommandResult, SmartZipCommandPlan, SmartZipConfig, SmartZipData } from "@xiranite/node-smartzip/core"
import type { LucideIcon } from "lucide-react"
import { Copy, ScrollText, Settings2, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function SmartZipStatsPanel({ result }: { result: SmartZipData | null }) {
  const stats = [
    ["选中", result?.selectedPaths.length ?? 0],
    ["归档", result?.archiveCount ?? 0],
    ["扩展名", result?.config.archiveExtensions.length ?? 0],
    ["错误", result?.errors.length ?? 0],
  ] as const

  return (
    <div data-testid="smartzip-stats-panel" className="grid shrink-0 grid-cols-4 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function SmartZipResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: SmartZipData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasCommand = Boolean(props.result?.command)
  const hasConfig = Boolean(props.result?.config)
  const preferredTab = props.running ? "logs" : hasCommand ? "command" : hasConfig ? "config" : "logs"
  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="command">命令</TabsTrigger>
        <TabsTrigger value="config">配置</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="command" className="min-h-0 flex-1">
        <CommandPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="config" className="min-h-0 flex-1">
        <ConfigPanel compact={props.compact} config={props.result?.config} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function CommandPanel(props: {
  compact?: boolean
  result: SmartZipData | null
  onCopy: () => void
}) {
  const command = props.result?.command
  const commandResult = props.result?.commandResult
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={command ? 1 : 0} icon={Terminal} label="命令" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {command ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            <CommandRow command={command} result={commandResult} />
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={Terminal} title="等待命令" description="选择动作并运行后会显示 SmartZip 命令计划。" />
        )}
      </ScrollArea>
    </section>
  )
}

function CommandRow({ command, result }: { command: SmartZipCommandPlan; result?: CommandResult }) {
  const status = result ? (result.code === 0 ? "success" : "error") : "planned"
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="truncate font-mono text-xs" title={command.command}>{command.command}</div>
        <Badge variant={status === "error" ? "destructive" : status === "success" ? "default" : "outline"} className="shrink-0">{status}</Badge>
      </div>
      <div className="truncate font-mono text-[11px] text-muted-foreground" title={command.args.join(" ")}>
        {command.label} {"->"} {command.args.join(" ")}
      </div>
      {result?.stderr ? <div className="truncate font-mono text-[11px] text-destructive" title={result.stderr}>{result.stderr}</div> : null}
      {result?.stdout ? <div className="truncate font-mono text-[11px] text-muted-foreground" title={result.stdout}>{result.stdout}</div> : null}
    </div>
  )
}

function ConfigPanel(props: {
  compact?: boolean
  config?: SmartZipConfig
  onCopy: () => void
}) {
  const config = props.config
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={config ? 1 : 0} icon={Settings2} label="配置" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {config ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            <ConfigRow label="7-Zip 目录" value={config.sevenZipDir} />
            <ConfigRow label="密码数" value={String(config.passwords.length)} />
            <ConfigRow label="归档扩展名" value={config.archiveExtensions.join(", ") || "(默认)"} />
            <ConfigRow label="右键菜单" value={config.contextMenu ? "启用" : "禁用"} />
            <ConfigRow label="发送到" value={config.sendTo ? "启用" : "禁用"} />
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={Settings2} title="等待配置" description="运行状态查看后会显示 SmartZip 配置。" />
        )}
      </ScrollArea>
    </section>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs" title={value}>{value}</div>
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
