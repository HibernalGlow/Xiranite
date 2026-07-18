import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { FloatingWindowNodeHeader } from "@/components/workspace/FloatingWindowFrame"
import type { CoveruAction, CoveruCandidate, CoveruData, CoveruInput, CoveruOutputMode } from "@xiranite/node-coveru/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, Clipboard, Copy, FolderInput, GalleryThumbnails, Image as ImageIcon, Images, PackageOpen, Play, RotateCcw, ShieldAlert, Square, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PathTextarea } from "@/components/ui/path-input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { tNode, useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, DEFAULT_PREFERRED_NAMES_TEXT, NODE_ICON } from "./constants"
import type { CoveruCardState, CoveruStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<CoveruCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("coveru")
  const data = getHostData(host, compId)
  const dataRef = useRef<CoveruCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<CoveruCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "scan"
  const actionMeta = getActionMeta(action, t)
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const paths = splitLines(data.pathsText)
  const candidates = result?.candidates ?? paths.map((path) => placeholderCandidate(path))
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  async function reloadDefaults() {
    const loadConfig = host.config?.get?.<Partial<CoveruCardState>>() ?? host.getNodeConfig?.<Partial<CoveruCardState>>()
    try {
      const response = await loadConfig
      if (response) {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      }
    } catch {
      // Persistent defaults are optional in browser-only preview hosts.
    }
  }

  useEffect(() => {
    void reloadDefaults()
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.outputDir, data.outputMode, data.preferredNamesText, data.overwrite, data.recursive, data.dryRun, defaults])

  function patch(patchData: Partial<CoveruCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-120) })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const lines = (dataRef.current.result?.candidates ?? []).map((item) => `${item.status}\t${item.sourcePath}\t${item.sourceEntry}\t${item.outputPath}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<CoveruCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  async function execute(nextAction: CoveruAction = action) {
    if (running) return
    const current = dataRef.current
    if (!splitLines(current.pathsText).length) {
      const message = t("error.pathRequired", "请先输入至少一个归档、图片或目录路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("progress.start", "{{action}}开始", { action: actionLabel(nextAction) }), result: null })
    try {
      const response = await run<CoveruInput, CoveruData>("coveru", buildInput(nextAction, current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<CoveruData>

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

  const commonProps = {
    action,
    actionMeta,
    candidates,
    configDirty,
    configFilePath,
    data,
    defaults,
    logs,
    paths,
    progress,
    result,
    running,
    status,
    onActionChange: (value: CoveruAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: reloadDefaults,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/coveru flex h-full min-h-0 w-full overflow-hidden">
        {surface.mode === "collapsed" || forceCollapsedSurface ? (
          <CollapsedView {...commonProps} />
        ) : compactSurface ? (
          portraitCompact ? <PortraitCompactView {...commonProps} /> : <CompactView {...commonProps} />
        ) : (
          <FullView {...commonProps} />
        )}
      </div>
    </TooltipProvider>
  )
}

type ViewProps = {
  action: CoveruAction
  actionMeta: (typeof ACTIONS)[number]
  candidates: CoveruCandidate[]
  configDirty: boolean
  configFilePath?: string
  data: CoveruCardState
  defaults?: Partial<CoveruCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: CoveruData | null
  running: boolean
  status: CoveruStatusMeta
  onActionChange: (value: CoveruAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: CoveruAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<CoveruCardState>) => void
  onReset: () => void
  onReloadDefaults: () => Promise<void>
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="coveru-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>{tNode("coveru", "name", "CoverU")}</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunActionButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="coveru-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <ActionCluster {...props} compact />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <CandidateStrip candidates={props.candidates} />
        {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
        <div className="min-h-0 flex-1">
          <ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="coveru-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <RunActionButton compact props={props} />
      </div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <CandidateStrip candidates={props.candidates} />
      <div className="min-h-0 flex-1">
        <ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="coveru-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/coveru:flex-row @3xl/coveru:items-center @3xl/coveru:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/coveru:flex-row @3xl/coveru:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="coveru-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1">
            <ActionCluster {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} candidates={props.candidates} />
      </div>

      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}

      <div className="grid min-h-0 flex-1 gap-2 grid-cols-1 @3xl/coveru:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] @3xl/coveru:grid-rows-[auto_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border bg-card p-2 @3xl/coveru:col-span-2">
          <ZoneTitle icon={FolderInput} label={tNode("coveru", "sections.queue", "归档队列")} />
          <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        </section>

        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-card p-2">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <ZoneTitle icon={GalleryThumbnails} label={tNode("coveru", "sections.candidates", "封面候选")} />
            <Badge variant="outline">{props.candidates.length}</Badge>
          </div>
          <CandidateGrid candidates={props.candidates} />
        </section>

        <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @3xl/coveru:col-start-2 @3xl/coveru:row-start-2">
          <ExecutionGate {...props} />
          <ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ActionCluster(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <NodeConfigPopover
        configPath={props.configFilePath}
        defaults={props.defaults}
        dirty={props.configDirty}
        disabled={props.running}
        t={tNode.bind(null, "coveru")}
        onOpenFile={props.onOpenConfigFile}
        onReload={props.onReloadDefaults}
        onRestore={props.onRestoreDefault}
        onSave={props.onSaveDefault}
      />
       <IconButton icon={RotateCcw} label={tNode("coveru", "actions.clearState", "清空状态")} onClick={props.onReset} />
    </div>
  )
}

function ActionMode(props: { disabled?: boolean; value: CoveruAction; onChange: (value: CoveruAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as CoveruAction)} className="grid grid-cols-3" size="sm">
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1">
          <item.icon className="size-3.5" />
           <span className="truncate text-xs">{tNode("coveru", `actions.${item.value}.shortLabel`, item.shortLabel)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function PathInput(props: { compact?: boolean; data: CoveruCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<CoveruCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
       {!props.compact && <Label htmlFor="coveru-paths" className="text-xs">{tNode("coveru", "fields.paths.label", "归档、图片或目录")}</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <PathTextarea
          id="coveru-paths"
           aria-label={tNode("coveru", "aria.paths", "coveru paths")}
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")}
          disabled={props.disabled}
           placeholder={tNode("coveru", "fields.paths.placeholder", "每行一个 ZIP/CBZ、图片或目录\nD:/archives/book.zip")}
          value={props.data.pathsText ?? ""}
          onValueChange={(pathsText) => props.onPatch({ pathsText })}
        />
        <div className="grid content-start gap-1.5">
           <IconButton disabled={props.disabled} icon={Clipboard} label={tNode("coveru", "actions.pastePaths", "粘贴路径")} onClick={props.onPaste} />
           <IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label={tNode("coveru", "actions.clearPaths", "清空路径")} onClick={() => props.onPatch({ pathsText: "" })} />
        </div>
      </div>
    </div>
  )
}

function OutputFields(props: { data: CoveruCardState; disabled?: boolean; onPatch: (patch: Partial<CoveruCardState>) => void }) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="coveru-output" className="text-xs">{tNode("coveru", "fields.outputDir.label", "输出目录")}</Label>
        <Input id="coveru-output" disabled={props.disabled} placeholder={tNode("coveru", "fields.outputDir.placeholder", "留空则输出到归档旁边")} value={props.data.outputDir ?? ""} onChange={(event) => props.onPatch({ outputDir: event.currentTarget.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">{tNode("coveru", "fields.outputMode.label", "输出位置")}</Label>
        <ToggleGroup type="single" value={props.data.outputMode ?? "alongside"} disabled={props.disabled} onValueChange={(value) => value && props.onPatch({ outputMode: value as CoveruOutputMode })} className="grid grid-cols-2" size="sm">
          <ToggleGroupItem value="alongside">{tNode("coveru", "fields.outputMode.alongside", "归档旁边")}</ToggleGroupItem>
          <ToggleGroupItem value="directory">{tNode("coveru", "fields.outputMode.directory", "统一目录")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="coveru-preferred" className="text-xs">{tNode("coveru", "fields.preferredNames.label", "优先文件名")}</Label>
        <Input id="coveru-preferred" disabled={props.disabled} value={props.data.preferredNamesText ?? DEFAULT_PREFERRED_NAMES_TEXT} onChange={(event) => props.onPatch({ preferredNamesText: event.currentTarget.value })} />
      </div>
    </div>
  )
}

function SwitchPanel(props: { compact?: boolean; data: CoveruCardState; disabled?: boolean; onPatch: (patch: Partial<CoveruCardState>) => void }) {
  return (
    <div className={cn("grid gap-2", props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]")}>
      <SwitchRow checked={props.data.dryRun ?? true} disabled={props.disabled} icon={ShieldAlert} label={tNode("coveru", "fields.dryRun", "预览")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
      <SwitchRow checked={props.data.recursive ?? true} disabled={props.disabled} icon={PackageOpen} label={tNode("coveru", "fields.recursive", "递归")} onCheckedChange={(recursive) => props.onPatch({ recursive })} />
      <SwitchRow checked={props.data.overwrite ?? false} disabled={props.disabled} icon={AlertTriangle} label={tNode("coveru", "fields.overwrite", "覆盖")} danger={props.data.overwrite} onCheckedChange={(overwrite) => props.onPatch({ overwrite })} />
    </div>
  )
}

function ExecutionGate(props: ViewProps) {
  const live = props.action === "extract" && !(props.data.dryRun ?? true)
  return (
    <section className={cn("flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50 bg-destructive/[0.03]")}>
      <div className="flex items-center justify-between gap-2">
        <ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label={tNode("coveru", "sections.execution", "执行")} tone={live ? "danger" : "default"} />
        <Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? tNode("coveru", "mode.preview", "预览") : tNode("coveru", "mode.write", "写入")}</Badge>
      </div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <OutputFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <SwitchPanel data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <RunActionButton props={props} />
    </section>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label={tNode("coveru", "aria.running", "coveru running")} disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>{tNode("coveru", "status.running", "运行中")}</span>}
      </Button>
    )
  }
  const label = actionLabel(props.action)
  const live = props.action === "extract" && !(props.data.dryRun ?? true)
  const disabled = props.running
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tNode("coveru", "confirm.title", "确认提取封面？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tNode("coveru", "confirm.description", "当前会写出封面文件。请确认输出目录和覆盖策略无误；不支持的归档会被跳过。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tNode("coveru", "buttons.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>{tNode("coveru", "buttons.confirmExtract", "确认提取")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function CandidateGrid(props: { candidates: CoveruCandidate[] }) {
  if (!props.candidates.length) return <EmptyCandidateState />
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid grid-cols-2 gap-2 p-0.5 @md/coveru:grid-cols-3 @4xl/coveru:grid-cols-4">
        {props.candidates.slice(0, 80).map((item, index) => <CandidateCard key={`${item.sourcePath}:${item.sourceEntry}:${index}`} item={item} index={index} />)}
      </div>
    </ScrollArea>
  )
}

function CandidateStrip(props: { candidates: CoveruCandidate[] }) {
  if (!props.candidates.length) return null
  return (
    <ScrollArea className="shrink-0">
      <div className="flex gap-1.5 pb-1">
        {props.candidates.slice(0, 16).map((item, index) => (
          <div key={`${item.sourcePath}:${index}`} className="w-14 shrink-0">
            <CoverPlaceholder item={item} index={index} />
            <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{baseName(item.sourcePath)}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function CandidateCard(props: { item: CoveruCandidate; index: number }) {
  const meta = statusMeta(props.item.status)
  const StatusIcon = meta.icon
  return (
    <div className={cn("grid gap-1.5 rounded-md border bg-card p-1.5", props.item.status === "error" && "border-destructive/40", props.item.status === "unsupported" && "border-muted-foreground/30")}>
      <CoverPlaceholder item={props.item} index={props.index} />
      <div className="flex min-w-0 items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{baseName(props.item.sourceEntry || props.item.sourcePath)}</div>
          <div className="truncate text-[10px] text-muted-foreground">{baseName(props.item.sourcePath)}</div>
        </div>
        <Badge variant={meta.variant} className="gap-1">
          <StatusIcon className="size-3" />
          {meta.label}
        </Badge>
      </div>
      {props.item.outputPath && <div className="truncate font-mono text-[10px] text-muted-foreground">{props.item.outputPath}</div>}
    </div>
  )
}

function CoverPlaceholder(props: { item: CoveruCandidate; index: number }) {
  const meta = statusMeta(props.item.status)
  return (
    <div className={cn("relative aspect-[3/4] overflow-hidden rounded-md border bg-card", props.item.status === "ready" && "border-primary/35", props.item.status === "unsupported" && "opacity-70")}>
      <div className="absolute inset-0 grid place-items-center">
        <ImageIcon className="size-6 text-muted-foreground/55" />
      </div>
       <div className="absolute left-1 top-1 rounded-sm bg-card px-1 text-[9px] font-semibold tabular-nums text-muted-foreground">{props.index + 1}</div>
      <div className={cn("absolute bottom-1 right-1 grid size-4 place-items-center rounded-full", meta.dotClass)}>
        <meta.icon className="size-3" />
      </div>
    </div>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: CoveruData | null; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="candidates" className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="candidates">{tNode("coveru", "tabs.results", "结果")}</TabsTrigger>
        <TabsTrigger value="errors">{tNode("coveru", "tabs.errors", "问题")}</TabsTrigger>
        <TabsTrigger value="logs">{tNode("coveru", "tabs.logs", "日志")}</TabsTrigger>
      </TabsList>
      <TabsContent value="candidates" className="min-h-0 flex-1">
        <CandidateRows compact={props.compact} candidates={props.result?.candidates ?? []} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="errors" className="min-h-0 flex-1">
        <TextPanel empty={tNode("coveru", "empty.noIssues", "暂无问题")} lines={[...(props.result?.errors ?? []), ...(props.result?.candidates ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel actionLabel={tNode("coveru", "buttons.copy", "复制")} empty={tNode("coveru", "empty.logs", "运行日志会显示在这里。")} lines={props.logs} onAction={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function CandidateRows(props: { compact?: boolean; candidates: CoveruCandidate[]; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Images className="size-3.5" />
          <span>{props.candidates.length ? tNode("coveru", "results.count", "{{count}} 项", { count: props.candidates.length }) : tNode("coveru", "results.waiting", "等待运行")}</span>
        </div>
        <Button disabled={!props.candidates.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          {tNode("coveru", "buttons.copy", "复制")}
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.candidates.length ? (
          <div className={cn("grid gap-1", props.compact ? "p-2" : "p-3")}>
            {props.candidates.slice(0, 140).map((item, index) => (
              <div key={`${item.sourcePath}:${item.sourceEntry}:${index}`} className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5">
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{baseName(item.sourcePath)} {item.sourceEntry ? `/ ${item.sourceEntry}` : ""}</div>
                   <div className="truncate font-mono text-[11px] text-muted-foreground">{item.outputPath || item.reason || tNode("coveru", "results.noOutput", "未生成输出")}</div>
                </div>
                <Badge variant={statusMeta(item.status).variant}>{statusMeta(item.status).label}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-24 items-center justify-center p-4 text-center text-sm text-muted-foreground">{tNode("coveru", "empty.results", "运行后显示候选和输出路径。")}</div>
        )}
      </ScrollArea>
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; lines: string[]; onAction?: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{props.lines.length ? tNode("coveru", "results.lines", "{{count}} 行", { count: props.lines.length }) : props.empty}</span>
        {props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? tNode("coveru", "buttons.copy", "复制")}</Button>}
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}
      </ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: CoveruStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return (
    <FloatingWindowNodeHeader>
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
          <Icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">{tNode("coveru", "name", "CoverU")}</h3>
            <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p>
        </div>
      </div>
    </div>
    </FloatingWindowNodeHeader>
  )
}

function StatsPanel(props: { candidates: CoveruCandidate[]; progress: number; result: CoveruData | null }) {
  const stats = [
     { label: tNode("coveru", "stats.candidates", "候选"), value: props.candidates.length },
     { label: tNode("coveru", "stats.ready", "可提取"), value: props.result?.readyCount ?? props.candidates.filter((item) => item.status === "ready").length },
     { label: tNode("coveru", "stats.extracted", "已提取"), value: props.result?.extractedCount ?? 0 },
     { label: tNode("coveru", "stats.unsupported", "不支持"), value: props.result?.unsupportedCount ?? props.candidates.filter((item) => item.status === "unsupported").length },
     { label: tNode("coveru", "stats.errors", "错误"), value: props.result?.errorCount ?? 0, danger: true },
     { label: tNode("coveru", "stats.progress", "进度"), value: props.progress, suffix: "%" },
  ]
  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/coveru:grid-cols-6">
      {stats.map((item) => (
        <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{item.label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", item.danger && item.value > 0 && "text-destructive")}>{item.value}{item.suffix ?? ""}</div>
        </div>
      ))}
    </div>
  )
}

function StatusStrip(props: { progress: number; status: CoveruStatusMeta; text?: string }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
        <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
      </div>
      <Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} />
    </div>
  )
}

function SwitchRow(props: { checked: boolean; danger?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onCheckedChange: (checked: boolean) => void }) {
  const Icon = props.icon
  const id = `coveru-switch-${props.label}`
  return (
    <Field orientation="horizontal" className={cn("rounded-md border bg-card px-2 py-1.5", props.danger && "border-destructive/40")}>
      <FieldContent className="min-w-0">
        <FieldLabel htmlFor={id} className="min-w-0 text-xs">
          <Icon className={cn("size-4 shrink-0 text-muted-foreground", props.danger && "text-destructive")} />
          <span className="truncate">{props.label}</span>
        </FieldLabel>
      </FieldContent>
      <Switch id={id} aria-label={props.label} checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
    </Field>
  )
}

function IconButton(props: { active?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant={props.active ? "secondary" : "outline"} onClick={props.onClick}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function ZoneTitle(props: { icon: LucideIcon; label: string; tone?: "default" | "danger" }) {
  const Icon = props.icon
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Icon className={cn("size-3.5", props.tone === "danger" ? "text-destructive" : "text-muted-foreground")} />
      <span className="text-xs font-semibold">{props.label}</span>
    </div>
  )
}

function EmptyCandidateState() {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      <Images className="size-6 text-muted-foreground/50" />
      <span>{tNode("coveru", "empty.candidates", "输入归档后显示封面候选。")}</span>
    </div>
  )
}

function statusFromState(data: CoveruCardState, running: boolean, result: CoveruData | null): CoveruStatusMeta {
  if (running || data.phase === "running") {
    return { label: tNode("coveru", "status.running", "运行中"), description: data.progressText || tNode("coveru", "statusDesc.running", "CoverU 正在扫描或提取封面。"), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  }
  if (data.phase === "error" || result?.errorCount) {
    return { label: tNode("coveru", "status.error", "失败"), description: data.progressText || result?.errors[0] || tNode("coveru", "statusDesc.error", "上次任务失败，请查看问题列表。"), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  }
  if (data.phase === "completed") {
    return { label: tNode("coveru", "status.completed", "完成"), description: data.progressText || tNode("coveru", "statusDesc.completed", "上次封面任务已完成。"), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  }
  return { label: tNode("coveru", "status.idle", "就绪"), description: tNode("coveru", "statusDesc.idle", "输入归档、图片或目录后扫描封面。"), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function statusMeta(status: CoveruCandidate["status"]) {
  if (status === "ready") return { icon: CheckCircle2, label: tNode("coveru", "candidate.ready", "可提取"), variant: "secondary" as const, dotClass: "bg-primary text-primary-foreground" }
  if (status === "extracted") return { icon: CheckCircle2, label: tNode("coveru", "candidate.extracted", "已提取"), variant: "default" as const, dotClass: "bg-primary text-primary-foreground" }
  if (status === "unsupported") return { icon: AlertTriangle, label: tNode("coveru", "candidate.unsupported", "不支持"), variant: "outline" as const, dotClass: "bg-muted text-muted-foreground" }
  if (status === "error") return { icon: XCircle, label: tNode("coveru", "candidate.error", "错误"), variant: "destructive" as const, dotClass: "bg-destructive text-destructive-foreground" }
  if (status === "empty") return { icon: ImageIcon, label: tNode("coveru", "candidate.empty", "无图片"), variant: "outline" as const, dotClass: "bg-muted text-muted-foreground" }
  return { icon: AlertTriangle, label: tNode("coveru", "candidate.skipped", "跳过"), variant: "outline" as const, dotClass: "bg-muted text-muted-foreground" }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return tNode("coveru", "summary.result", "{{candidates}} 项 / {{available}} 可用", { candidates: props.result.candidates.length, available: props.result.readyCount + props.result.extractedCount })
  if (props.paths.length) return tNode("coveru", "summary.paths", "{{paths}} 条路径 / {{action}}", { paths: props.paths.length, action: props.actionMeta.shortLabel })
  return props.actionMeta.description
}

function actionLabel(action: CoveruAction): string {
  return tNode("coveru", `actions.${action}.label`, ACTIONS.find((item) => item.value === action)?.label ?? action)
}

function getActionMeta(action: CoveruAction, t: ReturnType<typeof useNodeI18n>["t"]): (typeof ACTIONS)[number] {
  const meta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  return {
    ...meta,
    label: t(`actions.${meta.value}.label`, meta.label),
    shortLabel: t(`actions.${meta.value}.shortLabel`, meta.shortLabel),
    description: t(`actions.${meta.value}.description`, meta.description),
  }
}

function buildInput(action: CoveruAction, data: CoveruCardState): CoveruInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    outputDir: clean(data.outputDir),
    outputMode: data.outputMode ?? "alongside",
    overwrite: data.overwrite ?? false,
    recursive: data.recursive ?? true,
    dryRun: data.dryRun ?? true,
    preferredNames: splitPreferred(data.preferredNamesText),
  }
}

function placeholderCandidate(path: string): CoveruCandidate {
  return { sourcePath: path, sourceEntry: "", outputPath: "", sourceKind: "archive-entry", extension: "", score: 0, status: "ready" }
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function splitPreferred(value: unknown): string[] {
  return String(value || DEFAULT_PREFERRED_NAMES_TEXT).split(/,|\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}

function getHostData(host: NodeComponentProps<CoveruCardState>["host"], compId: string): CoveruCardState {
  return host.state?.getData?.() ?? host.getData<CoveruCardState>(compId) ?? {}
}
