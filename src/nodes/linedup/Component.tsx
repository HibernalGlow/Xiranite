import { useMemo } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type { LinedupFilterResult } from "@xiranite/node-linedup/core"
import { filterLines, splitLines } from "@xiranite/node-linedup/core"
import type { LucideIcon } from "lucide-react"
import { Clipboard, Copy, Eraser, Filter, RotateCcw, Settings2, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { LinedupDisplayTabs, StatsPanel } from "./ResultPanels"
import type { LinedupCardState, LinedupPhase, LinedupStatusMeta } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<LinedupCardState>(compId) ?? {}
  const sourceText = data.sourceText ?? ""
  const filterText = data.filterText ?? ""
  const logs = data.logs ?? []
  const result = data.result ?? null
  const phase = data.phase ?? "idle"
  const caseSensitive = data.caseSensitive ?? true
  const sort = data.sort ?? true
  const sourceLines = useMemo(() => splitLines(sourceText).filter((line) => line.trim()), [sourceText])
  const filterTokens = useMemo(() => splitLines(filterText).filter((line) => line.trim()), [filterText])
  const status = statusFromState(phase, result, sourceLines.length, filterTokens.length)
  const progress = phase === "completed" ? 100 : result ? 100 : 0
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  function patch(patchData: Partial<LinedupCardState>) {
    host.patchData(compId, patchData)
  }

  async function paste(field: "sourceText" | "filterText") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text })
  }

  function execute() {
    if (!sourceLines.length) {
      patch({ phase: "error", logs: [...logs, "请先粘贴源文本。"].slice(-120) })
      return
    }
    const next = filterLines({ sourceLines, filterLines: filterTokens, caseSensitive, sort })
    patch({
      phase: "completed",
      result: next,
      logs: [...logs, `保留 ${next.keptCount} 行，移除 ${next.removedCount} 行。`].slice(-120),
    })
  }

  function reset() {
    patch({ phase: "idle", result: null, logs: [] })
  }

  async function copyLines(lines: string[]) {
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function download() {
    host.downloadText?.("linedup-output.txt", result?.filteredLines.join("\n") ?? "")
  }

  const commonProps = {
    caseSensitive,
    filterCount: filterTokens.length,
    filterText,
    logs,
    phase,
    progress,
    result,
    sort,
    sourceCount: sourceLines.length,
    sourceText,
    status,
    onCopyKept: () => copyLines(result?.filteredLines ?? []),
    onCopyRemoved: () => copyLines(result?.removedLines ?? []),
    onDownload: download,
    onExecute: execute,
    onPasteFilter: () => paste("filterText"),
    onPasteSource: () => paste("sourceText"),
    onPatch: patch,
    onReset: reset,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/linedup relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,hsl(var(--primary)/0.12),transparent_36%),radial-gradient(circle_at_88%_8%,hsl(var(--chart-3)/0.12),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact ? <PortraitCompactView {...commonProps} /> : <CompactView {...commonProps} />
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

type ViewProps = {
  caseSensitive: boolean
  filterCount: number
  filterText: string
  logs: string[]
  phase: LinedupPhase
  progress: number
  result: LinedupFilterResult | null
  sort: boolean
  sourceCount: number
  sourceText: string
  status: LinedupStatusMeta
  onCopyKept: () => void
  onCopyRemoved: () => void
  onDownload: () => void
  onExecute: () => void
  onPasteFilter: () => void
  onPasteSource: () => void
  onPatch: (patch: Partial<LinedupCardState>) => void
  onReset: () => void
}

function CollapsedView(props: ViewProps) {
  return (
    <div data-testid="linedup-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Filter />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Linedup</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <ActionIconButton disabled={!props.sourceCount} icon={Zap} label="运行过滤" onClick={props.onExecute} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="linedup-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover {...props} />
          <ActionIconButton disabled={!props.sourceCount} icon={Zap} label="运行过滤" onClick={props.onExecute} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <TextAreas compact {...props} />
        <div className="min-h-0 flex-1">
          <LinedupDisplayTabs
            compact
            logs={props.logs}
            phase={props.phase}
            result={props.result}
            sourceText={props.sourceText}
            onCopyKept={props.onCopyKept}
            onCopyRemoved={props.onCopyRemoved}
            onDownload={props.onDownload}
          />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="linedup-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover {...props} />
          <ActionIconButton disabled={!props.sourceCount} icon={Zap} label="运行过滤" onClick={props.onExecute} />
        </div>
      </div>
      <TextAreas compact {...props} />
      <div className="min-h-0 flex-1">
        <LinedupDisplayTabs
          compact
          logs={props.logs}
          phase={props.phase}
          result={props.result}
          sourceText={props.sourceText}
          onCopyKept={props.onCopyKept}
          onCopyRemoved={props.onCopyRemoved}
          onDownload={props.onDownload}
        />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="linedup-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/linedup:flex-row @4xl/linedup:items-center @4xl/linedup:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/linedup:flex-row @4xl/linedup:items-center">
          <HeaderLine status={props.status} subtitle={summaryText(props)} />
          <div data-testid="linedup-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <Button disabled={!props.sourceCount} size="sm" onClick={props.onExecute}>
              <Zap />
              运行过滤
            </Button>
            <ActionIconButton disabled={!props.result} icon={Copy} label="复制保留结果" onClick={props.onCopyKept} />
            <ActionIconButton disabled={!props.result} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
            <OptionsPopover {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} sourceCount={props.sourceCount} filterCount={props.filterCount} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/linedup:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <TextAreas {...props} />
        </section>
        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/linedup:h-full">
          <LinedupDisplayTabs
            logs={props.logs}
            phase={props.phase}
            result={props.result}
            sourceText={props.sourceText}
            onCopyKept={props.onCopyKept}
            onCopyRemoved={props.onCopyRemoved}
            onDownload={props.onDownload}
          />
        </div>
      </div>
    </div>
  )
}

function TextAreas(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("grid min-h-0 gap-2", props.compact ? "grid-cols-2" : "flex-1 grid-rows-2")}>
      <TextAreaField
        compact={props.compact}
        label="源文本"
        placeholder="每行一个条目"
        value={props.sourceText}
        onChange={(sourceText) => props.onPatch({ sourceText })}
        onClear={() => props.onPatch({ sourceText: "" })}
        onPaste={props.onPasteSource}
      />
      <TextAreaField
        compact={props.compact}
        label="过滤词"
        placeholder="包含这些词的行会被移除"
        value={props.filterText}
        onChange={(filterText) => props.onPatch({ filterText })}
        onClear={() => props.onPatch({ filterText: "" })}
        onPaste={props.onPasteFilter}
      />
    </div>
  )
}

