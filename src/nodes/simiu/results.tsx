import type { SimiuData, SimiuGroup, SimiuOperation } from "@xiranite/node-simiu/core"
import type { LucideIcon } from "lucide-react"
import { Copy, FolderTree, ListChecks, ScrollText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function SimiuStatsPanel({ result }: { result: SimiuData | null }) {
  const stats = [
    ["图片", result?.imageCount ?? 0],
    ["分组", result?.groupCount ?? 0],
    ["操作", result?.operations.length ?? 0],
    ["错误", result?.errorCount ?? 0],
  ] as const

  return (
    <div data-testid="simiu-stats-panel" className="grid shrink-0 grid-cols-4 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "分组" && Number(value) > 0 && "text-primary", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function SimiuResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: SimiuData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const preferredTab = props.running ? "logs" : props.result?.groups.length ? "groups" : props.result?.operations.length ? "operations" : "groups"
  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="groups">分组</TabsTrigger>
        <TabsTrigger value="operations">操作</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="groups" className="min-h-0 flex-1">
        <GroupPanel compact={props.compact} groups={props.result?.groups ?? []} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="operations" className="min-h-0 flex-1">
        <OperationPanel compact={props.compact} operations={props.result?.operations ?? []} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function GroupPanel(props: {
  compact?: boolean
  groups: SimiuGroup[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.groups.length} icon={FolderTree} label="分组" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.groups.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {props.groups.map((group) => (
              <div key={`${group.parentDir}/${group.name}`} className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="truncate text-xs font-medium" title={group.name}>{group.name}</div>
                  <Badge variant="outline">{group.files.length} files</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={group.parentDir}>{group.parentDir}</div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="h-full min-h-20 border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FolderTree /></EmptyMedia>
              <EmptyTitle className="text-sm">等待分组</EmptyTitle>
              <EmptyDescription className="text-xs">生成计划后会显示相似图片分组。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
    </section>
  )
}

function OperationPanel(props: {
  compact?: boolean
  operations: SimiuOperation[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.operations.length} icon={ListChecks} label="操作" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.operations.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {props.operations.map((operation) => (
              <div key={`${operation.sourcePath}->${operation.targetPath}`} className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="truncate font-mono text-xs" title={operation.sourcePath}>{operation.sourcePath}</div>
                  <Badge variant={operation.status === "error" ? "destructive" : operation.status === "success" ? "default" : "outline"}>{operation.status}</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={operation.targetPath}>
                  {operation.mode} {"->"} {operation.targetPath}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="h-full min-h-20 border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListChecks /></EmptyMedia>
              <EmptyTitle className="text-sm">等待操作</EmptyTitle>
              <EmptyDescription className="text-xs">生成计划或应用分组后会显示文件操作。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
    </section>
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
          <Empty className="h-full min-h-20 border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><props.icon /></EmptyMedia>
              <EmptyTitle className="text-sm">等待日志</EmptyTitle>
              <EmptyDescription className="text-xs">{props.emptyText}</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
