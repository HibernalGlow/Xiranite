import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eye, Info, Languages, Settings2 } from "lucide-react"
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
import { ACTIONS, type TransqAction } from "./constants"
import type { TransqCardState, TransqStatusMeta } from "./types"

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
  action: TransqAction
  disabled?: boolean
  triggerClassName?: string
  onActionChange: (action: TransqAction) => void
}) {
  return (
    <ToggleGroup
      aria-label="transq action"
      className={cn("grid w-full grid-cols-3", props.triggerClassName)}
      disabled={props.disabled}
      size="sm"
      type="single"
      value={props.action}
      variant="outline"
      onValueChange={(value) => {
        if (value) props.onActionChange(value as TransqAction)
      }}
    >
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} aria-label={item.label} className="min-w-0" value={item.value}>
          <item.icon data-icon="inline-start" />
          <span className="truncate">{item.shortLabel}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function PathsInput(props: {
  compact?: boolean
  data: TransqCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<TransqCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="transq-paths" className="flex items-center gap-1.5">
            <Languages className="size-3.5 text-muted-foreground" />
            翻译文件路径
          </Label>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        {props.compact ? (
          <Input
            id="transq-paths"
            aria-label="transq 翻译文件路径"
            disabled={props.disabled}
            className="font-mono text-xs"
            placeholder="每行一个翻译文件路径"
            value={props.data.pathsText ?? ""}
            onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
          />
        ) : (
          <Textarea
            id="transq-paths"
            aria-label="transq 翻译文件路径"
            disabled={props.disabled}
            className="min-h-20 font-mono text-xs"
            placeholder={"每行一个翻译文件路径，例如：\nD:/Trans/projects/a.json\nD:/Trans/projects/b.json"}
            value={props.data.pathsText ?? ""}
            onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
          />
        )}
        <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
      </div>
    </div>
  )
}

export function PathFields(props: {
  data: TransqCardState
  disabled?: boolean
  onPatch: (patch: Partial<TransqCardState>) => void
}) {
  return (
    <div className="grid gap-2 @3xl/transq:grid-cols-2">
      <Input
        aria-label="transq 配置文件"
        disabled={props.disabled}
        placeholder="配置文件，可选"
        value={props.data.configPath ?? ""}
        onChange={(event) => props.onPatch({ configPath: event.currentTarget.value })}
      />
      <Input
        aria-label="transq 运行记录 JSONL"
        disabled={props.disabled}
        placeholder=".xiranite/transq-runs.jsonl"
        value={props.data.databasePath ?? ""}
        onChange={(event) => props.onPatch({ databasePath: event.currentTarget.value })}
      />
      <Input
        aria-label="transq 额外参数"
        disabled={props.disabled}
        placeholder="额外参数，空格分隔"
        value={props.data.argsText ?? ""}
        onChange={(event) => props.onPatch({ argsText: event.currentTarget.value })}
      />
      <Input
        aria-label="transq Python 可执行文件"
        disabled={props.disabled}
        placeholder="python，可留空"
        value={props.data.python ?? ""}
        onChange={(event) => props.onPatch({ python: event.currentTarget.value })}
      />
      <Input
        aria-label="transq 源码目录"
        disabled={props.disabled}
        placeholder="源码目录，可留空"
        value={props.data.sourceRoot ?? ""}
        onChange={(event) => props.onPatch({ sourceRoot: event.currentTarget.value })}
      />
      <Input
        aria-label="transq 模块名"
        disabled={props.disabled}
        placeholder="模块名，可留空"
        value={props.data.moduleName ?? ""}
        onChange={(event) => props.onPatch({ moduleName: event.currentTarget.value })}
      />
    </div>
  )
}

export function RuntimeOptions(props: {
  data: TransqCardState
  disabled?: boolean
  onPatch: (patch: Partial<TransqCardState>) => void
}) {
  return (
    <div className="grid gap-2 @3xl/transq:grid-cols-2">
      <SwitchRow
        checked={props.data.dryRun ?? true}
        disabled={props.disabled}
        icon={Eye}
        label="预演"
        description="只生成命令计划，不真正调用 Python 模块。"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
      <SwitchRow
        checked={props.data.recordRun ?? false}
        disabled={props.disabled}
        icon={DatabaseZap}
        label="记录运行"
        description="把运行结果写入 JSONL。"
        onCheckedChange={(recordRun) => props.onPatch({ recordRun })}
      />
    </div>
  )
}

export function OptionsPopover(props: {
  data: TransqCardState
  disabled?: boolean
  onPatch: (patch: Partial<TransqCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="transq 运行选项" disabled={props.disabled} size="icon-sm" variant="outline">
              <Settings2 />
              <span className="sr-only">运行选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>运行选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">运行选项</div>
          <p className="text-xs text-muted-foreground">配置文件、记录路径、Python、源码目录和预演开关集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <PathFields {...props} />
          <RuntimeOptions {...props} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<TransqCardState>
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
            <Button aria-label="transq 默认配置" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 TransQ 的路径和运行选项。</p>
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
                <DialogTitle>TransQ 配置</DialogTitle>
                <DialogDescription>当前 nodes.transq 默认值和配置文件位置。</DialogDescription>
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
  status: TransqStatusMeta
  text?: string
}) {
  return (
    <div className={cn("rounded-md border bg-background/70 p-2", props.compact && "p-1.5")}>
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
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
  config?: Partial<TransqCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.transq 暂无默认配置\n"
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
