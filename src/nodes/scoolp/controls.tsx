import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, Info, Package } from "lucide-react"
import type { ScoolpAction } from "@xiranite/node-scoolp/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ACTIONS, DEFAULT_CONFIG_TEXT } from "./constants"
import type { ScoolpCardState, ScoolpStatusMeta } from "./types"

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
  action: ScoolpCardState["action"]
  disabled?: boolean
  dryRun: boolean
  result: ScoolpCardState["result"]
  onExecute: (action: ScoolpAction) => void
  onPatch: (patch: Partial<ScoolpCardState>) => void
}) {
  return (
    <div data-testid="scoolp-action-picker" className="flex flex-wrap gap-1">
      {ACTIONS.map((item) => {
        const destructive = isDestructive(item.value, props.dryRun)
        const active = props.action === item.value
        const variant = active ? (destructive ? "destructive" : "secondary") : "outline"
        const Icon = item.icon

        return (
          <Tooltip key={item.value}>
            <TooltipTrigger asChild>
              <Button
                aria-label={item.label}
                aria-pressed={active}
                disabled={props.disabled}
                size="sm"
                variant={variant}
                onClick={() => props.onPatch({ action: item.value })}
              >
                <Icon />
                <span>{item.shortLabel}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function isDestructive(action: ScoolpAction, dryRun: boolean): boolean {
  if (action === "cache_delete" || action === "cache_backup") return true
  if (action === "sync" && !dryRun) return true
  return false
}

function dangerTitle(action: ScoolpAction): string {
  if (action === "cache_delete") return "确认删除过时缓存？"
  if (action === "cache_backup") return "确认备份过时缓存？"
  if (action === "sync") return "确认真实同步 Bucket？"
  return "确认真实执行 Scoolp？"
}

function dangerDescriptionFor(action: ScoolpAction, result: ScoolpCardState["result"]): string {
  if (action === "cache_delete") {
    return `当前关闭了预演，清理时会永久删除过时缓存文件。${result?.cache?.obsoleteCount ?? 0} 个文件将被删除，请确认无误后继续。`
  }
  if (action === "cache_backup") {
    return `当前关闭了预演，备份时会移动过时缓存到备份目录。${result?.cache?.obsoleteCount ?? 0} 个文件将被移动，请确认无误后继续。`
  }
  if (action === "sync") {
    return "当前关闭了预演，同步时会真实执行 git 和 scoop 命令，可能重置 bucket 和更新包。请确认配置无误后继续。"
  }
  return "当前操作会修改文件系统，请确认无误后继续。"
}

export function PathFields(props: {
  data: ScoolpCardState
  disabled?: boolean
  onPatch: (patch: Partial<ScoolpCardState>) => void
}) {
  return (
    <div data-testid="scoolp-path-fields" className="grid gap-2 @2xl/scoolp:grid-cols-2">
      <Field className="gap-1.5">
        <Label htmlFor="scoolp-path" className="text-xs">路径 / Bucket</Label>
        <Input
          id="scoolp-path"
          aria-label="scoolp path"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/scoop/buckets/main 或留空"
          value={props.data.path ?? ""}
          onChange={(event) => props.onPatch({ path: event.currentTarget.value })}
        />
      </Field>
      <Field className="gap-1.5">
        <Label htmlFor="scoolp-package" className="text-xs">包名</Label>
        <Input
          id="scoolp-package"
          aria-label="scoolp package name"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="7zip git grep..."
          value={props.data.packageName ?? ""}
          onChange={(event) => props.onPatch({ packageName: event.currentTarget.value })}
        />
      </Field>
      <Field className="gap-1.5">
        <Label htmlFor="scoolp-scoop-root" className="text-xs">Scoop 根目录</Label>
        <Input
          id="scoolp-scoop-root"
          aria-label="scoop root"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/scoop"
          value={props.data.scoopRoot ?? ""}
          onChange={(event) => props.onPatch({ scoopRoot: event.currentTarget.value })}
        />
      </Field>
      <Field className="gap-1.5">
        <Label htmlFor="scoolp-cache-path" className="text-xs">缓存目录</Label>
        <Input
          id="scoolp-cache-path"
          aria-label="scoolp cache path"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/scoop/cache"
          value={props.data.cachePath ?? ""}
          onChange={(event) => props.onPatch({ cachePath: event.currentTarget.value })}
        />
      </Field>
    </div>
  )
}

export function ConfigTextPanel(props: {
  ariaLabel: string
  compact?: boolean
  count: number
  disabled?: boolean
  inputId: string
  label: string
  onChange: (value: string) => void
  onClear: () => void
  onPaste: () => void
  placeholder: string
  value: string
}) {
  return (
    <FieldGroup className="gap-2">
      <Field className="gap-1.5">
        {!props.compact && (
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={props.inputId}>{props.label}</FieldLabel>
            <Badge variant="outline" className="shrink-0">{props.count} 行</Badge>
          </div>
        )}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
          <Textarea
            id={props.inputId}
            aria-label={props.ariaLabel}
            className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-16" : "h-28")}
            disabled={props.disabled}
            placeholder={props.placeholder}
            value={props.value}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          />
          <div className="grid content-start gap-1.5">
            <ActionIconButton disabled={props.disabled} icon={Clipboard} label={`粘贴${props.label}`} onClick={props.onPaste} />
            <ActionIconButton disabled={props.disabled || !props.value} icon={Eraser} label={`清空${props.label}`} onClick={props.onClear} />
          </div>
        </div>
      </Field>
    </FieldGroup>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: ScoolpCardState
  disabled?: boolean
  onPatch: (patch: Partial<ScoolpCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="scoolp-key-switches"
    >
      <SwitchRow
        checked={props.data.dryRun ?? true}
        description="开启时只生成命令计划，不执行实际安装或删除。"
        disabled={props.disabled}
        icon={Info}
        label="预演模式"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: ScoolpCardState
  disabled?: boolean
  onPatch: (patch: Partial<ScoolpCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="scoolp advanced options" disabled={props.disabled} size="icon-sm" variant="outline">
              <Package />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,520px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">Scoop 根目录、缓存路径和预演开关收在这里。</p>
        </div>
        <div className="grid gap-3">
          <PathFields data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
          <PrimarySwitches data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<ScoolpCardState>
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
            <Button aria-label="scoolp defaults" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 Scoolp 的同步 TOML、包名和预演开关到明文配置。</p>
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
                <DialogTitle>Scoolp 配置</DialogTitle>
                <DialogDescription>当前 nodes.scoolp 默认值和配置文件位置。</DialogDescription>
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

function ConfigPreview(props: {
  config?: Partial<ScoolpCardState>
  path?: string
}) {
  const content = props.config === undefined ? "# nodes.scoolp 暂无默认配置\n" : JSON.stringify(props.config, null, 2)
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

export function StatusStrip(props: {
  compact?: boolean
  progress: number
  status: ScoolpStatusMeta
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

export function ActionMeta(value: ScoolpCardState["action"]) {
  return ACTIONS.find((item) => item.value === value) ?? ACTIONS[0]!
}

export function defaultConfigIfEmpty(value: string | undefined): string {
  return value && value.trim() ? value : DEFAULT_CONFIG_TEXT
}
