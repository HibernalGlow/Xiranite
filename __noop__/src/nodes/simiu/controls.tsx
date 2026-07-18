import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eye, Info, Settings2 } from "lucide-react"
import type { SimiuAction, SimiuApplyMode, SimiuScanOrder } from "@xiranite/node-simiu/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tNode } from "@/nodes/shared/useNodeI18n"
import { ACTIONS, APPLY_MODE_OPTIONS, SCAN_ORDER_OPTIONS } from "./constants"
import type { SimiuCardState, SimiuStatusMeta } from "./types"

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

export function ActionPicker(props: {
  action: SimiuAction
  disabled?: boolean
  triggerClassName?: string
  onActionChange: (action: SimiuAction) => void
}) {
  return (
    <ToggleGroup
      aria-label={tNode("simiu", "aria.action", "simiu 操作")}
      className={cn("grid w-full grid-cols-3", props.triggerClassName)}
      disabled={props.disabled}
      size="sm"
      type="single"
      value={props.action}
      variant="outline"
      onValueChange={(value) => {
        if (value) props.onActionChange(value as SimiuAction)
      }}
    >
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} aria-label={tNode("simiu", `actions.${item.value}.label`, item.label)} className="min-w-0" value={item.value}>
          <item.icon data-icon="inline-start" />
          <span className="truncate">{tNode("simiu", `actions.${item.value}.shortLabel`, item.shortLabel)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function RootsInput(props: {
  compact?: boolean
  data: SimiuCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<SimiuCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="simiu-roots">{tNode("simiu", "fields.roots", "图片根目录")}</Label>
          <Badge variant="outline" className="shrink-0">{tNode("simiu", "fields.rootsHint", "jpg / png / webp")}</Badge>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="simiu-roots"
          aria-label={tNode("simiu", "aria.roots", "simiu 图片根目录")}
          disabled={props.disabled}
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-20" : "h-28")}
          placeholder={tNode("simiu", "placeholder.roots", "每行一个图片目录")}
          value={props.data.rootsText ?? ""}
          onChange={(event) => props.onPatch({ rootsText: event.currentTarget.value })}
        />
        <ActionIconButton disabled={props.disabled} icon={Clipboard} label={tNode("simiu", "actions.paste", "粘贴目录")} onClick={props.onPaste} />
      </div>
    </div>
  )
}

export function GroupFields(props: {
  data: SimiuCardState
  disabled?: boolean
  onPatch: (patch: Partial<SimiuCardState>) => void
}) {
  return (
    <div className="grid gap-2 @3xl/simiu:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label className="text-xs">{tNode("simiu", "fields.applyMode", "应用方式")}</Label>
        <ToggleGroup
          aria-label={tNode("simiu", "aria.applyMode", "simiu 应用模式")}
          className="grid w-full grid-cols-3"
          disabled={props.disabled}
          size="sm"
          type="single"
          value={props.data.mode ?? "move"}
          variant="outline"
          onValueChange={(mode) => {
            if (mode) props.onPatch({ mode: mode as SimiuApplyMode })
          }}
        >
          {APPLY_MODE_OPTIONS.map((item) => (
            <ToggleGroupItem key={item.value} aria-label={tNode("simiu", "aria.applyModeItem", "应用方式 {{label}}", { label: tNode("simiu", `applyMode.${item.value}`, item.label) })} className="min-w-0" value={item.value}>
              <span className="truncate">{tNode("simiu", `applyMode.${item.value}`, item.label)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label className="text-xs">{tNode("simiu", "fields.scanOrder", "扫描顺序")}</Label>
        <ToggleGroup
          aria-label={tNode("simiu", "aria.scanOrder", "simiu 扫描顺序")}
          className="grid w-full grid-cols-3"
          disabled={props.disabled}
          size="sm"
          type="single"
          value={props.data.scanOrder ?? "path"}
          variant="outline"
          onValueChange={(scanOrder) => {
            if (scanOrder) props.onPatch({ scanOrder: scanOrder as SimiuScanOrder })
          }}
        >
          {SCAN_ORDER_OPTIONS.map((item) => (
            <ToggleGroupItem key={item.value} aria-label={tNode("simiu", "aria.scanOrderItem", "扫描顺序 {{label}}", { label: tNode("simiu", `scanOrder.${item.value}`, item.label) })} className="min-w-0" value={item.value}>
              <span className="truncate">{tNode("simiu", `scanOrder.${item.value}`, item.label)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Input
        aria-label={tNode("simiu", "aria.namePrefix", "simiu 分组前缀")}
        disabled={props.disabled}
        placeholder={tNode("simiu", "placeholder.namePrefix", "分组前缀，默认 simiu_set")}
        value={props.data.namePrefix ?? ""}
        onChange={(event) => props.onPatch({ namePrefix: event.currentTarget.value })}
      />
      <Input
        aria-label={tNode("simiu", "aria.minGroupSize", "simiu 最小组大小")}
        disabled={props.disabled}
        placeholder={tNode("simiu", "placeholder.minGroupSize", "最小组大小，默认 2")}
        type="number"
        value={props.data.minGroupSize ?? ""}
        onChange={(event) => props.onPatch({ minGroupSize: event.currentTarget.value })}
      />
      <Input
        aria-label={tNode("simiu", "aria.sizeTolerance", "simiu 尺寸容差")}
        disabled={props.disabled}
        placeholder={tNode("simiu", "placeholder.sizeTolerance", "尺寸容差 bytes")}
        type="number"
        value={props.data.sizeToleranceBytes ?? ""}
        onChange={(event) => props.onPatch({ sizeToleranceBytes: event.currentTarget.value })}
      />
    </div>
  )
}

export function RuntimeOptions(props: {
  data: SimiuCardState
  disabled?: boolean
  onPatch: (patch: Partial<SimiuCardState>) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 @3xl/simiu:grid-cols-2">
        <Input
          aria-label={tNode("simiu", "aria.configPath", "simiu 配置 TOML")}
          disabled={props.disabled}
          placeholder={tNode("simiu", "placeholder.configPath", "simiu.toml，可选")}
          value={props.data.configPath ?? ""}
          onChange={(event) => props.onPatch({ configPath: event.currentTarget.value })}
        />
        <Input
          aria-label={tNode("simiu", "aria.databasePath", "simiu 运行记录 JSONL")}
          disabled={props.disabled}
          placeholder={tNode("simiu", "placeholder.databasePath", ".xiranite/simiu-runs.jsonl")}
          value={props.data.databasePath ?? ""}
          onChange={(event) => props.onPatch({ databasePath: event.currentTarget.value })}
        />
      </div>
      <div className="grid gap-2 @3xl/simiu:grid-cols-2">
        <SwitchRow
          checked={props.data.dryRun ?? true}
          disabled={props.disabled}
          icon={Eye}
          label={tNode("simiu", "fields.dryRun", "预演")}
          description={tNode("simiu", "fields.dryRunDescription", "只生成操作计划，不移动、复制或链接文件。")}
          onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
        />
        <SwitchRow
          checked={props.data.recordRun ?? false}
          disabled={props.disabled}
          icon={DatabaseZap}
          label={tNode("simiu", "fields.recordRun", "记录运行")}
          description={tNode("simiu", "fields.recordRunDescription", "把扫描或应用结果写入 JSONL。")}
          onCheckedChange={(recordRun) => props.onPatch({ recordRun })}
        />
      </div>
    </div>
  )
}

export function OptionsPopover(props: {
  data: SimiuCardState
  disabled?: boolean
  onPatch: (patch: Partial<SimiuCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label={tNode("simiu", "aria.groupOptions", "simiu 分组选项")} disabled={props.disabled} size="icon-sm" variant="outline">
              <Settings2 />
              <span className="sr-only">{tNode("simiu", "labels.groupOptions", "分组选项")}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tNode("simiu", "labels.groupOptions", "分组选项")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">{tNode("simiu", "labels.groupOptions", "分组选项")}</div>
          <p className="text-xs text-muted-foreground">{tNode("simiu", "labels.groupOptionsDescription", "应用方式、扫描顺序和预演开关集中在这里。")}</p>
        </div>
        <div className="grid gap-3">
          <GroupFields {...props} />
          <RuntimeOptions {...props} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<SimiuCardState>
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
            <Button aria-label={tNode("simiu", "aria.defaults", "simiu 默认配置")} disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">{tNode("simiu", "labels.defaults", "默认配置")}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tNode("simiu", "labels.defaults", "默认配置")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">{tNode("simiu", "labels.defaults", "默认配置")}</div>
          <p className="text-xs text-muted-foreground">{tNode("simiu", "labels.defaultsDescription", "保存 Simiu 的目录、分组和运行选项。")}</p>
        </div>
        <div className="grid gap-2">
          <Button disabled={props.disabled} size="sm" onClick={props.onSaveDefault}>{tNode("simiu", "actions.saveDefault", "保存为默认")}</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onRestoreDefault}>{tNode("simiu", "actions.restoreDefault", "恢复默认")}</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onResetOverride}>{tNode("simiu", "actions.clearOverride", "清除覆盖")}</Button>
          <Separator />
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={!props.configFilePath} size="sm" variant="ghost">{tNode("simiu", "actions.viewConfig", "查看配置")}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{tNode("simiu", "labels.configTitle", "Simiu 配置")}</DialogTitle>
                <DialogDescription>{tNode("simiu", "labels.configDescription", "当前 nodes.simiu 默认值和配置文件位置。")}</DialogDescription>
              </DialogHeader>
              <ConfigPreview config={props.defaults} path={props.configFilePath} />
            </DialogContent>
          </Dialog>
          <Button disabled={!props.onOpenConfigFile} size="sm" variant="ghost" onClick={() => void props.onOpenConfigFile?.()}>{tNode("simiu", "actions.openFile", "打开文件")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function StatusStrip(props: {
  compact?: boolean
  progress: number
  status: SimiuStatusMeta
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
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
      <label className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-xs font-medium">{props.label}</span>
        </span>
        <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
      </label>
      {props.description && <InfoHint label={props.label} description={props.description} />}
    </div>
  )
}

function ConfigPreview(props: {
  config?: Partial<SimiuCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? tNode("simiu", "labels.noDefaults", "# nodes.simiu 暂无默认配置\n")
    : JSON.stringify(props.config, null, 2)
  return (
    <div className="grid gap-3">
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">{tNode("simiu", "labels.configFile", "配置文件")}</div>
        <div className="mt-1 break-all font-mono text-xs">{props.path ?? tNode("simiu", "labels.noConfigService", "未连接本地配置服务")}</div>
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
          aria-label={tNode("simiu", "aria.hint", "{{label}}说明", { label })}
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
