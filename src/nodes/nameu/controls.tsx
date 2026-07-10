import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  FileArchive,
  FilePenLine,
  FolderInput,
  GitCompare,
  Info,
  ListChecks,
  Play,
  Settings2,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import type { NameuAction, NameuData, NameuMode, NameuPlanItem } from "@xiranite/node-nameu/core"
import { ACTIONS, MODES } from "./constants"
import type { NameuCardState, NameuStatusMeta } from "./types"

type NodeT = ReturnType<typeof useNodeI18n>["t"]

interface PatchProps {
  data: NameuCardState
  disabled?: boolean
  onPatch: (patch: Partial<NameuCardState>) => void
  t: NodeT
}

/** tech-latch: 右上角等宽标签（CFG_R / DIFF_VIEW / EXEC 风格） */
export function TechLatch({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-2 top-2 z-10 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50",
        className,
      )}
    >
      {label}
    </span>
  )
}

/** ActionMode: 扫描/预览/改名 三选一 */
export function ActionMode(props: {
  t: NodeT
  value: NameuAction
  disabled?: boolean
  onChange: (value: NameuAction) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => value && props.onChange(value as NameuAction)}
      className="grid grid-cols-3"
      size="sm"
    >
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1">
          <item.icon className="size-3.5" />
          <span className="truncate text-xs">{item.shortLabel}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** ModeToggle: 库目录 / 单个作者 */
export function ModeToggle(props: {
  t: NodeT
  value: NameuMode
  disabled?: boolean
  onChange: (value: NameuMode) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => value && props.onChange(value as NameuMode)}
      className="grid grid-cols-2"
      size="sm"
    >
      {MODES.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1">
          <item.icon className="size-3.5" />
          <span className="truncate text-xs">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** PathField: 路径输入（含粘贴/清空） */
export function PathField(props: PatchProps & {
  compact?: boolean
  onPaste: () => void
}) {
  return (
    <Field>
      {!props.compact && (
        <FieldLabel htmlFor="nameu-paths" className="flex items-center gap-1.5 text-xs">
          <FolderInput className="size-3.5" />
          {props.t("fields.paths", "库目录或艺术家目录")}
        </FieldLabel>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="nameu-paths"
          aria-label="nameu paths"
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")}
          disabled={props.disabled}
          placeholder={props.t("fields.pathsPlaceholder", "每行一个目录\nD:/archives")}
          value={props.data.pathsText ?? ""}
          onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
        />
        <div className="grid content-start gap-1.5">
          <IconAction
            disabled={props.disabled}
            icon={Clipboard}
            label={props.t("actions.paste", "粘贴路径")}
            onClick={props.onPaste}
          />
          <IconAction
            disabled={props.disabled || !props.data.pathsText}
            icon={Trash2}
            label={props.t("actions.clear", "清空路径")}
            onClick={() => props.onPatch({ pathsText: "" })}
          />
        </div>
      </div>
    </Field>
  )
}

/** SwitchPanel: 预览/补作者名/递归/整理目录 开关 */
export function SwitchPanel(props: PatchProps & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]",
      )}
    >
      <SwitchRow
        checked={props.data.dryRun ?? true}
        disabled={props.disabled}
        icon={ShieldAlert}
        label={props.t("switches.dryRun", "预览")}
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
      <SwitchRow
        checked={props.data.addArtistName ?? true}
        disabled={props.disabled}
        icon={FilePenLine}
        label={props.t("switches.addArtistName", "补作者名")}
        onCheckedChange={(addArtistName) => props.onPatch({ addArtistName })}
      />
      <SwitchRow
        checked={props.data.recursive ?? true}
        disabled={props.disabled}
        icon={FolderInput}
        label={props.t("switches.recursive", "递归")}
        onCheckedChange={(recursive) => props.onPatch({ recursive })}
      />
      <SwitchRow
        checked={props.data.normalizeFolders ?? true}
        disabled={props.disabled}
        icon={ListChecks}
        label={props.t("switches.normalizeFolders", "整理目录")}
        onCheckedChange={(normalizeFolders) => props.onPatch({ normalizeFolders })}
      />
    </div>
  )
}

function SwitchRow(props: {
  checked: boolean
  disabled?: boolean
  icon: LucideIcon
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  const Icon = props.icon
  return (
    <label className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/60 px-2 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{props.label}</span>
      </span>
      <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
    </label>
  )
}

/** RunButton: 执行按钮（live rename 走 AlertDialog 确认门） */
export function RunButton(props: {
  t: NodeT
  compact?: boolean
  running: boolean
  action: NameuAction
  dryRun: boolean
  onExecute: (action?: NameuAction) => void
}) {
  if (props.running) {
    return (
      <Button
        aria-label={props.t("actions.running", "运行中")}
        disabled
        size={props.compact ? "icon-sm" : "sm"}
        variant="secondary"
      >
        <Square />
        {!props.compact && <span>{props.t("actions.running", "运行中")}</span>}
      </Button>
    )
  }
  const label = actionLabel(props.action)
  const live = props.action === "rename" && !props.dryRun
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} size={props.compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!props.compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t("confirm.renameTitle", "确认执行改名？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {props.t("confirm.renameDescription", "当前会重命名文件或目录。请先确认路径、模式和冲突列表。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.t("actions.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>
              {props.t("confirm.renameExecute", "确认执行")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return (
    <Button aria-label={label} size={props.compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!props.compact && <span>{label}</span>}
    </Button>
  )
}

export function actionLabel(action: NameuAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

/** itemStatusMeta: 改名计划条目状态 → 图标/标签/颜色 */
export function itemStatusMeta(status: NameuPlanItem["status"]) {
  if (status === "renamed") return { icon: CheckCircle2, label: "已改", variant: "default" as const, iconColor: "text-primary" }
  if (status === "ready") return { icon: GitCompare, label: "待改", variant: "secondary" as const, iconColor: "text-primary" }
  if (status === "conflict") return { icon: AlertTriangle, label: "冲突", variant: "destructive" as const, iconColor: "text-destructive" }
  if (status === "error") return { icon: XCircle, label: "错误", variant: "destructive" as const, iconColor: "text-destructive" }
  if (status === "skipped") return { icon: AlertTriangle, label: "跳过", variant: "outline" as const, iconColor: "text-muted-foreground" }
  return { icon: CheckCircle2, label: "不变", variant: "outline" as const, iconColor: "text-muted-foreground" }
}

/** computeDiff: 计算源名→目标名的差异部分（用于 diff-highlight） */
function computeDiff(source: string, target: string) {
  if (!source || source === target) return { prefix: "", changed: "", suffix: target }
  let p = 0
  const min = Math.min(source.length, target.length)
  while (p < min && source[p] === target[p]) p++
  let s = 0
  while (s < min - p && source[source.length - 1 - s] === target[target.length - 1 - s]) s++
  return {
    prefix: target.slice(0, p),
    changed: target.slice(p, target.length - s),
    suffix: target.slice(target.length - s),
  }
}

/** DiffHighlight: 高亮目标名中变更的部分 */
export function DiffHighlight(props: { source: string; target: string }) {
  const diff = computeDiff(props.source, props.target)
  if (!diff.changed) return <span className="text-muted-foreground">{props.target}</span>
  return (
    <span className="min-w-0 truncate">
      <span className="text-muted-foreground">{diff.prefix}</span>
      <span className="rounded bg-primary/15 px-0.5 text-primary">{diff.changed}</span>
      <span className="text-muted-foreground">{diff.suffix}</span>
    </span>
  )
}

/** PlanTable: 改名计划表（Review Desk 风格 + tech-bracket + diff-highlight） */
export function PlanTable(props: {
  t: NodeT
  items: NameuPlanItem[]
  paths: string[]
  compact?: boolean
}) {
  if (!props.items.length) {
    const text = props.paths.length
      ? props.t("plan.emptyAfterRun", "运行预览后显示改名计划。")
      : props.t("plan.empty", "输入目录后预览改名计划。")
    return (
      <Empty className="min-h-32 border-0 p-4">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCompare />
          </EmptyMedia>
          <EmptyTitle className="text-sm">{props.t("plan.emptyTitle", "暂无计划")}</EmptyTitle>
          <EmptyDescription className="text-xs">{text}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (props.compact) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-1.5 p-2">
          {props.items.slice(0, 180).map((item, index) => (
            <PlanRowCompact key={`${item.sourcePath}:${index}`} item={item} />
          ))}
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 border-b bg-card/95 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        <div className="col-span-5">{props.t("plan.colSource", "源名称")}</div>
        <div className="col-span-1 text-center">{props.t("plan.colStatus", "状态")}</div>
        <div className="col-span-6">{props.t("plan.colTarget", "目标投影")}</div>
      </div>
      <div className="grid gap-1.5 p-2">
        {props.items.slice(0, 180).map((item, index) => (
          <PlanRowTable key={`${item.sourcePath}:${index}`} item={item} />
        ))}
      </div>
    </ScrollArea>
  )
}

function PlanRowTable({ item }: { item: NameuPlanItem }) {
  const meta = itemStatusMeta(item.status)
  const StatusIcon = meta.icon
  const isWarning = item.status === "conflict" || item.status === "error"
  return (
    <div
      className={cn(
        "relative grid grid-cols-12 items-center gap-3 rounded border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50",
        isWarning && "border-l-2 border-l-destructive",
      )}
    >
      <span className="pointer-events-none absolute left-0 top-0 size-1.5 border-l border-t border-primary/40" />
      <span className="pointer-events-none absolute bottom-0 right-0 size-1.5 border-b border-r border-primary/40" />
      <div className="col-span-5 flex min-w-0 items-center gap-1.5 truncate font-mono text-xs" title={item.sourcePath}>
        <FileArchive className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("truncate", isWarning && "text-muted-foreground")}>{item.sourceName}</span>
      </div>
      <div className="col-span-1 flex justify-center">
        <StatusIcon className={cn("size-4", meta.iconColor)} />
      </div>
      <div className="col-span-6 min-w-0 truncate font-mono text-xs">
        <DiffHighlight source={item.sourceName} target={item.targetName} />
      </div>
    </div>
  )
}

function PlanRowCompact({ item }: { item: NameuPlanItem }) {
  const meta = itemStatusMeta(item.status)
  const StatusIcon = meta.icon
  return (
    <div
      className={cn(
        "grid gap-1 rounded-md border px-2 py-1.5",
        (item.status === "conflict" || item.status === "error") && "border-destructive/40",
        item.status === "unchanged" && "opacity-75",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileArchive className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{item.sourceName}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {"→ "}
            <DiffHighlight source={item.sourceName} target={item.targetName} />
          </div>
        </div>
        <Badge variant={meta.variant} className="gap-1">
          <StatusIcon className="size-3" />
          {meta.label}
        </Badge>
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {item.artistName}
        {item.reason ? ` / ${item.reason}` : ""}
      </div>
    </div>
  )
}

/** StatusStrip: 进度条 + 状态文本 */
export function StatusStrip(props: {
  t: NodeT
  progress: number
  status: NameuStatusMeta
  text?: string
}) {
  return (
    <div className="rounded-md border bg-background/70 p-2">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
        <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
      </div>
      <Progress
        value={props.progress}
        className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")}
      />
    </div>
  )
}

/** Metric: 单个指标卡 */
export function Metric(props: { icon: LucideIcon; label: string; value: string | number; suffix?: string }) {
  const Icon = props.icon
  return (
    <Item size="sm" variant="muted">
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemDescription className="text-[11px]">{props.label}</ItemDescription>
        <ItemTitle className="truncate tabular-nums">
          {props.value}
          {props.suffix ?? ""}
        </ItemTitle>
      </ItemContent>
    </Item>
  )
}

/** SettingsPopover: 折叠视图的设置弹层 */
export function SettingsPopover(props: PatchProps & {
  action: NameuAction
  onActionChange: (value: NameuAction) => void
  onPaste: () => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={props.t("actions.command", "操作和参数")}
              disabled={props.disabled}
              size="icon-sm"
              variant="outline"
            >
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{props.t("actions.settings", "NameU 参数")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{props.t("settings.title", "NameU 操作")}</div>
            <p className="text-xs text-muted-foreground">
              {props.t("settings.description", "折叠状态保留完整参数与执行动作。")}
            </p>
          </div>
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-4">
          <ActionMode t={props.t} value={props.action} disabled={props.disabled} onChange={props.onActionChange} />
          <ModeToggle
            t={props.t}
            value={props.data.mode ?? "multi"}
            disabled={props.disabled}
            onChange={(mode) => props.onPatch({ mode })}
          />
          <PathField t={props.t} compact data={props.data} disabled={props.disabled} onPaste={props.onPaste} onPatch={props.onPatch} />
          <SwitchPanel t={props.t} compact data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** ResultTabs: 计划/问题/日志 三标签 */
export function ResultTabs(props: {
  t: NodeT
  compact?: boolean
  logs: string[]
  result: NameuData | null
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  return (
    <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="plan">{props.t("tabs.plan", "计划")}</TabsTrigger>
        <TabsTrigger value="issues">{props.t("tabs.issues", "问题")}</TabsTrigger>
        <TabsTrigger value="logs">{props.t("tabs.logs", "日志")}</TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1">
        <PlanPanel t={props.t} compact={props.compact} result={props.result} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1">
        <TextPanel
          t={props.t}
          empty={props.t("issues.empty", "暂无问题")}
          lines={[
            ...(props.result?.errors ?? []),
            ...(props.result?.items ?? [])
              .filter((item) => item.reason && item.status !== "ready")
              .map((item) => `${item.sourcePath}: ${item.reason}`),
          ]}
        />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel
          t={props.t}
          actionLabel={props.t("actions.copy", "复制")}
          empty={props.t("logs.empty", "运行日志会显示在这里。")}
          icon={Terminal}
          lines={props.logs}
          onAction={props.onCopyLogs}
        />
      </TabsContent>
    </Tabs>
  )
}

function PlanPanel(props: {
  t: NodeT
  compact?: boolean
  result: NameuData | null
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <GitCompare className="size-3.5" />
          <span>
            {props.result?.items.length
              ? props.t("plan.count", "{{count}} 项", { count: props.result.items.length })
              : props.t("plan.waiting", "等待运行")}
          </span>
        </div>
        <Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          {props.t("actions.copy", "复制")}
        </Button>
      </div>
      <PlanTable t={props.t} compact={props.compact} items={props.result?.items ?? []} paths={[]} />
    </section>
  )
}

function TextPanel(props: {
  t: NodeT
  actionLabel?: string
  empty: string
  icon?: LucideIcon
  lines: string[]
  onAction?: () => void
}) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {props.lines.length
            ? props.t("logs.lineCount", "{{count}} 行", { count: props.lines.length })
            : props.empty}
        </span>
        {props.onAction && (
          <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>
            {props.actionLabel ?? props.t("actions.copy", "复制")}
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre>
        ) : (
          <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">
            {props.empty}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function IconAction(props: {
  active?: boolean
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={props.label}
          disabled={props.disabled}
          size="icon-sm"
          variant={props.active ? "secondary" : "outline"}
          onClick={props.onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}
