import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, Info, Link2, ListTree, PackageOpen, ShieldQuestion, SlidersHorizontal } from "lucide-react"
import type { FindzOutputFormat } from "@xiranite/node-findz/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ACTIONS, DEFAULT_ARCHIVE_SEPARATOR, DEFAULT_WHERE, OUTPUT_FORMATS } from "./constants"
import type { FindzCardState, FindzStatusMeta } from "./types"

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
  value: FindzCardState["action"]
  onActionChange: (value: FindzCardState["action"]) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1" data-testid="findz-action-picker">
      {ACTIONS.map((item) => (
        <Button
          key={item.value}
          aria-label={item.label}
          disabled={props.disabled}
          size="sm"
          variant={(props.value ?? "search") === item.value ? "secondary" : "outline"}
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
  data: FindzCardState
  disabled?: boolean
  pathCount: number
  onPaste: () => void
  onPatch: (patch: Partial<FindzCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="findz-paths">搜索路径</Label>
          <Badge variant="outline" className="shrink-0">{props.pathCount} 条</Badge>
        </div>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="findz-paths"
          aria-label="findz 搜索路径"
          disabled={props.disabled}
          className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-16" : "h-28")}
          placeholder={"每行一个目录，或用 ; 分隔\nD:\\gallery\nD:/archives"}
          value={props.data.pathText ?? ""}
          onChange={(event) => props.onPatch({ pathText: event.currentTarget.value })}
        />
        <div className="grid content-start gap-1.5">
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
          <ActionIconButton
            disabled={props.disabled}
            icon={Eraser}
            label="清空路径"
            onClick={() => props.onPatch({ pathText: "" })}
          />
        </div>
      </div>
    </div>
  )
}

export function WhereInput(props: {
  compact?: boolean
  data: FindzCardState
  disabled?: boolean
  onPatch: (patch: Partial<FindzCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="findz-where">SQL 过滤器</Label>
          <span className="text-xs text-muted-foreground">留空匹配全部</span>
        </div>
      )}
      <Textarea
        id="findz-where"
        aria-label="findz SQL 过滤器"
        disabled={props.disabled}
        className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-20")}
        placeholder={'ext IN ("jpg", "png") AND size < 10M'}
        value={props.data.where ?? DEFAULT_WHERE}
        onChange={(event) => props.onPatch({ where: event.currentTarget.value })}
      />
    </div>
  )
}

export function PrimarySwitches(props: {
  compact?: boolean
  data: FindzCardState
  disabled?: boolean
  onPatch: (patch: Partial<FindzCardState>) => void
}) {
  const action = props.data.action ?? "search"
  return (
    <div
      className={cn(
        "grid gap-2",
        props.compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
      )}
      data-testid="findz-primary-switches"
    >
      <SwitchRow
        checked={props.data.noArchive ?? false}
        disabled={props.disabled || action !== "search"}
        icon={PackageOpen}
        label="跳过压缩包"
        description="普通搜索时不再展开压缩包成员，只扫描文件系统。"
        onCheckedChange={(noArchive) => props.onPatch({ noArchive })}
      />
      <SwitchRow
        checked={props.data.followSymlinks ?? false}
        disabled={props.disabled}
        icon={Link2}
        label="跟随链接"
        description="扫描时跟随符号链接，可能产生重复结果。"
        onCheckedChange={(followSymlinks) => props.onPatch({ followSymlinks })}
      />
      <SwitchRow
        checked={props.data.withImageMeta ?? false}
        disabled={props.disabled}
        icon={ShieldQuestion}
        label="图片元数据"
        description="读取图片宽高/分辨率，可用 width、height、resolution 等字段。"
        onCheckedChange={(withImageMeta) => props.onPatch({ withImageMeta })}
      />
      <SwitchRow
        checked={props.data.longFormat ?? true}
        disabled={props.disabled}
        icon={ListTree}
        label="长格式"
        description="文本输出附带日期、时间和大小列。"
        onCheckedChange={(longFormat) => props.onPatch({ longFormat })}
      />
    </div>
  )
}

export function AdvancedOptionsPopover(props: {
  data: FindzCardState
  disabled?: boolean
  onPatch: (patch: Partial<FindzCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="findz 高级选项" disabled={props.disabled} size="icon-sm" variant="outline">
              <SlidersHorizontal />
              <span className="sr-only">高级选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>高级选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,520px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">高级选项</div>
          <p className="text-xs text-muted-foreground">分组、refine、输出格式与限制参数集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="分组字段"
              placeholder="archive/ext/dir"
              value={props.data.groupBy ?? ""}
              disabled={props.disabled}
              onChange={(groupBy) => props.onPatch({ groupBy })}
            />
            <TextField
              label="refine 表达式"
              placeholder="count > 10"
              value={props.data.refine ?? ""}
              disabled={props.disabled}
              onChange={(refine) => props.onPatch({ refine })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="排序字段"
              value={props.data.sortBy ?? "avgSize"}
              disabled={props.disabled}
              values={[
                ["name", "名称"],
                ["count", "数量"],
                ["totalSize", "总大小"],
                ["avgSize", "平均大小"],
              ]}
              onChange={(value) => props.onPatch({ sortBy: value as FindzCardState["sortBy"] })}
            />
            <SelectField
              label="排序方向"
              value={props.data.sortDesc ? "desc" : "asc"}
              disabled={props.disabled}
              values={[
                ["asc", "升序"],
                ["desc", "降序"],
              ]}
              onChange={(value) => props.onPatch({ sortDesc: value === "desc" })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="最大结果数"
              min={0}
              value={props.data.maxResults ?? 0}
              disabled={props.disabled}
              onChange={(maxResults) => props.onPatch({ maxResults })}
            />
            <NumberField
              label="返回条数上限"
              min={0}
              value={props.data.maxReturnFiles ?? 5000}
              disabled={props.disabled}
              onChange={(maxReturnFiles) => props.onPatch({ maxReturnFiles })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="输出格式"
              value={props.data.outputFormat ?? "text"}
              disabled={props.disabled}
              values={OUTPUT_FORMATS.map((item) => [item.value, item.label] as [string, string])}
              onChange={(value) => props.onPatch({ outputFormat: value as FindzOutputFormat })}
            />
            <TextField
              label="归档分隔符"
              value={props.data.archiveSeparator ?? DEFAULT_ARCHIVE_SEPARATOR}
              disabled={props.disabled}
              onChange={(archiveSeparator) => props.onPatch({ archiveSeparator })}
            />
          </div>
          <TextField
            label="输出文件路径"
            placeholder="留空则只在卡片内显示"
            value={props.data.outputPath ?? ""}
            disabled={props.disabled}
            onChange={(outputPath) => props.onPatch({ outputPath })}
          />
          <SwitchRow
            checked={props.data.continueOnError ?? true}
            disabled={props.disabled}
            icon={Info}
            label="遇错继续"
            description="扫描中遇到不可读路径时记录错误并继续，关闭后遇到首个错误即中止。"
            onCheckedChange={(continueOnError) => props.onPatch({ continueOnError })}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<FindzCardState>
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
            <Button aria-label="findz 默认配置" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">findz 默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 Findz 的动作、路径、过滤器和开关到明文配置。</p>
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
                <DialogTitle>Findz 配置</DialogTitle>
                <DialogDescription>当前 nodes.findz 默认值和配置文件位置。</DialogDescription>
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
  status: FindzStatusMeta
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
  config?: Partial<FindzCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.findz 暂无默认配置\n"
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
  const id = `findz-${props.label}`
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
  min?: number
  onChange: (value: number) => void
  value: number
}) {
  const id = `findz-${props.label}`
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{props.label}</Label>
      <Input
        id={id}
        disabled={props.disabled}
        min={props.min}
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
      <Select value={props.value} disabled={props.disabled} onValueChange={props.onChange}>
        <SelectTrigger aria-label={props.label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.values.map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
