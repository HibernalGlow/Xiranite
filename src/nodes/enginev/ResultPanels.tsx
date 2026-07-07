import type { EngineVData } from "@xiranite/node-enginev/core"
import { Copy, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function StatsPanel({ result, total, visible, selected }: {
  result: EngineVData | null
  selected: number
  total: number
  visible: number
}) {
  const stats = [
    ["总数", result?.totalCount ?? total],
    ["可见", result?.filteredCount ?? visible],
    ["选中", selected],
    ["类型", Object.keys(result?.typeStats ?? {}).length],
    ["失败", result?.failedCount ?? 0],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-5 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

export function ResultTabs(props: {
  logs: string[]
  result: EngineVData | null
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const renameLines = props.result?.renameResults.map((item) => `${item.status} ${item.oldName} -> ${item.newName}`) ?? []
  const deleteLines = props.result?.deleteResults.map((item) => `${item.status} ${item.workshopId} ${item.message}`) ?? []
  const errorLines = props.result?.errors ?? []
  const hasResults = renameLines.length || deleteLines.length || errorLines.length

  return (
    <Tabs defaultValue="results" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="results">结果</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="results" className="min-h-0 flex-1">
        <TextPanel
          emptyText="运行重命名、删除或导出后，这里会显示计划和错误明细。"
          lines={hasResults ? [...renameLines, ...deleteLines, ...errorLines.map((item) => `error ${item}`)] : []}
          onCopy={props.onCopyResults}
        />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel emptyText="运行日志会显示在这里。" lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TextPanel(props: {
  emptyText: string
  lines: string[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListChecks className="size-3.5" />
          <span>{props.lines.length ? `${props.lines.length} 项` : "等待运行"}</span>
        </div>
        <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className="p-3 text-xs leading-5 text-muted-foreground">
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {props.emptyText}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
