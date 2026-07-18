import type { LucideIcon } from "lucide-react"
import { Clipboard, DatabaseZap, Eraser, Info, SlidersHorizontal } from "lucide-react"
import type { RegistryHive } from "@xiranite/node-owithu/core"
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
import { ACTIONS, HIVES } from "./constants"
import type { OwithuCardState, OwithuStatusMeta } from "./types"

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
  value: OwithuCardState["action"]
  onActionChange: (value: OwithuCardState["action"]) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1" data-testid="owithu-action-picker">
      {ACTIONS.map((item) => (
        <Button
          key={item.value}
          aria-label={item.label}
          disabled={props.disabled}
          size="sm"
          variant={(props.value ?? "preview") === item.value ? "secondary" : "outline"}
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
  data: OwithuCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<OwithuCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="owithu-path">配置文件路径</Label>
          {props.data.path ? (
            <Badge variant="outline" className="shrink-0">已设置</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">可选</span>
          )}
        </div>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
        <Input
          id="owithu-path"
          aria-label="owithu 配置文件路径"
          disabled={props.disabled}
          className="min-w-0 font-mono text-xs"
          placeholder={"D:\\config\\owithu.toml 或留空使用下方 TOML"}
          value={props.data.path ?? ""}
          onChange={(event) => props.onPatch({ path: event.currentTarget.value })}
        />
        <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
        <ActionIconButton
          disabled={props.disabled}
          icon={Eraser}
          label="清空路径"
          onClick={() => props.onPatch({ path: "" })}
        />
      </div>
    </div>
  )
}

export function ConfigTextInput(props: {
  compact?: boolean
  data: OwithuCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<OwithuCardState>) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      {!props.compact && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="owithu-toml">TOML 配置内容</Label>
          <div className="flex shrink-0 items-center gap-1.5">
            {props.data.configText ? (
              <Badge variant="outline">{props.data.configText.length} 字符</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">与路径二选一</span>
            )}
            <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴 TOML" onClick={props.onPaste} />
          </div>
        </div>
      )}
      <Textarea
        id="owithu-toml"
        aria-label="owithu TOML 配置"
        disabled={props.disabled}
        className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-20" : "h-32")}
        placeholder={'[vars]\napp = "D:\\Tools\\app.exe"\n\n[[entries]]\nkey = "open-with-app"\nlabel = "用 App 打开"\nexe = "{app}"\nargs = ["%1"]\nscope = ["file"]'}
        value={props.data.configText ?? ""}
        onChange={(event) => props.onPatch({ configText: event.currentTarget.value })}
      />
    </div>
  )
}

export function HivePicker(props: {
  compact?: boolean
  disabled?: boolean
  value: RegistryHive | ""
  onValueChange: (value: RegistryHive | "") => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5" data-testid="owithu-hive-picker">
      {!props.compact && <Label className="text-xs">注册表位置</Label>}
      <div className="grid grid-cols-4 gap-1">
        {HIVES.map((item) => (
          <Button
            key={item.value || "default"}
            aria-label={`注册表位置 ${item.label}`}
            disabled={props.disabled}
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

export function OptionsPopover(props: {
  data: OwithuCardState
  disabled?: boolean
  onPatch: (patch: Partial<OwithuCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="owithu 高级选项" disabled={props.disabled} size="icon-sm" variant="outline">
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
          <p className="text-xs text-muted-foreground">注册表位置与条目过滤集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <HivePicker disabled={props.disabled} value={props.data.hive ?? ""} onValueChange={(hive) => props.onPatch({ hive })} />
          <div>
            <Label htmlFor="owithu-only-key" className="text-xs">只处理指定 key</Label>
            <Input
              id="owithu-only-key"
              aria-label="owithu 条目 key 过滤"
              disabled={props.disabled}
              className="mt-1.5 font-mono text-xs"
              placeholder="留空处理全部条目"
              value={props.data.onlyKey ?? ""}
              onChange={(event) => props.onPatch({ onlyKey: event.currentTarget.value })}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">填写条目 key 后只会处理该条目，便于单独注册/注销。</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<OwithuCardState>
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
            <Button aria-label="owithu 默认配置" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">owithu 默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 Owithu 的动作、路径、TOML 和注册表位置到明文配置。</p>
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
                <DialogTitle>Owithu 配置</DialogTitle>
                <DialogDescription>当前 nodes.owithu 默认值和配置文件位置。</DialogDescription>
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
  status: OwithuStatusMeta
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

function ConfigPreview(props: {
  config?: Partial<OwithuCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.owithu 暂无默认配置\n"
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
