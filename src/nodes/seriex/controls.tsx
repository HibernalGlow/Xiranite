import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, FolderTree, Info } from "lucide-react"
import type { SeriexAction } from "@xiranite/node-seriex/core"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PathInput } from "@/components/ui/path-input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ACTIONS } from "./constants"
import type { SeriexCardState, SeriexStatusMeta } from "./types"

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
  action: SeriexCardState["action"]
  disabled?: boolean
  dryRun: boolean
  result: SeriexCardState["result"]
  onExecute: (action: SeriexAction) => void
  onPatch: (patch: Partial<SeriexCardState>) => void
}) {
  return (
    <div data-testid="seriex-action-picker" className="flex flex-wrap gap-1">
      {ACTIONS.map((item) => {
        const destructive = isDestructive(item.value, props.dryRun)
        const active = props.action === item.value
        const variant = active ? (destructive ? "destructive" : "secondary") : "outline"
        const Icon = item.icon

        return (
          <Tooltip key={item.value}>
            <TooltipTrigger asChild>
              {destructive ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      aria-label={item.label}
                      aria-pressed={active}
                      disabled={props.disabled}
                      size="sm"
                      variant={variant}
                    >
                      <Icon />
                      <span>{item.shortLabel}</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{dangerTitle(item.value)}</AlertDialogTitle>
                      <AlertDialogDescription>{dangerDescriptionFor(item.value, props.result)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          props.onPatch({ action: item.value })
                          props.onExecute(item.value)
                        }}
                      >
                        确认执行
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button
                  aria-label={item.label}
                  aria-pressed={active}
                  disabled={props.disabled}
                  size="sm"
                  variant={variant}
                  onClick={() => props.onExecute(item.value)}
                >
                  <Icon />
                  <span>{item.shortLabel}</span>
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function isDestructive(action: SeriexAction, dryRun: boolean): boolean {
  if (action === "execute" || action === "apply") return true
  void dryRun
  return false
}

function dangerTitle(action: SeriexAction): string {
  if (action === "execute") return "确认执行文件移动？"
  if (action === "apply") return "确认应用系列计划？"
  return "确认真实执行 Seriex？"
}

function dangerDescriptionFor(action: SeriexAction, result: SeriexCardState["result"]): string {
  if (action === "execute" || action === "apply") {
    const series = result?.totalSeries ?? 0
    const files = result?.totalFiles ?? 0
    return `当前将按计划把 ${files} 个文件移动到 ${series} 个系列文件夹，此操作会修改文件系统且不可撤销。请确认目录和配置无误后继续。`
  }
  return "当前操作会修改文件系统，请确认无误后继续。"
}

export function PathFields(props: {
  data: SeriexCardState
  disabled?: boolean
  onPatch: (patch: Partial<SeriexCardState>) => void
}) {
  return (
    <div data-testid="seriex-path-fields" className="grid gap-2 @2xl/seriex:grid-cols-2">
      <Field className="gap-1.5">
        <Label htmlFor="seriex-directory" className="text-xs">目录路径</Label>
        <PathInput
          id="seriex-directory"
          aria-label="seriex directory path"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/Media/Novels"
          value={props.data.directoryPath ?? ""}
          onValueChange={(directoryPath) => props.onPatch({ directoryPath })}
        />
      </Field>
      <Field className="gap-1.5">
        <Label htmlFor="seriex-config" className="text-xs">配置文件路径</Label>
        <PathInput
          id="seriex-config"
          aria-label="seriex config path"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="留空使用内嵌配置"
          value={props.data.configPath ?? ""}
          extensions={[".toml", ".json", ".yaml", ".yml"]}
          onValueChange={(configPath) => props.onPatch({ configPath })}
        />
      </Field>
      <Field className="gap-1.5">
        <Label htmlFor="seriex-prefix" className="text-xs">系列前缀</Label>
        <Input
          id="seriex-prefix"
          aria-label="seriex prefix"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="[#s]"
          value={props.data.prefix ?? ""}
          onChange={(event) => props.onPatch({ prefix: event.currentTarget.value })}
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
  data: SeriexCardState
  disabled?: boolean
  onPatch: (patch: Partial<SeriexCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="seriex-key-switches"
    >
      <SwitchRow
        checked={props.data.addPrefix ?? true}
        description="开启后系列文件夹会加上配置的前缀（如 [#s]）。"
        disabled={props.disabled}
        icon={Info}
        label="添加前缀"
        onCheckedChange={(addPrefix) => props.onPatch({ addPrefix })}
      />
      <SwitchRow
        checked={props.data.dryRun ?? false}
        description="开启后只生成命令计划，不移动任何文件。"
        disabled={props.disabled}
        icon={Info}
        label="预演模式"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: SeriexCardState
  disabled?: boolean
  onPatch: (patch: Partial<SeriexCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="seriex advanced options" disabled={props.disabled} size="icon-sm" variant="outline">
              <FolderTree />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,520px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">目录、配置文件、前缀和预演开关收在这里。</p>
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
  defaults?: Partial<SeriexCardState>
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
            <Button aria-label="seriex defaults" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 Seriex 的目录、前缀和已知系列到明文配置。</p>
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
                <DialogTitle>Seriex 配置</DialogTitle>
                <DialogDescription>当前 nodes.seriex 默认值和配置文件位置。</DialogDescription>
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
  config?: Partial<SeriexCardState>
  path?: string
}) {
  const content = props.config === undefined ? "# nodes.seriex 暂无默认配置\n" : JSON.stringify(props.config, null, 2)
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
  status: SeriexStatusMeta
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