function TextAreaField(props: {
  compact?: boolean
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onPaste: () => void
}) {
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{props.label}</Label>
        <div className="flex shrink-0 items-center gap-1">
          <ActionIconButton icon={Clipboard} label={`粘贴${props.label}`} onClick={props.onPaste} />
          <ActionIconButton disabled={!props.value} icon={Eraser} label={`清空${props.label}`} onClick={props.onClear} />
        </div>
      </div>
      <Textarea
        aria-label={props.label}
        className={cn("min-h-0 flex-1 resize-none font-mono text-xs", props.compact ? "h-24" : "h-full")}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  )
}

function OptionsPopover(props: ViewProps) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="linedup options" size="icon-sm" variant="outline">
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>过滤选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">过滤选项</div>
          <p className="text-xs text-muted-foreground">控制匹配大小写和结果排序，适合处理路径、标签或清单文本。</p>
        </div>
        <div className="grid gap-3">
          <SwitchRow
            checked={props.caseSensitive}
            description="开启后 beta 不会匹配 Beta。"
            label="区分大小写"
            onCheckedChange={(caseSensitive) => props.onPatch({ caseSensitive })}
          />
          <SwitchRow
            checked={props.sort}
            description="开启后保留和移除结果按自然顺序排序。"
            label="结果排序"
            onCheckedChange={(sort) => props.onPatch({ sort })}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SwitchRow(props: {
  checked: boolean
  description: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.label}</div>
        <div className="text-xs text-muted-foreground">{props.description}</div>
      </div>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  )
}

function ActionIconButton(props: {
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant="outline" onClick={props.onClick}>
          <Icon />
          <span className="sr-only">{props.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function HeaderLine({ status, subtitle }: {
  status: LinedupStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Filter />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Linedup</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function statusFromState(phase: LinedupPhase, result: LinedupFilterResult | null, sourceCount: number, filterCount: number): LinedupStatusMeta {
  if (phase === "error") {
    return {
      label: "失败",
      description: "缺少源文本，无法过滤。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (phase === "completed" && result) {
    return {
      label: "完成",
      description: `保留 ${result.keptCount} 行，移除 ${result.removedCount} 行。`,
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (sourceCount || filterCount) {
    return {
      label: "待过滤",
      description: `${sourceCount} 源 / ${filterCount} 过滤词`,
      tone: "idle",
      badgeVariant: "outline",
      iconClass: "bg-secondary text-secondary-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴源文本和过滤词后运行。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.result) return `保留 ${props.result.keptCount} / 移除 ${props.result.removedCount}`
  if (props.sourceCount || props.filterCount) return `${props.sourceCount} 源 / ${props.filterCount} 过滤词`
  return "粘贴文本后移除匹配行"
}
