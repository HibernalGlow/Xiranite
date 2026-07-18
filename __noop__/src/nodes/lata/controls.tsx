import type { LucideIcon } from "lucide-react"
import { ClipboardPaste, Settings2 } from "lucide-react"
import type { LataTaskInfo } from "@xiranite/node-lata/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { LataCardState, LataStatusMeta } from "./types"

export function ActionIconButton(props: {
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: "outline" | "secondary" | "destructive"
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={props.label}
          disabled={props.disabled}
          size="icon-sm"
          variant={props.variant ?? "outline"}
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

export function TaskfileInput(props: {
  compact?: boolean
  data: LataCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<LataCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="lata-taskfile-input">
      <Label htmlFor="lata-taskfile" className="text-xs">Taskfile 路径</Label>
      <div className="flex min-w-0 gap-1.5">
        <Input
          id="lata-taskfile"
          aria-label="lata taskfile path"
          disabled={props.disabled}
          className="min-w-0 flex-1 font-mono text-xs"
          placeholder="D:/repo/Taskfile.yml"
          value={props.data.taskfilePath ?? ""}
          onChange={(event) => props.onPatch({ taskfilePath: event.currentTarget.value })}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="粘贴 Taskfile 路径" disabled={props.disabled} size="icon-sm" variant="outline" onClick={props.onPaste}>
              <ClipboardPaste />
            </Button>
          </TooltipTrigger>
          <TooltipContent>粘贴 Taskfile 路径</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export function ArgsInput(props: {
  data: LataCardState
  disabled?: boolean
  onPatch: (patch: Partial<LataCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor="lata-args" className="text-xs">任务参数</Label>
      <Input
        id="lata-args"
        aria-label="lata task args"
        disabled={props.disabled}
        className="font-mono text-xs"
        placeholder="--flag value"
        value={props.data.taskArgs ?? ""}
        onChange={(event) => props.onPatch({ taskArgs: event.currentTarget.value })}
      />
    </div>
  )
}

export function TaskPicker(props: {
  compact?: boolean
  disabled?: boolean
  selectedTask: string
  tasks: LataTaskInfo[]
  onTaskChange: (task: string) => void
}) {
  if (!props.tasks.length) {
    return (
      <div className="flex min-w-0 flex-wrap gap-1" data-testid="lata-task-picker">
        <Button disabled size="sm" variant="outline">
          <span className="truncate text-xs">尚无任务</span>
        </Button>
      </div>
    )
  }
  return (
    <div className={cn("flex min-w-0 flex-wrap gap-1", props.compact && "max-h-20 overflow-auto")} data-testid="lata-task-picker">
      {props.tasks.map((task) => (
        <Button
          key={task.name}
          aria-label={task.name}
          disabled={props.disabled}
          size="sm"
          variant={props.selectedTask === task.name ? "secondary" : "outline"}
          onClick={() => props.onTaskChange(task.name)}
        >
          <span className="truncate text-xs">{task.name}</span>
        </Button>
      ))}
    </div>
  )
}

export function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<LataCardState>
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
            <Button aria-label="lata defaults" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <Settings2 />
              <span className="sr-only">默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 Lata 的 Taskfile 路径、任务名和参数到明文配置。</p>
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
                <DialogTitle>Lata 配置</DialogTitle>
                <DialogDescription>当前 nodes.lata 默认值和配置文件位置。</DialogDescription>
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
  status: LataStatusMeta
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
  config?: Partial<LataCardState>
  path?: string
}) {
  const content = props.config === undefined ? "# nodes.lata 暂无默认配置\n" : JSON.stringify(props.config, null, 2)
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
