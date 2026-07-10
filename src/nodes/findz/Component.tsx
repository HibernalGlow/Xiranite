import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { FindzAction, FindzData, FindzInput } from "@xiranite/node-findz/core"
import { formatFoundPath } from "@xiranite/node-findz/core"
import { Copy, FileSearch, FolderOpen, HelpCircle, Play, RotateCcw, Search, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, HELP_ACTION } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  AdvancedOptionsPopover,
  ConfigDefaultsPopover,
  PathInput,
  PrimarySwitches,
  StatusStrip,
  WhereInput,
} from "./controls"
import type { FindzCardState, FindzPhase, FindzStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

type FindzProps = NodeComponentProps<FindzCardState, Partial<FindzCardState>>

export function Component({ host }: FindzProps) {
  "use memo"
  const surface = useNodeSurface()
  const { t: tNode } = useNodeI18n("findz")
  const data = host.state.getData() ?? {}
  const dataRef = useRef<FindzCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<FindzCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "search"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const paths = useMemo(() => splitPaths(data.pathText), [data.pathText])
  const where = data.where?.trim() || "1"
  const status = statusFromState(data, running, tNode)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.config?.get()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.action,
    data.archiveSeparator,
    data.continueOnError,
    data.followSymlinks,
    data.groupBy,
    data.longFormat,
    data.maxResults,
    data.maxReturnFiles,
    data.noArchive,
    data.outputFormat,
    data.outputPath,
    data.pathText,
    data.printZero,
    data.refine,
    data.sortBy,
    data.sortDesc,
    data.where,
    data.withImageMeta,
    defaults,
  ])

  function patch(patchData: Partial<FindzCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.state.patchData(patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function copyResults() {
    const lines = result?.outputText
      ? [result.outputText]
      : (result?.files ?? []).map((file) => formatFoundPath(file))
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: FindzAction = action) {
    if (running) return
    if (nextAction !== "help" && !paths.length) {
      patch({ phase: "error", progress: 0, progressText: tNode("pathRequired", "请先输入至少一个搜索路径。") })
      return
    }
    const run = host.runner?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: tNode("noNative", "当前环境没有本地运行能力，请使用桌面模式或 CLI。") })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input = buildInput(nextAction, dataRef.current)
    setRunning(true)
    try {
      patch({ phase: "searching", progress: 0, progressText: tNode("actionStart", "{{action}}开始", { action: labelForAction(nextAction, tNode) }), result: null, action: nextAction })
      const response = await run<FindzInput, FindzData>("findz", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<FindzData>

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
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<FindzCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    await host.config?.save(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({
      action: undefined,
      pathText: undefined,
      where: undefined,
      noArchive: undefined,
      followSymlinks: undefined,
      withImageMeta: undefined,
      longFormat: undefined,
      continueOnError: undefined,
      maxResults: undefined,
      maxReturnFiles: undefined,
      groupBy: undefined,
      refine: undefined,
      sortBy: undefined,
      sortDesc: undefined,
      outputFormat: undefined,
      outputPath: undefined,
      archiveSeparator: undefined,
      printZero: undefined,
    })
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    host,
    logs,
    paths,
    progress,
    result,
    running,
    status,
    tNode,
    where,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile,
    onPaste: pastePaths,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/findz relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-4)_16%,transparent),transparent_34%)]" />
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
  action: FindzAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: FindzCardState
  defaults?: Partial<FindzCardState>
  host: FindzProps["host"]
  logs: string[]
  paths: string[]
  progress: number
  result: FindzData | null
  running: boolean
  status: FindzStatusMeta
  tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string
  where: string
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: FindzAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<FindzCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.actionMeta.icon
  return (
    <div data-testid="findz-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FileSearch />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Findz</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{summaryText(props)}</span>
        </div>
      </div>
      <RunActionButton compact props={props} />
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="findz-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <ActionIconButton disabled={props.running} icon={HelpCircle} label={props.tNode("buttons.filterHelp", "过滤器帮助")} onClick={() => props.onExecute("help")} />
          {props.running ? <ActionIconButton destructive icon={Square} label={props.tNode("buttons.running", "运行中")} onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
        <WhereInput compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <FindzResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="findz-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label={props.tNode("buttons.running", "运行中")} onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
        <WhereInput compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <FindzResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="findz-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/findz:flex-row @4xl/findz:items-center @4xl/findz:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/findz:flex-row @4xl/findz:items-center">
          <HeaderLine
            actionMeta={props.actionMeta}
            status={props.status}
            subtitle={props.data.progressText || `${props.actionMeta.label} / ${props.paths.length || 1} ${props.tNode("pathsLabel", "路径")} / where ${props.where}`}
          />
          <div data-testid="findz-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/findz:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">{props.tNode("sections.task", "任务")}</div>
              <div className="text-xs text-muted-foreground">{props.tNode("sections.taskDesc", "选择搜索动作，粘贴路径，写 SQL 过滤器。")}</div>
            </div>
            <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
            <PathInput data={props.data} disabled={props.running} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
            <WhereInput data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{props.tNode("sections.switches", "关键开关")}</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <FindzResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && (props.running ? <ActionIconButton destructive icon={Square} label={props.tNode("buttons.running", "运行中")} onClick={() => undefined} /> : <RunActionButton props={props} />)}
      <ActionIconButton disabled={props.running} icon={HelpCircle} label={props.tNode("buttons.filterHelp", "过滤器帮助")} onClick={() => props.onExecute("help")} />
      <ActionIconButton disabled={!props.result} icon={Copy} label={props.tNode("buttons.copyResults", "复制结果")} onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={FileSearch} label={props.tNode("buttons.copyLogs", "复制日志")} onClick={props.onCopyLogs} />
      <ActionIconButton icon={RotateCcw} label={props.tNode("buttons.clearState", "清空状态")} onClick={props.onReset} />
      {!props.compact && (
        <ConfigDefaultsPopover
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

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="findz running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>{props.tNode("buttons.running", "运行中")}</span>}
      </Button>
    )
  }
  const label = props.tNode("buttons.run", "运行{{action}}", { action: props.actionMeta.shortLabel })
  return (
    <Button aria-label={label} disabled={!props.paths.length} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: FindzStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <actionMeta.icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Findz</h3>
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
  result: FindzData | null
}) {
  const { t: tNode } = useNodeI18n("findz")
  const stats = [
    [tNode("stats.total", "总计"), props.result?.totalCount ?? 0],
    [tNode("stats.files", "文件"), props.result?.fileCount ?? 0],
    [tNode("stats.dirs", "目录"), props.result?.dirCount ?? 0],
    [tNode("stats.archive", "归档成员"), props.result?.archiveCount ?? 0],
    [tNode("stats.nested", "嵌套"), props.result?.nestedCount ?? 0],
    [tNode("stats.errors", "错误"), props.result?.errors.length ?? 0],
    [tNode("stats.scanned", "扫描"), props.result?.scannedFiles ?? 0],
    [tNode("stats.progress", "进度"), `${props.progress}%`],
  ] as const

  const errorLabel = tNode("stats.errors", "错误")
  return (
    <div className="grid shrink-0 grid-cols-4 gap-1 @4xl/findz:grid-cols-8">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === errorLabel && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function FindzResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: FindzData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const { t: tNode } = useNodeI18n("findz")
  const isHelp = props.result?.action === "help"
  const fileLines = useMemo(() => (props.result?.files ?? []).slice(0, 500).map((file) => `${file.type} ${formatFoundPath(file)} ${file.sizeFormatted}`), [props.result])
  const groupLines = useMemo(() => (props.result?.groups ?? []).map((group) => `${group.count} ${group.name} / ${group.totalSizeFormatted} / 均 ${group.avgSizeFormatted}`), [props.result])
  const hasFiles = fileLines.length > 0
  const hasGroups = groupLines.length > 0

  const preferredTab = isHelp ? "output" : props.running ? "logs" : hasFiles ? "files" : hasGroups ? "groups" : props.logs.length ? "logs" : "files"
  const [tab, setTab] = useState(preferredTab)
  useEffect(() => { setTab(preferredTab) }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        {isHelp ? <TabsTrigger value="output">{tNode("tabs.help", "帮助")}</TabsTrigger> : (
          <>
            <TabsTrigger value="files">{tNode("tabs.files", "文件")}</TabsTrigger>
            <TabsTrigger value="groups">{tNode("tabs.groups", "分组")}</TabsTrigger>
            <TabsTrigger value="logs">{tNode("tabs.logs", "日志")}</TabsTrigger>
          </>
        )}
      </TabsList>
      {isHelp ? (
        <TabsContent value="output" className="min-h-0 flex-1">
          <TextPanel compact={props.compact} emptyText={tNode("empty.help", "帮助文本会显示在这里。")} icon={HelpCircle} lines={props.result?.outputText ? [props.result.outputText] : []} onCopy={props.onCopyResults} />
        </TabsContent>
      ) : (
        <>
          <TabsContent value="files" className="min-h-0 flex-1">
            <TextPanel compact={props.compact} emptyText={tNode("empty.files", "运行后会显示匹配的文件和归档成员。")} icon={FolderOpen} lines={fileLines} onCopy={props.onCopyResults} />
          </TabsContent>
          <TabsContent value="groups" className="min-h-0 flex-1">
            <TextPanel compact={props.compact} emptyText={tNode("empty.groups", "设置分组字段后会显示分组汇总。")} icon={Search} lines={groupLines} onCopy={props.onCopyResults} />
          </TabsContent>
          <TabsContent value="logs" className="min-h-0 flex-1">
            <TextPanel compact={props.compact} emptyText={tNode("empty.logs", "运行日志会显示在这里。")} icon={FileSearch} lines={props.logs} onCopy={props.onCopyLogs} />
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof FileSearch
  lines: string[]
  onCopy: () => void
}) {
  const { t: tNode } = useNodeI18n("findz")
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.lines.length ? tNode("empty.itemCount", "{{count}} 项", { count: props.lines.length }) : tNode("empty.waitingRun", "等待运行")}</span>
        </div>
        <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          {tNode("buttons.copy", "复制")}
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 text-xs leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className="flex h-full min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{props.emptyText}</span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function buildInput(action: FindzAction, data: FindzCardState): FindzInput {
  return {
    action,
    pathText: data.pathText,
    where: data.where || "1",
    noArchive: data.noArchive ?? false,
    followSymlinks: data.followSymlinks ?? false,
    withImageMeta: data.withImageMeta ?? false,
    longFormat: data.longFormat ?? true,
    continueOnError: data.continueOnError ?? true,
    maxResults: data.maxResults ?? 0,
    maxReturnFiles: data.maxReturnFiles ?? 5000,
    groupBy: data.groupBy || undefined,
    refine: data.refine || undefined,
    sortBy: data.sortBy ?? "avgSize",
    sortDesc: data.sortDesc ?? true,
    outputFormat: data.outputFormat ?? "text",
    outputPath: data.outputPath || undefined,
    archiveSeparator: data.archiveSeparator || "//",
    printZero: data.printZero ?? false,
  }
}

function statusFromState(data: FindzCardState, running: boolean, tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string): FindzStatusMeta {
  if (running || data.phase === "searching") {
    return {
      label: tNode("status.running", "运行中"),
      description: data.progressText || tNode("statusDesc.running", "Findz 正在扫描并过滤。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: tNode("status.completed", "完成"),
      description: data.progressText || tNode("statusDesc.completed", "上次搜索已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || (data.result?.errors.length ?? 0) > 0) {
    return {
      label: tNode("status.error", "失败"),
      description: data.progressText || data.result?.errors[0] || tNode("statusDesc.error", "上次搜索失败，请查看日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: tNode("status.idle", "就绪"),
    description: tNode("statusDesc.idle", "粘贴路径并编写 SQL 过滤器后开始搜索。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function labelForAction(action: FindzAction, tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string): string {
  if (action === "search") return tNode("actions.search", "搜索")
  if (action === "archives_only") return tNode("actions.archives_only", "压缩包列举")
  if (action === "nested") return tNode("actions.nested", "嵌套归档")
  if (action === "help") return tNode("actions.help", "帮助")
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.totalCount) return props.tNode("summary.result", "{{total}} 项 / {{archive}} 归档成员", { total: props.result.totalCount, archive: props.result.archiveCount })
  if (props.paths.length) return props.tNode("summary.pathWaiting", "{{count}} 条路径等待搜索", { count: props.paths.length })
  return props.tNode("summary.pasteHint", "粘贴路径后开始搜索")
}

function splitPaths(text?: string): string[] {
  const seen = new Set<string>()
  return (text ?? "")
    .split(/\r?\n|[;]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item && !seen.has(item) && Boolean(seen.add(item)))
}

void HELP_ACTION
