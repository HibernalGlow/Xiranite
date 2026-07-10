import type { LucideIcon } from "lucide-react"
import type { TimeuAction, TimeuPlanItem } from "@xiranite/node-timeu/core"
import { AlertTriangle, CheckCircle2, Clipboard, Clock3, Copy, Eye, FileClock, FolderInput, FolderTree, History, Info, RotateCcw, Settings2, ShieldAlert, Terminal, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { ACTIONS } from "./constants"
import type { TimeuCardState, TimeuStatusMeta } from "./types"

type NodeT = ReturnType<typeof useNodeI18n>["t"]

interface PatchProps {
  data: TimeuCardState
  disabled?: boolean
  onPatch: (patch: Partial<TimeuCardState>) => void
  t: NodeT
}

export function PathFields({ compact = false, data, disabled, onPatch, onPaste, t }: PatchProps & {
  compact?: boolean
  onPaste: () => void
}) {
  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel className="flex items-center gap-1.5" htmlFor="timeu-paths">
          <FolderInput className="size-3.5" />
          {t("fields.paths", "文件或目录")}
        </FieldLabel>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <Textarea
            id="timeu-paths"
            aria-label={t("fields.pathsAria", "文件或目录路径")}
            className={cn("min-h-0 resize-none font-mono text-xs", compact ? "h-14" : "h-28")}
            disabled={disabled}
            placeholder={t("fields.pathsPlaceholder", "每行一个文件或目录\nD:/archive")}
            value={data.pathsText ?? ""}
            onChange={(event) => onPatch({ pathsText: event.currentTarget.value })}
          />
          <div className="grid content-start gap-1.5">
            <IconButton disabled={disabled} icon={Clipboard} label={t("actions.paste", "粘贴路径")} onClick={onPaste} />
            <IconButton disabled={disabled || !data.pathsText} icon={Trash2} label={t("actions.clearPaths", "清空路径")} onClick={() => onPatch({ pathsText: "" })} />
          </div>
        </div>
        <FieldDescription>{t("fields.pathsDescription", "每行一个路径，留空则使用默认记录文件。")}</FieldDescription>
      </Field>
    </FieldGroup>
  )
}

export function RecordField({ data, disabled, onPatch, t }: PatchProps) {
  return (
    <Field>
      <FieldLabel className="flex items-center gap-1.5" htmlFor="timeu-record">
        <FileClock className="size-3.5" />
        {t("fields.record", "记录文件")}
      </FieldLabel>
      <Input
        id="timeu-record"
        aria-label={t("fields.recordAria", "记录文件路径")}
        disabled={disabled}
        placeholder={t("fields.recordPlaceholder", "留空则在首个路径旁生成 timeu-timestamps.json")}
        value={data.recordPath ?? ""}
        onChange={(event) => onPatch({ recordPath: event.currentTarget.value })}
      />
      <FieldDescription>{t("fields.recordDescription", "JSON 时间戳记录文件，用于备份与恢复。")}</FieldDescription>
    </Field>
  )
}

export function SwitchPanel({ compact = false, data, disabled, onPatch, t }: PatchProps & {
  compact?: boolean
}) {
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]")}>
      <SwitchRow
        checked={data.dryRun ?? true}
        description={t("fields.dryRunDescription", "只生成计划，不写入记录或修改时间。")}
        disabled={disabled}
        icon={ShieldAlert}
        label={t("fields.dryRun", "预览")}
        t={t}
        onCheckedChange={(dryRun) => onPatch({ dryRun })}
      />
      <SwitchRow
        checked={data.recursive ?? true}
        description={t("fields.recursiveDescription", "递归扫描子目录中的文件。")}
        disabled={disabled}
        icon={FolderTree}
        label={t("fields.recursive", "递归")}
        t={t}
        onCheckedChange={(recursive) => onPatch({ recursive })}
      />
      <SwitchRow
        checked={data.includeDirectories ?? false}
        description={t("fields.includeDirectoriesDescription", "把目录本身也纳入时间戳记录。")}
        disabled={disabled}
        icon={FileClock}
        label={t("fields.includeDirectories", "含目录")}
        t={t}
        onCheckedChange={(includeDirectories) => onPatch({ includeDirectories })}
      />
    </div>
  )
}

