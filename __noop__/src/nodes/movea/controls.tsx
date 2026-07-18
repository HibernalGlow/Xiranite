import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, FolderInput, Info, ShieldAlert } from "lucide-react"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { MoveaCardState, MoveaStatusMeta } from "./types"

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

export function PathField(props: {
  compact?: boolean
  disabled?: boolean
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onPaste: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!props.compact && <Label htmlFor={props.id} className="text-xs">{props.label}</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Input
          id={props.id}
          aria-label={props.label}
          disabled={props.disabled}
          className="font-mono text-xs"
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        <ActionIconButton disabled={props.disabled} icon={Clipboard} label={`粘贴${props.label}`} onClick={props.onPaste} />
      </div>
    </div>
  )
}

export function TextAreaField(props: {
  compact?: boolean
  disabled?: boolean
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={props.id} className="text-xs">{props.label}</Label>
        </div>
      )}
      <Textarea
        id={props.id}
        aria-label={props.label}
        className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-12" : "h-20")}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: MoveaCardState
  disabled?: boolean
  onPatch: (patch: Partial<MoveaCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="movea-key-switches"
    >
      <SwitchRow
        checked={props.data.dryRun ?? true}
        disabled={props.disabled}
        icon={ShieldAlert}
        label="预演"
        description="开启后只生成移动计划，不写入文件系统。关闭后执行真实移动。"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
    </div>
  )
}

export function OptionsPopover(props: {
  data: MoveaCardState
  disabled?: boolean
  onPatch: (patch: Partial<MoveaCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="movea options" disabled={props.disabled} size="icon-sm" variant="outline">
              <FolderInput />
              <span className="sr-only">移动选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>移动选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,420px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">移动选项</div>
          <p className="text-xs text-muted-foreground">正则、目标文件夹、移动计划和预演开关集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <TextAreaField
            id="movea-regex"
            label="正则模式"
            value={props.data.regexText ?? ""}
            disabled={props.disabled}
            placeholder="每行一个正则"
            onChange={(regexText) => props.onPatch({ regexText })}
          />
          <TextAreaField
            id="movea-subfolders"
            label="目标子文件夹"
            value={props.data.subfoldersText ?? ""}
            disabled={props.disabled}
            placeholder="每行一个子文件夹"
            onChange={(subfoldersText) => props.onPatch({ subfoldersText })}
          />
          <TextAreaField
            id="movea-plan"
            label="移动计划"
            value={props.data.movePlanText ?? ""}
            disabled={props.disabled}
            placeholder='{"item":"target folder"}'
            onChange={(movePlanText) => props.onPatch({ movePlanText })}
          />
          <PrimarySwitches data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<MoveaCardState>
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
            <Button aria-label="movea defaults" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 Movea 的路径、正则和预演开关到明文配置。</p>
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
                <DialogTitle>Movea 配置</DialogTitle>
                <DialogDescription>当前 nodes.movea 默认值和配置文件位置。</DialogDescription>
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
  status: MoveaStatusMeta
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

function ConfigPreview(props: {
  config?: Partial<MoveaCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.movea 暂无默认配置\n"
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
