import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { MoveaAction, MoveaData, MoveaInput } from "@xiranite/node-movea/core"
import { matchMoveaArchiveToFolders } from "@xiranite/node-movea/core"
import { Copy, FolderInput, MoveRight, RotateCcw, Search, ShieldAlert, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { ACTIONS } from "./constants"
import { ActionIconButton, OptionsPopover, PathField, PrimarySwitches, StatusStrip, TextAreaField } from "./controls"
import type { MoveaCardState, MoveaPhase, MoveaStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<MoveaCardState>(compId) ?? {}
  const dataRef = useRef<MoveaCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<MoveaCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const matchedFolders = data.matchedFolders ?? []
  const scanResults = useMemo(() => Object.values(result?.scanResults ?? {}), [result])
  const dryRun = data.dryRun ?? true
  const phase = phaseFromState(data, running)
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<MoveaCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.rootPath, data.regexText, data.archiveName, data.subfoldersText, data.level1Name, data.movePlanText, data.dryRun, defaults])

  function patch(patchData: Partial<MoveaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function paste(field: keyof MoveaCardState) {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function copyResults() {
    const lines = [
      ...scanResults.map((item) => `${item.name}: ${item.archives.length} archives / ${item.movableFolders.length} movable / ${item.subfolders.length} targets`),
      ...matchedFolders.map((folder) => `match ${folder}`),
      ...(result?.moveItems ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.sourcePath} -> ${item.targetPath}`),
    ]
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function executeMatch() {
    const folders = matchMoveaArchiveToFolders(
      dataRef.current.archiveName ?? "",
      splitLines(dataRef.current.subfoldersText),
      splitLines(dataRef.current.regexText),
    )
    patch({ matchedFolders: folders, phase: "preview" })
    pushLog(`Matched ${folders.length} folder(s).`)
  }

  async function execute(action: MoveaAction) {
    if (running) return
    if (action === "match") {
      executeMatch()
      return
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input: MoveaInput = {
      action,
      rootPath: dataRef.current.rootPath,
      regexPatterns: splitLines(dataRef.current.regexText),
      level1Name: dataRef.current.level1Name,
      movePlan: parseMovePlan(dataRef.current.movePlanText),
      dryRun,
    }

    if (action === "scan" && !input.rootPath) {
      patch({ phase: "error", progress: 0, progressText: "请先输入根路径。" })
      return
    }
    if (action === "move_single" && !input.level1Name) {
      patch({ phase: "error", progress: 0, progressText: "请先输入 level1 名称。" })
      return
    }

    setRunning(true)
    try {
      patch({ phase: "running", progress: 0, progressText: `${actionLabel(action)}开始`, result: null })
      const response = await run<MoveaInput, MoveaData>("movea", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<MoveaData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, matchedFolders: [], logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<MoveaCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({ rootPath: undefined, regexText: undefined, archiveName: undefined, subfoldersText: undefined, level1Name: undefined, movePlanText: undefined, dryRun: undefined })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    logs,
    matchedFolders,
    phase,
    progress,
    result,
    running,
    scanResults,
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPaste: paste,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/movea relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-5)_14%,transparent),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact ? <PortraitCompactView {...commonProps} /> : <CompactView {...commonProps} />
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

type ViewProps = ReturnType<typeof createViewProps>

function createViewProps(props: {
  configDirty: boolean
  configFilePath?: string
  data: MoveaCardState
  defaults?: Partial<MoveaCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  matchedFolders: string[]
  phase: MoveaPhase
  progress: number
  result: MoveaData | null
  running: boolean
  scanResults: MoveaData["scanResults"][string][]
  status: MoveaStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: MoveaAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: (field: keyof MoveaCardState) => void
  onPatch: (patch: Partial<MoveaCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  return (
    <div data-testid="movea-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FolderInput />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Movea</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <PrimaryActionButton compact props={props} />
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="movea-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathField compact id="movea-root" label="根路径" disabled={props.running} value={props.data.rootPath ?? ""} onChange={(rootPath) => props.onPatch({ rootPath })} onPaste={() => props.onPaste("rootPath")} />
        <PathField compact id="movea-level1" label="level1" disabled={props.running} value={props.data.level1Name ?? ""} onChange={(level1Name) => props.onPatch({ level1Name })} onPaste={() => props.onPaste("level1Name")} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <ResultTabs compact logs={props.logs} matchedFolders={props.matchedFolders} result={props.result} running={props.running} scanResults={props.scanResults} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="movea-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PathField compact id="movea-root" label="根路径" disabled={props.running} value={props.data.rootPath ?? ""} onChange={(rootPath) => props.onPatch({ rootPath })} onPaste={() => props.onPaste("rootPath")} />
        <PathField compact id="movea-level1" label="level1" disabled={props.running} value={props.data.level1Name ?? ""} onChange={(level1Name) => props.onPatch({ level1Name })} onPaste={() => props.onPaste("level1Name")} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <ResultTabs compact logs={props.logs} matchedFolders={props.matchedFolders} result={props.result} running={props.running} scanResults={props.scanResults} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="movea-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/movea:flex-row @4xl/movea:items-center @4xl/movea:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/movea:flex-row @4xl/movea:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.scanResults.length} 文件夹 / ${props.dryRun ? "预演" : "真实执行"}`} />
          <div data-testid="movea-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/movea:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">输入根路径和 level1 名称，扫描后匹配目标并移动。</div>
            </div>
            <PathField id="movea-root" label="根路径" disabled={props.running} value={props.data.rootPath ?? ""} onChange={(rootPath) => props.onPatch({ rootPath })} onPaste={() => props.onPaste("rootPath")} />
            <PathField id="movea-level1" label="level1 名称" disabled={props.running} value={props.data.level1Name ?? ""} onChange={(level1Name) => props.onPatch({ level1Name })} onPaste={() => props.onPaste("level1Name")} />
            <PathField id="movea-archive" label="归档名" disabled={props.running} value={props.data.archiveName ?? ""} onChange={(archiveName) => props.onPatch({ archiveName })} onPaste={() => props.onPaste("archiveName")} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">匹配与计划</div>
            <TextAreaField id="movea-regex" label="正则模式" disabled={props.running} value={props.data.regexText ?? ""} placeholder="每行一个正则" onChange={(regexText) => props.onPatch({ regexText })} />
            <TextAreaField id="movea-subfolders" label="目标子文件夹" disabled={props.running} value={props.data.subfoldersText ?? ""} placeholder="每行一个子文件夹" onChange={(subfoldersText) => props.onPatch({ subfoldersText })} />
            <TextAreaField id="movea-plan" label="移动计划" disabled={props.running} value={props.data.movePlanText ?? ""} placeholder='{"item":"target folder"}' onChange={(movePlanText) => props.onPatch({ movePlanText })} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/movea:h-full">
          <ResultTabs logs={props.logs} matchedFolders={props.matchedFolders} result={props.result} running={props.running} scanResults={props.scanResults} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running} icon={Search} label="扫描目录" onClick={() => props.onExecute("scan")} />
      <ActionIconButton disabled={props.running} icon={FolderInput} label="匹配目标" onClick={() => props.onExecute("match")} />
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={props.running || (!props.scanResults.length && !props.matchedFolders.length)} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
      {!props.compact && (
          <NodeConfigButton nodeKey="movea"
          configDirty={props.configDirty}
          configFilePath={props.configFilePath}
          defaults={props.defaults}
          disabled={props.running}
          onOpenConfigFile={props.onOpenConfigFile}
          onResetOverride={props.onResetOverride}
          onRestoreDefault={props.onRestoreDefault}
          onSaveDefault={props.onSaveDefault}
        />
      )}
    </div>
  )
}

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="movea running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = !props.data.level1Name
  const label = props.dryRun ? "预演移动" : "执行移动"
  if (!props.dryRun) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <ShieldAlert />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Movea 移动？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，将对 level1 {props.data.level1Name ?? "未指定"} 执行真实文件移动。该操作不可撤销，请确认移动计划无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("move_single")}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute("move_single")}>
      <MoveRight />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: MoveaStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <FolderInput />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Movea</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  progress: number
  result: MoveaData | null
}) {
  const stats = [
    ["文件夹", props.result?.totalFolders ?? 0],
    ["归档", props.result?.totalArchives ?? 0],
    ["可移动", props.result?.totalMovableFolders ?? 0],
    ["成功", props.result?.moveSuccess ?? 0],
    ["失败", props.result?.moveFailed ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/movea:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "失败" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultTabs(props: {
  compact?: boolean
  logs: string[]
  matchedFolders: string[]
  result: MoveaData | null
  running?: boolean
  scanResults: MoveaData["scanResults"][string][]
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const scanLines = props.scanResults.map((item) => `${item.name}: ${item.archives.length} archives / ${item.movableFolders.length} movable / ${item.subfolders.length} targets${item.warning ? ` / ${item.warning}` : ""}`)
  const matchLines = props.matchedFolders.map((folder) => `match ${folder}`)
  const moveLines = (props.result?.moveItems ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.sourcePath} -> ${item.targetPath}${item.error ? ` / ${item.error}` : ""}`)
  const resultLines = [...scanLines, ...matchLines, ...moveLines]
  const routes = props.result?.moveItems ?? []
  const preferredTab = props.running
    ? "results"
    : resultLines.length
      ? "results"
      : props.logs.length
        ? "logs"
        : "results"

  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="results">匹配</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="results" className="min-h-0 flex-1">
        <MoveaRouteTable compact={props.compact} routes={routes} matchedFolders={props.matchedFolders} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={Copy} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function MoveaRouteTable(props: { compact?: boolean; routes: MoveaData["moveItems"]; matchedFolders: string[]; onCopy: () => void }) {
  const rows = props.routes.length
    ? props.routes
    : props.matchedFolders.map((folder) => ({ itemName: folder, sourcePath: folder, targetFolder: "", targetPath: "", success: true, itemType: "folder" as const, level1Name: "" }))
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><FolderInput className="size-3.5" /><span>{rows.length ? `${rows.length} 项` : "等待运行"}</span></div><Button disabled={!rows.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />复制</Button></div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {rows.length ? <Table><TableHeader><TableRow><TableHead>源项</TableHead><TableHead>目标目录</TableHead><TableHead className="w-20">状态</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={`${item.sourcePath}:${item.targetPath}`}><TableCell className="max-w-0 truncate font-mono text-xs" title={item.sourcePath}>{item.itemName}</TableCell><TableCell className="max-w-0 truncate font-mono text-xs text-muted-foreground" title={item.targetFolder}>{item.targetFolder || "等待匹配"}</TableCell><TableCell><Badge variant={item.success ? "outline" : "destructive"}>{item.success ? "匹配" : "异常"}</Badge></TableCell></TableRow>)}</TableBody></Table> : <div className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground">扫描目录后会显示路由匹配和异常。</div>}
      </ScrollArea>
    </section>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof FolderInput
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

function statusFromState(data: MoveaCardState, running: boolean, result: MoveaData | null): MoveaStatusMeta {
  if (running || data.phase === "scan" || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Movea 正在扫描或移动文件。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || result?.errors.length) {
    return {
      label: "失败",
      description: data.progressText || result?.errors[0] || "上次任务失败，请查看结果和日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次任务已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "preview") {
    return {
      label: "已匹配",
      description: "已匹配目标文件夹，可继续移动。",
      tone: "idle",
      badgeVariant: "outline",
      iconClass: "bg-secondary text-secondary-foreground",
    }
  }
  return {
    label: "就绪",
    description: "输入根路径后扫描一级文件夹。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: MoveaCardState, running: boolean): MoveaPhase {
  if (running) return data.phase ?? "running"
  return data.phase ?? "idle"
}

function actionLabel(action: MoveaAction): string {
  const meta = ACTIONS.find((item) => item.value === action)
  return meta?.shortLabel ?? action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.moveFailed) return `${props.result.moveFailed} 个失败`
  if (props.scanResults.length) return `${props.scanResults.length} 文件夹 / ${props.result?.totalArchives ?? 0} 归档`
  if (props.matchedFolders.length) return `${props.matchedFolders.length} 个匹配`
  return "输入根路径后扫描目录"
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,|;/).map((item) => item.trim()).filter(Boolean)
}

function parseMovePlan(value?: string): Record<string, string | null> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | null> : {}
  } catch {
    return {}
  }
}
