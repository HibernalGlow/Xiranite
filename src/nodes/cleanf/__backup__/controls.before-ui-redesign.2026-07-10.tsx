import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, Eye, Info, ShieldAlert, Sparkles } from "lucide-react"
import type { CleanfPresetId } from "@xiranite/node-cleanf/core"
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
import { PRESET_METAS } from "./constants"
import type { CleanfCardState, CleanfStatusMeta } from "./types"

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

export function PathInput(props: {
  compact?: boolean
  disabled?: boolean
  pathCount: number
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onPaste: () => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="cleanf-paths">扫描路径</Label>
          <Badge variant="outline" className="shrink-0">{props.pathCount} 条</Badge>
        </div>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="cleanf-paths"
          aria-label={tNode("cleanf", "aria.scanPaths", "cleanf scan paths")}
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-24")}
          disabled={props.disabled}
          placeholder={"每行一个文件夹路径\nD:/gallery\nD:/archives"}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        <div className="grid content-start gap-1.5">
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
          <ActionIconButton disabled={props.disabled || !props.value} icon={Eraser} label="清空路径" onClick={props.onClear} />
        </div>
      </div>
    </div>
  )
}

export function PresetPicker(props: {
  disabled?: boolean
  selected: CleanfPresetId[]
  onToggle: (id: CleanfPresetId) => void
}) {
  return (
    <div data-testid="cleanf-preset-picker" className="grid gap-1">
      {PRESET_METAS.map((preset) => {
        const active = props.selected.includes(preset.id)
        const Icon = preset.icon
        return (
          <button
            key={preset.id}
            aria-label={preset.label}
            aria-pressed={active}
            disabled={props.disabled}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
              active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/50",
              props.disabled && "opacity-60",
            )}
            onClick={() => props.onToggle(preset.id)}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate font-medium">{preset.label}</span>
            <InfoHint label={preset.label} description={preset.description} />
          </button>
        )
      })}
    </div>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: CleanfCardState
  disabled?: boolean
  onPatch: (patch: Partial<CleanfCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="cleanf-primary-switches"
    >
      <SwitchRow
        checked={props.data.previewMode ?? true}
        disabled={props.disabled}
        icon={ShieldAlert}
        label="预演模式"
        description="开启后只扫描并预览将要删除的项目，不写入文件系统。关闭后会真实删除。"
        onCheckedChange={(previewMode) => props.onPatch({ previewMode })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: CleanfCardState
  disabled?: boolean
  onPatch: (patch: Partial<CleanfCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label={tNode("cleanf", "aria.advancedOptions", "cleanf advanced options")} disabled={props.disabled} size="icon-sm" variant="outline">
              <Sparkles />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">排除关键词用于跳过路径中包含这些字符串的项目。</p>
        </div>
        <div className="grid gap-2">
          <TextField
            label="排除关键词"
            placeholder="逗号分隔，如: node_modules, .git"
            value={props.data.excludeKeywords ?? ""}
            disabled={props.disabled}
            onChange={(excludeKeywords) => props.onPatch({ excludeKeywords })}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<CleanfCardState>
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
            <Button aria-label={tNode("cleanf", "aria.defaults", "cleanf defaults")} disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 Cleanf 的路径、预设和预演开关到明文配置。</p>
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
                <DialogTitle>Cleanf 配置</DialogTitle>
                <DialogDescription>当前 nodes.cleanf 默认值和配置文件位置。</DialogDescription>
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
  status: CleanfStatusMeta
  text?: string
}) {
  return (
    <div className={cn("rounded-md border bg-card p-2", props.compact && "p-1.5")}>
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
    <div className="flex min-w-0 items-center justify-between gap-1.5 rounded-md border bg-card px-2 py-1.5">
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

export function ResultList(props: {
  compact?: boolean
  result: CleanfCardState["result"]
}) {
  const result = props.result
  const previewFiles = result?.previewFiles ?? []
  const details = result?.removedDetails ?? {}
  const lines = previewFiles.length
    ? previewFiles
    : Object.entries(details).map(([key, count]) => `${key}: ${count}`)
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5" />
          <span>{lines.length ? `${lines.length} 项` : "等待运行"}</span>
        </div>
        <Badge variant="outline">总计 {result?.totalRemoved ?? 0}</Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {lines.length ? (
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {lines.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            运行后会显示待删除项目和分类统计。
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
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
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
  config?: Partial<CleanfCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.cleanf 暂无默认配置\n"
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
  const id = `cleanf-${props.label}`
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