export function ActionMode({ disabled, value, t, onChange }: {
  disabled?: boolean
  value: TimeuAction
  t: NodeT
  onChange: (value: TimeuAction) => void
}) {
  return (
    <ToggleGroup
      aria-label={t("actions.modeAria", "时间戳操作模式")}
      className="grid w-full grid-cols-3"
      disabled={disabled}
      size="sm"
      type="single"
      value={value}
      variant="outline"
      onValueChange={(next) => {
        if (next) onChange(next as TimeuAction)
      }}
    >
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} aria-label={item.label} className="min-w-0 gap-1" value={item.value}>
          <item.icon data-icon="inline-start" />
          <span className="truncate text-xs">{item.shortLabel}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function ConfirmRunButton({ compact = false, props }: {
  compact?: boolean
  props: {
    action: TimeuAction
    running: boolean
    t: NodeT
    onExecute: (action?: TimeuAction) => void
  }
}) {
  const { action, running, t, onExecute } = props
  if (running) {
    return (
      <Button aria-label={t("actions.running", "运行中")} disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Clock3 data-icon="inline-start" />
        {!compact && <span>{t("actions.running", "运行中")}</span>}
      </Button>
    )
  }
  const live = action !== "scan"
  const label = actionLabel(action, t)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <History data-icon="inline-start" />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "restore"
                ? t("confirm.restoreTitle", "确认恢复时间戳？")
                : t("confirm.backupTitle", "确认备份时间戳？")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm.description", "当前操作将写入记录文件或修改文件 atime/mtime。请确认路径和记录文件无误。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onExecute(action)}>
              {t("actions.confirm", "确认执行")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return (
    <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => onExecute(action)}>
      <History data-icon="inline-start" />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

export function SettingsPopover({ data, disabled, onPatch, onPaste, t }: PatchProps & {
  onPaste: () => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label={t("actions.settings", "路径与选项")} disabled={disabled} size="icon-sm" variant="outline">
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("actions.settings", "路径与选项")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t("settings.title", "路径与选项")}</div>
            <p className="text-xs text-muted-foreground">{t("settings.description", "调整路径队列、记录文件和扫描选项。")}</p>
          </div>
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-4">
          <PathFields compact data={data} disabled={disabled} onPaste={onPaste} onPatch={onPatch} t={t} />
          <RecordField data={data} disabled={disabled} onPatch={onPatch} t={t} />
          <SwitchPanel compact data={data} disabled={disabled} onPatch={onPatch} t={t} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ProgressDial({ compact = false, progress, running, status, t }: {
  compact?: boolean
  progress: number
  running: boolean
  status: TimeuStatusMeta
  t: NodeT
}) {
  const value = Math.max(0, Math.min(100, progress))
  return (
    <div className="relative grid shrink-0 place-items-center">
      <AnimatedCircularProgressBar
        ariaLabel={t("dial.aria", "任务进度")}
        className={cn(compact ? "size-28 text-base" : "size-44 text-xl")}
        gaugePrimaryColor="var(--primary)"
        gaugeSecondaryColor="var(--muted)"
        value={value}
      >
        <div className="flex flex-col items-center gap-1 text-center">
          {running ? (
            <div className={cn("font-semibold tabular-nums", compact ? "text-xl" : "text-3xl")}>
              {value}
              <span className="text-sm">%</span>
            </div>
          ) : status.tone === "success" ? (
            <CheckCircle2 className={cn("text-primary", compact ? "size-6" : "size-9")} />
          ) : status.tone === "error" ? (
            <AlertTriangle className={cn("text-destructive", compact ? "size-6" : "size-9")} />
          ) : (
            <Clock3 className={cn("text-muted-foreground", compact ? "size-6" : "size-9")} />
          )}
          <div className="text-[11px] text-muted-foreground">
            {running ? t("dial.running", "处理中") : status.label}
          </div>
        </div>
      </AnimatedCircularProgressBar>
      {running && <span className="pointer-events-none absolute inset-2 rounded-full ring-2 ring-primary/30 animate-pulse" />}
    </div>
  )
}

export function StatusStrip({ compact = false, progress, status, text, t }: {
  compact?: boolean
  progress: number
  status: TimeuStatusMeta
  text?: string
  t: NodeT
}) {
  return (
    <Card className={cn("gap-0 py-0", compact && "rounded-lg")}>
      <CardContent className={cn("grid gap-2 p-3", compact && "p-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <Badge className="shrink-0" variant={status.badgeVariant}>{status.label}</Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{text || status.description}</span>
        </div>
        {status.tone === "running" && <Progress aria-label={t("status.progressAria", "当前任务进度")} value={progress} />}
      </CardContent>
    </Card>
  )
}

export function TimestampLedger({ compact = false, plan, t }: {
  compact?: boolean
  plan: Array<TimeuPlanItem | { path: string; operation: "backup" | "restore"; status: "pending" }>
  t: NodeT
}) {
  if (!plan.length) {
    return (
      <Empty className="h-full min-h-36 border-0 p-4">
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileClock /></EmptyMedia>
          <EmptyTitle className="text-sm">{t("ledger.emptyTitle", "暂无记录")}</EmptyTitle>
          <EmptyDescription className="text-xs">{t("ledger.emptyDescription", "运行后显示当前时间、记录时间和恢复计划。")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ScrollArea className={cn("h-full min-h-0", compact && "max-h-48")}>
      <ItemGroup className="gap-1 p-2">
        {plan.slice(0, 160).map((item, index) => {
          const meta = itemStatusMeta(item.status, t)
          const StatusIcon = meta.icon
          const current = "current" in item ? item.current : undefined
          const stored = "stored" in item ? item.stored : undefined
          return (
            <Item key={`${item.path}:${index}`} size="sm" variant="muted" className={cn(item.status === "error" && "border-destructive/40", item.status === "skipped" && "opacity-75")}>
              <ItemMedia variant="icon"><StatusIcon /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="truncate font-mono text-xs">{baseName(item.path)}</ItemTitle>
                <ItemDescription className="truncate font-mono text-[11px]">{item.path}</ItemDescription>
                {(current || stored) && (
                  <div className="mt-1 grid gap-1 text-[11px] text-muted-foreground @md/timeu:grid-cols-2">
                    <span className="truncate">
                      {t("ledger.current", "当前")} {current ? formatMs(current.mtimeMs) : t("ledger.missing", "缺失")}
                    </span>
                    <span className="truncate">
                      {t("ledger.stored", "记录")} {stored ? formatMs(stored.mtimeMs) : t("ledger.notWritten", "未写入")}
                    </span>
                  </div>
                )}
              </ItemContent>
              <Badge variant={meta.variant} className="shrink-0 gap-1">
                <StatusIcon className="size-3" />
                {meta.label}
              </Badge>
            </Item>
          )
        })}
      </ItemGroup>
    </ScrollArea>
  )
}

export function LogPanel({ compact = false, logs, t, onCopyLogs, onReset }: {
  compact?: boolean
  logs: string[]
  t: NodeT
  onCopyLogs: () => void
  onReset: () => void
}) {
  return (
    <Card className="h-full min-h-0 gap-0 py-0" data-testid="timeu-history-panel">
      <CardHeader className="border-b px-3 py-3 !pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal />
          {t("history.title", "运行日志")}
        </CardTitle>
        <CardDescription className="text-xs">{t("history.description", "扫描、备份、恢复的过程与错误按顺序记录。")}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button aria-label={t("actions.copy", "复制")} disabled={!logs.length} size="icon-sm" variant="outline" onClick={onCopyLogs}><Copy /></Button>
          <Button aria-label={t("actions.reset", "重置")} size="icon-sm" variant="ghost" onClick={onReset}><RotateCcw /></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">
        <ScrollArea className={cn("h-full min-h-0", compact && "max-h-32")}>
          {logs.length ? (
            <ItemGroup className="gap-1 p-2">
              {logs.map((line, index) => (
                <Item key={`${index}-${line}`} size="sm" variant="muted">
                  <ItemMedia variant="icon"><Terminal /></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="break-all font-mono text-xs">{line}</ItemTitle>
                    <ItemDescription className="text-[10px]">{t("history.sequence", "记录 #{{count}}", { count: String(index + 1).padStart(3, "0") })}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <Empty className="h-full min-h-36 border-0 p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Terminal /></EmptyMedia>
                <EmptyTitle className="text-sm">{t("history.emptyTitle", "暂无日志")}</EmptyTitle>
                <EmptyDescription className="text-xs">{t("history.emptyDescription", "启动后会显示扫描、备份和恢复的过程。")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export function MetricGrid({ paths, progress, result, t }: {
  paths: string[]
  progress: number
  result: { scannedCount?: number; backupCount?: number; restoredCount?: number; skippedCount?: number; errorCount?: number } | null
  t: NodeT
}) {
  const metrics: Array<{ icon: LucideIcon; label: string; value: number; suffix?: string }> = [
    { icon: FolderInput, label: t("metrics.paths", "路径"), value: paths.length },
    { icon: Clock3, label: t("metrics.scanned", "扫描"), value: result?.scannedCount ?? 0 },
    { icon: History, label: t("metrics.backup", "备份"), value: result?.backupCount ?? 0 },
    { icon: RotateCcw, label: t("metrics.restored", "恢复"), value: result?.restoredCount ?? 0 },
    { icon: Eye, label: t("metrics.skipped", "跳过"), value: result?.skippedCount ?? 0 },
    { icon: AlertTriangle, label: t("metrics.progress", "进度"), value: progress, suffix: "%" },
  ]
  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/timeu:grid-cols-6">
      {metrics.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-1 truncate text-[11px] text-muted-foreground">
              <Icon className="size-3 shrink-0" />
              {item.label}
            </div>
            <div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div>
          </div>
        )
      })}
    </div>
  )
}

function SwitchRow(props: {
  checked: boolean
  description?: string
  disabled?: boolean
  icon: LucideIcon
  label: string
  t: NodeT
  onCheckedChange: (checked: boolean) => void
}) {
  const Icon = props.icon
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
      <label className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{props.label}</span>
        </span>
        <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
      </label>
      {props.description && <InfoHint label={props.label} description={props.description} />}
    </div>
  )
}

function IconButton(props: { disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant="outline" onClick={props.onClick}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function InfoHint({ description, label }: { description: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`${label}说明`}
          className="inline-grid size-5 shrink-0 cursor-help place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          role="img"
          tabIndex={0}
        >
          <Info className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

function itemStatusMeta(status: TimeuPlanItem["status"] | "pending", t: NodeT) {
  if (status === "success") return { icon: CheckCircle2, label: t("status.success", "完成"), variant: "default" as const }
  if (status === "error") return { icon: XCircle, label: t("status.error", "错误"), variant: "destructive" as const }
  if (status === "skipped") return { icon: AlertTriangle, label: t("status.skipped", "跳过"), variant: "outline" as const }
  return { icon: Clock3, label: t("status.pending", "待执行"), variant: "secondary" as const }
}

function actionLabel(action: TimeuAction, t: NodeT): string {
  if (action === "scan") return t("actions.scan", "扫描")
  if (action === "backup") return t("actions.backup", "备份")
  if (action === "restore") return t("actions.restore", "恢复")
  return action
}

function formatMs(value: number): string {
  return new Date(value).toLocaleString()
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}
