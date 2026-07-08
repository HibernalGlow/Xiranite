import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, FolderSearch, Info, Search, ShieldAlert, Tag } from "lucide-react"
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
import { ACTIONS, DEFAULT_KEYWORDS_TEXT, DEFAULT_SCAN_DEPTH } from "./constants"
import type { KavvkaCardState, KavvkaStatusMeta } from "./types"

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

export function PathTextPanel(props: {
  ariaLabel: string
  badgeTone?: "default" | "secondary" | "outline"
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
            <Badge variant={props.badgeTone ?? "outline"} className="shrink-0">{props.count} 条</Badge>
          </div>
        )}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
          <Textarea
            id={props.inputId}
            aria-label={props.ariaLabel}
            className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-20")}
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

export function KeywordAndDepthFields(props: {
  data: KavvkaCardState
  disabled?: boolean
  onPatch: (patch: Partial<KavvkaCardState>) => void
}) {
  return (
    <div className="grid gap-2 @2xl/kavvka:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <KeywordField disabled={props.disabled} value={props.data.keywordText ?? DEFAULT_KEYWORDS_TEXT} onChange={(keywordText) => props.onPatch({ keywordText })} />
      <DepthField disabled={props.disabled} value={props.data.scanDepth ?? DEFAULT_SCAN_DEPTH} onChange={(scanDepth) => props.onPatch({ scanDepth })} />
    </div>
  )
}

function KeywordField(props: { disabled?: boolean; value: string; onChange: (value: string) => void }) {
  return (
    <Field className="gap-1.5">
      <Label htmlFor="kavvka-keywords" className="text-xs">关键词</Label>
      <Input
        id="kavvka-keywords"
        aria-label="kavvka scan keywords"
        className="font-mono text-xs"
        disabled={props.disabled}
        placeholder="画集, CG, 图集..."
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

function DepthField(props: { disabled?: boolean; value: number; onChange: (value: number) => void }) {
  return (
    <Field className="gap-1.5">
      <Label htmlFor="kavvka-depth" className="text-xs">扫描深度</Label>
      <Input
        id="kavvka-depth"
        aria-label="kavvka scan depth"
        className="font-mono text-xs"
        disabled={props.disabled}
        max={10}
        min={0}
        type="number"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </Field>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: KavvkaCardState
  disabled?: boolean
  onPatch: (patch: Partial<KavvkaCardState>) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="kavvka-key-switches"
    >
      <SwitchRow
        checked={props.data.force ?? true}
        description="允许把兄弟文件夹移入 #compare 目录。"
        disabled={props.disabled}
        icon={FolderSearch}
        label="强制移动"
        onCheckedChange={(force) => props.onPatch({ force })}
      />
      <SwitchRow
        checked={props.data.dryRun ?? true}
        description="开启时只生成 Czkawka 路径，不写入文件系统。"
        disabled={props.disabled}
        icon={ShieldAlert}
        label="预演"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
      <SwitchRow
        checked={props.data.strictArtist ?? false}
        description="强制要求源路径中存在带 [] 标记的画师目录。"
        disabled={props.disabled}
        icon={Tag}
        label="严格画师"
        onCheckedChange={(strictArtist) => props.onPatch({ strictArtist })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: KavvkaCardState
  disabled?: boolean
  onPatch: (patch: Partial<KavvkaCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="kavvka advanced options" disabled={props.disabled} size="icon-sm" variant="outline">
              <Search />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">关键词、扫描深度和严格画师等低频参数收在这里。</p>
        </div>
        <div className="grid gap-3">
          <KeywordAndDepthFields data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
          <PrimarySwitches data={props.data} disabled={props.disabled} onPatch={props.onPatch} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<KavvkaCardState>
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
            <Button aria-label="kavvka defaults" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
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
          <p className="text-xs text-muted-foreground">保存 Kavvka 的扫描路径、关键词和风险开关到明文配置。</p>
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
                <DialogTitle>Kavvka 配置</DialogTitle>
                <DialogDescription>当前 nodes.kavvka 默认值和配置文件位置。</DialogDescription>
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
  config?: Partial<KavvkaCardState>
  path?: string
}) {
  const content = props.config === undefined ? "# nodes.kavvka 暂无默认配置\n" : JSON.stringify(props.config, null, 2)
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
  status: KavvkaStatusMeta
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

export function ActionMeta(value: KavvkaCardState["action"]): typeof ACTIONS[number] {
  return ACTIONS.find((item) => item.value === value) ?? ACTIONS[0]!
}
