import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, FolderInput, Info, Layers, PackageOpen, ShieldAlert } from "lucide-react"
import type { DissolvefConflictMode } from "@xiranite/node-dissolvef/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tNode } from "@/nodes/shared/useNodeI18n"
import { BUNDLE_MODES, CONFLICT_MODES, DEFAULT_THRESHOLD } from "./constants"
import type { DissolvefCardState, DissolvefStatusMeta } from "./types"

export function ActionIconButton(props: {
  active?: boolean
  destructive?: boolean
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
          variant={props.destructive ? "destructive" : props.active ? "secondary" : "outline"}
          onClick={props.onClick}
        >
          <Icon />
          <span className="sr-only">{props.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

export function ModePicker(props: {
  compact?: boolean
  direct: boolean
  disabled?: boolean
  selectedModes: string[]
  onToggleMode: (mode: "nested" | "media" | "archive") => void
  onSetDirect: (direct: boolean) => void
}) {
  return (
    <div data-testid="dissolvef-mode-picker" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      <Button
        aria-label={tNode("dissolvef", "aria.bundleMode", "捆绑模式")}
        disabled={props.disabled}
        size="sm"
        variant={!props.direct ? "secondary" : "outline"}
        onClick={() => props.onSetDirect(false)}
      >
        <Layers data-icon="inline-start" />
        <span className="truncate">捆绑</span>
      </Button>
      {BUNDLE_MODES.map((item) => (
        <Button
          key={item.value}
          aria-label={item.label}
          disabled={props.disabled || props.direct}
          size="sm"
          variant={!props.direct && props.selectedModes.includes(item.value) ? "secondary" : "outline"}
          onClick={() => props.onToggleMode(item.value)}
        >
          <item.icon data-icon="inline-start" />
          <span className="truncate">{item.shortLabel}</span>
        </Button>
      ))}
      <Button
        aria-label={tNode("dissolvef", "aria.directMode", "直提模式")}
        disabled={props.disabled}
        size="sm"
        variant={props.direct ? "secondary" : "outline"}
        onClick={() => props.onSetDirect(true)}
      >
        <PackageOpen data-icon="inline-start" />
        <span className="truncate">直提</span>
      </Button>
    </div>
  )
}

export function PathInput(props: {
  compact?: boolean
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onPaste: () => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="dissolvef-path">目标文件夹</Label>
        </div>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="dissolvef-path"
          aria-label={tNode("dissolvef", "aria.targetFolder", "dissolvef target folder")}
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-20")}
          disabled={props.disabled}
          placeholder={"要溶解的文件夹路径\nD:/library/outer"}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        <div className="grid content-start gap-1.5">
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴文件夹" onClick={props.onPaste} />
          <ActionIconButton disabled={props.disabled || !props.value} icon={Eraser} label="清空路径" onClick={props.onClear} />
        </div>
      </div>
    </div>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: DissolvefCardState
  direct: boolean
  disabled?: boolean
  onPatch: (patch: Partial<DissolvefCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="dissolvef-primary-switches"
    >
      <SwitchRow
        checked={props.data.preview ?? true}
        disabled={props.disabled}
        icon={ShieldAlert}
        label="预演"
        description="开启后只生成计划，不移动或删除文件。关闭后会真实执行。"
        onCheckedChange={(preview) => props.onPatch({ preview })}
      />
      <SwitchRow
        checked={props.data.protectFirstLevel ?? true}
        disabled={props.disabled || props.direct}
        icon={FolderInput}
        label="保护一级"
        description="开启后跳过第一层子文件夹，避免误伤顶层归档结构。"
        onCheckedChange={(protectFirstLevel) => props.onPatch({ protectFirstLevel })}
      />
      <SwitchRow
        checked={props.data.enableSimilarity ?? true}
        disabled={props.disabled || props.direct}
        icon={Info}
        label="相似度校验"
        description="开启后比对父文件夹与子项名称相似度，低于阈值时跳过。"
        onCheckedChange={(enableSimilarity) => props.onPatch({ enableSimilarity })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: DissolvefCardState
  direct: boolean
  disabled?: boolean
  onPatch: (patch: Partial<DissolvefCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label={tNode("dissolvef", "aria.advancedOptions", "dissolvef advanced options")} disabled={props.disabled} size="icon-sm" variant="outline">
              <ShieldAlert />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,520px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">相似度阈值、排除关键词、冲突策略和历史路径集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <NumberField
            label="相似度阈值"
            value={props.data.similarityThreshold ?? DEFAULT_THRESHOLD}
            min={0}
            max={1}
            step={0.05}
            disabled={props.disabled || props.direct || !(props.data.enableSimilarity ?? true)}
            onChange={(similarityThreshold) => props.onPatch({ similarityThreshold })}
          />
          <TextField
            label="排除关键词"
            placeholder="逗号或换行分隔，如: CG, pixiv"
            value={props.data.excludeText ?? ""}
            disabled={props.disabled}
            onChange={(excludeText) => props.onPatch({ excludeText })}
          />
          <TextField
            label="历史路径"
            placeholder="留空则使用默认历史文件"
            value={props.data.historyPath ?? ""}
            disabled={props.disabled}
            onChange={(historyPath) => props.onPatch({ historyPath })}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="文件冲突"
              value={props.data.fileConflict ?? "auto"}
              disabled={props.disabled || !props.direct}
              values={CONFLICT_MODES.map((item) => [item.value, item.label])}
              onChange={(fileConflict) => props.onPatch({ fileConflict: fileConflict as DissolvefConflictMode })}
            />
            <SelectField
              label="目录冲突"
              value={props.data.dirConflict ?? "auto"}
              disabled={props.disabled || !props.direct}
              values={CONFLICT_MODES.map((item) => [item.value, item.label])}
              onChange={(dirConflict) => props.onPatch({ dirConflict: dirConflict as DissolvefConflictMode })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<DissolvefCardState>
  disabled?: boolean
  onOpenConfigFile?: () => Promise<void> | void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label={tNode("dissolvef", "aria.defaults", "dissolvef defaults")} disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 Dissolvef 的路径、模式和冲突策略到明文配置。</p>
        </div>
        <div className="grid gap-2">
          <Button disabled={props.disabled} size="sm" onClick={props.onSaveDefault}>保存为默认</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onRestoreDefault}>恢复默认</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onResetOverride}>清除覆盖</Button>
          <Separator />
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={!props.configFilePath} size="sm" variant="ghost">查看配置</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Dissolvef 配置</DialogTitle>
                <DialogDescription>当前 nodes.dissolvef 默认值和配置文件位置。</DialogDescription>
              </DialogHeader>
              <ConfigPreview config={props.defaults} path={props.configFilePath} />
            </DialogContent>
          </Dialog>
          <Button disabled={!props.onOpenConfigFile} size="sm" variant="ghost" onClick={() => void props.onOpenConfigFile?.()}>打开文件</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function StatusStrip(props: {
  compact?: boolean
  progress: number
  status: DissolvefStatusMeta
  text?: string
}) {
  return (
    <div className={cn("rounded-md border bg-background/70 p-2", props.compact && "p-1.5")}>
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
        <Badge variant={props.status.badgeVariant} className="shrink-0">{props.status.label}</Badge>
      </div>
      <Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} />
    </div>
  )
}

export function SwitchRow(props: {
  checked: boolean
  description?: string
  disabled?: boolean
  icon?: LucideIcon
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  const Icon = props.icon
  return (
    <div className="flex min-w-0 items-center justify-between gap-1.5 rounded-md border bg-background/60 px-2 py-1.5">
      <label className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-xs font-medium">{props.label}</span>
        </span>
        <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
      </label>
      {props.description && <InfoHint label={props.label} description={props.description} />}
    </div>
  )
}

export function PlanList(props: {
  compact?: boolean
  result: DissolvefCardState["result"]
}) {
  const plan = props.result?.plan ?? []
  const lines = plan.map((item) => `${item.status} ${item.mode} ${item.operation} ${item.sourcePath}${item.targetPath ? ` -> ${item.targetPath}` : item.reason ? ` / ${item.reason}` : ""}`)
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{lines.length ? `${lines.length} 项` : "等待运行"}</span>
        </div>
        <Badge variant="outline">总计 {props.result?.totalCount ?? 0}</Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {lines.length ? (
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {lines.slice(0, 120).join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            运行后会显示移动和删除计划。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

export function HistoryPanel(props: {
  compact?: boolean
  result: DissolvefCardState["result"]
  onUndo: (id: string) => void
}) {
  const history = props.result?.history ?? []
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{history.length ? `${history.length} 条` : "无历史"}</span>
        </div>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {history.length ? (
          <div className="grid gap-1 p-2">
            {history.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/45">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{item.id}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{item.mode} / {item.count} 项{item.undone ? " / 已撤销" : ""}</div>
                </div>
                {!item.undone && (
                  <Button aria-label={`撤销 ${item.id}`} disabled={props.result === undefined} size="xs" variant="ghost" onClick={() => props.onUndo(item.id)}>
                    撤销
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            执行操作后会记录历史，可用于撤销。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

export function LogPanel(props: {
  compact?: boolean
  logs: string[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{props.logs.length ? `${props.logs.length} 行` : "等待日志"}</span>
        </div>
        <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.logs.length ? (
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {props.logs.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            运行日志会显示在这里。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function ConfigPreview(props: {
  config?: Partial<DissolvefCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.dissolvef 暂无默认配置\n"
    : JSON.stringify(props.config, null, 2)
  return (
    <div className="grid gap-3">
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">配置文件</div>
        <div className="mt-1 break-all font-mono text-xs">{props.path ?? "未连接本地配置服务"}</div>
      </div>
      <pre className="max-h-[45vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5">
        {content}
      </pre>
    </div>
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

function TextField(props: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const id = `dissolvef-${props.label}`
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{props.label}</Label>
      <Input
        id={id}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  )
}

function NumberField(props: {
  disabled?: boolean
  label: string
  max?: number
  min?: number
  onChange: (value: number) => void
  step?: number
  value: number
}) {
  const id = `dissolvef-${props.label}`
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{props.label}</Label>
      <Input
        id={id}
        disabled={props.disabled}
        max={props.max}
        min={props.min}
        step={props.step}
        type="number"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </div>
  )
}

function SelectField(props: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  value: string
  values: Array<[string, string]>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs">{props.label}</Label>
      <div className="grid grid-cols-4 gap-1">
        {props.values.map(([value, label]) => (
          <Button
            key={value}
            aria-label={`${props.label} ${label}`}
            disabled={props.disabled}
            size="sm"
            variant={props.value === value ? "secondary" : "outline"}
            onClick={() => props.onChange(value)}
          >
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
