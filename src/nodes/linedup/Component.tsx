import { useMemo, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type { LinedupFilterResult } from "@xiranite/node-linedup/core"
import { filterLines, splitLines } from "@xiranite/node-linedup/core"
import type { LucideIcon } from "lucide-react"
import { Clipboard, Copy, Download, Eraser, Filter, RotateCcw, Terminal, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
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

  const [filterMode, setFilterMode] = useState<"regex" | "contains" | "exact">("contains")
  const [invertMatch, setInvertMatch] = useState(false)
  const [outputView, setOutputView] = useState<"kept" | "removed">("kept")

  const sourceLines = useMemo(() => splitLines(sourceText).filter((line) => line.trim()), [sourceText])
  const filterTokens = useMemo(() => splitLines(filterText).filter((line) => line.trim()), [filterText])

  const status = statusFromState(phase, result, sourceLines.length, filterTokens.length)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  const displayResult = useMemo(() => {
    if (!result) return null
    if (invertMatch) {
      return {
        filteredLines: result.removedLines,
        removedLines: result.filteredLines,
        keptCount: result.removedCount,
        removedCount: result.keptCount,
      }
    }
    return result
  }, [result, invertMatch])

  const outputLines = outputView === "kept" ? (displayResult?.filteredLines ?? []) : (displayResult?.removedLines ?? [])
  const outputCount = outputView === "kept" ? (displayResult?.keptCount ?? 0) : (displayResult?.removedCount ?? 0)

  const keptCount = displayResult?.keptCount ?? 0
  const removedCount = displayResult?.removedCount ?? 0
  const totalProcessed = keptCount + removedCount
  const keptPercent = totalProcessed > 0 ? (keptCount / totalProcessed) * 100 : 0
  const removedPercent = totalProcessed > 0 ? (removedCount / totalProcessed) * 100 : 0

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
    displayResult,
    filterMode,
    filterText,
    filterTokens,
    invertMatch,
    keptCount,
    keptPercent,
    logs,
    outputCount,
    outputLines,
    outputView,
    phase,
    removedCount,
    removedPercent,
    sort,
    sourceCount: sourceLines.length,
    sourceText,
    status,
    totalProcessed,
    onCopyKept: () => copyLines(displayResult?.filteredLines ?? []),
    onCopyRemoved: () => copyLines(displayResult?.removedLines ?? []),
    onCopyOutput: () => copyLines(outputLines),
    onDownload: download,
    onExecute: execute,
    onFilterModeChange: setFilterMode,
    onInvertMatchChange: setInvertMatch,
    onOutputViewChange: setOutputView,
    onPasteFilter: () => paste("filterText"),
    onPasteSource: () => paste("sourceText"),
    onPatch: patch,
    onReset: reset,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/linedup relative flex h-full min-h-0 w-full overflow-hidden bg-background">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-3)_8%,transparent),transparent_34%)]" />
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
  displayResult: LinedupFilterResult | null
  filterMode: "regex" | "contains" | "exact"
  filterText: string
  filterTokens: string[]
  invertMatch: boolean
  keptCount: number
  keptPercent: number
  logs: string[]
  outputCount: number
  outputLines: string[]
  outputView: "kept" | "removed"
  phase: LinedupPhase
  removedCount: number
  removedPercent: number
  sort: boolean
  sourceCount: number
  sourceText: string
  status: LinedupStatusMeta
  totalProcessed: number
  onCopyKept: () => void
  onCopyRemoved: () => void
  onCopyOutput: () => void
  onDownload: () => void
  onExecute: () => void
  onFilterModeChange: (mode: "regex" | "contains" | "exact") => void
  onInvertMatchChange: (v: boolean) => void
  onOutputViewChange: (v: "kept" | "removed") => void
  onPasteFilter: () => void
  onPasteSource: () => void
  onPatch: (patch: Partial<LinedupCardState>) => void
  onReset: () => void
}

/* ------------------------------------------------------------------ */
//  Full three-column industrial workbench
/* ------------------------------------------------------------------ */

function FullView(props: ViewProps) {
  return (
    <div data-testid="linedup-full-view" className="flex min-h-0 flex-1 flex-col">
      <WorkbenchHeader {...props} />
      <div className="grid min-h-0 flex-1 grid-cols-1 @5xl/linedup:grid-cols-[1fr_280px_1fr]">
        <RawInputPanel {...props} />
        <FilterLogicPanel {...props} />
        <FilteredOutputPanel {...props} />
      </div>
    </div>
  )
}

function WorkbenchHeader(props: ViewProps) {
  const isActive = props.phase === "completed" || props.phase === "ready"
  return (
    <div data-testid="linedup-header-toolbar" className="flex shrink-0 items-center justify-between gap-3 border-b bg-card/40 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <div className={cn("grid size-7 shrink-0 place-items-center rounded-md", props.status.iconClass)}>
          <Filter className="size-4" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-semibold tracking-wider text-muted-foreground">LINEDUP</span>
          <span className="text-[10px] text-muted-foreground">/</span>
          <span className="text-[10px] font-mono tracking-wider">
            STATUS:{" "}
            <span className={cn(isActive ? "text-emerald-500" : "text-amber-500")}>{props.status.label.toUpperCase()}</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-muted-foreground/30")} />
          <span className={cn("text-[10px] font-mono tracking-wider", isActive ? "text-emerald-500" : "text-muted-foreground/60")}>
            {isActive ? "STREAM_ACTIVE" : "STREAM_IDLE"}
          </span>
        </div>
        <span className="hidden text-[10px] font-mono tracking-wider text-muted-foreground @3xl/linedup:inline">
          VOL: {(props.sourceCount * 0.05).toFixed(1)} MB/s
        </span>
      </div>
    </div>
  )
}

function RawInputPanel(props: ViewProps) {
  return (
    <Card className="h-full rounded-none border-0 border-r bg-card/20">
      <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3">
        <CardTitle className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">RAW_INPUT</CardTitle>
        <div className="flex items-center gap-1">
          <ActionIconButton icon={Clipboard} label="粘贴源文本" onClick={props.onPasteSource} />
          <ActionIconButton disabled={!props.sourceText} icon={Eraser} label="清空源文本" onClick={() => props.onPatch({ sourceText: "" })} />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-3 py-0">
        <Textarea
          aria-label="源文本"
          className="min-h-0 flex-1 resize-none rounded-md border bg-background/60 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="每行一个条目..."
          value={props.sourceText}
          onChange={(e) => props.onPatch({ sourceText: e.currentTarget.value })}
        />
        {props.logs.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Terminal className="size-3" />
              LOG_STREAM
            </div>
            <ScrollArea className="h-14">
              <div className="flex flex-col gap-0.5">
                {props.logs.slice(-5).map((log, i) => (
                  <div key={i} className="text-[10px] font-mono text-muted-foreground">{`> ${log}`}</div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t py-2 px-3">
        <Badge variant="outline" className="text-[10px] font-mono">
          {props.phase.toUpperCase()}
        </Badge>
        <span className="text-[10px] font-mono tracking-wider text-muted-foreground">LINES: {props.sourceCount}</span>
      </CardFooter>
    </Card>
  )
}

function FilterLogicPanel(props: ViewProps) {
  return (
    <Card className="h-full rounded-none border-0 border-r bg-card/40">
      <CardHeader className="space-y-0 py-2 px-3">
        <CardTitle className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">OP_01</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter Mode</Label>
          <ToggleGroup
            type="single"
            value={props.filterMode}
            onValueChange={(v) => v && props.onFilterModeChange(v as "regex" | "contains" | "exact")}
            className="w-full"
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="regex" className="flex-1 text-xs font-mono">
              Regex
            </ToggleGroupItem>
            <ToggleGroupItem value="contains" className="flex-1 text-xs font-mono">
              Contains
            </ToggleGroupItem>
            <ToggleGroupItem value="exact" className="flex-1 text-xs font-mono">
              Exact
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter Tokens</Label>
            <div className="flex items-center gap-1">
              <ActionIconButton icon={Clipboard} label="粘贴过滤词" onClick={props.onPasteFilter} />
              <ActionIconButton disabled={!props.filterText} icon={Eraser} label="清空过滤词" onClick={() => props.onPatch({ filterText: "" })} />
            </div>
          </div>
          <Textarea
            aria-label="过滤词"
            className="min-h-[72px] resize-none rounded-md border bg-background/60 font-mono text-xs shadow-none focus-visible:ring-1"
            placeholder="ERROR | WARN | ..."
            value={props.filterText}
            onChange={(e) => props.onPatch({ filterText: e.currentTarget.value })}
          />
        </div>

        <div className="space-y-2">
          <SwitchRow
            label="Match Case"
            description="区分大小写匹配"
            checked={props.caseSensitive}
            onCheckedChange={(v) => props.onPatch({ caseSensitive: v })}
          />
          <SwitchRow
            label="Invert Match"
            description="保留匹配项而非移除"
            checked={props.invertMatch}
            onCheckedChange={props.onInvertMatchChange}
          />
        </div>

        <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Modifiers</div>
          <SwitchRow
            label="Sort Results"
            description="按字母顺序排序输出"
            checked={props.sort}
            onCheckedChange={(v) => props.onPatch({ sort: v })}
          />
        </div>

        <div className="mt-auto space-y-2 rounded-md border p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Processing Delta</div>
          <div className="flex items-end gap-4">
            <div>
              <div className="text-2xl font-bold leading-none tabular-nums">{props.keptCount}</div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Lines Kept</div>
            </div>
            <div>
              <div className="text-2xl font-bold leading-none tabular-nums text-destructive">{props.removedCount}</div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Removed</div>
            </div>
          </div>
          {props.totalProcessed > 0 && (
            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${props.keptPercent}%` }} />
              <div className="h-full bg-destructive transition-all" style={{ width: `${props.removedPercent}%` }} />
            </div>
          )}
        </div>

        <Button disabled={!props.sourceCount} size="sm" className="w-full gap-2 font-mono text-xs" onClick={props.onExecute}>
          <Zap className="size-4" />
          EXECUTE
        </Button>
      </CardContent>
    </Card>
  )
}

function FilteredOutput