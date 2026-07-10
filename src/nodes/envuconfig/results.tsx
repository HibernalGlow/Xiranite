import type { EnvuBackupOperation, EnvuConfigData, EnvuConfigFile } from "@xiranite/node-envuconfig/core"
import type { LucideIcon } from "lucide-react"
import { CheckCircle2, ClipboardList, Copy, FolderTree, ScrollText, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function EnvuConfigStatsPanel({ result }: { result: EnvuConfigData | null }) {
  const stats = [
    ["文件", result?.files.length ?? 0],
    ["分组", new Set(result?.files.map((file) => file.group)).size ?? 0],
    ["操作", result?.operations.length ?? 0],
    ["错误", result?.errors.length ?? 0],
  ] as const

  return (
    <div data-testid="envuconfig-stats-panel" className="grid shrink-0 grid-cols-4 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Wide-surface file ledger. The compact result tabs keep their richer
 * per-file cards; this table lets the workspace use the central scanning
 * surface as a dense, glanceable inventory.
 */
export function EnvuConfigFileLedger({ files }: { files: EnvuConfigFile[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border bg-background/70">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FolderTree className="size-3.5" />
          <span>Detected objects</span>
        </div>
        <Badge variant="outline">{files.length}</Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {files.length ? (
          <Table className="min-w-[360px] text-xs">
            <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm">
              <TableRow>
                <TableHead>File path</TableHead>
                <TableHead>Group</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.path}>
                  <TableCell className="max-w-0 truncate font-mono" title={file.path}>{file.relativePath}</TableCell>
                  <TableCell><Badge variant="outline">{file.group}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatBytes(file.size)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={FolderTree} title="等待文件" description="扫描后将在此列出 EnvU 配置对象。" />
        )}
      </ScrollArea>
    </section>
  )
}

export function EnvuConfigResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: EnvuConfigData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasFiles = Boolean(props.result?.files.length)
  const hasOperations = Boolean(props.result?.operations.length)
  const preferredTab = props.running ? "logs" : hasOperations ? "operations" : hasFiles ? "files" : "logs"
  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="files">文件</TabsTrigger>
        <TabsTrigger value="operations">操作</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="files" className="min-h-0 flex-1">
        <FilePanel compact={props.compact} files={props.result?.files ?? []} onCopy={props.onCopyResults} />
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

function FilePanel(props: {
  compact?: boolean
  files: EnvuConfigFile[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.files.length} icon={FolderTree} label="文件" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.files.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {props.files.map((file) => (
              <div key={file.path} className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={file.path}>{file.relativePath}</div>
                  <Badge variant="outline" className="shrink-0">{file.group}</Badge>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate font-mono" title={file.path}>{file.path}</span>
                  <span className="shrink-0 tabular-nums">{formatBytes(file.size)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={FolderTree} title="等待文件" description="扫描或生成清单后会列出 EnvU 配置文件。" />
        )}
      </ScrollArea>
    </section>
  )
}

function OperationPanel(props: {
  compact?: boolean
  operations: EnvuBackupOperation[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <PanelHeader count={props.operations.length} icon={ClipboardList} label="操作" onCopy={props.onCopy} />
      <ScrollArea className="min-h-0 flex-1">
        {props.operations.length ? (
          <div className={props.compact ? "grid gap-1.5 p-2" : "grid gap-2 p-3"}>
            {props.operations.map((operation, index) => (
              <OperationRow key={`${operation.sourcePath}-${index}`} operation={operation} />
            ))}
          </div>
        ) : (
          <EmptyState compact={props.compact} icon={ClipboardList} title="等待操作" description="生成清单或执行备份后会显示每个文件的复制计划。" />
        )}
      </ScrollArea>
    </section>
  )
}

function OperationRow({ operation }: { operation: EnvuBackupOperation }) {
  const Icon = operation.status === "success" ? CheckCircle2 : operation.status === "error" ? TriangleAlert : ClipboardList
  return (
    <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium" title={operation.sourcePath}>
          <Icon className={cn("size-3.5 shrink-0", operation.status === "success" && "text-green-600 dark:text-green-400", operation.status === "error" && "text-destructive")} />
          <span className="truncate font-mono">{operation.sourcePath}</span>
        </div>
        <Badge variant={operation.status === "error" ? "destructive" : operation.status === "success" ? "default" : "outline"} className="shrink-0">{operation.status}</Badge>
      </div>
      <div className="truncate font-mono text-[11px] text-muted-foreground" title={operation.targetPath}>
        {"->"} {operation.targetPath}
      </div>
      {operation.reason && <div className="truncate font-mono text-[11px] text-destructive" title={operation.reason}>{operation.reason}</div>}
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
