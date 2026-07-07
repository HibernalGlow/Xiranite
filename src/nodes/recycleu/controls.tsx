import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Clock, Copy, Gauge, Info, RotateCcw, Settings2, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { INTERVAL_PRESETS } from "./constants"
import type { RecycleuCardState, RecycleuStatusMeta } from "./types"

interface PatchProps {
  data: RecycleuCardState
  disabled?: boolean
  onPatch: (patch: Partial<RecycleuCardState>) => void
}

export function CleanupFields({ compact = false, data, disabled, onPatch }: PatchProps & {
  compact?: boolean
}) {
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-[1fr_1fr_86px]" : "@md/recycleu:grid-cols-[1fr_1fr_104px]")}>
      <NumberField
        ariaLabel="清理间隔秒数"
        disabled={disabled}
        icon={Clock}
        label="间隔"
        max={3600}
        min={5}
        suffix="s"
        value={data.interval ?? 10}
        onChange={(interval) => onPatch({ interval })}
      />
      <NumberField
        ariaLabel="最大循环次数"
        disabled={disabled}
        icon={Gauge}
        label="次数"
        max={360}
        min={1}
        value={data.maxCycles ?? 1}
        onChange={(maxCycles) => onPatch({ maxCycles })}
      />
      <DriveField
        disabled={disabled}
        value={data.driveLetter ?? ""}
        onChange={(driveLetter) => onPatch({ driveLetter })}
      />
    </div>
  )
}

export function IntervalPresets({ disabled, value, onChange }: {
  disabled?: boolean
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {INTERVAL_PRESETS.map((preset) => (
        <Button
          key={preset}
          disabled={disabled}
          size="xs"
          variant={value === preset ? "secondary" : "outline"}
          onClick={() => onChange(preset)}
        >
          {preset < 60 ? `${preset}s` : "1m"}
        </Button>
      ))}
    </div>
  )
}

export function ConfirmActionButton(props: {
  children?: ReactNode
  confirmLabel: string
  description: string
  disabled?: boolean
  icon: LucideIcon
  label: string
  title: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost"
  onConfirm: () => void
}) {
  const Icon = props.icon
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={props.disabled} size="sm" variant={props.variant ?? "default"}>
          <Icon />
          {props.children ?? props.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function IconConfirmButton(props: {
  confirmLabel: string
  description: string
  disabled?: boolean
  icon: LucideIcon
  label: string
  title: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const Icon = props.icon
  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              aria-label={props.label}
              disabled={props.disabled}
              size="icon-sm"
              variant={props.destructive ? "destructive" : "outline"}
            >
              <Icon />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{props.label}</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SettingsPopover({ data, disabled, onPatch }: PatchProps) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="清理参数" size="icon-sm" variant="outline">
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>清理参数</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,420px)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">清理参数</div>
            <p className="text-xs text-muted-foreground">折叠状态也可以完整调整间隔、次数和盘符。</p>
          </div>
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="grid gap-3">
          <CleanupFields data={data} disabled={disabled} onPatch={onPatch} />
          <IntervalPresets
            disabled={disabled}
            value={data.interval ?? 10}
            onChange={(interval) => onPatch({ interval })}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TimerDial(props: {
  cleanCount: number
  compact?: boolean
  progress: number
  remainingSeconds: number
  running: boolean
  status: RecycleuStatusMeta
}) {
  const progress = Math.max(0, Math.min(100, props.progress))
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full p-1",
        props.compact ? "size-20" : "size-28",
      )}
      style={{
        background: `conic-gradient(hsl(var(--primary)) ${progress}%, hsl(var(--muted)) ${progress}% 100%)`,
      }}
    >
      <div className="grid h-full w-full place-items-center rounded-full bg-background/95 shadow-inner">
        <div className="text-center">
          {props.running ? (
            <div className={cn("font-semibold tabular-nums", props.compact ? "text-base" : "text-2xl")}>
              {props.remainingSeconds}s
            </div>
          ) : (
            <Trash2 className={cn("mx-auto text-muted-foreground", props.compact ? "size-5" : "size-7")} />
          )}
          <div className="mt-1 text-[10px] text-muted-foreground">{props.cleanCount} 次</div>
        </div>
      </div>
      {props.status.tone === "running" && (
        <span className="absolute inset-0 rounded-full ring-2 ring-primary/30 animate-pulse" />
      )}
    </div>
  )
}

export function StatusStrip({ compact = false, progress, status, text }: {
  compact?: boolean
  progress: number
  status: RecycleuStatusMeta
  text?: string
}) {
  return (
    <div className={cn("rounded-md border bg-background/70 p-3", compact && "p-2")}>
      <div className="flex min-w-0 items-center gap-2">
        <Badge className="shrink-0" variant={status.badgeVariant}>{status.label}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{text || status.detail}</span>
      </div>
      {status.tone === "running" && <Progress className="mt-2" value={progress} />}
    </div>
  )
}

export function LogPanel({ compact = false, logs, onCopyLogs, onReset }: {
  compact?: boolean
  logs: string[]
  onCopyLogs: () => void
  onReset: () => void
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="text-sm font-semibold">运行日志</div>
        <div className="flex items-center gap-1">
          <Button disabled={!logs.length} size="xs" variant="outline" onClick={onCopyLogs}>
            <Copy />
            复制
          </Button>
          <Button size="xs" variant="ghost" onClick={onReset}>
            <RotateCcw />
            重置
          </Button>
        </div>
      </div>
      <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background/70", compact ? "max-h-24" : "max-h-[38vh]")}>
        <div className="space-y-1 p-3 font-mono text-xs leading-5">
          {logs.length ? logs.map((line, index) => (
            <div key={`${index}-${line}`} className="break-words text-muted-foreground">{line}</div>
          )) : (
            <div className="text-muted-foreground">暂无日志。启动后会显示倒计时、清理结果和错误。</div>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function NumberField(props: {
  ariaLabel: string
  disabled?: boolean
  icon: LucideIcon
  label: string
  max: number
  min: number
  suffix?: string
  value: number
  onChange: (value: number) => void
}) {
  const Icon = props.icon
  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {props.label}
      </Label>
      <div className="relative">
        <Input
          aria-label={props.ariaLabel}
          disabled={props.disabled}
          max={props.max}
          min={props.min}
          type="number"
          value={props.value}
          onChange={(event) => {
            const value = Number(event.currentTarget.value)
            if (Number.isFinite(value)) props.onChange(Math.max(props.min, Math.min(props.max, Math.floor(value))))
          }}
        />
        {props.suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{props.suffix}</span>}
      </div>
    </div>
  )
}

function DriveField(props: {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs" htmlFor="recycleu-drive">盘符</Label>
      <Input
        id="recycleu-drive"
        aria-label="盘符"
        disabled={props.disabled}
        maxLength={2}
        placeholder="全部"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value.toUpperCase().replace(/[^A-Z:]/g, "").slice(0, 2))}
      />
    </div>
  )
}
