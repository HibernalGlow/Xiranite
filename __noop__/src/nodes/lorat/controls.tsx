import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, Info, SlidersHorizontal } from "lucide-react"
import type { LoratScopeFilter, LoratStatusFilter } from "@xiranite/node-lorat/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ACTIONS, SCOPE_FILTERS, STATUS_FILTERS } from "./constants"
import type { LoratCardState, LoratStatusMeta } from "./types"

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
  disabled?: boolean
  value: LoratCardState["action"]
  onActionChange: (value: LoratCardState["action"]) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1" data-testid="lorat-action-picker">
      {ACTIONS.map((item) => (
        <Button
          key={item.value}
          aria-label={item.label}
          disabled={props.disabled}
          size="sm"
          variant={(props.value ?? "scan") === item.value ? "secondary" : "outline"}
          onClick={() => props.onActionChange(item.value)}
        >
          <item.icon data-icon="inline-start" />
          <span className="truncate">{item.shortLabel}</span>
        </Button>
      ))}
    </div>
  )
}

export function PathInput(props: {
  compact?: boolean
  data: LoratCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<LoratCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lorat-folder">LoRA 目录</Label>
          {props.data.folderPath ? (
            <Badge variant="outline" className="shrink-0">已设置</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">待输入</span>
          )}
        </div>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
        <Input
          id="lorat-folder"
          aria-label="lorat LoRA 目录"
          disabled={props.disabled}
          className="min-w-0 font-mono text-xs"
          placeholder={"D:\\ComfyUI\\models\\loras"}
          value={props.data.folderPath ?? ""}
          onChange={(event) => props.onPatch({ folderPath: event.currentTarget.value })}
        />
        <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴目录" onClick={props.onPaste} />
        <ActionIconButton
          disabled={props.disabled}
          icon={Eraser}
          label="清空目录"
          onClick={() => props.onPatch({ folderPath: "" })}
        />
      </div>
    </div>
  )
}

export function SearchInput(props: {
  compact?: boolean
  data: LoratCardState
  disabled?: boolean
  onPatch: (patch: Partial<LoratCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && <Label htmlFor="lorat-search">搜索过滤</Label>}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Input
          id="lorat-search"
          aria-label="lorat 搜索过滤"
          disabled={props.disabled}
          className="min-w-0 text-xs"
          placeholder="按文件名、目录或触发词过滤"
          value={props.data.search ?? ""}
          onChange={(event) => props.onPatch({ search: event.currentTarget.value })}
        />
        <ActionIconButton
          disabled={props.disabled || !props.data.search}
          icon={Eraser}
          label="清空搜索"
          onClick={() => props.onPatch({ search: "" })}
        />
      </div>
    </div>
  )
}

export function OptionsPopover(props: {
  data: LoratCardState
  disabled?: boolean
  onPatch: (patch: Partial<LoratCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="lorat 高级选项" disabled={props.disabled} size="icon-sm" variant="outline">
              <SlidersHorizontal />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,420px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">状态与范围过滤集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <FilterGroup
            label="状态过滤"
            options={STATUS_FILTERS}
            value={props.data.statusFilter ?? "all"}
            onValueChange={(statusFilter) => props.onPatch({ statusFilter: statusFilter as LoratStatusFilter })}
          />
          <FilterGroup
            label="范围过滤"
            options={SCOPE_FILTERS}
            value={props.data.scopeFilter ?? "all"}
            onValueChange={(scopeFilter) => props.onPatch({ scopeFilter: scopeFilter as LoratScopeFilter })}
          />
          <p className="text-xs text-muted-foreground">
            状态过滤按 sidecar 状态显示，范围过滤按目录中的 self/@ 标记显示。
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TriggerDbInput(props: {
  compact?: boolean
  data: LoratCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<LoratCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lorat-trigger-db">TriggerDB JSON</Label>
          <div className="flex shrink-0 items-center gap-1.5">
            {props.data.triggerDbJson ? (
              <Badge variant="outline">{props.data.triggerDbJson.length} 字符</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">可选</span>
            )}
            <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴 JSON" onClick={props.onPaste} />
          </div>
        </div>
      )}
      <Textarea
        id="lorat-trigger-db"
        aria-label="lorat TriggerDB JSON"
        disabled={props.disabled}
        className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-20" : "h-28")}
        placeholder={'{\n  "artist/alice": {\n    "all_triggers": "alice",\n    "active_triggers": "alice"\n  }\n}'}
        value={props.data.triggerDbJson ?? ""}
        onChange={(event) => props.onPatch({ triggerDbJson: event.currentTarget.value })}
      />
    </div>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<LoratCardState>
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
            <Button aria-label="lorat 默认配置" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">lorat 默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 Lorat 的动作、目录、搜索和过滤到明文配置。</p>
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
                <DialogTitle>Lorat 配置</DialogTitle>
                <DialogDescription>当前 nodes.lorat 默认值和配置文件位置。</DialogDescription>
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
  status: LoratStatusMeta
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

function FilterGroup(props: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs">{props.label}</Label>
      <div className="grid grid-cols-4 gap-1">
        {props.options.map((item) => (
          <Button
            key={item.value}
            aria-label={`${props.label} ${item.label}`}
            size="sm"
            variant={props.value === item.value ? "secondary" : "outline"}
            onClick={() => props.onValueChange(item.value)}
          >
            <span className="truncate text-xs">{item.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function ConfigPreview(props: {
  config?: Partial<LoratCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.lorat 暂无默认配置\n"
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

export { InfoHint }
