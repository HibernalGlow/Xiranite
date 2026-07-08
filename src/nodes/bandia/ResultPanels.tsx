import { useEffect, useState } from "react"
import type { BandiaData, BandiaItemResult, BandiaPathMapping } from "@xiranite/node-bandia/core"
import { Archive, CheckCircle2, Copy, FileArchive, FolderOpen, ListChecks, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { BandiaMode } from "./types"

export function StatsPanel(props: {
  archiveCount: number
  mappingCount: number
  pathCount: number
  progress: number
  result: BandiaData | null
}) {
  const done = (props.result?.extractedCount ?? 0) + (props.result?.compressedCount ?? 0)
  const stats = [
    ["输入", props.archiveCount || props.pathCount],
    ["映射", props.result?.pathMappings.length ?? props.mappingCount],
    ["完成", done],
    ["失败", props.result?.failedCount ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-5 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "失败" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function QueuePreview(props: {
  archivePaths: string[]
  compact?: boolean
  mappings: BandiaPathMapping[]
  mode: BandiaMode
  paths: string[]
  result: BandiaData | null
}) {
  const isExtract = props.mode === "extract"
  const items = isExtract
    ? props.archivePaths.map((path) => ({ source: path, target: "", ok: resultOk(props.result, path) }))
    : queueMappings(props).map((mapping) => ({ source: mapping.extractedPath, target: mapping.archivePath, ok: resultOk(props.result, mapping.extractedPath) }))
  const Icon = isExtract ? FileArchive : FolderOpen

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <div className="truncate text-xs font-medium">{isExtract ? "待解压文件" : "待压缩映射"}</div>
        </div>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {items.length ? (
          <div className="grid gap-1 p-2">
            {items.slice(0, 120).map((item, index) => (
              <div key={`${item.source}:${item.target}:${index}`} className="grid min-w-0 gap-0.5 rounded-md px-2 py-1.5 hover:bg-muted/45">
                <div className="flex min-w-0 items-center gap-2">
                  {item.ok === true ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                  ) : item.ok === false ? (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                  )}
                  <span className="truncate text-xs font-medium">{basename(item.source)}</span>
                </div>
                {item.target && (
                  <div className="truncate pl-7 text-[11px] text-muted-foreground">{"->"} {basename(item.target)}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {isExtract ? "粘贴压缩包路径后会显示队列。" : "输入源路径或导入映射后会显示队列。"}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

export function ResultTabs(props: {
  archivePaths?: string[]
  compact?: boolean
  logs: string[]
  mappings?: BandiaPathMapping[]
  mode?: BandiaMode
  paths?: string[]
  result: BandiaData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasQueue = Boolean(props.mode)
  const resultLines = [
    ...(props.result?.pathMappings ?? []).map((mapping) => `map ${mapping.archivePath} -> ${mapping.extractedPath}`),
    ...(props.result?.results ?? []).map(resultLine),
  ]
  const preferredTab = props.running
    ? "queue"
    : resultLines.length || props.result
      ? "results"
      : props.logs.length
        ? "logs"
        : "queue"
  const [tab, setTab] = useState(hasQueue ? preferredTab : "results")

  useEffect(() => {
    setTab(hasQueue ? preferredTab : "results")
  }, [hasQueue, preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        {hasQueue && <TabsTrigger value="queue">队列</TabsTrigger>}
        <TabsTrigger value="results">结果</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      {hasQueue && (
        <TabsContent value="queue" className="min-h-0 flex-1">
          <QueuePreview
            compact={props.compact}
            archivePaths={props.archivePaths ?? []}
            mappings={props.mappings ?? []}
            mode={props.mode ?? "extract"}
            paths={props.paths ?? []}
            result={props.result}
          />
        </TabsContent>
      )}
      <TabsContent value="results" className="min-h-0 flex-1">
        <TextPanel
          compact={props.compact}
          emptyText="运行后会显示路径映射、命令计划和错误明细。"
          icon={ListChecks}
          lines={resultLines}
          onCopy={props.onCopyResults}
        />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={Archive} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof ListChecks
  lines: string[]
  onCopy: () => void
}) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
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
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            {props.emptyText}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function queueMappings(props: {
  mappings: BandiaPathMapping[]
  paths: string[]
}): BandiaPathMapping[] {
  if (props.mappings.length) return props.mappings
  return props.paths.map((path) => ({ archivePath: `${path}.zip`, extractedPath: path }))
}

function resultOk(result: BandiaData | null, sourcePath: string): boolean | undefined {
  const match = result?.results.find((item) => item.sourcePath === sourcePath)
  return match?.success
}

function resultLine(item: BandiaItemResult): string {
  const target = item.outputPath ?? item.archivePath
  return `${item.success ? "ok" : "fail"} ${item.sourcePath}${target ? ` -> ${target}` : ""}${item.error ? ` / ${item.error}` : ""}`
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}
