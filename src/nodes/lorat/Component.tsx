import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { LoratAction, LoratData, LoratInput, LoratRow } from "@xiranite/node-lorat/core"
import { applyTriggerDb, collectTriggerDb, filterLoratRows, parseTriggerDb, summarizeLoratRows } from "@xiranite/node-lorat/core"
import { CheckSquare, Copy, Play, RotateCcw, ScrollText, Square, Tags } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathInput,
  SearchInput,
  StatusStrip,
  TriggerDbInput,
} from "./controls"
import { LoratResultTabs } from "./results"
import type { LoratCardState, LoratStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<LoratCardState>(compId) ?? {}
  const dataRef = useRef<LoratCardState>(data)
  dataRef.current = data

  const [, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<LoratCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)
  const [pendingRowAction, setPendingRowAction] = useState<{ row: LoratRow; action: "write_triggers" | "mark_no_trigger" } | null>(null)

  const action = data.action ?? "scan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const logs = data.logs ?? []
  const rows = data.rows ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  const filteredRows = useMemo(() => filterLoratRows(rows, {
    search: data.search,
    statusFilter: data.statusFilter,
    scopeFilter: data.scopeFilter,
  }), [rows, data.search, data.statusFilter, data.scopeFilter])
  const stats = summarizeLoratRows(rows)
  const selectedKeys = rows.filter((row) => row.selected).map((row) => row.key)

  useEffect(() => {
    host.getNodeConfig?.<Partial<LoratCardState>>()
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
    data.folderPath,
    data.triggerDbJson,
    data.search,
    data.statusFilter,
    data.scopeFilter,
    defaults,
  ])

  function patch(patchData: Partial<LoratCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
    setRevision((value) => value + 1)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pasteFolder() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ folderPath: text.trim().split(/\r?\n/)[0]?.trim() ?? "" })
  }

  async function pasteDb() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ triggerDbJson: text })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const lines = filteredRows.map((row) => `${row.name}\t${row.status}\t${row.trigger}\t${row.source}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function execute(nextAction: LoratAction = action, overrideKeys?: string[]) {
    if (running) return
    const current = dataRef.current
    const currentRows = current.rows ?? []

    if (nextAction === "apply_db") {
      try {
        const db = parseTriggerDb(current.triggerDbJson)
        const nextRows = applyTriggerDb(currentRows, db)
        const matched = nextRows.filter((row) => row.dbKey).length
        patch({
          phase: "completed",
          progress: 100,
          progressText: `已应用 TriggerDB 到 ${matched} 行。`,
          action: nextAction,
          rows: nextRows,
        })
        pushLog(`Applied TriggerDB to ${matched} row(s).`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        patch({ phase: "error", progress: 0, progressText: message })
        pushLog(message)
      }
      return
    }

    if (nextAction === "export_db") {
      try {
        const db = collectTriggerDb(currentRows, parseTriggerDb(current.triggerDbJson))
        const json = `${JSON.stringify(db, null, 2)}\n`
        patch({
          phase: "completed",
          progress: 100,
          progressText: `已导出 ${Object.keys(db).length} 条 TriggerDB。`,
          action: nextAction,
          triggerDbJson: json,
        })
        host.downloadText?.("lora-triggers.generated.json", json)
        await host.clipboard?.writeText?.(json)
        pushLog(`Exported ${Object.keys(db).length} TriggerDB entrie(s).`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        patch({ phase: "error", progress: 0, progressText: message })
        pushLog(message)
      }
      return
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input = buildInput(nextAction, current, overrideKeys ?? selectedKeys)
    setRunning(true)
    try {
      patch({ phase: "scanning", progress: 0, progressText: `${labelForAction(nextAction)}开始`, action: nextAction })
      const response = await run<LoratInput, LoratData>("lorat", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<LoratData>

      const next = response.data
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        rows: next?.rows ?? currentRows,
        triggerDbJson: next?.triggerDbJson || current.triggerDbJson,
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

  function updateRow(key: string, patchRow: Partial<LoratRow>) {
    patch({ rows: rows.map((row) => row.key === key ? { ...row, ...patchRow } : row) })
  }

  function toggleRow(row: LoratRow) {
    updateRow(row.key, { selected: !row.selected })
  }

  function editTrigger(row: LoratRow, trigger: string) {
    updateRow(row.key, {
      trigger,
      changed: trigger.trim() !== row.originalTrigger.trim(),
      status: trigger.trim() ? "trigger" : row.originalStatus,
    })
  }

  function selectMissing() {
    const visible = new Set(filteredRows.map((row) => row.key))
    patch({
      rows: rows.map((row) => visible.has(row.key) ? { ...row, selected: row.status === "missing" } : row),
    })
  }

  function clearSelection() {
    patch({ rows: rows.map((row) => row.selected ? { ...row, selected: false } : row) })
  }

  function reset() {
    patch({ rows: [], logs: [], phase: "idle", progress: 0, progressText: "", search: "", statusFilter: "all", scopeFilter: "all" })
  }

  async function saveAsDefault() {
    const config: Partial<LoratCardState> = {}
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
    patch({
      action: undefined,
      folderPath: undefined,
      triggerDbJson: undefined,
      search: undefined,
      statusFilter: undefined,
      scopeFilter: undefined,
    })
  }

  function confirmRowAction(row: LoratRow, rowAction: "write_triggers" | "mark_no_trigger") {
    setPendingRowAction({ row, action: rowAction })
  }

  function canRun(): boolean {
    if (running) return false
    if (action === "scan") return Boolean(data.folderPath?.trim())
    if (action === "apply_db" || action === "export_db") return rows.length > 0
    if (action === "write_triggers" || action === "mark_no_trigger") return selectedKeys.length > 0
    return true
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
    canRun: canRun(),
    configDirty,
    configFilePath,
    data,
    defaults,
    filteredRows,
    host,
    logs,
    progress,
    rows,
    running,
    selectedKeys,
    stats,
    status,
    onClearSelection: clearSelection,
    onConfirmRowAction: confirmRowAction,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onEditTrigger: editTrigger,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPasteDb: pasteDb,
    onPasteFolder: pasteFolder,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onSelectMissing: selectMissing,
    onToggleRow: toggleRow,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/lorat relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-2)_16%,transparent),transparent_34%)]" />
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
      <RowActionDialog
        pending={pendingRowAction}
        onCancel={() => setPendingRowAction(null)}
        onConfirm={(pending) => {
          setPendingRowAction(null)
          void execute(pending.action, [pending.row.key])
        }}
      />
    </TooltipProvider>
  )
}

type ViewProps = ReturnType<typeof createViewProps>

function createViewProps(props: {
  action: LoratAction
  actionMeta: typeof ACTIONS[number]
  canRun: boolean
  configDirty: boolean
  configFilePath?: string
  data: LoratCardState
  defaults?: Partial<LoratCardState>
  filteredRows: LoratRow[]
  host: NodeComponentProps["host"]
  logs: string[]
  progress: number
  rows: LoratRow[]
  running: boolean
  selectedKeys: string[]
  stats: ReturnType<typeof summarizeLoratRows>
  status: LoratStatusMeta
  onClearSelection: () => void
  onConfirmRowAction: (row: LoratRow, action: "write_triggers" | "mark_no_trigger") => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onEditTrigger: (row: LoratRow, trigger: string) => void
  onExecute: (action?: LoratAction, overrideKeys?: string[]) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteDb: () => void
  onPasteFolder: () => void
  onPatch: (patch: Partial<LoratCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onSelectMissing: () => void
  onToggleRow: (row: LoratRow) => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.actionMeta.icon
  return (
    <div data-testid="lorat-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Tags />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Lorat</span>
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
    <div data-testid="lorat-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPasteFolder} onPatch={props.onPatch} />
        <SearchInput compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <LoratResultTabs compact filteredRows={props.filteredRows} logs={props.logs} running={props.running} onClearSelection={props.onClearSelection} onConfirmRowAction={props.onConfirmRowAction} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} onEditTrigger={props.onEditTrigger} onSelectMissing={props.onSelectMissing} onToggleRow={props.onToggleRow} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="lorat-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPasteFolder} onPatch={props.onPatch} />
        <SearchInput compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <LoratResultTabs compact filteredRows={props.filteredRows} logs={props.logs} running={props.running} onClearSelection={props.onClearSelection} onConfirmRowAction={props.onConfirmRowAction} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} onEditTrigger={props.onEditTrigger} onSelectMissing={props.onSelectMissing} onToggleRow={props.onToggleRow} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="lorat-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/lorat:flex-row @4xl/lorat:items-center @4xl/lorat:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/lorat:flex-row @4xl/lorat:items-center">
          <HeaderLine
            actionMeta={props.actionMeta}
            status={props.status}
            subtitle={props.data.progressText || `${props.actionMeta.label} / ${props.data.folderPath ? "已设目录" : "待输入"} / ${props.rows.length} 行`}
          />
          <div data-testid="lorat-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} stats={props.stats} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/lorat:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">任务</div>
              <div className="text-xs text-muted-foreground">选择动作，输入 LoRA 目录或粘贴 TriggerDB。</div>
            </div>
            <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
            <PathInput data={props.data} disabled={props.running} onPaste={props.onPasteFolder} onPatch={props.onPatch} />
            <SearchInput data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">TriggerDB JSON</div>
            <TriggerDbInput data={props.data} disabled={props.running} onPaste={props.onPasteDb} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <LoratResultTabs filteredRows={props.filteredRows} logs={props.logs} running={props.running} onClearSelection={props.onClearSelection} onConfirmRowAction={props.onConfirmRowAction} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} onEditTrigger={props.onEditTrigger} onSelectMissing={props.onSelectMissing} onToggleRow={props.onToggleRow} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && (props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton props={props} />)}
      <ActionIconButton disabled={!props.filteredRows.length} icon={CheckSquare} label="选中缺失" onClick={props.onSelectMissing} />
      <ActionIconButton disabled={!props.selectedKeys.length} icon={RotateCcw} label="清除选择" onClick={props.onClearSelection} />
      <ActionIconButton disabled={!props.filteredRows.length} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={ScrollText} label="复制日志" onClick={props.onCopyLogs} />
      <ActionIconButton icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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
      <Button aria-label="lorat running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }
  const label = `运行${props.actionMeta.shortLabel}`
  const dangerous = isDangerous(props)
  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={!props.canRun} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Lorat？</AlertDialogTitle>
            <AlertDialogDescription>
              当前选择的是{props.actionMeta.label}，将{props.action === "write_triggers" ? "向 sidecar 文件写入触发词" : "写入 no-trigger sidecar"}，已存在的 sidecar 会被覆盖。请确认选择无误后再继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={!props.canRun} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: LoratStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">Lorat</h3>
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
  stats: ReturnType<typeof summarizeLoratRows>
}) {
  const stats = [
    ["总数", props.stats.total],
    ["缺失", props.stats.missing],
    ["已有", props.stats.trigger],
    ["无触发", props.stats.notrigger],
    ["已改", props.stats.changed],
    ["已选", props.stats.selected],
    ["库匹配", props.stats.dbMatched],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div data-testid="lorat-stats-panel" className="grid shrink-0 grid-cols-4 gap-1 @4xl/lorat:grid-cols-8">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "缺失" && Number(value) > 0 && "text-amber-600 dark:text-amber-400")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function RowActionDialog(props: {
  pending: { row: LoratRow; action: "write_triggers" | "mark_no_trigger" } | null
  onCancel: () => void
  onConfirm: (pending: { row: LoratRow; action: "write_triggers" | "mark_no_trigger" }) => void
}) {
  return (
    <AlertDialog open={props.pending !== null} onOpenChange={(open) => { if (!open) props.onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.pending?.action === "write_triggers" ? "确认写入触发词？" : "确认标记无触发词？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {props.pending?.action === "write_triggers"
              ? `将向 ${props.pending?.row.name} 写入触发词 sidecar，已存在的 sidecar 会被覆盖。`
              : `将为 ${props.pending?.row.name} 写入 no-trigger sidecar，标记该 LoRA 没有触发词。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => { if (props.pending) props.onConfirm(props.pending) }}
          >
            确认执行
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function buildInput(action: LoratAction, data: LoratCardState, selectedKeys: string[]): LoratInput {
  return {
    action,
    folderPath: data.folderPath,
    triggerDbJson: data.triggerDbJson,
    rows: data.rows,
    selectedKeys,
  }
}

function statusFromState(data: LoratCardState, running: boolean): LoratStatusMeta {
  if (running || data.phase === "scanning") {
    return {
      label: "运行中",
      description: data.progressText || "Lorat 正在处理 LoRA 模型。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次操作已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: data.progressText || "上次操作失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "输入目录后开始扫描。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isDangerous(props: ViewProps): boolean {
  return props.action === "write_triggers" || props.action === "mark_no_trigger"
}

function labelForAction(action: LoratAction): string {
  if (action === "scan") return "扫描"
  if (action === "apply_db") return "应用 TriggerDB"
  if (action === "write_triggers") return "写入触发词"
  if (action === "mark_no_trigger") return "标记无触发词"
  if (action === "export_db") return "导出 TriggerDB"
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.rows.length) {
    return `${props.stats.total} LoRA / ${props.stats.missing} 缺失 / ${props.stats.trigger} 已有 / ${props.stats.notrigger} 无触发`
  }
  if (props.data.folderPath) return `${props.data.folderPath} 等待扫描`
  return "粘贴目录后开始扫描"
}
