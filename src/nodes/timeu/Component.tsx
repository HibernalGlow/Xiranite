import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { TimeuAction, TimeuData, TimeuInput, TimeuPlanItem } from "@xiranite/node-timeu/core"
import type { LucideIcon } from "lucide-react"
import { Clock3, DatabaseZap, FileClock, FolderInput, History, RotateCcw, Search, Settings2, Terminal } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RunningTint } from "@/nodes/shared/controls"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, NODE_ICON } from "./constants"
import {
  ActionMode,
  ConfirmRunButton,
  LogPanel,
  PathFields,
  ProgressDial,
  RecordField,
  SettingsPopover,
  StatusStrip,
  SwitchPanel,
} from "./controls"
import type { TimeuCardState, TimeuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

type NodeT = ReturnType<typeof useNodeI18n>["t"]
type LedgerItem = TimeuPlanItem | { path: string; operation: "backup" | "restore"; status: "pending" }

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("timeu")
  const data = getHostData(host, compId)
  const dataRef = useRef<TimeuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<TimeuCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "scan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const status = statusFromState(data, running, result, t)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)
  const crampedCompact = surface.mode === "compact" && surface.height > 0 && surface.height < 280

  useEffect(() => {
    const loadConfig = host.config?.get?.() ?? host.getNodeConfig?.<Partial<TimeuCardState>>()
    loadConfig?.then((response) => setDefaults(response.config as Partial<TimeuCardState> | undefined)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.recordPath, data.recursive, data.includeDirectories, data.dryRun, defaults])

  function patch(patchData: Partial<TimeuCardState>) {
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

  async function copyResults() {
    const lines = (dataRef.current.result?.plan ?? []).map((item) => `${item.status}\t${item.operation}\t${item.path}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<TimeuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: TimeuAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = t("errors.noPaths", "请先输入至少一个文件或目录路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("errors.noRunner", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(t("errors.noRunnerLog", "Native action is unavailable in this host."))
      return
    }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.actionStarted", "{{action}}开始", { action: actionLabel(nextAction, t) }), result: null })
    try {
      const response = await run<TimeuInput, TimeuData>("timeu", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<TimeuData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const props: ViewProps = {
    action,
    actionMeta,
    configDirty,
    data,
    defaults,
    logs,
    paths,
    progress,
    result,
    running,
    status,
    t,
    onActionChange: (value) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onRestoreDefault: () => defaults && patch(defaults),
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} data-testid="timeu-surface" className="@container/timeu flex h-full min-h-0 w-full overflow-hidden">
        <div className="flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...props} />
          ) : compactSurface ? (
            portraitCompact
              ? crampedCompact
                ? <CondensedCompactView {...props} />
                : <PortraitCompactView {...props} />
              : crampedCompact
                ? <CondensedCompactView {...props} />
                : <CompactView {...props} />
          ) : (
            <FullView {...props} wide={surface.mode === "workspace" || surface.mode === "expanded" || surface.width >= 960} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

interface ViewProps {
  action: TimeuAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: TimeuCardState
  defaults?: Partial<TimeuCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: TimeuData | null
  running: boolean
  status: TimeuStatusMeta
  t: NodeT
  onActionChange: (value: TimeuAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: TimeuAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<TimeuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

/* ================================ */
/* Collapsed                        */
/* ================================ */

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="timeu-collapsed-view" className="relative flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border border-[#53dcba]/15 bg-[#0b141c]/90 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg border", props.status.tone === "error" ? "border-red-500/30" : "border-[#53dcba]/20", props.status.iconClass)}>
        <Icon className="size-4" />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold leading-none">
          <span className="text-[#53dcba]">TimeU</span>
          <Badge variant={props.status.badgeVariant} className="text-[10px]">{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-[#53dcba]/60">{summaryText(props)}</div>
        <div className="mt-1 truncate text-[11px] text-[#53dcba]/40">{settingsText(props)}</div>
      </div>
      <CollapsedCommandPopover {...props} />
    </div>
  )
}

function CollapsedCommandPopover(props: ViewProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={props.t("actions.command", "操作和参数")} className="relative shrink-0 border-[#53dcba]/20 text-[#53dcba] hover:bg-[#53dcba]/10 hover:text-[#53dcba]" size="icon-sm" variant="outline">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,460px)] border-[#53dcba]/20 bg-[#0b141c]">
        <div className="mb-4">
          <div className="text-sm font-semibold text-[#53dcba]">{props.t("command.title", "TimeU 操作")}</div>
          <p className="text-xs text-[#53dcba]/50">{props.t("command.description", "折叠状态保留完整路径、选项和执行动作。")}</p>
        </div>
        <div className="flex flex-col gap-4">
          <ActionMode disabled={props.running} t={props.t} value={props.action} onChange={props.onActionChange} />
          <PathFields compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} t={props.t} />
          <RecordField data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} />
          <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} />
          <ConfirmRunButton props={props} />
        </div>
      </PopoverContent>
    </Popover